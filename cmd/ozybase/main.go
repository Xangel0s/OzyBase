package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Xangel0s/OzyBase/internal/api"
	ozyauth "github.com/Xangel0s/OzyBase/internal/auth"
	"github.com/Xangel0s/OzyBase/internal/config"
	"github.com/Xangel0s/OzyBase/internal/core"
	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/Xangel0s/OzyBase/internal/realtime"
	"github.com/Xangel0s/OzyBase/internal/typegen"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"golang.org/x/crypto/bcrypt"
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

	// Connect to database
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	db, err := data.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("failed to connect to database: %w", err)
	}
	defer db.Close()

	log.Println("✅ Connected to PostgreSQL")

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

	// Initialize Realtime & Webhooks
	broker := realtime.NewBroker()
	dispatcher := realtime.NewWebhookDispatcher(db.Pool)

	// Start database event listener
	go realtime.ListenForEvents(context.Background(), db.Pool, broker, dispatcher)

	// Initialize Server Components
	h := api.NewHandler(db, broker, dispatcher)
	e := setupEcho(h, cfg)

	// Start server
	addr := fmt.Sprintf(":%s", cfg.Port)
	go func() {
		log.Printf("🚀 OzyBase server starting on http://localhost%s", addr)
		if err := e.Start(addr); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	// Wait for interruption
	<-ctx.Done()
	log.Println("🛑 Shutting down server...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := e.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("failed to shutdown server: %w", err)
	}

	log.Println("👋 Server exited")
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

func setupEcho(h *api.Handler, cfg *config.Config) *echo.Echo {
	e := echo.New()
	e.HideBanner = true

	// Middleware
	e.Use(middleware.Logger())
	e.Use(middleware.Recover())
	e.Use(middleware.CORS())
	e.Use(middleware.RateLimiter(middleware.NewRateLimiterMemoryStore(20)))
	e.Use(api.SecurityHeadersDefault())
	e.Use(middleware.BodyLimit("10M"))

	// Services and Handlers
	authService := core.NewAuthService(h.DB, cfg.JWTSecret)
	authHandler := api.NewAuthHandler(authService)
	realtimeHandler := api.NewRealtimeHandler(h.Broker)
	fileHandler := api.NewFileHandler("./data/storage")
	functionsHandler := api.NewFunctionsHandler("./functions")

	// API Groups and Middlewares
	authRequired := api.AuthMiddleware(cfg.JWTSecret, false)
	authOptional := api.AuthMiddleware(cfg.JWTSecret, true)
	accessList := api.AccessMiddleware(h.DB, "list")
	accessCreate := api.AccessMiddleware(h.DB, "create")

	apiGroup := e.Group("/api")
	apiGroup.Use(api.MetricsMiddleware(h.Metrics))
	{
		apiGroup.GET("/health", h.Health)
		apiGroup.GET("/realtime", realtimeHandler.Stream)

		// Auth
		authGroup := apiGroup.Group("/auth")
		authGroup.POST("/login", authHandler.Login)
		// Signup is now protected, only an authenticated user (admin) can create others
		authGroup.POST("/signup", authHandler.Signup, authRequired)

		// Functions
		apiGroup.GET("/functions", functionsHandler.List, authRequired)

		// Files
		apiGroup.POST("/files", fileHandler.Upload, authRequired)
		apiGroup.GET("/files", fileHandler.List, authRequired)
		e.Static("/api/files", "./data/storage")

		// Collections
		collectionsGroup := apiGroup.Group("/collections", authRequired)
		collectionsGroup.POST("", h.CreateCollection)
		collectionsGroup.GET("", h.ListCollections)
		collectionsGroup.DELETE("/:name", h.DeleteCollection) // New
		collectionsGroup.GET("/schemas", h.ListSchemas)
		collectionsGroup.GET("/visualize", h.GetVisualizeSchema)

		// Project Info
		apiGroup.GET("/project/info", h.GetProjectInfo, authRequired)
		apiGroup.GET("/project/health", h.GetHealthIssues, authRequired)
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
		apiGroup.PATCH("/collections/:name/records/:id", h.UpdateRecord, authOptional, accessCreate)
		apiGroup.DELETE("/collections/:name/records/:id", h.DeleteRecord, authOptional, accessCreate)

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
