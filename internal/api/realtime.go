package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/Xangel0s/OzyBase/internal/realtime"
	"github.com/golang-jwt/jwt/v5"
	"github.com/labstack/echo/v4"
)

var realtimeTableNamePattern = regexp.MustCompile(`^[a-zA-Z0-9_]+$`)

type realtimeSessionClaims struct {
	Scope     string   `json:"scope"`
	UserID    string   `json:"uid,omitempty"`
	Role      string   `json:"role,omitempty"`
	Workspace string   `json:"workspace_id,omitempty"`
	Channels  []string `json:"channels,omitempty"`
	SessionID string   `json:"sid,omitempty"`
	jwt.RegisteredClaims
}

// RealtimeHandler handles SSE connections.
type RealtimeHandler struct {
	Broker         *realtime.Broker
	DB             *data.DB
	SigningKey     string
	AuthzV2Enabled bool
	LegacyOpen     bool
	SessionTTL     time.Duration
}

type RealtimeHandlerOption func(*RealtimeHandler)

func WithRealtimeDB(db *data.DB) RealtimeHandlerOption {
	return func(h *RealtimeHandler) { h.DB = db }
}

func WithRealtimeSigningKey(secret string) RealtimeHandlerOption {
	return func(h *RealtimeHandler) {
		secret = strings.TrimSpace(secret)
		if secret != "" {
			h.SigningKey = secret
		}
	}
}

func WithRealtimeAuthzV2(enabled bool) RealtimeHandlerOption {
	return func(h *RealtimeHandler) { h.AuthzV2Enabled = enabled }
}

func WithRealtimeLegacyOpen(enabled bool) RealtimeHandlerOption {
	return func(h *RealtimeHandler) { h.LegacyOpen = enabled }
}

// NewRealtimeHandler creates a new instance of RealtimeHandler.
func NewRealtimeHandler(broker *realtime.Broker, opts ...RealtimeHandlerOption) *RealtimeHandler {
	h := &RealtimeHandler{
		Broker:     broker,
		SessionTTL: 5 * time.Minute,
	}
	for _, opt := range opts {
		if opt != nil {
			opt(h)
		}
	}
	if strings.TrimSpace(h.SigningKey) == "" {
		h.SigningKey = strings.TrimSpace("realtime-fallback-signing-key")
	}
	return h
}

