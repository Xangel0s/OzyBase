package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/Xangel0s/OzyBase/internal/api"
	ozyauth "github.com/Xangel0s/OzyBase/internal/auth"
	"github.com/Xangel0s/OzyBase/internal/config"
	"github.com/Xangel0s/OzyBase/internal/core"
	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/Xangel0s/OzyBase/internal/logger"
	"github.com/Xangel0s/OzyBase/internal/mailer"
	"github.com/Xangel0s/OzyBase/internal/realtime"
	"github.com/Xangel0s/OzyBase/internal/typegen"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"golang.org/x/crypto/bcrypt"
	"golang.org/x/time/rate"
)

func main() {
	if err := run(); err != nil {
		log.Printf("❌ Failed to start OzyBase: %v", err)
		os.Exit(1)
	}
}

func run() error {
	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("failed to load config: %w", err)
	}

	// Initialize Logger
	logger.Init(os.Getenv("DEBUG") == "true")
	logger.Log.Info().Msg("🎯 OzyBase initializing...")

	// Connect to database
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	db, err := data.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}
	defer db.Close()

	logger.Log.Info().Msg("✅ Connected to PostgreSQL")

	// Run migrations
	if err := db.RunMigrations(ctx); err != nil {
		return fmt.Errorf("failed to run migrations: %w", err)
	}

	// Auto-setup admin user
	ozyauth.EnsureAdminUser(db)

	// CLI Commands handling
	if handleCLI(db) {
		return nil
	}

	// Initialize Realtime, Webhooks & Cron
	broker := realtime.NewBroker()
	dispatcher := realtime.NewWebhookDispatcher(db.Pool)
	cronMgr := realtime.NewCronManager(db.Pool)
	cronMgr.Start()

	// Start database event listener
	go realtime.ListenForEvents(context.Background(), db.Pool, broker, dispatcher)

	// Setup Mailer
	mailSvc := mailer.NewLogMailer()

	// Initialize Server Components
	h := api.NewHandler(db, broker, dispatcher, mailSvc)

	// Start Log Export Worker
	go h.StartLogExporter(context.Background())

	e := setupEcho(h, cfg, cronMgr)

	// Start server
	addr := fmt.Sprintf(":%s", cfg.Port)
	go func() {
		logger.Log.Info().Str("addr", addr).Msg("🚀 OzyBase server starting")
		if err := e.Start(addr); err != nil && err != http.ErrServerClosed {
			logger.Log.Fatal().Err(err).Msg("Server crashed")
		}
	}()

	// Wait for interruption
	<-ctx.Done()
	logger.Log.Info().Msg("🛑 Shutting down server...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := e.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("failed to shutdown server: %w", err)
	}

	logger.Log.Info().Msg("👋 Server exited")
	return nil
}

func handleCLI(db *data.DB) bool {
	if len(os.Args) > 1 && os.Args[1] == "gen-types" {
		outputPath := "./OzyBase-types.ts"
		for i, arg := range os.Args {
			if arg == "--out" && i+1 < len(os.Args) {
				outputPath = os.Args[i+1]
			}
		}

		gen := typegen.NewGenerator(db)
		if err := gen.Generate(outputPath); err != nil {
			log.Fatalf("Failed to generate types: %v", err)
		}
		log.Printf("✅ Types generated successfully to %s", outputPath)
		return true
	}

	if len(os.Args) > 1 && os.Args[1] == "reset-admin" {
		ctx := context.Background()
		email := "system@ozybase.local"
		newPass := "admin123"

		if len(os.Args) > 2 {
			newPass = os.Args[2]
		}

		log.Printf("🔐 Resetting password for %s...", email)

		hashedPassword, err := bcrypt.GenerateFromPassword([]byte(newPass), 12)
		if err != nil {
			log.Fatalf("Failed to hash password: %v", err)
		}

		_, err = db.Pool.Exec(ctx, "UPDATE _v_users SET password_hash = $1 WHERE email = $2", string(hashedPassword), email)
		if err != nil {
			log.Fatalf("Failed to update password: %v", err)
		}

		log.Printf("✅ Admin password reset successfully to: %s", newPass)
		return true
	}
	return false
}

