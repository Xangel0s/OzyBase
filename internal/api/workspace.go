package api

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"net/http"
	"net/mail"
	"os"
	"strings"
	"time"

	"github.com/Xangel0s/OzyBase/internal/core"
	"github.com/Xangel0s/OzyBase/internal/mailer"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5"
	"github.com/labstack/echo/v4"
)

type WorkspaceHandler struct {
	service *core.WorkspaceService
	mailer  mailer.Mailer
}

func NewWorkspaceHandler(service *core.WorkspaceService, mailer mailer.Mailer) *WorkspaceHandler {
	return &WorkspaceHandler{service: service, mailer: mailer}
}

func workspaceActorID(c echo.Context) (string, bool) {
	userID, ok := c.Get("user_id").(string)
	if !ok || strings.TrimSpace(userID) == "" {
		return "", false
	}
	return userID, true
}

func (h *WorkspaceHandler) requireWorkspaceRole(c echo.Context, workspaceID string) (string, bool, error) {
	userID, ok := workspaceActorID(c)
	if !ok {
		return "", false, c.JSON(http.StatusUnauthorized, map[string]string{"error": "authentication required"})
	}

	isMember, role, err := h.service.IsMember(c.Request().Context(), workspaceID, userID)
	if err != nil {
		return "", false, internalAPIError(c, http.StatusInternalServerError, "workspace.require_role", err, "Unable to validate project access right now.")
	}
	if !isMember {
		return "", false, c.JSON(http.StatusForbidden, map[string]string{"error": "workspace access denied"})
	}
	return role, true, nil
}

