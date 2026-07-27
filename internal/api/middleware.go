package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/Xangel0s/OzyBase/internal/mailer"
	"github.com/Xangel0s/OzyBase/internal/realtime"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

func claimString(claims jwt.MapClaims, keys ...string) string {
	for _, key := range keys {
		if raw, ok := claims[key].(string); ok {
			if value := strings.TrimSpace(raw); value != "" {
				return value
			}
		}
	}
	return ""
}

func extractUserIDFromClaims(claims jwt.MapClaims) string {
	return claimString(claims, "user_id", "sub")
}

func AuthMiddleware(db *data.DB, jwtSecret string, optional bool) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			if c.Request().Method == http.MethodOptions {
				return next(c)
			}

			// API key middleware may already authenticate this request.
			if userID, ok := c.Get("user_id").(string); ok && userID != "" {
				if role, ok := c.Get("role").(string); ok && role != "" {
					return next(c)
				}
			}

			authHeader := c.Request().Header.Get("Authorization")
			if authHeader == "" {
				if optional {
					return next(c)
				}
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "missing authorization header"})
			}

			tokenParts := strings.Split(authHeader, " ")
			if len(tokenParts) != 2 || strings.ToLower(tokenParts[0]) != "bearer" {
				if optional {
					return next(c)
				}
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "invalid authorization header format"})
			}

			tokenString := tokenParts[1]
			token, err := jwt.Parse(tokenString, func(token *jwt.Token) (any, error) {
				if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
					return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
				}
				return []byte(jwtSecret), nil
			})

			if err != nil || !token.Valid {
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "invalid or expired token"})
			}

			claims, ok := token.Claims.(jwt.MapClaims)
			if !ok {
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "invalid token claims"})
			}

			userID := extractUserIDFromClaims(claims)
			if userID == "" {
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "invalid token user"})
			}

			var email, role string
			var isVerified bool
			err = resolveActiveSessionIdentity(c.Request().Context(), db, tokenString, userID, &email, &role, &isVerified)
			if err != nil {
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "invalid or expired session"})
			}

			// Use DB + active session state as source of truth to avoid stale or forged role/email claims.
			c.Set("user_id", userID)
			c.Set("email", email)
			c.Set("role", role)
			c.Set("is_verified", isVerified)

			return next(c)
		}
	}
}

// RequireRole enforces an exact role match for sensitive routes.
func RequireRole(requiredRole string) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			role, ok := c.Get("role").(string)
			if !ok || role == "" {
				return c.JSON(http.StatusForbidden, map[string]string{"error": "insufficient privileges"})
			}
			if role != requiredRole {
				return c.JSON(http.StatusForbidden, map[string]string{"error": requiredRole + " role required"})
			}
			return next(c)
		}
	}
}

// RequireAnyRole allows access when the caller role matches at least one required role.
func RequireAnyRole(requiredRoles ...string) echo.MiddlewareFunc {
	allowed := map[string]struct{}{}
	for _, role := range requiredRoles {
		normalized := strings.TrimSpace(role)
		if normalized == "" {
			continue
		}
		allowed[normalized] = struct{}{}
	}

	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			role, ok := c.Get("role").(string)
			if !ok || strings.TrimSpace(role) == "" {
				return c.JSON(http.StatusForbidden, map[string]string{"error": "insufficient privileges"})
			}
			if _, exists := allowed[role]; !exists {
				return c.JSON(http.StatusForbidden, map[string]string{"error": "required roles: " + strings.Join(requiredRoles, ", ")})
			}
			return next(c)
		}
	}
}

