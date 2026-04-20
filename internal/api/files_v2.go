package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

type storagePolicyDecision struct {
	Resolved    bool
	Allowed     bool
	OwnerFilter string
	Reason      string
}

func (h *FileHandler) ListBucketPolicies(c echo.Context) error {
	if !h.PolicyV2Enabled {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "storage policy v2 is disabled"})
	}

	bucket, err := h.getBucket(c.Request().Context(), normalizeBucketName(c.Param("name")))
	if err != nil {
		return storageErrorResponse(c, err)
	}
	if err := h.ensureLegacyBucketPolicySeed(c.Request().Context(), bucket); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to load storage policies"})
	}

	policies, err := h.listBucketPolicies(c.Request().Context(), bucket.ID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to list storage policies"})
	}
	return c.JSON(http.StatusOK, map[string]any{
		"bucket":   bucket.Name,
		"policies": serializeStoragePolicies(policies),
	})
}

func (h *FileHandler) UpsertBucketPolicies(c echo.Context) error {
	if !h.PolicyV2Enabled {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "storage policy v2 is disabled"})
	}

	bucket, err := h.getBucket(c.Request().Context(), normalizeBucketName(c.Param("name")))
	if err != nil {
		return storageErrorResponse(c, err)
	}

	var req struct {
		Policies []map[string]any `json:"policies"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid policies payload"})
	}

	tx, err := h.DB.Pool.Begin(c.Request().Context())
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to start policy update"})
	}
	defer func() { _ = tx.Rollback(c.Request().Context()) }()

	if _, err := tx.Exec(c.Request().Context(), `DELETE FROM _v_storage_bucket_policies WHERE bucket_id = $1`, bucket.ID); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to clear old policies"})
	}

	for _, item := range req.Policies {
		action := strings.ToLower(strings.TrimSpace(fmt.Sprint(item["action"])))
		effect := strings.ToLower(strings.TrimSpace(fmt.Sprint(item["effect"])))
		if action != "select" && action != "insert" && action != "update" && action != "delete" {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "policy action must be select/insert/update/delete"})
		}
		if effect != "allow" && effect != "deny" {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "policy effect must be allow/deny"})
		}

		priority := 100
		if rawPriority, ok := item["priority"]; ok {
			switch typed := rawPriority.(type) {
			case float64:
				priority = int(typed)
			case int:
				priority = typed
			case int64:
				priority = int(typed)
			}
		}
		if priority < 0 || priority > 10000 {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "policy priority must be between 0 and 10000"})
		}

		subject := map[string]any{}
		if rawSubject, ok := item["subject"]; ok && rawSubject != nil {
			if cast, ok := rawSubject.(map[string]any); ok {
				subject = cast
			}
		}
		description := strings.TrimSpace(fmt.Sprint(item["description"]))
		subjectJSON, _ := json.Marshal(subject)
		if _, err := tx.Exec(c.Request().Context(), `
			INSERT INTO _v_storage_bucket_policies (bucket_id, action, effect, priority, subject, description, is_active, updated_at)
			VALUES ($1, $2, $3, $4, $5::jsonb, $6, TRUE, NOW())
		`, bucket.ID, action, effect, priority, string(subjectJSON), description); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to persist policy"})
		}
	}

	if err := tx.Commit(c.Request().Context()); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to commit policy update"})
	}

	policies, err := h.listBucketPolicies(c.Request().Context(), bucket.ID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to list updated policies"})
	}
	return c.JSON(http.StatusOK, map[string]any{
		"bucket":   bucket.Name,
		"policies": serializeStoragePolicies(policies),
	})
}

func (h *FileHandler) SignURL(c echo.Context) error {
	var req struct {
		Operation       string `json:"operation"`
		Bucket          string `json:"bucket"`
		ObjectPath      string `json:"object_path"`
		FileName        string `json:"filename"`
		ContentType     string `json:"content_type"`
		Size            int64  `json:"size"`
		ExpiresInSecond int64  `json:"expires_in"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid sign payload"})
	}

	req.Operation = strings.ToLower(strings.TrimSpace(req.Operation))
	if req.Operation == "" {
		req.Operation = "read"
	}

	ttl := time.Duration(req.ExpiresInSecond) * time.Second
	if ttl <= 0 {
		ttl = defaultStorageSignedURLTTL
	}
	if ttl > maxStorageSignedURLTTL {
		ttl = maxStorageSignedURLTTL
	}
	expiresAt := time.Now().UTC().Add(ttl)

	bucket, err := h.getBucket(c.Request().Context(), normalizeBucketName(req.Bucket))
	if err != nil {
		return storageErrorResponse(c, err)
	}

	switch req.Operation {
	case "upload":
		if _, err := h.authorizeBucket(c, bucket, storageActionWrite); err != nil {
			return c.JSON(http.StatusForbidden, map[string]string{"error": err.Error()})
		}
		displayName := cleanObjectName(req.FileName)
		if strings.TrimSpace(displayName) == "" {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "filename is required"})
		}
		if req.Size < 0 {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "size must be zero or greater"})
		}
		if err := validateBucketUploadSize(bucket, req.Size); err != nil {
			return c.JSON(http.StatusRequestEntityTooLarge, map[string]string{"error": err.Error()})
		}
		if err := validateBucketTotalQuota(bucket, req.Size); err != nil {
			return c.JSON(http.StatusRequestEntityTooLarge, map[string]string{"error": err.Error()})
		}
		if err := h.validateWorkspaceStorageLimit(c.Request().Context(), workspacePointerFromContext(c), req.Size); err != nil {
			return c.JSON(http.StatusRequestEntityTooLarge, map[string]string{"error": err.Error()})
		}

		contentType := strings.TrimSpace(req.ContentType)
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		objectKey := buildObjectStorageKey(displayName)
		var sessionID string
		err := h.DB.Pool.QueryRow(c.Request().Context(), `
			INSERT INTO _v_storage_upload_sessions (bucket_id, owner_id, workspace_id, name, size, content_type, storage_key, expires_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			RETURNING id
		`, bucket.ID, uuidPointerFromContext(c), workspacePointerFromContext(c), displayName, req.Size, contentType, objectKey, expiresAt).Scan(&sessionID)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to create upload session"})
		}
		uploadToken, signErr := issueStorageUploadToken(h.UploadKey, sessionID, time.Now().UTC(), expiresAt)
		if signErr != nil {
			_, _ = h.DB.Pool.Exec(c.Request().Context(), `DELETE FROM _v_storage_upload_sessions WHERE id = $1`, sessionID)
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to sign upload url"})
		}

		return c.JSON(http.StatusCreated, map[string]any{
			"operation":    "upload",
			"bucket":       bucket.Name,
			"filename":     displayName,
			"storage_key":  objectKey,
			"signed_url":   "/api/files/uploads?token=" + uploadToken,
			"upload_token": uploadToken,
			"expires_at":   expiresAt,
		})
	case "read":
		objectPath := strings.TrimSpace(req.ObjectPath)
		if objectPath == "" {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "object_path is required for read signed urls"})
		}
		if _, err := h.authorizeBucket(c, bucket, storageActionRead); err != nil {
			return c.JSON(http.StatusForbidden, map[string]string{"error": err.Error()})
		}
		token, err := h.issueStorageSignedReadToken(bucket.Name, objectPath, time.Now().UTC(), expiresAt)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to sign read url"})
		}
		return c.JSON(http.StatusCreated, map[string]any{
			"operation":   "read",
			"bucket":      bucket.Name,
			"object_path": objectPath,
			"signed_url":  buildObjectURL(bucket.Name, objectPath) + "?token=" + token,
			"token":       token,
			"expires_at":  expiresAt,
		})
	default:
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "operation must be read or upload"})
	}
}