func (h *WorkspaceHandler) Create(c echo.Context) error {
	userID := c.Get("user_id").(string)
	var req struct {
		Name string `json:"name"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}

	if req.Name == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "name is required"})
	}

	ws, err := h.service.CreateWorkspace(c.Request().Context(), req.Name, userID)
	if err != nil {
		return internalAPIError(c, http.StatusInternalServerError, "workspace.create", err, "Unable to create the project right now.")
	}

	return c.JSON(http.StatusCreated, ws)
}

func (h *WorkspaceHandler) List(c echo.Context) error {
	userID := c.Get("user_id").(string)
	workspaces, err := h.service.ListWorkspacesForUser(c.Request().Context(), userID)
	if err != nil {
		return internalAPIError(c, http.StatusInternalServerError, "workspace.list", err, "Unable to load projects right now.")
	}
	return c.JSON(http.StatusOK, workspaces)
}

func (h *WorkspaceHandler) Bootstrap(c echo.Context) error {
	userID, ok := workspaceActorID(c)
	if !ok {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "authentication required"})
	}
	requestID := RequestIDFromContext(c)
	role, _ := c.Get("role").(string)
	log.Printf("request_id=%s operation=workspace_bootstrap stage=start user_id=%s role=%s", requestID, userID, strings.TrimSpace(role))

	existingWorkspaces, err := h.service.ListWorkspacesForUser(c.Request().Context(), userID)
	if err != nil {
		return internalAPIError(c, http.StatusInternalServerError, "workspace.bootstrap.list_user_workspaces", err, "Unable to resolve project access right now.")
	}
	if len(existingWorkspaces) > 0 {
		log.Printf("request_id=%s operation=workspace_bootstrap stage=resolved resolution=existing_membership workspace_id=%s", requestID, existingWorkspaces[0].ID)
		return c.JSON(http.StatusOK, map[string]any{
			"workspace_id":      existingWorkspaces[0].ID,
			"workspace_name":    existingWorkspaces[0].Name,
			"bootstrap_applied": false,
			"resolution":        "existing_membership",
		})
	}

	workspace, bootstrapApplied, err := h.service.BootstrapLegacyWorkspace(c.Request().Context(), userID)
	if err != nil {
		if errors.Is(err, core.ErrWorkspaceBootstrapAccessRequired) {
			availableWorkspace, lookupErr := h.service.FirstWorkspaceInInstallation(c.Request().Context())
			if lookupErr != nil {
				return internalAPIError(c, http.StatusInternalServerError, "workspace.bootstrap.first_workspace", lookupErr, "Unable to resolve project access right now.")
			}

			allowDiscovery := strings.EqualFold(strings.TrimSpace(os.Getenv("OZY_ALLOW_DISCOVERY")), "true")
			if allowDiscovery && strings.TrimSpace(role) == "admin" && availableWorkspace != nil {
				attachedWorkspace, membershipCreated, attachErr := h.service.AttachUserToDefaultWorkspace(c.Request().Context(), userID, workspaceRoleAdmin)
				if attachErr == nil && attachedWorkspace != nil {
					log.Printf("request_id=%s operation=workspace_bootstrap stage=resolved resolution=attached_existing workspace_id=%s membership_created=%t", requestID, attachedWorkspace.ID, membershipCreated)
					return c.JSON(http.StatusOK, map[string]any{
						"workspace_id":       attachedWorkspace.ID,
						"workspace_name":     attachedWorkspace.Name,
						"bootstrap_applied":  false,
						"membership_created": membershipCreated,
						"resolution":         "attached_existing",
					})
				}
				if attachErr != nil {
					return internalAPIError(c, http.StatusInternalServerError, "workspace.bootstrap.attach_default", attachErr, "Unable to resolve project access right now.")
				}
			}

			accessMessage := "You need access to an existing project before continuing."
			response := map[string]any{
				"error":                  accessMessage,
				"error_code":             "WORKSPACE_ACCESS_REQUIRED",
				"bootstrap_applied":      false,
				"resolution":             "workspace_access_required",
				"request_access_supported": true,
			}
			if availableWorkspace != nil {
				accessMessage = "You need an invitation to access project '" + availableWorkspace.Name + "'."
				response["error"] = accessMessage
				response["available_workspace_id"] = availableWorkspace.ID
				response["available_workspace_name"] = availableWorkspace.Name
			}

			log.Printf("request_id=%s operation=workspace_bootstrap stage=resolved resolution=workspace_access_required", requestID)
			return c.JSON(http.StatusConflict, response)
		}
		return internalAPIError(c, http.StatusInternalServerError, "workspace.bootstrap", err, "Unable to bootstrap the project scope right now.")
	}
	if workspace == nil {
		return internalAPIError(c, http.StatusInternalServerError, "workspace.bootstrap.nil_workspace", errors.New("workspace bootstrap did not return an active project"), "Unable to bootstrap the project scope right now.")
	}

	resolution := "existing_membership"
	if bootstrapApplied {
		resolution = "bootstrapped_legacy"
	}
	log.Printf("request_id=%s operation=workspace_bootstrap stage=resolved resolution=%s workspace_id=%s bootstrap_applied=%t", requestID, resolution, workspace.ID, bootstrapApplied)

	return c.JSON(http.StatusOK, map[string]any{
		"workspace_id":      workspace.ID,
		"workspace_name":    workspace.Name,
		"bootstrap_applied": bootstrapApplied,
		"resolution":        resolution,
	})
}

func (h *WorkspaceHandler) RequestAccess(c echo.Context) error {
	userID, ok := workspaceActorID(c)
	if !ok {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "authentication required"})
	}

	var req struct {
		Message     string `json:"message"`
		WorkspaceID string `json:"workspace_id"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}
	message := strings.TrimSpace(req.Message)
	if len(message) > 1000 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "message must be 1000 characters or less"})
	}

	requestedWorkspaceID := strings.TrimSpace(req.WorkspaceID)
	var workspaceID string
	var workspaceName string
	if requestedWorkspaceID != "" {
		if err := h.service.GetDB().Pool.QueryRow(c.Request().Context(), `
			SELECT id::text, name
			FROM _v_workspaces
			WHERE id = $1::uuid
		`, requestedWorkspaceID).Scan(&workspaceID, &workspaceName); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return c.JSON(http.StatusNotFound, map[string]string{"error": "project not found"})
			}
			return internalAPIError(c, http.StatusInternalServerError, "workspace.request_access.lookup_requested_workspace", err, "Unable to process access request right now.")
		}
	} else {
		workspace, err := h.service.FirstWorkspaceInInstallation(c.Request().Context())
		if err != nil {
			return internalAPIError(c, http.StatusInternalServerError, "workspace.request_access.lookup_workspace", err, "Unable to process access request right now.")
		}
		if workspace == nil {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "no project is available for access requests"})
		}
		workspaceID = workspace.ID
		workspaceName = workspace.Name
	}

	isMember, _, err := h.service.IsMember(c.Request().Context(), workspaceID, userID)
	if err != nil {
		return internalAPIError(c, http.StatusInternalServerError, "workspace.request_access.check_membership", err, "Unable to process access request right now.")
	}
	if isMember {
		return c.JSON(http.StatusConflict, map[string]string{"error": "your account already has access to this project"})
	}

	requesterEmail, _ := c.Get("email").(string)
	if strings.TrimSpace(requesterEmail) == "" {
		if err := h.service.GetDB().Pool.QueryRow(c.Request().Context(), `
			SELECT email
			FROM _v_users
			WHERE id = $1
		`, userID).Scan(&requesterEmail); err != nil {
			return internalAPIError(c, http.StatusInternalServerError, "workspace.request_access.requester_email", err, "Unable to process access request right now.")
		}
	}
	requestIP := strings.TrimSpace(c.RealIP())
	requestUserAgent := strings.TrimSpace(c.Request().UserAgent())

	var requestID string
	if err := h.service.GetDB().Pool.QueryRow(c.Request().Context(), `
		INSERT INTO _v_access_requests (user_id, workspace_id, message, source_ip, user_agent, status)
		SELECT $1::uuid, $2::uuid, $3, $4, $5, 'PENDING'::_v_access_request_status
		WHERE NOT EXISTS (
			SELECT 1
			FROM _v_access_requests
			WHERE user_id = $1::uuid
			  AND workspace_id = $2::uuid
			  AND status = 'PENDING'::_v_access_request_status
		)
		RETURNING id::text
	`, userID, workspaceID, message, requestIP, requestUserAgent).Scan(&requestID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusConflict, map[string]string{"error": "you already have a pending access request for this project"})
		}
		return internalAPIError(c, http.StatusInternalServerError, "workspace.request_access.insert", err, "Unable to process access request right now.")
	}

	rows, err := h.service.GetDB().Pool.Query(c.Request().Context(), `
		SELECT DISTINCT LOWER(u.email)
		FROM _v_workspace_members m
		JOIN _v_users u ON u.id = m.user_id
		WHERE m.workspace_id = $1
		  AND m.role IN ('owner', 'admin')
		  AND u.id <> $2
	`, workspaceID, userID)
	if err != nil {
		return internalAPIError(c, http.StatusInternalServerError, "workspace.request_access.lookup_recipients", err, "Unable to process access request right now.")
	}
	defer rows.Close()

	recipients := make([]string, 0, 4)
	for rows.Next() {
		var recipient string
		if err := rows.Scan(&recipient); err != nil {
			return internalAPIError(c, http.StatusInternalServerError, "workspace.request_access.scan_recipients", err, "Unable to process access request right now.")
		}
		recipient = strings.TrimSpace(recipient)
		if recipient != "" {
			recipients = append(recipients, recipient)
		}
	}
	if err := rows.Err(); err != nil {
		return internalAPIError(c, http.StatusInternalServerError, "workspace.request_access.recipients_rows", err, "Unable to process access request right now.")
	}

	body := "User " + requesterEmail + " requested access to project '" + workspaceName + "'."
	if message != "" {
		body += "\n\nMessage:\n" + message
	}
	body += "\n\nGrant or reject from Security > Access Requests in OzyBase."

	notified := 0
	for _, recipient := range recipients {
		if h.mailer == nil {
			break
		}
		if sendErr := h.mailer.Send(recipient, "OzyBase access request for "+workspaceName, body); sendErr != nil {
			log.Printf("operation=workspace_request_access stage=notify_failed recipient=%s err=%v", recipient, sendErr)
			continue
		}
		notified++
	}

	return c.JSON(http.StatusAccepted, map[string]any{
		"status":              "request_submitted",
		"request_id":          requestID,
		"workspace_id":        workspaceID,
		"workspace_name":      workspaceName,
		"notified_recipients": notified,
	})
}

