package config

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	DatabaseURL    string
	Port           string
	JWTSecret      string
	AllowedOrigins []string
	RateLimitRPS   float64
	RateLimitBurst int
	BodyLimit      string
}

func Load() (*Config, error) {
	_ = godotenv.Load()

	// Validate required PostgreSQL variables
	required := []string{"DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME"}
	allSet := true
	for _, env := range required {
		if os.Getenv(env) == "" {
			allSet = false
			break
		}
	}

	var dbURL string
	if allSet {
		dbURL = fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=%s",
			os.Getenv("DB_USER"),
			os.Getenv("DB_PASSWORD"),
			os.Getenv("DB_HOST"),
			os.Getenv("DB_PORT"),
			os.Getenv("DB_NAME"),
			getEnv("DB_SSLMODE", "disable"),
		)
	} else {
		dbURL = getEnv("DATABASE_URL", "postgres://localhost:5432/OzyBase?sslmode=disable")
	}

	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		jwtSecret = getOrGenerateSecret()
	}

	origins := strings.Split(getEnv("ALLOWED_ORIGINS", "*"), ",")
	rps, _ := strconv.ParseFloat(getEnv("RATE_LIMIT_RPS", "20"), 64)
	burst, _ := strconv.Atoi(getEnv("RATE_LIMIT_BURST", "20"))

	cfg := &Config{
		DatabaseURL:    dbURL,
		Port:           getEnv("PORT", "8090"),
		JWTSecret:      jwtSecret,
		AllowedOrigins: origins,
		RateLimitRPS:   rps,
		RateLimitBurst: burst,
		BodyLimit:      getEnv("BODY_LIMIT", "10M"),
	}

	return cfg, nil
}

func getOrGenerateSecret() string {
	const secretFile = ".ozy_secret"
	if data, err := os.ReadFile(secretFile); err == nil {
		return string(data)
	}

	b := make([]byte, 64)
	if _, err := rand.Read(b); err != nil {
		return "emergency-static-secret-should-never-happen"
	}
	secret := hex.EncodeToString(b)
	_ = os.WriteFile(secretFile, []byte(secret), 0600)
	return secret
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
