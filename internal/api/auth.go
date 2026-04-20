package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"net/mail"
	"os"
	"strconv"
	"strings"

	"github.com/Xangel0s/OzyBase/internal/core"
	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/Xangel0s/OzyBase/internal/logger"
	"github.com/labstack/echo/v4"
	"github.com/markbates/goth/gothic"
)

type AuthService interface {
	DB() *data.DB
	Signup(ctx context.Context, email, password string) (*core.User, error)
	Login(ctx context.Context, email, password, ip, ua string) (*core.AuthLoginResult, error)
	RefreshSession(ctx context.Context, refreshToken, ip, ua string) (*core.TokenPair, error)
	RequestPasswordReset(ctx context.Context, email string) (string, error)
	ConfirmPasswordReset(ctx context.Context, token, newPassword string) error
	VerifyEmail(ctx context.Context, token string) error
	ListUsers(ctx context.Context, limit int) ([]core.User, error)
	UpdateUserRole(ctx context.Context, userID, newRole string) error
	AdminResetUserPassword(ctx context.Context, targetUserID, newPassword string, forceLogout bool) (*core.AdminPasswordResetResult, error)
	DeleteUser(ctx context.Context, targetUserID, actorUserID string) error
	HandleOAuthLogin(ctx context.Context, provider, providerID, email string, data map[string]any) (string, *core.User, error)
	ListSessions(ctx context.Context, userID string) ([]core.Session, error)
	RevokeSession(ctx context.Context, sessionID, userID string) error
	RevokeAllSessions(ctx context.Context) error
}

type AuthHandler struct {
	authService AuthService
}

func NewAuthHandler(authService AuthService) *AuthHandler {
	return &AuthHandler{
		authService: authService,
	}
}

type AuthRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *AuthHandler) Signup(c echo.Context) error {
	var req AuthRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}

	// Email validation
	if _, err := mail.ParseAddress(req.Email); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid email format"})
	}

	// Password validation (Min 8 chars)
	if len(req.Password) < 8 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "password must be at least 8 characters long"})
	}

	user, err := h.authService.Signup(c.Request().Context(), req.Email, req.Password)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	workspaceID := workspaceIDFromRequestHeaders(c)
	if strings.TrimSpace(workspaceID) != "" {
		if attachErr := autoAttachUserToWorkspace(c.Request().Context(), h.authService.DB(), workspaceID, user.ID); attachErr != nil {
			logger.Log.Error().
				Str("module", "auth").
				Str("action", "auto_workspace_link").
				Str("workspace_id", workspaceID).
				Str("user_id", user.ID).
				Err(attachErr).
				Msg("failed to auto-link created user to workspace")
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "user created but workspace membership link failed"})
		}

		logger.Log.Info().
			Str("module", "auth").
			Str("action", "auto_workspace_link").
			Str("workspace_id", workspaceID).
			Str("user_id", user.ID).
			Msg("created user auto-linked to workspace")
	}

	return c.JSON(http.StatusCreated, user)
}

func (h *AuthHandler) Login(c echo.Context) error {
	var req AuthRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}

	result, err := h.authService.Login(c.Request().Context(), req.Email, req.Password, c.RealIP(), c.Request().UserAgent())
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": err.Error()})
	}

	if result.MFARequired {
		return c.JSON(http.StatusAccepted, map[string]any{
			"mfa_required": true,
			"mfa_store":    result.MFAStore,
			"user":         result.User,
			"message":      "2FA verification required",
		})
	}

	return c.JSON(http.StatusOK, map[string]any{
		"token":         result.Token,
		"refresh_token": result.RefreshToken,
		"user":          result.User,
	})
}

