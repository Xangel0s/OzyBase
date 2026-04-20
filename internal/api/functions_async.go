package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/labstack/echo/v4"
)

type functionRuntimeConfig struct {
	Name            string
	Script          string
	Runtime         string
	WASMModule      []byte
	TimeoutMS       int
	Entrypoint      string
	MaxConcurrency  int
	MaxRPM          int
	PayloadMaxBytes int
	MaxRetries      int
}

type functionJob struct {
	ID             string         `json:"id"`
	FunctionName   string         `json:"function_name"`
	WorkspaceID    *string        `json:"workspace_id,omitempty"`
	Status         string         `json:"status"`
	Attempts       int            `json:"attempts"`
	MaxAttempts    int            `json:"max_attempts"`
	IdempotencyKey string         `json:"idempotency_key,omitempty"`
	Payload        map[string]any `json:"payload,omitempty"`
	Result         map[string]any `json:"result,omitempty"`
	Error          string         `json:"error,omitempty"`
	AvailableAt    time.Time      `json:"available_at"`
	StartedAt      *time.Time     `json:"started_at,omitempty"`
	CompletedAt    *time.Time     `json:"completed_at,omitempty"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
}

func (h *FunctionsHandler) PatchConfig(c echo.Context) error {
	name := strings.TrimSpace(c.Param("name"))
	if name == "" || !data.IsValidIdentifier(name) {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid function name"})
	}

	cfg, err := h.getFunctionRuntimeConfig(c.Request().Context(), name)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Function not found"})
	}

	var req struct {
		TimeoutMS       *int `json:"timeout_ms"`
		MaxConcurrency  *int `json:"max_concurrency"`
		MaxRPM          *int `json:"max_rpm"`
		PayloadMaxBytes *int `json:"payload_max_bytes"`
		MaxRetries      *int `json:"max_retries"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid function config payload"})
	}

	if req.TimeoutMS != nil {
		cfg.TimeoutMS = normalizeFunctionTimeout(*req.TimeoutMS)
	}
	if req.MaxConcurrency != nil {
		cfg.MaxConcurrency = normalizeFunctionMaxConcurrency(*req.MaxConcurrency)
	}
	if req.MaxRPM != nil {
		cfg.MaxRPM = normalizeFunctionMaxRPM(*req.MaxRPM)
	}
	if req.PayloadMaxBytes != nil {
		cfg.PayloadMaxBytes = normalizeFunctionPayloadMaxBytes(*req.PayloadMaxBytes)
	}
	if req.MaxRetries != nil {
		cfg.MaxRetries = normalizeFunctionMaxRetries(*req.MaxRetries)
	}

	if _, err := h.DB.Pool.Exec(c.Request().Context(), `
		UPDATE _v_functions
		SET timeout_ms = $2,
		    max_concurrency = $3,
		    max_rpm = $4,
		    payload_max_bytes = $5,
		    max_retries = $6,
		    updated_at = NOW()
		WHERE name = $1
	`, name, cfg.TimeoutMS, cfg.MaxConcurrency, cfg.MaxRPM, cfg.PayloadMaxBytes, cfg.MaxRetries); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to update function config"})
	}

	return c.JSON(http.StatusOK, map[string]any{
		"name":              cfg.Name,
		"timeout_ms":        cfg.TimeoutMS,
		"max_concurrency":   cfg.MaxConcurrency,
		"max_rpm":           cfg.MaxRPM,
		"payload_max_bytes": cfg.PayloadMaxBytes,
		"max_retries":       cfg.MaxRetries,
	})
}

