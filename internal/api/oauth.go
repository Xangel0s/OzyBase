package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"

	"github.com/google/go-github/v53/github"
	"github.com/labstack/echo/v4"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

// This logic is simplified for the demonstration of Social Login.
// In a production app, client IDs and secrets would be stored in the Vault (_v_secrets).

func (h *AuthHandler) GetOAuthURL(c echo.Context) error {
	provider := c.Param("provider")

	// Generate random state
	b := make([]byte, 16)
	rand.Read(b)
	state := hex.EncodeToString(b)

	// Store state in cookie for verification
	cookie := &http.Cookie{
		Name:     "oauth_state",
		Value:    state,
		MaxAge:   300,
		HttpOnly: true,
		Secure:   false, // Set to true in prod
		Path:     "/",
	}
	c.SetCookie(cookie)

	var authURL string
	switch provider {
	case "google":
		conf := h.getGoogleConfig()
		authURL = conf.AuthCodeURL(state)
	case "github":
		conf := h.getGithubConfig()
		authURL = conf.AuthCodeURL(state)
	default:
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "unsupported provider"})
	}

	return c.JSON(http.StatusOK, map[string]string{"url": authURL})
}

func (h *AuthHandler) OAuthCallback(c echo.Context) error {
	provider := c.Param("provider")
	state := c.QueryParam("state")
	code := c.QueryParam("code")

	// Verify state
	cookie, err := c.Cookie("oauth_state")
	if err != nil || cookie.Value != state {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid state"})
	}

	ctx := c.Request().Context()
	var email, providerID string
	var extraData map[string]interface{}

	switch provider {
	case "google":
		conf := h.getGoogleConfig()
		tok, err := conf.Exchange(ctx, code)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "failed to exchange token"})
		}

		client := conf.Client(ctx, tok)
		resp, err := client.Get("https://www.googleapis.com/oauth2/v2/userinfo")
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to get user info"})
		}
		defer resp.Body.Close()

		var gUser struct {
			ID    string `json:"id"`
			Email string `json:"email"`
		}
		json.NewDecoder(resp.Body).Decode(&gUser)
		email = gUser.Email
		providerID = gUser.ID
		extraData = map[string]interface{}{"google_id": gUser.ID}

	case "github":
		conf := h.getGithubConfig()
		tok, err := conf.Exchange(ctx, code)
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "failed to exchange token"})
		}

		client := github.NewTokenClient(ctx, tok.AccessToken)
		user, _, err := client.Users.Get(ctx, "")
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to get github user"})
		}

		providerID = fmt.Sprintf("%d", *user.ID)
		if user.Email != nil {
			email = *user.Email
		} else {
			email = fmt.Sprintf("%s@github.com", *user.Login)
		}
		extraData = map[string]interface{}{"github_user": *user.Login}
	}

	// Sign in or register via AuthService
	token, _, err := h.authService.HandleOAuthLogin(ctx, provider, providerID, email, extraData)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	// Redirect back to frontend with token
	// In a real app, you might use a more secure way to pass the token
	frontendURL := os.Getenv("FRONTEND_URL")
	if frontendURL == "" {
		frontendURL = "http://localhost:5173"
	}

	// We use a query param for simplicity in this demo
	return c.Redirect(http.StatusTemporaryRedirect, fmt.Sprintf("%s/oauth-callback?token=%s", frontendURL, token))
}

func (h *AuthHandler) getGoogleConfig() *oauth2.Config {
	return &oauth2.Config{
		ClientID:     os.Getenv("GOOGLE_CLIENT_ID"),
		ClientSecret: os.Getenv("GOOGLE_CLIENT_SECRET"),
		RedirectURL:  os.Getenv("OZY_API_URL") + "/api/auth/callback/google",
		Scopes:       []string{"https://www.googleapis.com/auth/userinfo.email"},
		Endpoint:     google.Endpoint,
	}
}

func (h *AuthHandler) getGithubConfig() *oauth2.Config {
	// Import for GitHub might be needed
	return &oauth2.Config{
		ClientID:     os.Getenv("GITHUB_CLIENT_ID"),
		ClientSecret: os.Getenv("GITHUB_CLIENT_SECRET"),
		RedirectURL:  os.Getenv("OZY_API_URL") + "/api/auth/callback/github",
		Scopes:       []string{"user:email"},
		Endpoint: oauth2.Endpoint{
			AuthURL:  "https://github.com/login/oauth/authorize",
			TokenURL: "https://github.com/login/oauth/access_token",
		},
	}
}
