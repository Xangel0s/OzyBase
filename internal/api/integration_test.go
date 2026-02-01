package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/Xangel0s/OzyBase/internal/api"
	"github.com/Xangel0s/OzyBase/internal/config"
	"github.com/Xangel0s/OzyBase/internal/core"
	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/Xangel0s/OzyBase/internal/realtime"
	"github.com/joho/godotenv"
	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestIntegration_FullFlow(t *testing.T) {
	// Load .env from root for tests
	_ = godotenv.Load("../../.env")

	// Skip if no database connection is available
	cfg, err := config.Load()
	if err != nil || (os.Getenv("DATABASE_URL") == "" && cfg.DatabaseURL == "") {
		t.Skip("Skipping integration test: DATABASE_URL not set")
	}

	ctx := context.Background()
	db, err := data.Connect(ctx, cfg.DatabaseURL)
	require.NoError(t, err)
	defer db.Close()

	// Run migrations
	err = db.RunMigrations(ctx)
	require.NoError(t, err)

	// Setup Echo
	e := echo.New()
	broker := realtime.NewBroker()
	dispatcher := realtime.NewWebhookDispatcher(db.Pool)
	h := api.NewHandler(db, broker, dispatcher)
	authService := core.NewAuthService(db, cfg.JWTSecret)
	authHandler := api.NewAuthHandler(authService)

	// Middlewares
	authRequired := api.AuthMiddleware(cfg.JWTSecret, false)
	authOptional := api.AuthMiddleware(cfg.JWTSecret, true)
	accessCreate := api.AccessMiddleware(db, "create")
	accessList := api.AccessMiddleware(db, "list")

	// Routes
	e.POST("/api/auth/signup", authHandler.Signup)
	e.POST("/api/auth/login", authHandler.Login)
	e.POST("/api/collections", h.CreateCollection, authRequired)
	e.POST("/api/collections/:name/records", h.CreateRecord, authOptional, accessCreate)
	e.GET("/api/collections/:name/records", h.ListRecords, authOptional, accessList)

	// --- 1. Signup ---
	testEmail := fmt.Sprintf("test_integration_%d@OzyBase.io", time.Now().UnixNano())
	testPass := "Password123!"

	signupBody, _ := json.Marshal(map[string]string{
		"email":    testEmail,
		"password": testPass,
	})

	req := httptest.NewRequest(http.MethodPost, "/api/auth/signup", bytes.NewBuffer(signupBody))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusCreated, rec.Code)

	// --- 2. Login ---
	loginBody, _ := json.Marshal(map[string]string{
		"email":    testEmail,
		"password": testPass,
	})

	req = httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewBuffer(loginBody))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec = httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)

	var loginResp struct {
		Token string `json:"token"`
	}
	err = json.Unmarshal(rec.Body.Bytes(), &loginResp)
	require.NoError(t, err)
	token := loginResp.Token
	require.NotEmpty(t, token)

	// --- 3. Create Collection (Auth Required) ---
	collectionName := fmt.Sprintf("test_col_int_%d", time.Now().UnixNano()/1e6)
	colBody, _ := json.Marshal(map[string]interface{}{
		"name": collectionName,
		"schema": []map[string]interface{}{
			{"name": "title", "type": "text", "required": true},
			{"name": "views", "type": "number", "default": 0},
		},
		"list_rule":   "auth",
		"create_rule": "auth",
	})

	req = httptest.NewRequest(http.MethodPost, "/api/collections", bytes.NewBuffer(colBody))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	req.Header.Set(echo.HeaderAuthorization, "Bearer "+token)
	rec = httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusCreated, rec.Code)

	// Verify metadata exists
	var count int
	err = db.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM _v_collections WHERE name = $1", collectionName).Scan(&count)
	require.NoError(t, err)
	fmt.Printf("DEBUG: Collection %s count in metadata: %d\n", collectionName, count)

	// --- 4. Insert Record ---
	recordBody, _ := json.Marshal(map[string]interface{}{
		"title": "Integration Test Success",
		"views": 99,
	})

	req = httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/collections/%s/records", collectionName), bytes.NewBuffer(recordBody))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	req.Header.Set(echo.HeaderAuthorization, "Bearer "+token)
	rec = httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusCreated, rec.Code)

	// --- 5. List Records (Unauthorized Check) ---
	req = httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/collections/%s/records", collectionName), nil)
	rec = httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	// Should be 403 because list_rule is 'auth' and we didn't provide token
	assert.Equal(t, http.StatusForbidden, rec.Code)

	// --- 6. List Records (Authorized) ---
	req = httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/collections/%s/records", collectionName), nil)
	req.Header.Set(echo.HeaderAuthorization, "Bearer "+token)
	rec = httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)

	var items []map[string]interface{}
	err = json.Unmarshal(rec.Body.Bytes(), &items)
	if err != nil {
		fmt.Printf("DEBUG: Response Body: %s\n", rec.Body.String())
	}
	require.NoError(t, err)

	require.NotEmpty(t, items)
	assert.Equal(t, "Integration Test Success", items[0]["title"])
}