func (h *FunctionsHandler) InvokeAsync(c echo.Context) error {
	if !h.AsyncEnabled {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "functions async v1 is disabled"})
	}
	name := strings.TrimSpace(c.Param("name"))
	if name == "" || !data.IsValidIdentifier(name) {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid function name"})
	}

	cfg, err := h.getFunctionRuntimeConfig(c.Request().Context(), name)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Function not found"})
	}

	if cfg.PayloadMaxBytes <= 0 {
		cfg.PayloadMaxBytes = defaultFunctionPayloadMaxBytes
	}
	if c.Request().ContentLength > int64(cfg.PayloadMaxBytes) && c.Request().ContentLength >= 0 {
		return c.JSON(http.StatusRequestEntityTooLarge, map[string]string{"error": "payload exceeds configured function limit"})
	}

	workspaceID := strings.TrimSpace(workspaceIDFromContext(c))
	if err := h.enforceFunctionRPM(c.Request().Context(), name, workspaceID, cfg.MaxRPM); err != nil {
		return c.JSON(http.StatusTooManyRequests, map[string]any{
			"error":       "function invocation rate limit exceeded",
			"error_code":  "FUNCTION_RATE_LIMIT_EXCEEDED",
			"retry_after": 60,
		})
	}

	payload := map[string]any{}
	if err := json.NewDecoder(c.Request().Body).Decode(&payload); err != nil && err.Error() != "EOF" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid function payload"})
	}
	payloadJSON, _ := json.Marshal(payload)

	idempotencyKey := strings.TrimSpace(c.Request().Header.Get("Idempotency-Key"))
	if idempotencyKey == "" {
		idempotencyKey = strings.TrimSpace(c.QueryParam("idempotency_key"))
	}
	if idempotencyKey != "" {
		if existing, found, findErr := h.findFunctionJobByIdempotency(c.Request().Context(), name, workspaceID, idempotencyKey); findErr == nil && found {
			return c.JSON(http.StatusAccepted, map[string]any{
				"job_id":            existing.ID,
				"status":            existing.Status,
				"idempotent_replay": true,
			})
		}
	}

	var workspacePtr *string
	if workspaceID != "" {
		workspacePtr = &workspaceID
	}
	var jobID string
	err = h.DB.Pool.QueryRow(c.Request().Context(), `
		INSERT INTO _v_function_jobs (function_name, workspace_id, status, attempts, max_attempts, idempotency_key, payload, available_at, updated_at)
		VALUES ($1, $2, 'queued', 0, $3, NULLIF($4, ''), $5::jsonb, NOW(), NOW())
		RETURNING id
	`, name, workspacePtr, cfg.MaxRetries+1, idempotencyKey, string(payloadJSON)).Scan(&jobID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to queue function job"})
	}

	return c.JSON(http.StatusAccepted, map[string]any{
		"job_id":            jobID,
		"status":            "queued",
		"idempotent_replay": false,
	})
}

func (h *FunctionsHandler) GetJob(c echo.Context) error {
	jobID := strings.TrimSpace(c.Param("id"))
	if jobID == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "job id is required"})
	}
	workspaceID := strings.TrimSpace(workspaceIDFromContext(c))
	job, found, err := h.getFunctionJob(c.Request().Context(), jobID, workspaceID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to load function job"})
	}
	if !found {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "function job not found"})
	}
	return c.JSON(http.StatusOK, job)
}