func (h *AuthHandler) Refresh(c echo.Context) error {
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}

	if strings.TrimSpace(req.RefreshToken) == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "refresh_token is required"})
	}

	pair, err := h.authService.RefreshSession(c.Request().Context(), req.RefreshToken, c.RealIP(), c.Request().UserAgent())
	if err != nil {
		switch err {
		case core.ErrInvalidRefreshToken, core.ErrRefreshTokenReuse:
			return c.JSON(http.StatusUnauthorized, map[string]string{"error": "invalid refresh token"})
		default:
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to refresh session"})
		}
	}

	return c.JSON(http.StatusOK, map[string]any{
		"token":         pair.AccessToken,
		"refresh_token": pair.RefreshToken,
	})
}

func (h *AuthHandler) CSRFToken(c echo.Context) error {
	token, _ := c.Get("csrf").(string)
	token = strings.TrimSpace(token)
	if token == "" {
		buf := make([]byte, 32)
		if _, err := rand.Read(buf); err != nil {
			return c.JSON(http.StatusServiceUnavailable, map[string]string{"error": "csrf token unavailable"})
		}
		token = hex.EncodeToString(buf)
		c.SetCookie(&http.Cookie{
			Name:     "_ozy_csrf",
			Value:    token,
			Path:     "/",
			HttpOnly: true,
			Secure:   !strings.EqualFold(os.Getenv("DEBUG"), "true"),
			SameSite: http.SameSiteStrictMode,
		})
	}

	return c.JSON(http.StatusOK, map[string]string{"csrf_token": token})
}

func (h *AuthHandler) RequestReset(c echo.Context) error {
	var req struct {
		Email string `json:"email"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}

	token, err := h.authService.RequestPasswordReset(c.Request().Context(), req.Email)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	response := map[string]any{
		"message": "If the email exists, a reset token has been generated",
	}

	// Never leak reset tokens in production API responses.
	if strings.EqualFold(os.Getenv("DEBUG"), "true") && token != "" {
		response["token"] = token
	}

	return c.JSON(http.StatusOK, response)
}

func (h *AuthHandler) ConfirmReset(c echo.Context) error {
	var req struct {
		Token       string `json:"token"`
		NewPassword string `json:"new_password"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}

	if len(req.NewPassword) < 8 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "password must be at least 8 characters"})
	}

	err := h.authService.ConfirmPasswordReset(c.Request().Context(), req.Token, req.NewPassword)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]string{"message": "password has been reset successfully"})
}

func (h *AuthHandler) VerifyEmail(c echo.Context) error {
	token := c.QueryParam("token")
	if token == "" {
		var req struct {
			Token string `json:"token"`
		}
		_ = c.Bind(&req)
		token = req.Token
	}

	if token == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "missing token"})
	}

	err := h.authService.VerifyEmail(c.Request().Context(), token)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]string{"message": "email verified successfully"})
}

func (h *AuthHandler) ListUsers(c echo.Context) error {
	limit := 100
	if raw := strings.TrimSpace(c.QueryParam("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 && parsed <= 1000 {
			limit = parsed
		}
	}

	users, err := h.authService.ListUsers(c.Request().Context(), limit)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to list users"})
	}

	return c.JSON(http.StatusOK, map[string]any{
		"data":  users,
		"total": len(users),
	})
}

