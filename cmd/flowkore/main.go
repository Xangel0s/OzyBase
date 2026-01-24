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

	"github.com/Xangel0s/FlowKore/internal/api"
	"github.com/Xangel0s/FlowKore/internal/config"
	"github.com/Xangel0s/FlowKore/internal/core"
	"github.com/Xangel0s/FlowKore/internal/data"
	"github.com/Xangel0s/FlowKore/internal/realtime"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
)

func main() {
	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// Connect to database
	ctx := context.Background()
	db, err := data.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	log.Println("✅ Connected to PostgreSQL")

	// Run migrations
	if err := db.RunMigrations(ctx); err != nil {
		log.Fatalf("Failed to run migrations: %v", err)
	}

	// Initialize Realtime components
	broker := realtime.NewBroker()
	go data.ListenDB(ctx, cfg.DatabaseURL, broker)

	// Initialize Echo
	e := echo.New()
	e.HideBanner = true

	// Middleware
	e.Use(middleware.Logger())
	e.Use(middleware.Recover())
	e.Use(middleware.CORS())

	// Initialize handlers
	h := api.NewHandler(db)
	authService := core.NewAuthService(db, cfg.JWTSecret)
	authHandler := api.NewAuthHandler(authService)
	realtimeHandler := api.NewRealtimeHandler(broker)
	fileHandler := api.NewFileHandler("./data/storage")

	// Middlewares
	authRequired := api.AuthMiddleware(cfg.JWTSecret, false)
	authOptional := api.AuthMiddleware(cfg.JWTSecret, true)
	accessList := api.AccessMiddleware(db, "list")
	accessCreate := api.AccessMiddleware(db, "create")

	// Routes
	apiGroup := e.Group("/api")
	apiGroup.GET("/health", h.Health)
	apiGroup.GET("/realtime", realtimeHandler.Stream)

	// Auth Routes (Public)
	authGroup := apiGroup.Group("/auth")
	authGroup.POST("/signup", authHandler.Signup)
	authGroup.POST("/login", authHandler.Login)

	// Files API
	apiGroup.POST("/files", fileHandler.Upload, authRequired)
	e.Static("/api/files", "./data/storage")

	// Collections API (Protected - only for system admins ideally, but let's keep authRequired for now)
	collectionsGroup := apiGroup.Group("/collections", authRequired)
	collectionsGroup.POST("", h.CreateCollection)
	collectionsGroup.GET("", h.ListCollections)

	// Records API (ACL Protected)
	// We use authOptional so that the middleware can identify the user if a token is present,
	// but doesn't block the request yet. AccessMiddleware will decide based on the rule.
	apiGroup.POST("/collections/:name/records", h.CreateRecord, authOptional, accessCreate)
	apiGroup.GET("/collections/:name/records", h.ListRecords, authOptional, accessList)
	apiGroup.GET("/collections/:name/records/:id", h.GetRecord, authOptional, accessList)

	// Start server in goroutine
	go func() {
		addr := fmt.Sprintf(":%s", cfg.Port)
		log.Printf("🚀 FlowKore server starting on http://localhost%s", addr)
		if err := e.Start(addr); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("🛑 Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := e.Shutdown(ctx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}

	log.Println("👋 Server exited")
}