// RLSMiddleware injects user context into Postgres for the duration of the request
func RLSMiddleware(db *data.DB) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			userID, _ := c.Get("user_id").(string)
			if userID == "" {
				return next(c)
			}

			email, _ := c.Get("email").(string)
			role, _ := c.Get("role").(string)

			// Inject RLS context into the database pool for this request
			// Note: This uses SET LOCAL, so it only affects the current session/transaction within the DB pool connection.
			// Since pgxpool connections are reused, we MUST ensure this is done per request.
			// However, SET LOCAL only works within a transaction.
			// If we are not in a transaction, we should use SET.
			// Best practice with pgxpool is to use a transaction for RLS.

			// Store the RLS context in the echo context so handlers can use it
			// when they start their own transactions.
			rlsCtx := data.RLSContext{
				UserID:  userID,
				Email:   email,
				Roles:   []string{role},
				IsAdmin: role == "admin",
			}
			c.Set("rls_ctx", rlsCtx)

			// Also wrap the Request Context
			c.SetRequest(c.Request().WithContext(data.NewContext(c.Request().Context(), rlsCtx)))

			return next(c)
		}
	}
}

// WorkspaceMiddleware ensures the user has access to the requested workspace
// In single-tenant mode, if no workspace header is provided, it auto-resolves
// to the default workspace.
func WorkspaceMiddleware(db *data.DB, jwtSecret string, isSingleTenant bool) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			requestedWorkspaceID := strings.TrimSpace(c.Request().Header.Get("X-Workspace-Id"))
			if requestedWorkspaceID == "" {
				requestedWorkspaceID = strings.TrimSpace(c.Request().Header.Get("X-Ozy-Project-ID"))
			}
			boundWorkspaceID, _ := c.Get("api_key_workspace_id").(string)
			workspaceID := requestedWorkspaceID
			if workspaceID == "" {
				workspaceID = strings.TrimSpace(boundWorkspaceID)
			}
			if isSingleTenant {
				if workspaceID == "" || !workspaceExists(c.Request().Context(), db, workspaceID) {
					defaultID, err := db.EnsureDefaultWorkspace(c.Request().Context())
					if err == nil && defaultID != "" {
						workspaceID = defaultID
					}
				}
			}
			if workspaceID == "" {
				// We don't block if no workspace is provided (might be public or global API)
				return next(c)
			}
			if requestedWorkspaceID != "" && boundWorkspaceID != "" && requestedWorkspaceID != strings.TrimSpace(boundWorkspaceID) {
				return c.JSON(http.StatusForbidden, map[string]string{"error": "workspace-scoped api key cannot access a different workspace"})
			}
			if c.Get("is_service_role") == true {
				if !workspaceExists(c.Request().Context(), db, workspaceID) {
					return c.JSON(http.StatusForbidden, map[string]string{"error": "workspace does not exist"})
				}
				c.Set("workspace_id", workspaceID)
				c.Set("workspace_role", workspaceRoleOwner)
				return next(c)
			}
			if boundWorkspaceID != "" {
				if !workspaceExists(c.Request().Context(), db, workspaceID) {
					return c.JSON(http.StatusForbidden, map[string]string{"error": "workspace does not exist"})
				}
				workspaceRole := workspaceRoleViewer
				if role, _ := c.Get("api_key_role").(string); normalizeWorkspaceRole(role) != APIKeyRoleAnon {
					workspaceRole = workspaceRoleAdmin
				}
				c.Set("workspace_id", workspaceID)
				c.Set("workspace_role", workspaceRole)
				return next(c)
			}

			// Try to get user_id from context first (set by APIKeyMiddleware)
			userID, _ := c.Get("user_id").(string)

			// If not set yet, extract directly from JWT (runs before authRequired)
			if userID == "" {
				authHeader := c.Request().Header.Get("Authorization")
				tokenParts := strings.Split(authHeader, " ")
				if len(tokenParts) == 2 && strings.ToLower(tokenParts[0]) == "bearer" {
					token, err := jwt.Parse(tokenParts[1], func(token *jwt.Token) (any, error) {
						if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
							return nil, fmt.Errorf("unexpected signing method")
						}
						return []byte(jwtSecret), nil
					})
					if err == nil && token.Valid {
						if claims, ok := token.Claims.(jwt.MapClaims); ok {
							if uid := extractUserIDFromClaims(claims); uid != "" {
								userID = uid
							}
						}
					}
				}
			}

			if userID == "" {
				// If still not authenticated, they can't belong to a workspace
				// Let downstream authRequired handle the 401
				return next(c)
			}

			// Global Admin Bypass: Admins have access to all workspaces as Owners
			globalRole, _ := c.Get("role").(string)
			if globalRole == "admin" {
				c.Set("workspace_id", workspaceID)
				c.Set("workspace_role", workspaceRoleOwner)
				return next(c)
			}

			// Check membership
			var role string
			err := db.Pool.QueryRow(c.Request().Context(), `
				SELECT role FROM _v_workspace_members
				WHERE workspace_id = $1 AND user_id = $2
			`, workspaceID, userID).Scan(&role)

			if err != nil {
				return c.JSON(http.StatusForbidden, map[string]string{"error": "access to this workspace is denied or workspace does not exist"})
			}

			// Inject workspace context
			c.Set("workspace_id", workspaceID)
			c.Set("workspace_role", role)

			return next(c)
		}
	}
}