func (h *FileHandler) issueStorageSignedReadToken(bucketName, objectPath string, now, expiresAt time.Time) (string, error) {
	if strings.TrimSpace(h.UploadKey) == "" {
		return "", fmt.Errorf("storage signing key is required")
	}
	claims := storageSignedURLClaims{
		Scope:      "storage-signed-url",
		Operation:  "read",
		BucketName: strings.TrimSpace(bucketName),
		ObjectPath: strings.TrimSpace(objectPath),
		KeyID:      strings.TrimSpace(h.SignedKeyID),
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			Subject:   strings.TrimSpace(bucketName) + "/" + strings.TrimSpace(objectPath),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(h.UploadKey))
}

func (h *FileHandler) validateStorageSignedReadToken(tokenString string, now time.Time) (storageSignedURLClaims, error) {
	claims := storageSignedURLClaims{}
	if strings.TrimSpace(h.UploadKey) == "" {
		return claims, fmt.Errorf("storage signing key is required")
	}
	token, err := jwt.ParseWithClaims(tokenString, &claims, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return []byte(h.UploadKey), nil
	}, jwt.WithTimeFunc(func() time.Time { return now }))
	if err != nil {
		return claims, err
	}
	if !token.Valid {
		return claims, fmt.Errorf("signed url token is invalid")
	}
	if claims.Scope != "storage-signed-url" || claims.Operation != "read" {
		return claims, fmt.Errorf("signed url scope is invalid")
	}
	if strings.TrimSpace(h.SignedKeyID) != "" && strings.TrimSpace(claims.KeyID) != "" && strings.TrimSpace(claims.KeyID) != strings.TrimSpace(h.SignedKeyID) {
		return claims, fmt.Errorf("signed url key is no longer active")
	}
	return claims, nil
}