func (h *WorkspaceHandler) ListAccessRequests(c echo.Context) error {
	workspaceID, _ := c.Get("workspace_id").(string)
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "workspace context is required"})
	}

	rows, err := h.service.GetDB().Pool.Query(c.Request().Context(), `
		SELECT ar.id::text,
		       ar.user_id::text,
		       COALESCE(u.email, ''),
		       ar.workspace_id::text,
		       COALESCE(ar.message, ''),
		       COALESCE(ar.source_ip, ''),
		       ar.status::text,
		       COALESCE(ar.processed_by::text, ''),
		       COALESCE(processed_u.email, ''),
		       ar.created_at,
		       ar.updated_at,
		       ar.processed_at
		FROM _v_access_requests ar
		LEFT JOIN _v_users u ON u.id = ar.user_id
		LEFT JOIN _v_users processed_u ON processed_u.id = ar.processed_by
		WHERE ar.workspace_id = $1::uuid
		ORDER BY ar.created_at DESC
		LIMIT 200
	`, workspaceID)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) {
			switch pgErr.Code {
			case "42P01", "42703":
				log.Printf("operation=workspace.access_requests.list degraded=true code=%s detail=%s", pgErr.Code, strings.TrimSpace(pgErr.Message))
				return c.JSON(http.StatusOK, map[string]any{"requests": []any{}})
			}
		}
		return internalAPIError(c, http.StatusInternalServerError, "workspace.access_requests.list", err, "Unable to load access requests right now.")
	}
	defer rows.Close()

	type accessRequestRow struct {
		ID             string  `json:"id"`
		UserID         string  `json:"user_id"`
		Email          string  `json:"email"`
		UserEmail      string  `json:"user_email"`
		WorkspaceID    string  `json:"workspace_id"`
		Message        string  `json:"message"`
		SourceIP       string  `json:"source_ip,omitempty"`
		Status         string  `json:"status"`
		ProcessedBy    string  `json:"processed_by,omitempty"`
		ProcessedEmail string  `json:"processed_email,omitempty"`
		CreatedAt      string  `json:"created_at"`
		UpdatedAt      string  `json:"updated_at"`
		ProcessedAt    *string `json:"processed_at,omitempty"`
	}

	requests := make([]accessRequestRow, 0, 32)
	for rows.Next() {
		var row accessRequestRow
		var createdAt, updatedAt time.Time
		var processedAt sql.NullTime
		if err := rows.Scan(
			&row.ID,
			&row.UserID,
			&row.UserEmail,
			&row.WorkspaceID,
			&row.Message,
			&row.SourceIP,
			&row.Status,
			&row.ProcessedBy,
			&row.ProcessedEmail,
			&createdAt,
			&updatedAt,
			&processedAt,
		); err != nil {
			return internalAPIError(c, http.StatusInternalServerError, "workspace.access_requests.scan", err, "Unable to load access requests right now.")
		}
		row.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		row.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
		row.Email = row.UserEmail
		row.SourceIP = strings.TrimSpace(row.SourceIP)
		if strings.TrimSpace(row.ProcessedBy) == "" {
			row.ProcessedBy = ""
			row.ProcessedEmail = ""
		}
		if processedAt.Valid {
			formatted := processedAt.Time.UTC().Format(time.RFC3339)
			row.ProcessedAt = &formatted
		}
		requests = append(requests, row)
	}
	if err := rows.Err(); err != nil {
		return internalAPIError(c, http.StatusInternalServerError, "workspace.access_requests.rows", err, "Unable to load access requests right now.")
	}

	return c.JSON(http.StatusOK, map[string]any{"requests": requests})
}