func (h *FunctionsHandler) UpsertSecret(c echo.Context) error {
	name := strings.TrimSpace(c.Param("name"))
	if name == "" || !data.IsValidIdentifier(name) {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid function name"})
	}

	var req struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid secret payload"})
	}
	secretKey := strings.TrimSpace(req.Key)
	secretValue := strings.TrimSpace(req.Value)
	if secretKey == "" || secretValue == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "key and value are required"})
	}

	workspaceID := strings.TrimSpace(workspaceIDFromContext(c))
	var workspacePtr *string
	if workspaceID != "" {
		workspacePtr = &workspaceID
	}

	ciphertext, err := encryptKeyMaterial(apiKeySecretEncryptionSecret(), secretValue)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to encrypt function secret"})
	}

	ctx := c.Request().Context()
	tx, err := h.DB.Pool.Begin(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to start secret transaction"})
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var currentVersion int
	_ = tx.QueryRow(ctx, `
		SELECT version
		FROM _v_function_secrets
		WHERE function_name = $1
		  AND COALESCE(workspace_id::text, '') = COALESCE($2::text, '')
		  AND secret_key = $3
		  AND is_active = TRUE
		ORDER BY version DESC
		LIMIT 1
	`, name, workspacePtr, secretKey).Scan(&currentVersion)

	if _, err := tx.Exec(ctx, `
		UPDATE _v_function_secrets
		SET is_active = FALSE, updated_at = NOW()
		WHERE function_name = $1
		  AND COALESCE(workspace_id::text, '') = COALESCE($2::text, '')
		  AND secret_key = $3
		  AND is_active = TRUE
	`, name, workspacePtr, secretKey); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to rotate existing secret"})
	}

	nextVersion := currentVersion + 1
	if nextVersion <= 0 {
		nextVersion = 1
	}
	var actorUserID *string
	if uid := strings.TrimSpace(userIDFromContext(c)); uid != "" {
		if _, parseErr := uuid.Parse(uid); parseErr == nil {
			actorUserID = &uid
		}
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO _v_function_secrets (function_name, workspace_id, secret_key, secret_ciphertext, version, is_active, created_by_user_id, updated_at)
		VALUES ($1, $2, $3, $4, $5, TRUE, $6, NOW())
	`, name, workspacePtr, secretKey, ciphertext, nextVersion, actorUserID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to persist function secret"})
	}
	_, _ = tx.Exec(ctx, `
		INSERT INTO _v_function_secret_audit (function_name, workspace_id, secret_key, version, actor_user_id, action)
		VALUES ($1, $2, $3, $4, $5, 'upsert')
	`, name, workspacePtr, secretKey, nextVersion, actorUserID)

	if err := tx.Commit(ctx); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to commit secret update"})
	}

	return c.JSON(http.StatusCreated, map[string]any{
		"function":     name,
		"key":          secretKey,
		"version":      nextVersion,
		"workspace_id": workspaceID,
		"status":       "stored",
	})
}

func (h *FunctionsHandler) getFunctionRuntimeConfig(ctx context.Context, name string) (functionRuntimeConfig, error) {
	cfg := functionRuntimeConfig{}
	err := h.DB.Pool.QueryRow(ctx, `
		SELECT name, script, runtime, wasm_module, timeout_ms, entrypoint, max_concurrency, max_rpm, payload_max_bytes, max_retries
		FROM _v_functions
		WHERE name = $1
	`, name).Scan(&cfg.Name, &cfg.Script, &cfg.Runtime, &cfg.WASMModule, &cfg.TimeoutMS, &cfg.Entrypoint, &cfg.MaxConcurrency, &cfg.MaxRPM, &cfg.PayloadMaxBytes, &cfg.MaxRetries)
	if err != nil {
		return cfg, err
	}
	cfg.TimeoutMS = normalizeFunctionTimeout(cfg.TimeoutMS)
	cfg.MaxConcurrency = normalizeFunctionMaxConcurrency(cfg.MaxConcurrency)
	cfg.MaxRPM = normalizeFunctionMaxRPM(cfg.MaxRPM)
	cfg.PayloadMaxBytes = normalizeFunctionPayloadMaxBytes(cfg.PayloadMaxBytes)
	cfg.MaxRetries = normalizeFunctionMaxRetries(cfg.MaxRetries)
	if strings.TrimSpace(cfg.Entrypoint) == "" {
		cfg.Entrypoint = "_start"
	}
	return cfg, nil
}

func (h *FunctionsHandler) enforceFunctionRPM(ctx context.Context, name, workspaceID string, maxRPM int) error {
	maxRPM = normalizeFunctionMaxRPM(maxRPM)
	if maxRPM <= 0 {
		return nil
	}
	pathPattern := "/api/functions/" + strings.TrimSpace(name) + "/invoke%"
	var current int64
	if strings.TrimSpace(workspaceID) == "" {
		err := h.DB.Pool.QueryRow(ctx, `
			SELECT COUNT(*)
			FROM _v_audit_logs
			WHERE path LIKE $1
			  AND created_at >= NOW() - INTERVAL '1 minute'
		`, pathPattern).Scan(&current)
		if err != nil {
			return err
		}
	} else {
		err := h.DB.Pool.QueryRow(ctx, `
			SELECT COUNT(*)
			FROM _v_audit_logs
			WHERE workspace_id = $1
			  AND path LIKE $2
			  AND created_at >= NOW() - INTERVAL '1 minute'
		`, workspaceID, pathPattern).Scan(&current)
		if err != nil {
			return err
		}
	}
	if current >= int64(maxRPM) {
		return errors.New("function rpm exceeded")
	}
	return nil
}

func (h *FunctionsHandler) loadFunctionSecrets(ctx context.Context, functionName, workspaceID string) (map[string]string, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	rows, err := h.DB.Pool.Query(ctx, `
		SELECT secret_key, secret_ciphertext
		FROM _v_function_secrets
		WHERE function_name = $1
		  AND is_active = TRUE
		  AND (workspace_id IS NULL OR workspace_id::text = $2)
		ORDER BY (workspace_id::text = $2) DESC, version DESC
	`, functionName, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	secrets := map[string]string{}
	for rows.Next() {
		var key string
		var ciphertext string
		if err := rows.Scan(&key, &ciphertext); err != nil {
			return nil, err
		}
		if _, exists := secrets[key]; exists {
			continue
		}
		plaintext, err := decryptKeyMaterial(apiKeySecretEncryptionSecret(), ciphertext)
		if err != nil {
			return nil, err
		}
		secrets[key] = plaintext
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return secrets, nil
}

func (h *FunctionsHandler) startAsyncWorker(ctx context.Context) {
	ticker := time.NewTicker(850 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_ = h.processOneAsyncJob(ctx)
		}
	}
}

func (h *FunctionsHandler) processOneAsyncJob(ctx context.Context) error {
	tx, err := h.DB.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var (
		jobID        string
		functionName string
		workspaceID  string
		payloadRaw   string
		attempts     int
		maxAttempts  int
	)
	err = tx.QueryRow(ctx, `
		SELECT j.id, j.function_name, COALESCE(j.workspace_id::text, ''), j.payload::text, j.attempts, j.max_attempts
		FROM _v_function_jobs j
		JOIN _v_functions f ON f.name = j.function_name
		WHERE j.status IN ('queued', 'retrying')
		  AND j.available_at <= NOW()
		  AND (
			SELECT COUNT(*)
			FROM _v_function_jobs r
			WHERE r.function_name = j.function_name
			  AND r.status = 'running'
		  ) < GREATEST(f.max_concurrency, 1)
		ORDER BY j.created_at ASC
		FOR UPDATE SKIP LOCKED
		LIMIT 1
	`).Scan(&jobID, &functionName, &workspaceID, &payloadRaw, &attempts, &maxAttempts)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			_ = tx.Commit(ctx)
			return nil
		}
		return err
	}

	attempts++
	if _, err := tx.Exec(ctx, `
		UPDATE _v_function_jobs
		SET status = 'running', attempts = $2, started_at = NOW(), updated_at = NOW()
		WHERE id = $1
	`, jobID, attempts); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}

	payload := map[string]any{}
	if strings.TrimSpace(payloadRaw) != "" {
		_ = json.Unmarshal([]byte(payloadRaw), &payload)
	}

	resultPayload, runErr := h.executeFunctionByName(ctx, functionName, workspaceID, payload)
	if runErr == nil {
		resultJSON, _ := json.Marshal(resultPayload)
		_, _ = h.DB.Pool.Exec(ctx, `
			UPDATE _v_function_jobs
			SET status = 'succeeded', result = $2::jsonb, error = NULL, completed_at = NOW(), updated_at = NOW()
			WHERE id = $1
		`, jobID, string(resultJSON))
		return nil
	}

	if attempts < maxAttempts {
		backoff := time.Duration(attempts*attempts) * time.Second
		_, _ = h.DB.Pool.Exec(ctx, `
			UPDATE _v_function_jobs
			SET status = 'retrying', error = $2, available_at = NOW() + $3::interval, updated_at = NOW()
			WHERE id = $1
		`, jobID, runErr.Error(), fmt.Sprintf("%d seconds", int(backoff.Seconds())))
		return nil
	}

	_, _ = h.DB.Pool.Exec(ctx, `
		UPDATE _v_function_jobs
		SET status = 'failed', error = $2, completed_at = NOW(), updated_at = NOW()
		WHERE id = $1
	`, jobID, runErr.Error())
	return nil
}

func (h *FunctionsHandler) executeFunctionByName(ctx context.Context, name, workspaceID string, payload map[string]any) (map[string]any, error) {
	cfg, err := h.getFunctionRuntimeConfig(ctx, name)
	if err != nil {
		return nil, err
	}
	secrets, err := h.loadFunctionSecrets(ctx, name, workspaceID)
	if err != nil {
		return nil, err
	}

	runtimeName := strings.ToLower(strings.TrimSpace(cfg.Runtime))
	switch runtimeName {
	case "wasm":
		result, runErr := invokeWASMModule(ctx, cfg.WASMModule, cfg.Entrypoint, payload, secrets, cfg.TimeoutMS)
		if runErr != nil {
			return nil, runErr
		}
		return map[string]any{
			"name":       name,
			"runtime":    "wasm",
			"timeout_ms": cfg.TimeoutMS,
			"result":     result,
		}, nil
	default:
		result, runErr := h.invokeJavaScript(ctx, cfg.Script, payload, secrets)
		if runErr != nil {
			return nil, runErr
		}
		return map[string]any{
			"name":       name,
			"runtime":    "js",
			"timeout_ms": cfg.TimeoutMS,
			"result":     result,
		}, nil
	}
}

func (h *FunctionsHandler) getFunctionJob(ctx context.Context, id string, workspaceID string) (functionJob, bool, error) {
	job := functionJob{}
	workspaceID = strings.TrimSpace(workspaceID)
	var payloadRaw []byte
	var resultRaw []byte
	var workspaceRaw string
	var errorRaw string

	err := h.DB.Pool.QueryRow(ctx, `
		SELECT id,
		       function_name,
		       COALESCE(workspace_id::text, ''),
		       status,
		       attempts,
		       max_attempts,
		       COALESCE(idempotency_key, ''),
		       payload,
		       result,
		       COALESCE(error, ''),
		       available_at,
		       started_at,
		       completed_at,
		       created_at,
		       updated_at
		FROM _v_function_jobs
		WHERE id = $1
	`, id).Scan(
		&job.ID,
		&job.FunctionName,
		&workspaceRaw,
		&job.Status,
		&job.Attempts,
		&job.MaxAttempts,
		&job.IdempotencyKey,
		&payloadRaw,
		&resultRaw,
		&errorRaw,
		&job.AvailableAt,
		&job.StartedAt,
		&job.CompletedAt,
		&job.CreatedAt,
		&job.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return functionJob{}, false, nil
		}
		return functionJob{}, false, err
	}

	if workspaceRaw != "" {
		job.WorkspaceID = &workspaceRaw
	}
	if strings.TrimSpace(errorRaw) != "" {
		job.Error = errorRaw
	}
	if len(payloadRaw) > 0 {
		_ = json.Unmarshal(payloadRaw, &job.Payload)
	}
	if len(resultRaw) > 0 {
		_ = json.Unmarshal(resultRaw, &job.Result)
	}
	if workspaceID != "" && workspaceRaw != "" && workspaceRaw != workspaceID {
		return functionJob{}, false, nil
	}
	return job, true, nil
}

func (h *FunctionsHandler) findFunctionJobByIdempotency(ctx context.Context, functionName, workspaceID, key string) (functionJob, bool, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	key = strings.TrimSpace(key)
	if key == "" {
		return functionJob{}, false, nil
	}
	var id string
	err := h.DB.Pool.QueryRow(ctx, `
		SELECT id
		FROM _v_function_jobs
		WHERE function_name = $1
		  AND COALESCE(workspace_id::text, '') = COALESCE($2::text, '')
		  AND idempotency_key = $3
		ORDER BY created_at DESC
		LIMIT 1
	`, functionName, workspaceID, key).Scan(&id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return functionJob{}, false, nil
		}
		return functionJob{}, false, err
	}
	return h.getFunctionJob(ctx, id, workspaceID)
}