// SingleTenantGuard blocks workspace mutations (create/delete/update) when the
// instance is running in single-tenant mode (self_host or single_project_local).
func SingleTenantGuard(isSingleTenant bool) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			if !isSingleTenant {
				return next(c)
			}
			method := c.Request().Method
			if method == http.MethodPost || method == http.MethodDelete {
				return c.JSON(http.StatusForbidden, map[string]string{
					"error": "workspace creation and deletion are disabled in single-tenant mode",
				})
			}
			return next(c)
		}
	}
}

// APIKeyMiddleware validates OzyBase API keys (Enterprise Phase 1)
func APIKeyMiddleware(db *data.DB) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			if c.Request().Method == http.MethodOptions {
				return next(c)
			}

			// Skip if already authenticated by JWT
			if c.Get("user_id") != nil {
				return next(c)
			}

			key := c.Request().Header.Get("apikey")
			if key == "" {
				key = c.Request().Header.Get("X-Ozy-Key")
			}
			if key == "" {
				authHeader := strings.TrimSpace(c.Request().Header.Get("Authorization"))
				if strings.HasPrefix(strings.ToLower(authHeader), "bearer ") {
					candidate := strings.TrimSpace(authHeader[7:])
					// Treat Bearer as API key when it matches Ozy key shape.
					if strings.HasPrefix(candidate, "ozy_") {
						key = candidate
					}
				}
			}

			if key == "" {
				return next(c) // Proceed for public routes or will fail in AccessMiddleware
			}

			// Validate Key
			hash := sha256.Sum256([]byte(key))
			keyHash := hex.EncodeToString(hash[:])

			var role string
			var id string
			var isPrevious bool
			var graceUntil *time.Time
			var workspaceID string
			var securityLevel string
			err := db.Pool.QueryRow(c.Request().Context(), `
				UPDATE _v_api_keys 
				SET last_used_at = NOW() 
				WHERE key_hash = $1 AND is_active = true 
				  AND revoked_at IS NULL
				  AND valid_after <= NOW()
				  AND (expires_at IS NULL OR expires_at > NOW())
				  AND (rotated_to_key_id IS NULL OR (grace_until IS NOT NULL AND grace_until > NOW()))
				RETURNING id, role, (rotated_to_key_id IS NOT NULL) AS is_previous, grace_until, COALESCE(workspace_id::text, ''), COALESCE((to_jsonb(_v_api_keys)->>'security_level'), 'libre')
			`, keyHash).Scan(&id, &role, &isPrevious, &graceUntil, &workspaceID, &securityLevel)

			if err != nil {
				// We don't block here, just don't set user context.
				// AccessMiddleware will block if requirement is 'auth' or 'admin'
				return next(c)
			}

			// Formal API key model:
			// - anon: public-capable key (must NOT satisfy auth-required rules)
			// - service_role: trusted server key with admin-level capabilities
			switch role {
			case "service_role":
				c.Set("user_id", "service_role_"+id)
				c.Set("role", "admin")
				c.Set("api_key_role", role)
				c.Set("is_service_role", true)
			case "anon":
				c.Set("role", "anon")
				c.Set("api_key_role", role)
			default:
				c.Set("user_id", "api_key_"+id)
				c.Set("role", role)
				c.Set("api_key_role", role)
			}
			if isPrevious {
				c.Set("is_previous_key", true)
				if graceUntil != nil {
					c.Set("grace_until", graceUntil.Format(time.RFC3339))
				}
			}
			if strings.TrimSpace(workspaceID) != "" {
				c.Set("api_key_workspace_id", strings.TrimSpace(workspaceID))
			}
			if strings.TrimSpace(securityLevel) == "" {
				securityLevel = "libre"
			}
			c.Set("api_key_security_level", strings.ToLower(strings.TrimSpace(securityLevel)))
			c.Set("api_key_id", id)
			c.Set("is_api_key", true)

			return next(c)
		}
	}
}