func (h *AuthHandler) UpdateRole(c echo.Context) error {
	id := c.Param("id")
	var req struct {
		Role string `json:"role"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}

	err := h.authService.UpdateUserRole(c.Request().Context(), id, req.Role)
	if err != nil {
		switch err {
		case core.ErrUserNotFound:
			return c.JSON(http.StatusNotFound, map[string]string{"error": "user not found"})
		case core.ErrCannotDemoteLastAdmin:
			return c.JSON(http.StatusConflict, map[string]string{"error": "cannot demote the last remaining admin"})
		default:
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to update user role"})
		}
	}

	return c.JSON(http.StatusOK, map[string]string{"message": "user role updated successfully"})
}

func (h *AuthHandler) ResetUserPassword(c echo.Context) error {
	targetUserID := strings.TrimSpace(c.Param("id"))
	if targetUserID == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "user id is required"})
	}

	var req struct {
		Password    string `json:"password"`
		ForceLogout *bool  `json:"force_logout"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}

	password := strings.TrimSpace(req.Password)
	if password != "" && len(password) < 12 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "password must be at least 12 characters"})
	}

	forceLogout := true
	if req.ForceLogout != nil {
		forceLogout = *req.ForceLogout
	}

	result, err := h.authService.AdminResetUserPassword(c.Request().Context(), targetUserID, password, forceLogout)
	if err != nil {
		switch err {
		case core.ErrUserNotFound:
			return c.JSON(http.StatusNotFound, map[string]string{"error": "user not found"})
		default:
			if strings.Contains(strings.ToLower(err.Error()), "at least 12") {
				return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
			}
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to reset user password"})
		}
	}

	response := map[string]any{
		"message":                "password reset successfully",
		"sessions_terminated":    result.SessionsTerminated,
		"refresh_tokens_revoked": result.RefreshTokensRevoked,
	}
	if result.TemporaryPassword != "" {
		response["temporary_password"] = result.TemporaryPassword
	}

	return c.JSON(http.StatusOK, response)
}

func (h *AuthHandler) DeleteUser(c echo.Context) error {
	actorUserID, _ := c.Get("user_id").(string)
	targetUserID := c.Param("id")
	if strings.TrimSpace(targetUserID) == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "user id is required"})
	}

	err := h.authService.DeleteUser(c.Request().Context(), targetUserID, actorUserID)
	if err != nil {
		switch err {
		case core.ErrUserNotFound:
			return c.JSON(http.StatusNotFound, map[string]string{"error": "user not found"})
		case core.ErrCannotDeleteCurrentUser:
			return c.JSON(http.StatusConflict, map[string]string{"error": "you cannot delete the current authenticated user"})
		case core.ErrCannotDeleteLastAdmin:
			return c.JSON(http.StatusConflict, map[string]string{"error": "cannot delete the last remaining admin"})
		default:
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to delete user"})
		}
	}

	return c.JSON(http.StatusOK, map[string]string{"message": "user deleted successfully"})
}

func (h *AuthHandler) GetOAuthURL(c echo.Context) error {
	provider := c.Param("provider")
	if provider == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "provider is required"})
	}

	// Update context with provider for goth/gothic
	req := c.Request()
	q := req.URL.Query()
	q.Set("provider", provider)
	req.URL.RawQuery = q.Encode()

	gothic.BeginAuthHandler(c.Response(), req)
	return nil
}

func (h *AuthHandler) OAuthCallback(c echo.Context) error {
	provider := c.Param("provider")

	// Update context with provider
	req := c.Request()
	q := req.URL.Query()
	q.Set("provider", provider)
	req.URL.RawQuery = q.Encode()

	user, err := gothic.CompleteUserAuth(c.Response(), req)
	if err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": err.Error()})
	}

	token, dbUser, err := h.authService.HandleOAuthLogin(c.Request().Context(), provider, user.UserID, user.Email, map[string]any{
		"name":       user.Name,
		"avatar_url": user.AvatarURL,
	})

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]any{
		"token": token,
		"user":  dbUser,
	})
}

func (h *AuthHandler) ListSessions(c echo.Context) error {
	userID := c.Get("user_id").(string)
	sessions, err := h.authService.ListSessions(c.Request().Context(), userID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, sessions)
}

func (h *AuthHandler) RevokeSession(c echo.Context) error {
	userID := c.Get("user_id").(string)
	sessionID := c.Param("id")
	err := h.authService.RevokeSession(c.Request().Context(), sessionID, userID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.NoContent(http.StatusNoContent)
}

func (h *AuthHandler) RevokeAllSessions(c echo.Context) error {
	if role, _ := c.Get("role").(string); role != "admin" {
		return c.JSON(http.StatusForbidden, map[string]string{"error": "admin role required"})
	}
	if err := h.authService.RevokeAllSessions(c.Request().Context()); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, map[string]string{
		"status":  "ok",
		"message": "all sessions revoked successfully",
	})
}