func (h *FileHandler) listBucketPolicies(ctx context.Context, bucketID string) ([]storageBucketPolicyRecord, error) {
	rows, err := h.DB.Pool.Query(ctx, `
		SELECT id, action, effect, priority, subject::text, COALESCE(description, ''), is_active, created_at, updated_at
		FROM _v_storage_bucket_policies
		WHERE bucket_id = $1
		ORDER BY priority DESC, created_at ASC
	`, bucketID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	policies := make([]storageBucketPolicyRecord, 0)
	for rows.Next() {
		var rec storageBucketPolicyRecord
		var subject string
		if err := rows.Scan(&rec.ID, &rec.Action, &rec.Effect, &rec.Priority, &subject, &rec.Description, &rec.Active, &rec.CreatedAt, &rec.UpdatedAt); err != nil {
			return nil, err
		}
		rec.SubjectJSON = []byte(subject)
		policies = append(policies, rec)
	}
	return policies, rows.Err()
}

func serializeStoragePolicies(policies []storageBucketPolicyRecord) []map[string]any {
	result := make([]map[string]any, 0, len(policies))
	for _, rec := range policies {
		subject := map[string]any{}
		_ = json.Unmarshal(rec.SubjectJSON, &subject)
		result = append(result, map[string]any{
			"id":          rec.ID,
			"action":      rec.Action,
			"effect":      rec.Effect,
			"priority":    rec.Priority,
			"subject":     subject,
			"description": rec.Description,
			"is_active":   rec.Active,
			"created_at":  rec.CreatedAt,
			"updated_at":  rec.UpdatedAt,
		})
	}
	return result
}

func decodeStoragePolicySubject(raw []byte) storagePolicySubject {
	subject := storagePolicySubject{}
	_ = json.Unmarshal(raw, &subject)
	subject.UserID = strings.TrimSpace(subject.UserID)
	subject.Role = strings.ToLower(strings.TrimSpace(subject.Role))
	subject.WorkspaceID = strings.TrimSpace(subject.WorkspaceID)
	subject.PathPrefix = strings.TrimSpace(subject.PathPrefix)
	return subject
}

func (h *FileHandler) evaluateStoragePolicyV2(c echo.Context, bucket bucketRecord, policyAction, objectOwnerID, objectPath string) (storagePolicyDecision, error) {
	decision := storagePolicyDecision{Resolved: false, Allowed: false}
	if !h.PolicyV2Enabled {
		return decision, nil
	}
	if err := h.ensureLegacyBucketPolicySeed(c.Request().Context(), bucket); err != nil {
		return decision, err
	}
	policies, err := h.listBucketPolicies(c.Request().Context(), bucket.ID)
	if err != nil {
		return decision, err
	}
	if len(policies) == 0 {
		return decision, nil
	}

	eval := storagePolicyEvaluationContext{
		Action:        strings.ToLower(strings.TrimSpace(policyAction)),
		UserID:        strings.TrimSpace(userIDFromContext(c)),
		Role:          strings.ToLower(strings.TrimSpace(roleFromContext(c))),
		WorkspaceID:   strings.TrimSpace(workspaceIDFromContext(c)),
		ObjectOwnerID: strings.TrimSpace(objectOwnerID),
		ObjectPath:    strings.TrimSpace(objectPath),
		IsPublicRead:  strings.TrimSpace(userIDFromContext(c)) == "",
		IsServiceRole: c.Get("is_service_role") == true,
	}

	maxAllow := -1
	maxDeny := -1
	allowOwnerFilter := ""

	for _, policy := range policies {
		if !policy.Active {
			continue
		}
		if strings.ToLower(strings.TrimSpace(policy.Action)) != eval.Action {
			continue
		}
		subject := decodeStoragePolicySubject(policy.SubjectJSON)
		if !subject.matches(eval) {
			continue
		}
		effect := strings.ToLower(strings.TrimSpace(policy.Effect))
		switch effect {
		case "deny":
			if policy.Priority > maxDeny {
				maxDeny = policy.Priority
			}
		case "allow":
			if policy.Priority > maxAllow {
				maxAllow = policy.Priority
				if subject.ObjectOwner && eval.UserID != "" && eval.Action == "select" && eval.ObjectPath == "" {
					allowOwnerFilter = eval.UserID
				}
			}
		}
	}

	if maxDeny >= 0 && maxDeny >= maxAllow {
		decision.Resolved = true
		decision.Allowed = false
		decision.Reason = "denied by bucket policy"
		return decision, nil
	}
	if maxAllow >= 0 {
		decision.Resolved = true
		decision.Allowed = true
		decision.OwnerFilter = allowOwnerFilter
		decision.Reason = "allowed by bucket policy"
		return decision, nil
	}

	return decision, nil
}

func (h *FileHandler) ensureLegacyBucketPolicySeed(ctx context.Context, bucket bucketRecord) error {
	if !h.PolicyV2Enabled {
		return nil
	}
	var existing int
	if err := h.DB.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM _v_storage_bucket_policies WHERE bucket_id = $1`, bucket.ID).Scan(&existing); err != nil {
		return err
	}
	if existing > 0 {
		return nil
	}

	type seedPolicy struct {
		Action   string
		Effect   string
		Priority int
		Subject  map[string]any
		Desc     string
	}
	seed := make([]seedPolicy, 0, 4)
	publicReadSubject := map[string]any{"public": true}
	authenticatedSubject := map[string]any{"authenticated": true}
	adminSubject := map[string]any{"role": "admin"}
	ownerReadSubject := map[string]any{"authenticated": true, "object_owner": true}

	rule := strings.TrimSpace(bucket.RLSRule)
	if !bucket.RLSEnabled {
		if bucket.Public {
			seed = append(seed, seedPolicy{Action: "select", Effect: "allow", Priority: 100, Subject: publicReadSubject, Desc: "legacy public read"})
		} else {
			seed = append(seed, seedPolicy{Action: "select", Effect: "allow", Priority: 100, Subject: authenticatedSubject, Desc: "legacy auth read"})
		}
		seed = append(seed,
			seedPolicy{Action: "insert", Effect: "allow", Priority: 100, Subject: authenticatedSubject, Desc: "legacy auth write"},
			seedPolicy{Action: "update", Effect: "allow", Priority: 100, Subject: authenticatedSubject, Desc: "legacy auth write"},
			seedPolicy{Action: "delete", Effect: "allow", Priority: 100, Subject: authenticatedSubject, Desc: "legacy auth write"},
		)
	} else {
		switch rule {
		case "false":
			seed = append(seed,
				seedPolicy{Action: "select", Effect: "deny", Priority: 1000, Subject: map[string]any{}, Desc: "legacy deny"},
				seedPolicy{Action: "insert", Effect: "deny", Priority: 1000, Subject: map[string]any{}, Desc: "legacy deny"},
				seedPolicy{Action: "update", Effect: "deny", Priority: 1000, Subject: map[string]any{}, Desc: "legacy deny"},
				seedPolicy{Action: "delete", Effect: "deny", Priority: 1000, Subject: map[string]any{}, Desc: "legacy deny"},
			)
		case adminBucketRLSRule:
			seed = append(seed,
				seedPolicy{Action: "select", Effect: "allow", Priority: 800, Subject: adminSubject, Desc: "legacy admin"},
				seedPolicy{Action: "insert", Effect: "allow", Priority: 800, Subject: adminSubject, Desc: "legacy admin"},
				seedPolicy{Action: "update", Effect: "allow", Priority: 800, Subject: adminSubject, Desc: "legacy admin"},
				seedPolicy{Action: "delete", Effect: "allow", Priority: 800, Subject: adminSubject, Desc: "legacy admin"},
			)
		case defaultBucketRLSRule:
			seed = append(seed,
				seedPolicy{Action: "select", Effect: "allow", Priority: 700, Subject: ownerReadSubject, Desc: "legacy owner read"},
				seedPolicy{Action: "insert", Effect: "allow", Priority: 700, Subject: authenticatedSubject, Desc: "legacy owner write"},
				seedPolicy{Action: "update", Effect: "allow", Priority: 700, Subject: ownerReadSubject, Desc: "legacy owner write"},
				seedPolicy{Action: "delete", Effect: "allow", Priority: 700, Subject: ownerReadSubject, Desc: "legacy owner write"},
			)
		default:
			if bucket.Public {
				seed = append(seed, seedPolicy{Action: "select", Effect: "allow", Priority: 100, Subject: publicReadSubject, Desc: "legacy fallback public read"})
			} else {
				seed = append(seed, seedPolicy{Action: "select", Effect: "allow", Priority: 100, Subject: authenticatedSubject, Desc: "legacy fallback auth read"})
			}
			seed = append(seed,
				seedPolicy{Action: "insert", Effect: "allow", Priority: 100, Subject: authenticatedSubject, Desc: "legacy fallback auth write"},
				seedPolicy{Action: "update", Effect: "allow", Priority: 100, Subject: authenticatedSubject, Desc: "legacy fallback auth write"},
				seedPolicy{Action: "delete", Effect: "allow", Priority: 100, Subject: authenticatedSubject, Desc: "legacy fallback auth write"},
			)
		}
	}

	for _, item := range seed {
		subjectJSON, _ := json.Marshal(item.Subject)
		if _, err := h.DB.Pool.Exec(ctx, `
			INSERT INTO _v_storage_bucket_policies (bucket_id, action, effect, priority, subject, description, is_active, updated_at)
			VALUES ($1, $2, $3, $4, $5::jsonb, $6, TRUE, NOW())
		`, bucket.ID, item.Action, item.Effect, item.Priority, string(subjectJSON), item.Desc); err != nil {
			return err
		}
	}
	return nil
}

func (s storagePolicySubject) matches(eval storagePolicyEvaluationContext) bool {
	if s.Public && eval.UserID != "" {
		return false
	}
	if s.Authenticated && eval.UserID == "" {
		return false
	}
	if s.UserID != "" && s.UserID != eval.UserID {
		return false
	}
	if s.Role != "" && s.Role != eval.Role {
		return false
	}
	if s.WorkspaceID != "" && s.WorkspaceID != eval.WorkspaceID {
		return false
	}
	if s.RequireService && !eval.IsServiceRole {
		return false
	}
	if s.ObjectOwner {
		if eval.UserID == "" {
			return false
		}
		if eval.ObjectOwnerID != "" && eval.ObjectOwnerID != eval.UserID {
			return false
		}
		if eval.ObjectOwnerID == "" && eval.ObjectPath != "" {
			return false
		}
	}
	if s.PathPrefix != "" && !strings.HasPrefix(eval.ObjectPath, s.PathPrefix) {
		return false
	}
	return true
}

func (h *FileHandler) auditStorageObjectAccess(c echo.Context, bucket *bucketRecord, object *storedObject, action string, allowed bool, reason string) {
	if h == nil || h.DB == nil || h.DB.Pool == nil {
		return
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 2*time.Second)
	defer cancel()

	var bucketID *string
	if bucket != nil {
		bucketID = &bucket.ID
	}
	var objectID *string
	var objectPath string
	if object != nil {
		objectID = &object.ID
		objectPath = strings.TrimSpace(object.StoragePath)
	}
	if objectPath == "" {
		objectPath = strings.TrimSpace(c.Param("*"))
	}

	role := strings.ToLower(strings.TrimSpace(roleFromContext(c)))
	ip := strings.TrimSpace(c.RealIP())
	userAgent := strings.TrimSpace(c.Request().UserAgent())

	var userIDPtr *string
	if uid := strings.TrimSpace(userIDFromContext(c)); uid != "" {
		if _, err := uuid.Parse(uid); err == nil {
			userIDPtr = &uid
		}
	}
	var workspaceIDPtr *string
	if wid := strings.TrimSpace(workspaceIDFromContext(c)); wid != "" {
		if _, err := uuid.Parse(wid); err == nil {
			workspaceIDPtr = &wid
		}
	}

	_, _ = h.DB.Pool.Exec(ctx, `
		INSERT INTO _v_storage_object_access_audit (bucket_id, object_id, action, allowed, reason, user_id, role, workspace_id, object_path, ip_address, user_agent)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
	`, bucketID, objectID, strings.TrimSpace(action), allowed, strings.TrimSpace(reason), userIDPtr, role, workspaceIDPtr, objectPath, ip, userAgent)
}

func (h *FileHandler) enforceObjectPolicyV2(c echo.Context, bucket bucketRecord, policyAction string, object storedObject) error {
	if !h.PolicyV2Enabled {
		return nil
	}
	ownerID := ""
	if object.OwnerID != nil {
		ownerID = strings.TrimSpace(*object.OwnerID)
	}
	decision, err := h.evaluateStoragePolicyV2(c, bucket, policyAction, ownerID, strings.TrimSpace(object.StoragePath))
	if err != nil {
		return err
	}
	if decision.Resolved && !decision.Allowed {
		return fmt.Errorf("access denied by bucket policy")
	}
	return nil
}

func userIDFromContext(c echo.Context) string {
	if c == nil {
		return ""
	}
	if value, ok := c.Get("user_id").(string); ok {
		return strings.TrimSpace(value)
	}
	return ""
}

func roleFromContext(c echo.Context) string {
	if c == nil {
		return ""
	}
	if value, ok := c.Get("role").(string); ok {
		return strings.TrimSpace(value)
	}
	if value, ok := c.Get("workspace_role").(string); ok {
		return strings.TrimSpace(value)
	}
	return ""
}

func workspaceIDFromContext(c echo.Context) string {
	if c == nil {
		return ""
	}
	if value, ok := c.Get("workspace_id").(string); ok {
		return strings.TrimSpace(value)
	}
	return ""
}
