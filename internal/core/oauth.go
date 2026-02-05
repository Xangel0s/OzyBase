package core

import (
	"fmt"
	"os"

	"github.com/markbates/goth"
	"github.com/markbates/goth/providers/github"
	"github.com/markbates/goth/providers/google"
)

// InitOAuth initializes the OAuth providers using gothic/goth
func InitOAuth() error {
	githubClient := os.Getenv("GITHUB_CLIENT_ID")
	githubSecret := os.Getenv("GITHUB_CLIENT_SECRET")
	googleClient := os.Getenv("GOOGLE_CLIENT_ID")
	googleSecret := os.Getenv("GOOGLE_CLIENT_SECRET")
	callbackURL := os.Getenv("OZY_CALLBACK_URL")

	if callbackURL == "" {
		callbackURL = "http://localhost:8090/api/auth/oauth/callback"
	}

	var providers []goth.Provider

	if githubClient != "" && githubSecret != "" {
		providers = append(providers, github.New(githubClient, githubSecret, fmt.Sprintf("%s?provider=github", callbackURL)))
	}

	if googleClient != "" && googleSecret != "" {
		providers = append(providers, google.New(googleClient, googleSecret, fmt.Sprintf("%s?provider=google", callbackURL)))
	}

	if len(providers) > 0 {
		goth.UseProviders(providers...)
	}

	return nil
}

// GetProviderUser common interface for OAuth users
type OAuthUser struct {
	ID        string
	Email     string
	Name      string
	AvatarURL string
	Provider  string
}