func setupEcho(h *api.Handler, cfg *config.Config, cronMgr *realtime.CronManager) *echo.Echo {
	e := echo.New()
	e.HideBanner = true

	// Middleware
	e.Use(middleware.Logger())
	e.Use(middleware.Recover())
	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins: cfg.AllowedOrigins,
		AllowHeaders: []string{echo.HeaderOrigin, echo.HeaderContentType, echo.HeaderAccept, echo.HeaderAuthorization},
	}))
	e.Use(middleware.RateLimiter(middleware.NewRateLimiterMemoryStoreWithConfig(
		middleware.RateLimiterMemoryStoreConfig{
			Rate:      rate.Limit(cfg.RateLimitRPS),
			Burst:     cfg.RateLimitBurst,
			ExpiresIn: 3 * time.Minute,
		},
	)))
	e.Use(api.SecurityHeadersDefault())
	e.Use(middleware.BodyLimit(cfg.BodyLimit))
	e.Use(middleware.CSRFWithConfig(middleware.CSRFConfig{
		TokenLookup: "header:X-CSRF-Token",
		ContextKey:  "csrf",
		CookieName:  "_ozy_csrf",
		CookiePath:  "/",
		Skipper: func(c echo.Context) bool {
			// Skip CSRF for API requests with Bearer token (since they are already protected by JWT)
			// or for specific public endpoints if needed.
			authHeader := c.Request().Header.Get("Authorization")
			return strings.HasPrefix(authHeader, "Bearer ")
		},
	}))

	// Services and Handlers
	// Setup Mailer
	mailSvc := mailer.NewLogMailer()

	authService := core.NewAuthService(h.DB, cfg.JWTSecret, mailSvc)
	authHandler := api.NewAuthHandler(authService)
	twoFactorService := core.NewTwoFactorService(h.DB)
	twoFactorHandler := api.NewTwoFactorHandler(twoFactorService)
	realtimeHandler := api.NewRealtimeHandler(h.Broker)
	fileHandler := api.NewFileHandler(h.DB, "./data/storage")
	functionsHandler := api.NewFunctionsHandler(h.DB, "./functions")
	webhookHandler := api.NewWebhookHandler(h.DB)
	cronHandler := api.NewCronHandler(h.DB, cronMgr)

	// API Groups and Middlewares
	authRequired := api.AuthMiddleware(cfg.JWTSecret, false)
	authOptional := api.AuthMiddleware(cfg.JWTSecret, true)
	accessList := api.AccessMiddleware(h.DB, "list")
	accessCreate := api.AccessMiddleware(h.DB, "create")
	accessUpdate := api.AccessMiddleware(h.DB, "update")
	accessDelete := api.AccessMiddleware(h.DB, "delete")

	apiGroup := e.Group("/api")
	apiGroup.Use(api.MetricsMiddleware(h))
	{
		apiGroup.GET("/health", h.Health)
		apiGroup.GET("/project/stats", h.GetStats, authRequired)
		apiGroup.GET("/realtime", realtimeHandler.Stream)
		apiGroup.GET("/webhooks", webhookHandler.List, authRequired)
		apiGroup.POST("/webhooks", webhookHandler.Create, authRequired)
		apiGroup.DELETE("/webhooks/:id", webhookHandler.Delete, authRequired)

		apiGroup.GET("/cron", cronHandler.List, authRequired)
		apiGroup.POST("/cron", cronHandler.Create, authRequired)
		apiGroup.DELETE("/cron/:id", cronHandler.Delete, authRequired)

		// Auth
		authGroup := apiGroup.Group("/auth")
		authGroup.POST("/login", authHandler.Login)
		// Signup is now protected, only an authenticated user (admin) can create others
		authGroup.POST("/signup", authHandler.Signup, authRequired)
		authGroup.POST("/reset-password/request", authHandler.RequestReset)
		authGroup.POST("/reset-password/confirm", authHandler.ConfirmReset)
		authGroup.GET("/verify-email", authHandler.VerifyEmail)
		authGroup.PATCH("/users/:id/role", authHandler.UpdateRole, authRequired)

		// Social Login
		authGroup.GET("/login/:provider", authHandler.GetOAuthURL)
		authGroup.GET("/callback/:provider", authHandler.OAuthCallback)

		// Two-Factor Authentication
		authGroup.POST("/2fa/setup", twoFactorHandler.Setup2FA, authRequired)
		authGroup.POST("/2fa/enable", twoFactorHandler.Enable2FA, authRequired)
		authGroup.POST("/2fa/disable", twoFactorHandler.Disable2FA, authRequired)
		authGroup.GET("/2fa/status", twoFactorHandler.Get2FAStatus, authRequired)
		authGroup.POST("/2fa/verify", twoFactorHandler.Verify2FA)

		// Functions
		apiGroup.GET("/functions", functionsHandler.List, authRequired)
		apiGroup.POST("/functions", functionsHandler.Create, authRequired)
		apiGroup.POST("/functions/:name/invoke", functionsHandler.Invoke)

		// Files
		apiGroup.POST("/files", fileHandler.Upload, authRequired)
		apiGroup.GET("/files", fileHandler.List, authRequired)
		apiGroup.GET("/files/buckets", fileHandler.ListBuckets, authRequired)
		apiGroup.POST("/files/buckets", fileHandler.CreateBucket, authRequired)
		e.Static("/api/files", "./data/storage")

		// Collections
		collectionsGroup := apiGroup.Group("/collections", authRequired)
		collectionsGroup.POST("", h.CreateCollection)
		collectionsGroup.GET("", h.ListCollections)
		collectionsGroup.DELETE("/:name", h.DeleteCollection) // New
		collectionsGroup.GET("/schemas", h.ListSchemas)
		collectionsGroup.GET("/visualize", h.GetVisualizeSchema)
		collectionsGroup.PATCH("/rules", h.UpdateCollectionRules)

		// Project Info
		apiGroup.GET("/project/info", h.GetProjectInfo, authRequired)
		apiGroup.GET("/project/health", h.GetHealthIssues, authRequired)
		apiGroup.GET("/project/security/policies", h.GetSecurityPolicies, authRequired)
		apiGroup.POST("/project/security/policies", h.UpdateSecurityPolicy, authRequired)
		apiGroup.GET("/project/security/stats", h.GetSecurityStats, authRequired)
		apiGroup.GET("/project/security/notifications", h.GetNotificationRecipients, authRequired)
		apiGroup.POST("/project/security/notifications", h.AddNotificationRecipient, authRequired)
		apiGroup.DELETE("/project/security/notifications/:id", h.DeleteNotificationRecipient, authRequired)

		// Integrations (Slack, Discord, SIEM)
		apiGroup.GET("/project/integrations", h.ListIntegrations, authRequired)
		apiGroup.POST("/project/integrations", h.CreateIntegration, authRequired)
		apiGroup.DELETE("/project/integrations/:id", h.DeleteIntegration, authRequired)
		apiGroup.POST("/project/integrations/:id/test", h.TestIntegration, authRequired)

		apiGroup.POST("/project/health/fix", h.FixHealthIssues, authRequired)
		apiGroup.GET("/project/logs", h.GetLogs, authRequired)

		// Extensions
		apiGroup.GET("/extensions", h.ListExtensions, authRequired)
		apiGroup.POST("/extensions/:name", h.ToggleExtension, authRequired)

		// Integrations
		apiGroup.GET("/webhooks", h.ListWebhooks, authRequired)
		apiGroup.POST("/webhooks", h.CreateWebhook, authRequired)
		apiGroup.DELETE("/webhooks/:id", h.DeleteWebhook, authRequired)

		apiGroup.GET("/cron", h.ListCronJobs, authRequired)
		apiGroup.POST("/cron", h.CreateCronJob, authRequired)
		apiGroup.DELETE("/cron/:id", h.DeleteCronJob, authRequired)

		apiGroup.GET("/vault", h.ListSecrets, authRequired)
		apiGroup.POST("/vault", h.CreateSecret, authRequired)
		apiGroup.DELETE("/vault/:id", h.DeleteSecret, authRequired)

		apiGroup.GET("/wrappers", h.ListWrappers, authRequired)
		apiGroup.POST("/graphql/v1", h.HandleGraphQL, authRequired)

		apiGroup.GET("/schema/:name", h.GetTableSchema, authRequired)

		// Records
		apiGroup.POST("/collections/:name/records", h.CreateRecord, authOptional, accessCreate)
		apiGroup.GET("/collections/:name/records", h.ListRecords, authOptional, accessList)
		apiGroup.GET("/collections/:name/records/:id", h.GetRecord, authOptional, accessList)
		apiGroup.PATCH("/collections/:name/records/:id", h.UpdateRecord, authOptional, accessUpdate)
		apiGroup.DELETE("/collections/:name/records/:id", h.DeleteRecord, authOptional, accessDelete)

		// Tables (Generic/Dashboard endpoints) - Now PROTECTED
		apiGroup.GET("/tables/:name", h.ListRecords, authRequired)
		apiGroup.POST("/tables/:name/rows", h.CreateRecord, authRequired)
		apiGroup.PATCH("/tables/:name/rows/:id", h.UpdateRecord, authRequired)
		apiGroup.DELETE("/tables/:name/rows/:id", h.DeleteRecord, authRequired)
		apiGroup.POST("/tables/:name/import", h.ImportRecords, authRequired)
		apiGroup.POST("/tables/:name/columns", h.AddColumn, authRequired)           // New
		apiGroup.DELETE("/tables/:name/columns/:col", h.DeleteColumn, authRequired) // New
	}

	// Create users table for demo if missing
	ensureUsersTable(h.DB)

	// Static Frontend (SPA)
	api.RegisterStaticRoutes(e)

	return e
}