func (h *WorkspaceHandler) DecideAccessRequest(c echo.Context) error {
	workspaceID, _ := c.Get("workspace_id").(string)
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "workspace context is required"})
	}

	requestID := strings.TrimSpace(c.Param("id"))
	if requestID == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "request id is required"})
	}

	actorUserID, ok := workspaceActorID(c)
	if !ok {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "authentication required"})
	}

	var req struct {
		Decision string `json:"decision"`
		Role     string `json:"role"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}

	decision := strings.ToUpper(strings.TrimSpace(req.Decision))
	if decision != "APPROVED" && decision != "REJECTED" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "decision must be APPROVED or REJECTED"})
	}

	grantRole := normalizeWorkspaceRole(req.Role)
	if grantRole == "" {
		grantRole = workspaceRoleMember
	}
	if !isManagedWorkspaceRole(grantRole) || grantRole == workspaceRoleOwner {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "role must be admin, member, or viewer"})
	}

	tx, err := h.service.GetDB().Pool.Begin(c.Request().Context())
	if err != nil {
		return internalAPIError(c, http.StatusInternalServerError, "workspace.access_requests.begin", err, "Unable to process this decision right now.")
	}
	defer func() { _ = tx.Rollback(c.Request().Context()) }()

	var targetUserID string
	var currentStatus string
	if err := tx.QueryRow(c.Request().Context(), `
		SELECT user_id::text, status::text
		FROM _v_access_requests
		WHERE id = $1::uuid
		  AND workspace_id = $2::uuid
		FOR UPDATE
	`, requestID, workspaceID).Scan(&targetUserID, &currentStatus); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "access request not found"})
		}
		return internalAPIError(c, http.StatusInternalServerError, "workspace.access_requests.lookup", err, "Unable to process this decision right now.")
	}

	if currentStatus != "PENDING" {
		return c.JSON(http.StatusConflict, map[string]string{"error": "access request is already processed"})
	}

	if decision == "APPROVED" {
		if _, err := tx.Exec(c.Request().Context(), `
			INSERT INTO _v_workspace_members (workspace_id, user_id, role)
			VALUES ($1::uuid, $2::uuid, $3)
			ON CONFLICT (workspace_id, user_id) DO UPDATE
			SET role = EXCLUDED.role
		`, workspaceID, targetUserID, grantRole); err != nil {
			return internalAPIError(c, http.StatusInternalServerError, "workspace.access_requests.grant_membership", err, "Unable to process this decision right now.")
		}
	}

	if _, err := tx.Exec(c.Request().Context(), `
		UPDATE _v_access_requests
		SET status = $1::_v_access_request_status,
		    processed_by = $2::uuid,
		    processed_at = NOW(),
		    updated_at = NOW()
		WHERE id = $3::uuid
	`, decision, actorUserID, requestID); err != nil {
		return internalAPIError(c, http.StatusInternalServerError, "workspace.access_requests.update", err, "Unable to process this decision right now.")
	}

	if err := tx.Commit(c.Request().Context()); err != nil {
		return internalAPIError(c, http.StatusInternalServerError, "workspace.access_requests.commit", err, "Unable to process this decision right now.")
	}

	return c.JSON(http.StatusOK, map[string]any{
		"status":   decision,
		"request_id": requestID,
		"user_id":  targetUserID,
		"role":     grantRole,
	})
}

func (h *WorkspaceHandler) Update(c echo.Context) error {
	id := c.Param("id")
	role, ok, err := h.requireWorkspaceRole(c, id)
	if err != nil || !ok {
		return err
	}
	if !canManageWorkspaceSettings(role) {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "workspace settings require admin or owner access"})
	}

	var req struct {
		Name   string                 `json:"name"`
		Config map[string]interface{} `json:"config"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}

	if err := h.service.UpdateWorkspace(c.Request().Context(), id, req.Name, req.Config); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.NoContent(http.StatusOK)
}