// CreateSession handles POST /api/realtime/session
func (h *RealtimeHandler) CreateSession(c echo.Context) error {
	userID := strings.TrimSpace(userIDFromContext(c))
	role := strings.ToLower(strings.TrimSpace(roleFromContext(c)))
	workspaceID := strings.TrimSpace(workspaceIDFromContext(c))
	isServiceRole := c.Get("is_service_role") == true
	if userID == "" && !isServiceRole {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "authentication required"})
	}
	if !h.AuthzV2Enabled && !isServiceRole && !strings.EqualFold(role, "admin") {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "legacy realtime sessions require admin or service role"})
	}

	var req struct {
		Channels        []string `json:"channels"`
		ExpiresInSecond int64    `json:"expires_in"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid realtime session payload"})
	}

	ttl := h.SessionTTL
	if req.ExpiresInSecond > 0 {
		ttl = time.Duration(req.ExpiresInSecond) * time.Second
	}
	if ttl < 30*time.Second {
		ttl = 30 * time.Second
	}
	if ttl > 15*time.Minute {
		ttl = 15 * time.Minute
	}

	allowedByPolicy := make([]string, 0, len(req.Channels)+2)
	if h.AuthzV2Enabled {
		allowedDefault := buildDefaultRealtimeChannels(workspaceID, userID)
		allowedByPolicy = append(allowedByPolicy, allowedDefault...)
		for _, ch := range req.Channels {
			normalized := normalizeRealtimeChannel(ch)
			if normalized == "" {
				continue
			}
			if isRealtimeChannelAllowed(normalized, workspaceID, userID, role, isServiceRole) {
				allowedByPolicy = append(allowedByPolicy, normalized)
			}
		}
		allowedByPolicy = dedupeRealtimeStrings(allowedByPolicy)
		if len(allowedByPolicy) == 0 {
			return c.JSON(http.StatusForbidden, map[string]string{"error": "no authorized realtime channels available for this session"})
		}
		sort.Strings(allowedByPolicy)
	} else {
		// Legacy compatibility mode: keep fan-out behavior for admin/service callers,
		// while still using short-lived signed session tokens for browser EventSource.
		allowedByPolicy = []string{"legacy:all"}
	}

	now := time.Now().UTC()
	expiresAt := now.Add(ttl)
	claims := realtimeSessionClaims{
		Scope:     "realtime-session",
		UserID:    userID,
		Role:      role,
		Workspace: workspaceID,
		Channels:  allowedByPolicy,
		SessionID: fmt.Sprintf("rt-%d", now.UnixNano()),
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			Subject:   userID,
		},
	}
	if isServiceRole {
		claims.Role = "service_role"
	}
	if claims.Subject == "" {
		claims.Subject = claims.Role
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString([]byte(h.SigningKey))
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to sign realtime session"})
	}

	return c.JSON(http.StatusCreated, map[string]any{
		"token":      tokenString,
		"expires_at": expiresAt,
		"channels":   allowedByPolicy,
	})
}

// Stream handles GET /api/realtime
func (h *RealtimeHandler) Stream(c echo.Context) error {
	requestedChannels := parseRealtimeChannels(c.QueryParam("channels"))
	allowAllLegacy := false
	allowedChannels := map[string]struct{}{}

	rawToken := strings.TrimSpace(c.QueryParam("token"))
	if rawToken == "" {
		switch {
		case !h.AuthzV2Enabled && h.LegacyOpen:
			allowAllLegacy = true
		case !h.AuthzV2Enabled:
			role := strings.ToLower(strings.TrimSpace(roleFromContext(c)))
			if role != "admin" && c.Get("is_service_role") != true && !hasAdminBearerToken(c, h.SigningKey) {
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "realtime session token is required"})
			}
			allowAllLegacy = true
		default:
			return c.JSON(http.StatusUnauthorized, map[string]string{"error": "realtime session token is required"})
		}
	} else {
		claims, err := h.parseRealtimeSessionToken(rawToken)
		if err != nil {
			return c.JSON(http.StatusUnauthorized, map[string]string{"error": "realtime session token is invalid or expired"})
		}
		if !h.AuthzV2Enabled && hasLegacyRealtimeAll(claims.Channels) {
			allowAllLegacy = true
		}
		for _, channel := range claims.Channels {
			allowedChannels[channel] = struct{}{}
		}
		if !allowAllLegacy && len(requestedChannels) > 0 {
			filtered := map[string]struct{}{}
			for _, channel := range requestedChannels {
				if _, ok := allowedChannels[channel]; ok {
					filtered[channel] = struct{}{}
				}
			}
			allowedChannels = filtered
		}
		if !allowAllLegacy && len(allowedChannels) == 0 {
			return c.JSON(http.StatusForbidden, map[string]string{"error": "no authorized realtime channels for this stream"})
		}
	}

	w := c.Response()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	eventChan := h.Broker.Subscribe()
	defer h.Broker.Unsubscribe(eventChan)

	if _, err := fmt.Fprintf(w, ": welcome to OzyBase realtime\n\n"); err != nil {
		return nil
	}
	w.Flush()

	ctx := c.Request().Context()
	for {
		select {
		case event := <-eventChan:
			if !allowAllLegacy {
				eventChannels := deriveRealtimeChannelsFromEvent(event)
				if !realtimeChannelIntersection(eventChannels, allowedChannels) {
					continue
				}
			}
			msg, err := json.Marshal(event)
			if err != nil {
				continue
			}
			if _, err := fmt.Fprintf(w, "data: %s\n\n", msg); err != nil {
				return nil
			}
			w.Flush()
		case <-ctx.Done():
			return nil
		}
	}
}

func hasAdminBearerToken(c echo.Context, signingKey string) bool {
	authHeader := strings.TrimSpace(c.Request().Header.Get("Authorization"))
	if !strings.HasPrefix(strings.ToLower(authHeader), "bearer ") {
		return false
	}
	rawToken := strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
	if rawToken == "" {
		rawToken = strings.TrimSpace(strings.TrimPrefix(authHeader, "bearer "))
	}
	if rawToken == "" {
		return false
	}
	token, err := jwt.Parse(rawToken, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return []byte(signingKey), nil
	})
	if err != nil || !token.Valid {
		return false
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return false
	}
	role := strings.ToLower(strings.TrimSpace(fmt.Sprint(claims["role"])))
	return role == "admin"
}

func (h *RealtimeHandler) parseRealtimeSessionToken(raw string) (realtimeSessionClaims, error) {
	claims := realtimeSessionClaims{}
	token, err := jwt.ParseWithClaims(raw, &claims, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return []byte(h.SigningKey), nil
	})
	if err != nil {
		return claims, err
	}
	if !token.Valid {
		return claims, fmt.Errorf("invalid realtime session token")
	}
	if claims.Scope != "realtime-session" {
		return claims, fmt.Errorf("invalid realtime token scope")
	}
	claims.Channels = dedupeRealtimeStrings(claims.Channels)
	return claims, nil
}

func buildDefaultRealtimeChannels(workspaceID, userID string) []string {
	channels := make([]string, 0, 2)
	if workspaceID != "" {
		channels = append(channels, "workspace:"+workspaceID)
	}
	if userID != "" {
		channels = append(channels, "user:"+userID)
	}
	return channels
}

func isRealtimeChannelAllowed(channel, workspaceID, userID, role string, isServiceRole bool) bool {
	if channel == "" {
		return false
	}
	if strings.HasPrefix(channel, "workspace:") {
		target := strings.TrimSpace(strings.TrimPrefix(channel, "workspace:"))
		if target == "" {
			return false
		}
		if isServiceRole || strings.EqualFold(role, "admin") {
			return true
		}
		return target == workspaceID
	}
	if strings.HasPrefix(channel, "user:") {
		target := strings.TrimSpace(strings.TrimPrefix(channel, "user:"))
		if target == "" {
			return false
		}
		if isServiceRole || strings.EqualFold(role, "admin") {
			return true
		}
		return target == userID
	}
	if strings.HasPrefix(channel, "table:") {
		parts := strings.Split(channel, ":")
		if len(parts) != 3 {
			return false
		}
		targetWorkspace := strings.TrimSpace(parts[1])
		tableName := strings.TrimSpace(parts[2])
		if targetWorkspace == "" || tableName == "" || !realtimeTableNamePattern.MatchString(tableName) {
			return false
		}
		if isServiceRole || strings.EqualFold(role, "admin") {
			return true
		}
		return targetWorkspace == workspaceID
	}
	return false
}

func parseRealtimeChannels(raw string) []string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil
	}
	parts := strings.Split(trimmed, ",")
	channels := make([]string, 0, len(parts))
	for _, part := range parts {
		normalized := normalizeRealtimeChannel(part)
		if normalized != "" {
			channels = append(channels, normalized)
		}
	}
	return dedupeRealtimeStrings(channels)
}

func normalizeRealtimeChannel(raw string) string {
	value := strings.ToLower(strings.TrimSpace(raw))
	if value == "" {
		return ""
	}
	if strings.HasPrefix(value, "workspace:") {
		id := strings.TrimSpace(strings.TrimPrefix(value, "workspace:"))
		if id == "" {
			return ""
		}
		return "workspace:" + id
	}
	if strings.HasPrefix(value, "user:") {
		id := strings.TrimSpace(strings.TrimPrefix(value, "user:"))
		if id == "" {
			return ""
		}
		return "user:" + id
	}
	if strings.HasPrefix(value, "table:") {
		parts := strings.Split(value, ":")
		if len(parts) != 3 {
			return ""
		}
		if strings.TrimSpace(parts[1]) == "" || strings.TrimSpace(parts[2]) == "" {
			return ""
		}
		if !realtimeTableNamePattern.MatchString(strings.TrimSpace(parts[2])) {
			return ""
		}
		return "table:" + strings.TrimSpace(parts[1]) + ":" + strings.TrimSpace(parts[2])
	}
	return ""
}

func deriveRealtimeChannelsFromEvent(event realtime.Event) []string {
	channels := make([]string, 0, 3)

	record := asMap(event.Record)
	oldRecord := asMap(event.Old)
	workspaceID := pickStringField(record, oldRecord, "workspace_id")
	if workspaceID != "" {
		channels = append(channels, "workspace:"+workspaceID)
		if strings.TrimSpace(event.Table) != "" {
			channels = append(channels, "table:"+workspaceID+":"+strings.ToLower(strings.TrimSpace(event.Table)))
		}
	}

	userID := pickStringField(record, oldRecord, "owner_id", "user_id")
	if userID != "" {
		channels = append(channels, "user:"+userID)
	}

	return dedupeRealtimeStrings(channels)
}

func realtimeChannelIntersection(eventChannels []string, allowed map[string]struct{}) bool {
	if len(allowed) == 0 {
		return false
	}
	for _, channel := range eventChannels {
		if _, ok := allowed[channel]; ok {
			return true
		}
	}
	return false
}

func asMap(value any) map[string]any {
	switch typed := value.(type) {
	case nil:
		return nil
	case map[string]any:
		return typed
	default:
		encoded, err := json.Marshal(typed)
		if err != nil {
			return nil
		}
		decoded := map[string]any{}
		if err := json.Unmarshal(encoded, &decoded); err != nil {
			return nil
		}
		return decoded
	}
}

func pickStringField(record map[string]any, oldRecord map[string]any, keys ...string) string {
	for _, key := range keys {
		if record != nil {
			if value := stringify(record[key]); value != "" {
				return value
			}
		}
		if oldRecord != nil {
			if value := stringify(oldRecord[key]); value != "" {
				return value
			}
		}
	}
	return ""
}

func stringify(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(typed)
	default:
		trimmed := strings.TrimSpace(fmt.Sprint(typed))
		if trimmed == "<nil>" {
			return ""
		}
		return trimmed
	}
}

func dedupeRealtimeStrings(items []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(items))
	for _, item := range items {
		trimmed := strings.TrimSpace(item)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		out = append(out, trimmed)
	}
	return out
}

func hasLegacyRealtimeAll(channels []string) bool {
	for _, channel := range channels {
		if strings.EqualFold(strings.TrimSpace(channel), "legacy:all") {
			return true
		}
	}
	return false
}