func ensureUsersTable(db *data.DB) {
	ctx := context.Background()
	// Check if 'users' table exists in _v_collections
	var exists bool
	err := db.Pool.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM _v_collections WHERE name = 'users')").Scan(&exists)
	if err != nil || exists {
		return
	}

	log.Println("🛠️ Creating 'users' collection for the first time...")

	// Simple mock schema registration
	// We'll just create the table directly for this demo if it's missing from Postgres too
	_, _ = db.Pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS users (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			email TEXT,
			username TEXT,
			is_verified BOOLEAN DEFAULT FALSE,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)
	`)

	// Register in metadata
	_, _ = db.Pool.Exec(ctx, `
		INSERT INTO _v_collections (name, schema_def, list_rule, create_rule)
		VALUES ('users', '[]', 'public', 'public')
		ON CONFLICT DO NOTHING
	`)

	// Insert some mock data
	_, _ = db.Pool.Exec(ctx, `
		INSERT INTO users (email, username, is_verified) VALUES
		('alex.smith@example.com', 'asmith', true),
		('jordan.doe@company.org', 'jdoe', false)
		ON CONFLICT DO NOTHING
	`)

	// Create 'posts' table with Foreign Key to demonstrate visualizer connections
	_, _ = db.Pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS posts (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id UUID REFERENCES users(id) ON DELETE CASCADE,
			title TEXT NOT NULL,
			content TEXT,
			published BOOLEAN DEFAULT FALSE,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)
	`)

	// Register 'posts' in metadata
	_, _ = db.Pool.Exec(ctx, `
		INSERT INTO _v_collections (name, schema_def, list_rule, create_rule)
		VALUES ('posts', '[]', 'public', 'public')
		ON CONFLICT DO NOTHING
	`)
}