func (h *WorkspaceHandler) GetUsage(c echo.Context) error {
	id := c.Param("id")
	_, ok, err := h.requireWorkspaceRole(c, id)
	if err != nil || !ok {
		return err
	}

	usage, err := h.service.GetWorkspaceUsage(c.Request().Context(), id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, usage)
}

func (h *WorkspaceHandler) GetLimits(c echo.Context) error {
	id := c.Param("id")
	_, ok, err := h.requireWorkspaceRole(c, id)
	if err != nil || !ok {
		return err
	}

	limits, err := h.service.GetWorkspaceLimits(c.Request().Context(), id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, limits)
}

func (h *WorkspaceHandler) UpdateLimits(c echo.Context) error {
	id := c.Param("id")
	role, ok, err := h.requireWorkspaceRole(c, id)
	if err != nil || !ok {
		return err
	}
	if !canManageWorkspaceSettings(role) {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "workspace limits require admin or owner access"})
	}

	current, err := h.service.GetWorkspaceLimits(c.Request().Context(), id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	var req struct {
		WarningThresholdPct      *int64 `json:"warning_threshold_pct"`
		RowsHardLimit            *int64 `json:"rows_hard_limit"`
		StorageBytesHardLimit    *int64 `json:"storage_bytes_hard_limit"`
		APIRequestsSoftLimit     *int64 `json:"api_requests_soft_limit"`
		APIRequestsHardLimit     *int64 `json:"api_requests_hard_limit"`
		RealtimeEventsSoftLimit  *int64 `json:"realtime_events_soft_limit"`
		RealtimeEventsHardLimit  *int64 `json:"realtime_events_hard_limit"`
		FunctionInvocationsLimit *int64 `json:"function_invocations_soft_limit"`
		FunctionInvocationsHard  *int64 `json:"function_invocations_hard_limit"`
		RateLimitWindowSeconds   *int64 `json:"rate_limit_window_seconds"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}

	if err := validateWorkspaceLimitValue("warning_threshold_pct", req.WarningThresholdPct, true); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	if err := validateWorkspaceLimitValue("rows_hard_limit", req.RowsHardLimit, false); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	if err := validateWorkspaceLimitValue("storage_bytes_hard_limit", req.StorageBytesHardLimit, false); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	if err := validateWorkspaceLimitValue("api_requests_soft_limit", req.APIRequestsSoftLimit, false); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	if err := validateWorkspaceLimitValue("api_requests_hard_limit", req.APIRequestsHardLimit, false); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	if err := validateWorkspaceLimitValue("realtime_events_soft_limit", req.RealtimeEventsSoftLimit, false); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	if err := validateWorkspaceLimitValue("realtime_events_hard_limit", req.RealtimeEventsHardLimit, false); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	if err := validateWorkspaceLimitValue("function_invocations_soft_limit", req.FunctionInvocationsLimit, false); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	if err := validateWorkspaceLimitValue("function_invocations_hard_limit", req.FunctionInvocationsHard, false); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	if err := validateWorkspaceLimitValue("rate_limit_window_seconds", req.RateLimitWindowSeconds, false); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	if req.WarningThresholdPct != nil {
		current.WarningThresholdPct = *req.WarningThresholdPct
	}
	if req.RowsHardLimit != nil {
		current.RowsHardLimit = *req.RowsHardLimit
	}
	if req.StorageBytesHardLimit != nil {
		current.StorageBytesHardLimit = *req.StorageBytesHardLimit
	}
	if req.APIRequestsSoftLimit != nil {
		current.APIRequestsSoftLimit = *req.APIRequestsSoftLimit
	}
	if req.APIRequestsHardLimit != nil {
		current.APIRequestsHardLimit = *req.APIRequestsHardLimit
	}
	if req.RealtimeEventsSoftLimit != nil {
		current.RealtimeEventsSoftLimit = *req.RealtimeEventsSoftLimit
	}
	if req.RealtimeEventsHardLimit != nil {
		current.RealtimeEventsHardLimit = *req.RealtimeEventsHardLimit
	}
	if req.FunctionInvocationsLimit != nil {
		current.FunctionInvocationsLimit = *req.FunctionInvocationsLimit
	}
	if req.FunctionInvocationsHard != nil {
		current.FunctionInvocationsHard = *req.FunctionInvocationsHard
	}
	if req.RateLimitWindowSeconds != nil {
		current.RateLimitWindowSeconds = *req.RateLimitWindowSeconds
	}

	if err := h.service.UpdateWorkspaceLimits(c.Request().Context(), id, current); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, current)
}

func (h *WorkspaceHandler) Delete(c echo.Context) error {
	id := c.Param("id")
	role, ok, err := h.requireWorkspaceRole(c, id)
	if err != nil || !ok {
		return err
	}
	if !canDeleteWorkspace(role) {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "workspace deletion requires owner access"})
	}

	if err := h.service.DeleteWorkspace(c.Request().Context(), id); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.NoContent(http.StatusNoContent)
}

func validateWorkspaceLimitValue(name string, value *int64, isThreshold bool) error {
	if value == nil {
		return nil
	}
	if *value < 0 {
		return errors.New(name + " must be zero or greater")
	}
	if isThreshold && *value > 100 {
		return errors.New(name + " must be <= 100")
	}
	return nil
}

func (h *WorkspaceHandler) ListMembers(c echo.Context) error {
	id := c.Param("id")
	role, ok, err := h.requireWorkspaceRole(c, id)
	if err != nil || !ok {
		return err
	}
	if !canViewWorkspaceMembers(role) {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "workspace members are not visible for this role"})
	}

	members, err := h.service.GetWorkspaceMembers(c.Request().Context(), id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, members)
}

func (h *WorkspaceHandler) AddMember(c echo.Context) error {
	id := c.Param("id")
	actorUserID, ok := workspaceActorID(c)
	if !ok {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "authentication required"})
	}
	actorRole, isAuthorized, err := h.requireWorkspaceRole(c, id)
	if err != nil || !isAuthorized {
		return err
	}
	if !canManageWorkspaceSettings(actorRole) {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "workspace membership changes require admin or owner access"})
	}

	var req struct {
		UserID string `json:"user_id"`
		Email  string `json:"email"`
		Role   string `json:"role"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}

	targetUserID := strings.TrimSpace(req.UserID)
	targetEmail := strings.TrimSpace(strings.ToLower(req.Email))
	if targetUserID == "" && targetEmail == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "user_id or email is required"})
	}

	req.Role = normalizeWorkspaceRole(req.Role)
	if !isManagedWorkspaceRole(req.Role) {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "role must be admin, member, or viewer"})
	}
	if !canAssignWorkspaceRole(actorRole, req.Role) {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "your workspace role cannot assign that target role"})
	}

	if targetUserID == "" {
		if _, err := mail.ParseAddress(targetEmail); err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid email"})
		}

		if err := h.service.GetDB().Pool.QueryRow(c.Request().Context(), `
			SELECT id
			FROM _v_users
			WHERE LOWER(email) = $1
		`, targetEmail).Scan(&targetUserID); err != nil {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "user not found"})
		}
	}

	if targetUserID == actorUserID && normalizeWorkspaceRole(actorRole) == workspaceRoleAdmin {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "admins cannot change their own workspace role"})
	}

	targetIsMember, targetRole, err := h.service.IsMember(c.Request().Context(), id, targetUserID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if targetIsMember {
		if normalizeWorkspaceRole(targetRole) == workspaceRoleOwner {
			return c.JSON(http.StatusConflict, map[string]string{"error": "workspace owner cannot be changed from member settings"})
		}
		if !canManageWorkspaceMember(actorRole, targetRole) {
			return c.JSON(http.StatusForbidden, map[string]string{"error": "your workspace role cannot manage that member"})
		}
	}

	if err := h.service.AddWorkspaceMember(c.Request().Context(), id, targetUserID, req.Role); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	inviterEmail, _ := c.Get("email").(string)
	if inviterEmail == "" {
		inviterEmail = "An admin"
	}

	// Notify the invited user asynchronously without depending on the request context.
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		var email, workspaceName string
		err := h.service.GetDB().Pool.QueryRow(ctx, `
			SELECT u.email, w.name 
			FROM _v_users u, _v_workspaces w 
			WHERE u.id = $1 AND w.id = $2
		`, targetUserID, id).Scan(&email, &workspaceName)

		if err == nil {
			_ = mailer.SendTemplateEmail(ctx, h.service.GetDB(), h.mailer, "workspace_invite", email, map[string]string{
				"app_name":       "OzyBase",
				"workspace_name": workspaceName,
				"inviter_email":  inviterEmail,
			})
		}
	}()

	return c.NoContent(http.StatusOK)
}

func (h *WorkspaceHandler) RemoveMember(c echo.Context) error {
	id := c.Param("id")
	userId := c.Param("userId")
	actorUserID, ok := workspaceActorID(c)
	if !ok {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "authentication required"})
	}
	actorRole, isAuthorized, err := h.requireWorkspaceRole(c, id)
	if err != nil || !isAuthorized {
		return err
	}
	if !canManageWorkspaceSettings(actorRole) {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "workspace membership changes require admin or owner access"})
	}

	targetIsMember, targetRole, err := h.service.IsMember(c.Request().Context(), id, userId)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if !targetIsMember {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "workspace member not found"})
	}
	if normalizeWorkspaceRole(targetRole) == workspaceRoleOwner {
		return c.JSON(http.StatusConflict, map[string]string{"error": "workspace owner cannot be removed"})
	}
	if actorUserID == userId && normalizeWorkspaceRole(actorRole) == workspaceRoleAdmin {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "admins cannot remove themselves from the workspace"})
	}
	if !canManageWorkspaceMember(actorRole, targetRole) {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "your workspace role cannot manage that member"})
	}

	if err := h.service.RemoveWorkspaceMember(c.Request().Context(), id, userId); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.NoContent(http.StatusNoContent)
}
