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

	// Initialize Server Components
	e := setupEcho(db, cfg)

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
	return false
}

func setupEcho(db *data.DB, cfg *config.Config) *echo.Echo {
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
	broker := realtime.NewBroker()
	go data.ListenDB(context.Background(), cfg.DatabaseURL, broker)

	h := api.NewHandler(db)
	authService := core.NewAuthService(db, cfg.JWTSecret)
	authHandler := api.NewAuthHandler(authService)
	realtimeHandler := api.NewRealtimeHandler(broker)
	fileHandler := api.NewFileHandler("./data/storage")

	// API Groups and Middlewares
	authRequired := api.AuthMiddleware(cfg.JWTSecret, false)
	authOptional := api.AuthMiddleware(cfg.JWTSecret, true)
	accessList := api.AccessMiddleware(db, "list")
	accessCreate := api.AccessMiddleware(db, "create")

	apiGroup := e.Group("/api")
	{
		apiGroup.GET("/health", h.Health)
		apiGroup.GET("/realtime", realtimeHandler.Stream)

		// Auth
		authGroup := apiGroup.Group("/auth")
		authGroup.POST("/login", authHandler.Login)
		// Signup is now protected, only an authenticated user (admin) can create others
		authGroup.POST("/signup", authHandler.Signup, authRequired)

		// Files
		apiGroup.POST("/files", fileHandler.Upload, authRequired)
		e.Static("/api/files", "./data/storage")

		// Collections
		collectionsGroup := apiGroup.Group("/collections", authRequired)
		collectionsGroup.POST("", h.CreateCollection)
		collectionsGroup.GET("", h.ListCollections)

		apiGroup.GET("/schema/:name", h.GetTableSchema, authRequired)

		// Records
		apiGroup.POST("/collections/:name/records", h.CreateRecord, authOptional, accessCreate)
		apiGroup.GET("/collections/:name/records", h.ListRecords, authOptional, accessList)
		apiGroup.GET("/collections/:name/records/:id", h.GetRecord, authOptional, accessList)

		// Tables (Generic/Dashboard endpoints) - Now PROTECTED
		apiGroup.GET("/tables/:name", h.ListRecords, authRequired)
		apiGroup.POST("/tables/:name/rows", h.CreateRecord, authRequired)
	}

	// Create users table for demo if missing
	ensureUsersTable(db)

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
}