func resolveActiveSessionIdentity(ctx context.Context, db *data.DB, tokenString, userID string, email, role *string, isVerified *bool) error {
	tokenHash := sha256.Sum256([]byte(tokenString))
	encodedTokenHash := hex.EncodeToString(tokenHash[:])

	return db.Pool.QueryRow(ctx, `
		UPDATE _v_sessions AS s
		SET last_used_at = NOW()
		FROM _v_users AS u
		WHERE s.token_hash = $1
		  AND s.user_id = $2::uuid
		  AND s.expires_at > NOW()
		  AND u.id = s.user_id
		RETURNING u.email, u.role, u.is_verified
	`, encodedTokenHash, userID).Scan(email, role, isVerified)
}

func workspaceExists(ctx context.Context, db *data.DB, workspaceID string) bool {
	var exists bool
	if err := db.Pool.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM _v_workspaces WHERE id = $1
		)
	`, workspaceID).Scan(&exists); err != nil {
		return false
	}
	return exists
}

// AccessMiddleware checks per-collection permissions (ACL)
func AccessMiddleware(db *data.DB, requirement string) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			collectionName := c.Param("name")
			if collectionName == "" {
				return next(c) // Public routes or collections management
			}

			var listRule, createRule, updateRule, deleteRule, rlsRule string
			var rlsEnabled bool
			err := db.Pool.QueryRow(c.Request().Context(),
				"SELECT list_rule, create_rule, update_rule, delete_rule, rls_enabled, rls_rule FROM _v_collections WHERE name = $1",
				collectionName).Scan(&listRule, &createRule, &updateRule, &deleteRule, &rlsEnabled, &rlsRule)

			if err != nil {
				fmt.Printf("[ACL-DEBUG] Collection NOT FOUND in _v_collections: %s\n", collectionName)
				return c.JSON(http.StatusNotFound, map[string]string{"error": "collection not found"})
			}

			// Store RLS config for later use in handlers
			c.Set("rls_enabled", rlsEnabled)
			c.Set("rls_rule", rlsRule)

			rule := resolveCollectionAccessRule(requirement, listRule, createRule, updateRule, deleteRule)
			fmt.Printf("[ACL-DEBUG] Table: %s | Requirement: %s | Rule: %s | User: %v\n", collectionName, requirement, rule, c.Get("user_id"))

			decision := evaluateCollectionAccessRule(rule, c.Get("user_id"), c.Get("role"))
			if decision.allowed {
				return next(c)
			}
			if decision.debugMessage != "" {
				fmt.Printf("[ACL-DEBUG] BLOCKED: %s\n", decision.debugMessage)
			}
			return c.JSON(decision.status, map[string]string{"error": decision.message})
		}
	}
}

type collectionAccessDecision struct {
	allowed      bool
	status       int
	message      string
	debugMessage string
}

func resolveCollectionAccessRule(requirement, listRule, createRule, updateRule, deleteRule string) string {
	switch strings.ToLower(strings.TrimSpace(requirement)) {
	case "create":
		return createRule
	case "update":
		return updateRule
	case "delete":
		return deleteRule
	default:
		return listRule
	}
}

func normalizeCollectionRoleRule(rule string) string {
	normalized := strings.ToLower(strings.TrimSpace(rule))
	if strings.HasPrefix(normalized, "role:") {
		return strings.TrimSpace(strings.TrimPrefix(normalized, "role:"))
	}
	return normalized
}

func evaluateCollectionAccessRule(rule string, rawUserID any, rawRole any) collectionAccessDecision {
	userID, _ := rawUserID.(string)
	role, _ := rawRole.(string)
	normalizedRule := strings.ToLower(strings.TrimSpace(rule))

	switch normalizedRule {
	case "public":
		return collectionAccessDecision{allowed: true}
	case "auth":
		if strings.TrimSpace(userID) == "" {
			return collectionAccessDecision{
				status:       http.StatusForbidden,
				message:      "authentication required for this collection",
				debugMessage: "Auth required",
			}
		}
		return collectionAccessDecision{allowed: true}
	case "admin":
		if strings.TrimSpace(role) != "admin" {
			return collectionAccessDecision{
				status:       http.StatusForbidden,
				message:      "admin access required for this collection",
				debugMessage: fmt.Sprintf("Admin required | Current role: %v", rawRole),
			}
		}
		return collectionAccessDecision{allowed: true}
	default:
		requiredRole := normalizeCollectionRoleRule(normalizedRule)
		if requiredRole != "" && strings.TrimSpace(role) == requiredRole {
			return collectionAccessDecision{allowed: true}
		}
		if requiredRole != "" {
			return collectionAccessDecision{
				status:       http.StatusForbidden,
				message:      fmt.Sprintf("%s role required for this collection", requiredRole),
				debugMessage: fmt.Sprintf("%s role required | Current role: %v", requiredRole, rawRole),
			}
		}
		return collectionAccessDecision{
			status:       http.StatusForbidden,
			message:      "access denied",
			debugMessage: "Access rule is empty or invalid",
		}
	}
}

// MetricsMiddleware tracks activity for the dashboard and persists audit logs
func MetricsMiddleware(h *Handler) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			path := c.Request().URL.Path
			lowerPath := strings.ToLower(path)

			// [Refined Exclusion] Strictly block automated polling noise
			// We block only the HEAD and background fetch events, allowing actual interactions
			isPolling := isMetricsPollingPath(lowerPath)

			if isPolling {
				return next(c)
			}

			start := time.Now().UTC()
			err := next(c)
			stop := time.Now().UTC()

			// Add to logs with Geolocation
			ip := c.RealIP()
			latency := stop.Sub(start)
			status := c.Response().Status
			method := c.Request().Method
			if method != http.MethodOptions &&
				method != http.MethodHead &&
				status >= http.StatusOK &&
				status < http.StatusBadRequest {
				incrementMetricsCounter(h, lowerPath)
			}

			// Handle userID as UUID: convert "" to nil for Postgres safety
			rawUserID := c.Get("user_id")
			var userIDPtr *string
			if s, ok := rawUserID.(string); ok && s != "" {
				// API key identities are non-UUID (e.g. "api_key_<id>"), keep DB FK safe.
				if _, parseErr := uuid.Parse(s); parseErr == nil {
					userID := s
					userIDPtr = &userID
				}
			} else {
				userIDPtr = nil
			}

			// [Async Audit] Use the high-performance worker
			rawWorkspaceID, _ := c.Get("workspace_id").(string)
			var workspaceIDPtr *string
			if strings.TrimSpace(rawWorkspaceID) != "" {
				workspaceID := strings.TrimSpace(rawWorkspaceID)
				workspaceIDPtr = &workspaceID
			}

			go func() {
				geo, _ := h.Geo.GetLocation(context.Background(), ip)

				entry := data.AuditLog{
					UserID:      userIDPtr,
					WorkspaceID: workspaceIDPtr,
					IP:          ip,
					Method:      c.Request().Method,
					Path:        path,
					Status:      status,
					Latency:     latency.Milliseconds(),
					Country:     geo.Country,
					City:        geo.City,
					UserAgent:   c.Request().UserAgent(),
					CreatedAt:   stop,
				}

				// Push to non-blocking buffer
				if h.Audit != nil {
					h.Audit.Log(entry)
				}

				// Check for Geo Breach
				isBreach, _ := h.Geo.CheckBreach(context.Background(), ip, geo.Country)
				if isBreach {
					detailsMap := map[string]any{
						"ip":      ip,
						"country": geo.Country,
						"city":    geo.City,
						"method":  entry.Method,
						"path":    entry.Path,
					}
					var alreadyOpen bool
					_ = h.DB.Pool.QueryRow(context.Background(), `
						SELECT EXISTS (
							SELECT 1
							FROM _v_security_alerts
							WHERE type = 'geo_breach'
							  AND is_resolved = false
							  AND COALESCE(metadata->>'ip', '') = $1
							  AND COALESCE(metadata->>'country', '') = $2
							  AND COALESCE(metadata->>'city', '') = $3
							  AND created_at >= NOW() - INTERVAL '15 minutes'
						)
					`, ip, geo.Country, geo.City).Scan(&alreadyOpen)
					if alreadyOpen {
						return
					}

					details, _ := json.Marshal(detailsMap)
					_, _ = h.DB.Pool.Exec(context.Background(), `
						INSERT INTO _v_security_alerts (type, severity, message, metadata)
						VALUES ($1, $2, $3, $4)
					`, "geo_breach", "critical", "Geo breach detected", details)

					// Send email notifications to all active recipients
					go func() {
						rows, err := h.DB.Pool.Query(context.Background(), `
							SELECT email FROM _v_security_notification_recipients
							WHERE is_active = true AND 'geo_breach' = ANY(alert_types)
						`)
						if err != nil {
							return
						}
						defer rows.Close()

						alertDetails := fmt.Sprintf("IP: %s from %s, %s attempted to access %s %s",
							ip, geo.Country, geo.City, entry.Method, entry.Path)

						for rows.Next() {
							var email string
							if err := rows.Scan(&email); err == nil {
								_ = mailer.SendTemplateEmail(context.Background(), h.DB, h.Mailer, "security_alert", email, map[string]string{
									"app_name":   "OzyBase",
									"alert_type": "Geographic Access Breach",
									"details":    alertDetails,
								})
							}
						}
					}()

					// Send to webhook integrations (Slack, Discord, SIEM)
					go func() {
						var detailsMap map[string]any
						_ = json.Unmarshal(details, &detailsMap)

						_ = h.Integrations.SendSecurityAlert(context.Background(), realtime.SecurityAlertPayload{
							Type:      "geo_breach",
							Severity:  "critical",
							Details:   detailsMap,
							Timestamp: time.Now().Format(time.RFC3339),
						})
					}()
				}
			}()

			return err
		}
	}
}

func isMetricsPollingPath(path string) bool {
	switch path {
	case "/api/project/logs",
		"/api/project/info",
		"/api/project/health",
		"/api/project/stats",
		"/api/project/security/alerts",
		"/api/project/security/stats",
		"/api/analytics/traffic",
		"/api/analytics/geo",
		"/api/health",
		"/api/system/status":
		return true
	default:
		return false
	}
}

func incrementMetricsCounter(h *Handler, lowerPath string) {
	module := resolveMetricsModule(lowerPath)
	if module == "" {
		return
	}

	h.Metrics.Lock()
	switch module {
	case "auth":
		h.Metrics.AuthRequests++
	case "storage":
		h.Metrics.StorageRequests++
	case "db":
		h.Metrics.DbRequests++
	}
	h.Metrics.Unlock()
}

func resolveMetricsModule(path string) string {
	switch {
	case strings.HasPrefix(path, "/api/auth/"):
		return "auth"
	case strings.HasPrefix(path, "/api/files"):
		return "storage"
	case strings.HasPrefix(path, "/api/realtime"):
		return ""
	case strings.HasPrefix(path, "/api/"):
		return "db"
	default:
		return ""
	}
}
