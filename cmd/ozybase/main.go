package main

import (
	"context"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/Xangel0s/OzyBase/internal/api"
	ozyauth "github.com/Xangel0s/OzyBase/internal/auth"
	"github.com/Xangel0s/OzyBase/internal/cli"
	"github.com/Xangel0s/OzyBase/internal/config"
	"github.com/Xangel0s/OzyBase/internal/core"
	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/Xangel0s/OzyBase/internal/logger"
	"github.com/Xangel0s/OzyBase/internal/mailer"
	"github.com/Xangel0s/OzyBase/internal/migrations"
	"github.com/Xangel0s/OzyBase/internal/realtime"
	"github.com/Xangel0s/OzyBase/internal/storage"
	"github.com/Xangel0s/OzyBase/internal/typegen"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"golang.org/x/time/rate"
)

func main() {
	logger.Init(strings.EqualFold(strings.TrimSpace(os.Getenv("DEBUG")), "true"))
	if err := run(); err != nil {
		logger.Log.Fatal().Err(err).Msg("startup failed")
	}
}

func run() error {
	handled, err := cli.HandleGlobalCommands(os.Args)
	if err != nil {
		return err
	}
	if handled {
		return nil
	}

	printStartupBanner()

	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("failed to load config: %w", err)
	}

	// Initialize Logger
	logger.Init(os.Getenv("DEBUG") == "true")
	logger.Log.Info().Msg("startup begin")
	if cfg.GeneratedJWTSecret {
		logger.Log.Warn().Msg("jwt secret generated")
	}
	if cfg.GeneratedAnonKey {
		logger.Log.Warn().Msg("anon key generated")
	}
	if cfg.GeneratedServiceRoleKey {
		logger.Log.Warn().Msg("service role key generated")
	}
	if cfg.DerivedAllowedOrigin {
		logger.Log.Info().Strs("origins", cfg.AllowedOrigins).Msg("allowed origins derived")
	}
	for _, warning := range cfg.SecurityWarnings {
		logger.Log.Warn().Str("warning", warning).Msg("config warning")
	}

	// Connect to database
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	var embeddedDB *data.EmbeddedDB
	dbURL := cfg.DatabaseURL

	if dbURL == "" {
		embeddedDB = data.NewEmbeddedDB()
		if err := embeddedDB.Start(); err != nil {
			return fmt.Errorf("failed to start embedded database: %w", err)
		}
		dbURL = embeddedDB.GetConnectionString()
	}

	db, err := data.Connect(ctx, dbURL)
	if err != nil {
		if embeddedDB != nil {
			_ = embeddedDB.Stop()
		}
		return fmt.Errorf("failed to connect to database: %w", err)
	}
	defer func() {
		db.Close()
		if embeddedDB != nil {
			_ = embeddedDB.Stop()
		}
	}()

	logger.Log.Info().Msg("db connected")
	logDatabaseIdentity(ctx, db)

	// Run migrations
	if err := db.RunMigrations(ctx); err != nil {
		return fmt.Errorf("failed to run migrations: %w", err)
	}

	// Initialize OAuth
	initOAuth()

	// Initialize Storage
	storageSvc, err := initStorage(cfg)
	if err != nil {
		return err
	}

	// CLI Commands handling (admin create, admin reset, etc.)
	handledCLI, err := handleCLI(db)
	if err != nil {
		return err
	}
	if handledCLI {
		return nil
	}

	// Optional admin bootstrap from ENV vars.
	// If no ENV vars are set and no admin user exists, print setup banner.
	if shouldBootstrapAdminFromEnv() {
		ozyauth.EnsureAdminUser(db)
	} else if !hasAdminUser(ctx, db) {
		printNotInitializedBanner()
	}

	// Initialize Realtime components
	broker, dispatcher, cronMgr := initRealtime(db)

	// Initialize PubSub (for horizontal scaling)
	ps := initPubSub(cfg, broker)
	startRealtimePipelines(ctx, db, broker, dispatcher, ps, cfg)

	// Setup Mailer
	mailSvc := buildMailer(db, cfg)

	// Setup Audit Service (Go Best Practice: Async Logging)
	auditService := core.NewAuditService(db)
	auditService.Start()
	defer auditService.Stop()

	// Initialize migrations generator and applier
	migrator := migrations.NewGenerator("./migrations")
	applier := migrations.NewApplier(db.Pool, "./migrations")
	if err := applier.ApplyPendingMigrations(ctx); err != nil {
		logger.Log.Warn().Err(err).Msg("automatic pending migrations application warning")
	}

	// Initialize Server Components
	h := api.NewHandler(
		db,
		broker,
		dispatcher,
		mailSvc,
		storageSvc,
		ps,
		migrator,
		applier,
		api.BuildProjectProductionReadiness(cfg),
		auditService,
	)
	if err := api.EnsureEssentialAPIKeys(ctx, db, api.EssentialAPIKeyBootstrap{
		AnonKey:        cfg.AnonKey,
		ServiceRoleKey: cfg.ServiceRoleKey,
	}); err != nil {
		logger.Log.Error().Err(err).Msg("failed to ensure essential api keys")
		return fmt.Errorf("failed to ensure essential api keys: %w", err)
	}

	// Start Log Export Worker
	go h.StartLogExporter(context.Background())
	// Start Integration Delivery Worker (queue + retry + DLQ)
	if h.Integrations != nil {
		go h.Integrations.StartDeliveryWorker(context.Background())
	}

	e := setupEcho(ctx, h, cfg, cronMgr)

	// Register Prometheus
	api.RegisterPrometheus(e)

	// Start server
	addr := fmt.Sprintf(":%s", cfg.Port)
	go func() {
		logger.Log.Info().Str("addr", addr).Msg("server starting")
		if err := e.Start(addr); err != nil && err != http.ErrServerClosed {
			logger.Log.Fatal().Err(err).Msg("server crashed")
		}
	}()

	// Wait for interruption
	<-ctx.Done()
	logger.Log.Info().Msg("server shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := e.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("failed to shutdown server: %w", err)
	}

	logger.Log.Info().Msg("server exited")
	return nil
}

func printStartupBanner() {
	fmt.Println(`  OOOOO   ZZZZZ   Y   Y   BBBB    AAA    SSSS   EEEEE`)
	fmt.Println(`  O   O      Z    Y Y     B   B  A   A  S      E`)
	fmt.Println(`  O   O     Z      Y      BBBB   AAAAA   SSS   EEEE`)
	fmt.Println(`  O   O    Z       Y      B   B  A   A      S  E`)
	fmt.Println(`  OOOOO   ZZZZZ    Y      BBBB   A   A  SSSS   EEEEE`)
	fmt.Println()
}

func printNotInitializedBanner() {
	execName := filepath.Base(os.Args[0])
	var cmdExample string
	if runtime.GOOS == "windows" {
		if !strings.HasSuffix(strings.ToLower(execName), ".exe") {
			execName += ".exe"
		}
		cmdExample = fmt.Sprintf(".\\%s admin create --email x --password y", execName)
	} else {
		cmdExample = fmt.Sprintf("./%s admin create --email x --password y", execName)
	}

	fmt.Println()
	fmt.Println("┌─────────────────────────────────────────────────────────────────┐")
	fmt.Println("│  OzyBase is not initialized.                                    │")
	fmt.Println("│  No admin account found.                                        │")
	fmt.Println("│                                                                 │")
	fmt.Println("│  To create the first admin, run:                                │")
	fmt.Printf("│    %-60s │\n", cmdExample)
	fmt.Println("│                                                                 │")
	fmt.Println("│  Or set INITIAL_ADMIN_EMAIL + INITIAL_ADMIN_PASSWORD            │")
	fmt.Println("│  in your .env and restart.                                      │")
	fmt.Println("└─────────────────────────────────────────────────────────────────┘")
	fmt.Println()
}

func hasAdminUser(ctx context.Context, db *data.DB) bool {
	if db == nil || db.Pool == nil {
		return false
	}
	var count int
	if err := db.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM _v_users WHERE role = 'admin'").Scan(&count); err != nil {
		return false
	}
	return count > 0
}

func logDatabaseIdentity(ctx context.Context, db *data.DB) {
	if db == nil || db.Pool == nil {
		return
	}

	identityCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	var serverAddr, serverPort, dbName, dbUser, version string
	err := db.Pool.QueryRow(identityCtx, `
		SELECT
			COALESCE(inet_server_addr()::text, 'local-socket') AS server_addr,
			COALESCE(inet_server_port()::text, 'n/a') AS server_port,
			current_database()::text AS db_name,
			current_user::text AS db_user,
			split_part(version(), ',', 1)::text AS version_short
	`).Scan(&serverAddr, &serverPort, &dbName, &dbUser, &version)
	if err != nil {
		logger.Log.Warn().Err(err).Msg("db identity unresolved")
		return
	}

	logger.Log.Info().
		Str("server_addr", serverAddr).
		Str("server_port", serverPort).
		Str("database", dbName).
		Str("db_user", dbUser).
		Str("server_version", version).
		Msg("db identity resolved")
}

func buildMailer(db *data.DB, cfg *config.Config) mailer.Mailer {
	fallback := mailer.SMTPConfigFromEnvironment()
	if cfg != nil {
		fallback = mailer.SMTPConfig{
			Host:     cfg.SMTPHost,
			Port:     cfg.SMTPPort,
			Username: cfg.SMTPUser,
			Password: cfg.SMTPPass,
			From:     cfg.SMTPFrom,
		}
	}

	if fallback.Configured() {
		logger.Log.Info().Msg("smtp mailer env fallback")
	} else {
		logger.Log.Warn().Msg("smtp mailer console fallback")
	}

	return mailer.NewRuntimeMailer(db, fallback)
}

func handleCLI(db *data.DB) (bool, error) {
	if len(os.Args) > 1 && os.Args[1] == "gen-types" {
		outputPath := "./OzyBase-types.ts"
		for i, arg := range os.Args {
			if arg == "--out" && i+1 < len(os.Args) {
				outputPath = os.Args[i+1]
			}
		}

		gen := typegen.NewGenerator(db)
		if err := gen.Generate(outputPath); err != nil {
			return true, fmt.Errorf("failed to generate types: %w", err)
		}
		logger.Log.Info().Str("output", outputPath).Msg("types generated")
		return true, nil
	}

	if len(os.Args) > 1 && os.Args[1] == "admin" {
		return true, runAdminCommand(db, os.Args[2:])
	}

	if len(os.Args) > 1 && (os.Args[1] == "migrate" || os.Args[1] == "migrate-create") {
		sub := "apply"
		if len(os.Args) > 2 {
			sub = os.Args[2]
		}
		if sub == "create" || os.Args[1] == "migrate-create" {
			name := "custom_migration"
			if len(os.Args) > 3 {
				name = os.Args[3]
			} else if len(os.Args) > 2 && os.Args[1] == "migrate-create" {
				name = os.Args[2]
			}
			gen := migrations.NewGenerator("./migrations")
			fileName, err := gen.CreateMigration(name, "-- Write your SQL migration statements here\n")
			if err != nil {
				return true, fmt.Errorf("failed to create migration: %w", err)
			}
			fmt.Printf("✓ Created migration file: ./migrations/%s\n", fileName)
			return true, nil
		}
	}

	if len(os.Args) > 1 && (os.Args[1] == "migrate-apply" || (len(os.Args) > 2 && os.Args[1] == "migrate" && os.Args[2] == "apply")) {
		ctx := context.Background()
		applier := migrations.NewApplier(db.Pool, "./migrations")

		logger.Log.Info().Msg("migrations checking pending")
		if err := applier.ApplyPendingMigrations(ctx); err != nil {
			return true, fmt.Errorf("migration application failed: %w", err)
		}

		logger.Log.Info().Msg("migrations applied")
		return true, nil
	}

	if len(os.Args) > 1 && (os.Args[1] == "clean" || os.Args[1] == "db-reset") {
		ctx := context.Background()
		fmt.Println("[INFO] Cleaning development data and resetting user schema...")

		tables, err := db.ListTables(ctx)
		if err == nil {
			for _, table := range tables {
				lower := strings.ToLower(table)
				isSys := strings.HasPrefix(lower, "_v_") || strings.HasPrefix(lower, "_ozy_") ||
					lower == "migrations" || lower == "workspaces" || lower == "workspace_members" ||
					lower == "auth_sessions" || lower == "storage_buckets"
				if !isSys {
					db.Pool.Exec(ctx, fmt.Sprintf("DROP TABLE IF EXISTS public.%s CASCADE", table))
				}
			}
		}

		db.Pool.Exec(ctx, "DELETE FROM _v_storage_objects")
		db.Pool.Exec(ctx, "DELETE FROM _v_buckets WHERE name != 'default'")
		db.Pool.Exec(ctx, "DELETE FROM _v_functions")
		db.Pool.Exec(ctx, "DELETE FROM _v_collections")

		fmt.Println("[OK] Clean complete! Development data wiped and database reset to production baseline.")
		return true, nil
	}

	return false, nil
}

func resolveInitialAdminEmail() string {
	if email := strings.TrimSpace(os.Getenv("INITIAL_ADMIN_EMAIL")); email != "" {
		return email
	}
	appDomain := strings.TrimSpace(os.Getenv("APP_DOMAIN"))
	if appDomain == "" || appDomain == "localhost" || strings.HasPrefix(appDomain, "localhost:") {
		return "system@ozybase.local"
	}
	return "admin@" + appDomain
}

func shouldBootstrapAdminFromEnv() bool {
	if strings.EqualFold(strings.TrimSpace(os.Getenv("OZY_AUTO_BOOTSTRAP_ADMIN")), "true") {
		return true
	}
	if strings.TrimSpace(os.Getenv("INITIAL_ADMIN_EMAIL")) != "" {
		return true
	}
	if strings.TrimSpace(os.Getenv("INITIAL_ADMIN_PASSWORD")) != "" {
		return true
	}
	return false
}

// runAdminCommand dispatches admin sub-commands: create, reset, delete-all
func runAdminCommand(db *data.DB, args []string) error {
	binName := filepath.Base(os.Args[0])
	if len(args) == 0 {
		fmt.Fprintf(os.Stderr, "usage: %s admin <create|reset|delete-all>\n", binName)
		fmt.Fprintln(os.Stderr, "  admin create   [--email EMAIL] [--password PASSWORD]")
		fmt.Fprintln(os.Stderr, "  admin reset    --email EMAIL [--password PASSWORD]")
		fmt.Fprintln(os.Stderr, "  admin delete-all")
		os.Exit(1)
	}

	sub := args[0]
	ctx := context.Background()

	switch sub {
	case "create":
		fs := flag.NewFlagSet("admin create", flag.ExitOnError)
		emailFlag := fs.String("email", "", "Admin email address")
		passFlag := fs.String("password", "", "Admin password (min 12 chars)")
		_ = fs.Parse(args[1:])

		email := strings.TrimSpace(*emailFlag)
		password := strings.TrimSpace(*passFlag)

		if email == "" {
			email = ozyauth.PromptLine("Enter admin email: ")
		}
		if password == "" {
			password = ozyauth.PromptLine("Enter admin password (min 12 chars): ")
		}

		if err := ozyauth.CreateAdminWithWorkspace(ctx, db, email, password); err != nil {
			fmt.Fprintf(os.Stderr, "✗ Error: %s\n", err)
			os.Exit(1)
		}
		fmt.Printf("✓ Admin created: %s\n", strings.ToLower(strings.TrimSpace(email)))
		fmt.Println("  Workspace: Primary Project")

	case "reset":
		fs := flag.NewFlagSet("admin reset", flag.ExitOnError)
		emailFlag := fs.String("email", "", "Admin email address")
		passFlag := fs.String("password", "", "New password (min 12 chars)")
		_ = fs.Parse(args[1:])

		email := strings.TrimSpace(*emailFlag)
		password := strings.TrimSpace(*passFlag)

		if email == "" {
			email = ozyauth.PromptLine("Enter admin email: ")
		}
		if password == "" {
			password = ozyauth.PromptLine("Enter new password (min 12 chars): ")
		}

		if err := ozyauth.ResetAdminPassword(ctx, db, email, password); err != nil {
			fmt.Fprintf(os.Stderr, "✗ Error: %s\n", err)
			os.Exit(1)
		}
		fmt.Printf("✓ Password updated for: %s\n", strings.ToLower(strings.TrimSpace(email)))

	case "delete-all":
		fmt.Println("⚠ This will delete ALL admin accounts and reset the system to uninitialized.")
		confirm := ozyauth.PromptLine("Type 'yes' to confirm: ")
		if confirm != "yes" {
			fmt.Println("Aborted.")
			os.Exit(0)
		}
		n, err := ozyauth.DeleteAllAdmins(ctx, db)
		if err != nil {
			fmt.Fprintf(os.Stderr, "✗ Error: %s\n", err)
			os.Exit(1)
		}
		fmt.Printf("✓ All admin accounts deleted (%d removed). System is now uninitialized.\n", n)

	default:
		fmt.Fprintf(os.Stderr, "✗ Unknown admin sub-command: %q\n", sub)
		fmt.Fprintln(os.Stderr, "  Available: create, reset, delete-all")
		os.Exit(1)
	}

	return nil
}

func initOAuth() {
	if err := core.InitOAuth(); err != nil {
		logger.Log.Warn().Err(err).Msg("oauth init failed")
	}
}

func initStorage(cfg *config.Config) (storage.Provider, error) {
	if cfg.StorageProvider == "s3" {
		svc, err := storage.NewS3Provider(cfg.S3Endpoint, cfg.S3AccessKey, cfg.S3SecretKey, cfg.S3UseSSL)
		if err != nil {
			if cfg.StorageFallbackLocal {
				logger.Log.Warn().Err(err).Str("path", cfg.StoragePath).Msg("storage s3 fallback local")
				return storage.NewLocalProvider(cfg.StoragePath), nil
			}
			return nil, fmt.Errorf("failed to initialize S3 storage: %w", err)
		}
		logger.Log.Info().Msg("storage s3")
		return svc, nil
	}
	if cfg.StorageProvider != "local" {
		logger.Log.Warn().Str("provider", cfg.StorageProvider).Msg("storage provider unknown")
	}
	logger.Log.Info().Str("path", cfg.StoragePath).Msg("storage local")
	return storage.NewLocalProvider(cfg.StoragePath), nil
}

func initRealtime(db *data.DB) (*realtime.Broker, *realtime.WebhookDispatcher, *realtime.CronManager) {
	broker := realtime.NewBroker()
	dispatcher := realtime.NewWebhookDispatcher(db.Pool)

	cronMgr := realtime.NewCronManager(db.Pool)
	cronMgr.Start()

	return broker, dispatcher, cronMgr
}

func startRealtimePipelines(ctx context.Context, db *data.DB, broker *realtime.Broker, dispatcher *realtime.WebhookDispatcher, ps realtime.PubSub, cfg *config.Config) {
	nodeID := strings.TrimSpace(cfg.RealtimeNodeID)
	if nodeID == "" {
		nodeID = realtime.DefaultNodeID()
	}
	channel := strings.TrimSpace(cfg.RealtimeChannel)
	if channel == "" {
		channel = realtime.DefaultClusterChannel
	}
	broker.SetNodeID(nodeID)
	if err := realtime.StartPubSubBridge(ctx, ps, broker, nodeID, channel); err != nil {
		logger.Log.Warn().Err(err).Str("mode", ps.Mode()).Msg("realtime pubsub start failed")
	}
	if cfg.RealtimeWALBridgeEnabled {
		err := realtime.StartLogicalWALBridge(ctx, realtime.LogicalWALBridgeConfig{
			DatabaseURL:     cfg.DatabaseURL,
			SlotName:        cfg.RealtimeWALSlot,
			PublicationName: cfg.RealtimeWALPublication,
			NodeID:          nodeID,
			Channel:         channel,
		}, broker, dispatcher, ps)
		if err != nil {
			logger.Log.Warn().Err(err).Msg("realtime wal fallback listen notify")
			go realtime.ListenForEvents(ctx, db.Pool, broker, dispatcher, ps, nodeID, channel)
			return
		}
		logger.Log.Info().Str("slot", cfg.RealtimeWALSlot).Str("publication", cfg.RealtimeWALPublication).Msg("realtime wal enabled")
		return
	}

	go realtime.ListenForEvents(ctx, db.Pool, broker, dispatcher, ps, nodeID, channel)
}

func initPubSub(cfg *config.Config, broker *realtime.Broker) realtime.PubSub {
	if cfg.RealtimeBroker == "redis" {
		logger.Log.Info().Msg("pubsub redis")
		return realtime.NewRedisPubSub(cfg.RedisAddr, cfg.RedisPassword, cfg.RedisDB)
	}
	logger.Log.Info().Msg("pubsub local")
	return realtime.NewLocalPubSub(broker)
}

func setupEcho(ctx context.Context, h *api.Handler, cfg *config.Config, cronMgr *realtime.CronManager) *echo.Echo {
	e := echo.New()
	e.HideBanner = true
	e.HTTPErrorHandler = api.HTTPErrorHandler

	// Middleware
	e.Use(api.RequestIDMiddleware())
	e.Use(api.ErrorEnvelopeMiddleware())
	e.Use(middleware.RequestLoggerWithConfig(middleware.RequestLoggerConfig{
		LogStatus: true,
		LogURI:    true,
		LogValuesFunc: func(c echo.Context, v middleware.RequestLoggerValues) error {
			logger.Log.Info().Int("status", v.Status).Str("method", v.Method).Str("uri", v.URI).Msg("request")
			return nil
		},
	}))
	e.Use(h.FirewallMiddleware()) // IP Firewall (Whitelist/Blacklist) - Very First Defense
	e.Use(middleware.Recover())
	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins: cfg.AllowedOrigins,
		AllowHeaders: []string{
			echo.HeaderOrigin,
			echo.HeaderContentType,
			echo.HeaderAccept,
			echo.HeaderAuthorization,
			"X-CSRF-Token",
			"X-Workspace-Id",
			"X-Ozy-Project-ID",
			"apikey",
			"X-Ozy-Key",
		},
	}))
	e.Use(middleware.RateLimiterWithConfig(middleware.RateLimiterConfig{
		Store: middleware.NewRateLimiterMemoryStoreWithConfig(
			middleware.RateLimiterMemoryStoreConfig{
				Rate:      rate.Limit(cfg.RateLimitRPS),
				Burst:     cfg.RateLimitBurst,
				ExpiresIn: 3 * time.Minute,
			},
		),
		Skipper: func(c echo.Context) bool {
			// Only rate-limit API routes. Static assets and SPA shell should not consume API burst budget.
			path := c.Request().URL.Path
			if !strings.HasPrefix(path, "/api/") {
				return true
			}

			// Authenticated traffic is already guarded by token/API-key checks and workspace limits.
			// Keep limiter focused on unauthenticated/public attack surface.
			authHeader := strings.TrimSpace(c.Request().Header.Get("Authorization"))
			if strings.HasPrefix(authHeader, "Bearer ") {
				return true
			}
			if strings.TrimSpace(c.Request().Header.Get("apikey")) != "" {
				return true
			}
			if strings.TrimSpace(c.Request().Header.Get("X-Ozy-Key")) != "" {
				return true
			}
			return false
		},
	}))
	e.Use(api.SecurityHeadersDefault())
	e.Use(middleware.BodyLimitWithConfig(middleware.BodyLimitConfig{
		Limit: cfg.BodyLimit,
		Skipper: func(c echo.Context) bool {
			if c.Request().Method != http.MethodPut {
				return false
			}
			path := c.Request().URL.Path
			return path == "/api/files/uploads" || strings.HasPrefix(path, "/api/files/uploads/multipart/")
		},
	}))
	e.Use(api.PrometheusMiddleware()) // Stats
	e.Use(api.APIKeyMiddleware(h.DB)) // API Key Auth (Enterprise Phase 1)
	e.Use(api.RLSMiddleware(h.DB))    // RLS Context Injection
	e.Use(api.AdminAuditMiddleware(h))
	// #nosec G101 -- CSRF token lookup/cookie fields are static identifiers, not credentials.
	e.Use(middleware.CSRFWithConfig(middleware.CSRFConfig{
		TokenLookup:    "header:X-CSRF-Token",
		ContextKey:     "csrf",
		CookieName:     "_ozy_csrf",
		CookiePath:     "/",
		CookieHTTPOnly: true,
		CookieSecure:   !strings.EqualFold(os.Getenv("DEBUG"), "true"),
		CookieSameSite: http.SameSiteStrictMode,
		Skipper: func(c echo.Context) bool {
			// Skip CSRF for API requests with Bearer token or API keys
			authHeader := c.Request().Header.Get("Authorization")
			if strings.HasPrefix(authHeader, "Bearer ") || c.Get("is_api_key") == true {
				return true
			}
			// Skip CSRF for login endpoint
			path := c.Request().URL.Path
			if path == "/api/auth/login" || path == "/api/auth/signup" || path == "/api/system/status" || path == "/api/project/metrics" || strings.HasPrefix(path, "/api/project/mcp") || strings.HasPrefix(path, "/api/functions/") {
				return true
			}
			return false
		},
	}))

	// Services and Handlers
	// Setup Mailer
	mailSvc := h.Mailer
	if mailSvc == nil {
		mailSvc = buildMailer(h.DB, cfg)
		h.Mailer = mailSvc
	}

	authService := core.NewAuthService(h.DB, cfg.JWTSecret, mailSvc)
	h.Auth = authService // Inject dependency for System Setup
	authHandler := api.NewAuthHandler(authService)
	twoFactorService := core.NewTwoFactorService(h.DB)
	twoFactorHandler := api.NewTwoFactorHandler(twoFactorService, authService)
	realtimeHandler := api.NewRealtimeHandler(
		h.Broker,
		api.WithRealtimeDB(h.DB),
		api.WithRealtimeSigningKey(cfg.JWTSecret),
		api.WithRealtimeAuthzV2(cfg.RealtimeAuthzV2),
		api.WithRealtimeLegacyOpen(cfg.RealtimeLegacyOpen),
	)
	fileHandler := api.NewFileHandler(
		h.DB,
		h.Storage,
		cfg.StoragePath,
		cfg.JWTSecret,
		api.WithStoragePolicyV2(cfg.StoragePolicyV2),
		api.WithStorageSignedKeyID(cfg.StorageSignedKeyID),
	)
	if cfg.StorageMaintenanceIntervalMinutes > 0 {
		go fileHandler.StartMaintenanceLoop(ctx, time.Duration(cfg.StorageMaintenanceIntervalMinutes)*time.Minute)
	}
	functionsHandler := api.NewFunctionsHandler(
		h.DB,
		"./functions",
		api.WithFunctionsAsyncEnabled(cfg.FunctionsAsyncV1),
		api.WithFunctionsSigningKey(cfg.JWTSecret),
	)
	webhookHandler := api.NewWebhookHandler(h.DB)
	cronHandler := api.NewCronHandler(h.DB, cronMgr)
	workspaceService := core.NewWorkspaceService(h.DB)
	workspaceHandler := api.NewWorkspaceHandler(workspaceService, mailSvc)

	// API Groups and Middlewares
	authRequired := api.AuthMiddleware(h.DB, cfg.JWTSecret, false)
	authOptional := api.AuthMiddleware(h.DB, cfg.JWTSecret, true)
	adminOnly := api.RequireRole("admin")
	accessList := api.AccessMiddleware(h.DB, "list")
	accessCreate := api.AccessMiddleware(h.DB, "create")
	accessUpdate := api.AccessMiddleware(h.DB, "update")
	accessDelete := api.AccessMiddleware(h.DB, "delete")

	apiGroup := e.Group("/api")
	apiGroup.Use(api.MetricsMiddleware(h))
	apiGroup.Use(api.WorkspaceMiddleware(h.DB, cfg.JWTSecret, cfg.IsSingleTenant()))
	{
		apiGroup.GET("/health", h.Health)
		apiGroup.GET("/project/metrics", h.GetPrometheusMetrics) // Enterprise Phase 1
		apiGroup.GET("/project/stats", h.GetStats, authRequired)
		apiGroup.GET("/realtime", realtimeHandler.Stream)
		apiGroup.POST("/realtime/session", realtimeHandler.CreateSession, authRequired)
		apiGroup.GET("/project/realtime/status", h.GetRealtimeStatus, authRequired, adminOnly)

		// ... (Auth/System/etc) ...

		// API Keys (Enterprise Phase 1)
		keysGroup := apiGroup.Group("/project/keys", authRequired, adminOnly)
		keysGroup.GET("", h.ListAPIKeys)
		keysGroup.GET("/events", h.ListAPIKeyEvents)
		keysGroup.GET("/essential", h.ListEssentialAPIKeys)
		keysGroup.POST("/essential/verify", h.VerifyEssentialAPIKeyAccess)
		keysGroup.POST("/essential/:role/reveal", h.RevealEssentialAPIKey)
		keysGroup.POST("/essential/:role/rotate", h.RotateEssentialAPIKey)
		keysGroup.POST("", h.CreateAPIKey)
		keysGroup.DELETE("/:id", h.DeleteAPIKey)
		keysGroup.PATCH("/:id/toggle", h.ToggleAPIKey)
		keysGroup.POST("/:id/rotate", h.RotateAPIKey)

		// Workspaces
		workspacesGroup := apiGroup.Group("/workspaces", authRequired, api.SingleTenantGuard(cfg.IsSingleTenant()))
		workspacesGroup.POST("", workspaceHandler.Create)
		workspacesGroup.POST("/bootstrap", workspaceHandler.Bootstrap)
		workspacesGroup.POST("/request-access", workspaceHandler.RequestAccess)
		workspacesGroup.GET("", workspaceHandler.List)
		workspacesGroup.PATCH("/:id", workspaceHandler.Update)
		workspacesGroup.DELETE("/:id", workspaceHandler.Delete)
		workspacesGroup.GET("/:id/members", workspaceHandler.ListMembers)
		workspacesGroup.POST("/:id/members", workspaceHandler.AddMember)
		workspacesGroup.DELETE("/:id/members/:userId", workspaceHandler.RemoveMember)

		// Auth
		authGroup := apiGroup.Group("/auth")
		authGroup.GET("/csrf", authHandler.CSRFToken)
		authGroup.POST("/login", authHandler.Login)
		authGroup.POST("/refresh", authHandler.Refresh)
		// Signup is now protected, only an authenticated user (admin) can create others
		authGroup.POST("/signup", authHandler.Signup, authRequired, adminOnly)
		authGroup.POST("/reset-password/request", authHandler.RequestReset)
		authGroup.POST("/reset-password/confirm", authHandler.ConfirmReset)
		authGroup.GET("/verify-email", authHandler.VerifyEmail)
		authGroup.POST("/verify-email", authHandler.VerifyEmail)
		authGroup.GET("/users", authHandler.ListUsers, authRequired, adminOnly)
		authGroup.PATCH("/users/:id/role", authHandler.UpdateRole, authRequired, adminOnly)
		authGroup.POST("/users/:id/reset-password", authHandler.ResetUserPassword, authRequired, adminOnly)
		authGroup.DELETE("/users/:id", authHandler.DeleteUser, authRequired, adminOnly)
		authGroup.GET("/providers", h.ListAuthProviders, authRequired, adminOnly)
		authGroup.GET("/config", h.GetAuthConfig, authRequired, adminOnly)
		authGroup.GET("/smtp", h.GetSMTPSettings, authRequired, adminOnly)
		authGroup.PUT("/smtp", h.UpdateSMTPSettings, authRequired, adminOnly)
		authGroup.POST("/smtp/test", h.SendSMTPTestEmail, authRequired, adminOnly)
		authGroup.GET("/templates", h.ListAuthTemplates, authRequired, adminOnly)
		authGroup.PUT("/templates/:type", h.UpdateAuthTemplate, authRequired, adminOnly)

		// Social Login
		authGroup.GET("/login/:provider", authHandler.GetOAuthURL)
		authGroup.GET("/callback/:provider", authHandler.OAuthCallback)

		// Sessions (Enterprise Phase 2)
		authGroup.GET("/sessions", authHandler.ListSessions, authRequired)
		authGroup.DELETE("/sessions/:id", authHandler.RevokeSession, authRequired)
		authGroup.POST("/sessions/revoke-all", authHandler.RevokeAllSessions, authRequired, adminOnly)

		// System Status (Public)
		apiGroup.GET("/system/status", h.GetSystemStatus)

		// Two-Factor Authentication
		authGroup.POST("/2fa/setup", twoFactorHandler.Setup2FA, authRequired)
		authGroup.POST("/2fa/enable", twoFactorHandler.Enable2FA, authRequired)
		authGroup.POST("/2fa/disable", twoFactorHandler.Disable2FA, authRequired)
		authGroup.GET("/2fa/status", twoFactorHandler.Get2FAStatus, authRequired)
		authGroup.POST("/2fa/verify", twoFactorHandler.Verify2FA)

		// Functions
		apiGroup.GET("/functions", functionsHandler.List, authRequired)
		apiGroup.POST("/functions", functionsHandler.Create, authRequired)
		apiGroup.PATCH("/functions/:name/config", functionsHandler.PatchConfig, authRequired, adminOnly)
		apiGroup.DELETE("/functions/:name", functionsHandler.Delete, authRequired, adminOnly)
		apiGroup.POST("/functions/:name/invoke", functionsHandler.Invoke)
		apiGroup.GET("/functions/:name/invoke", functionsHandler.Invoke)
		apiGroup.POST("/functions/:name/invoke-async", functionsHandler.InvokeAsync, authRequired)
		apiGroup.GET("/functions/jobs/:id", functionsHandler.GetJob, authRequired)
		apiGroup.POST("/functions/:name/secrets", functionsHandler.UpsertSecret, authRequired, adminOnly)

		// Files
		apiGroup.GET("/files/buckets", fileHandler.ListBuckets, authRequired)
		apiGroup.GET("/files/buckets/:name", fileHandler.GetBucket, authRequired)
		apiGroup.GET("/files/buckets/:name/policies", fileHandler.ListBucketPolicies, authRequired, adminOnly)
		apiGroup.PUT("/files/buckets/:name/policies", fileHandler.UpsertBucketPolicies, authRequired, adminOnly)
		apiGroup.POST("/files/buckets", fileHandler.CreateBucket, authRequired, adminOnly)
		apiGroup.PATCH("/files/buckets/:name", fileHandler.UpdateBucket, authRequired, adminOnly)
		apiGroup.POST("/files/buckets/:name/lifecycle/sweep", fileHandler.RunLifecycleSweep, authRequired, adminOnly)
		apiGroup.DELETE("/files/buckets/:name", fileHandler.DeleteBucket, authRequired, adminOnly)
		apiGroup.POST("/files/sign", fileHandler.SignURL, authRequired)
		apiGroup.POST("/files/uploads/session", fileHandler.CreateUploadSession, authRequired)
		apiGroup.POST("/files/uploads/multipart/session", fileHandler.CreateMultipartUploadSession, authRequired)
		apiGroup.GET("/files/uploads/multipart/:id", fileHandler.GetMultipartUploadSession, authRequired)
		apiGroup.PUT("/files/uploads/multipart/:id/parts/:part", fileHandler.UploadMultipartPart, authRequired)
		apiGroup.POST("/files/uploads/multipart/:id/complete", fileHandler.CompleteMultipartUpload, authRequired)
		apiGroup.DELETE("/files/uploads/multipart/:id", fileHandler.AbortMultipartUpload, authRequired)
		apiGroup.PUT("/files/uploads", fileHandler.UploadStream)
		apiGroup.POST("/files", fileHandler.Upload, authRequired)
		apiGroup.GET("/files", fileHandler.List, authOptional)
		apiGroup.GET("/files/:bucket/*", fileHandler.Download, authOptional)
		apiGroup.DELETE("/files/:bucket/*", fileHandler.DeleteObject, authRequired)
		apiGroup.POST("/files/:bucket/move", fileHandler.MoveObject, authRequired)
		apiGroup.POST("/files/:bucket/rename", fileHandler.MoveObject, authRequired)

		// Collections
		collectionsGroup := apiGroup.Group("/collections", authRequired)
		collectionsGroup.POST("", h.CreateCollection)
		collectionsGroup.GET("", h.ListCollections)
		collectionsGroup.DELETE("/:name", h.DeleteCollection) // New
		collectionsGroup.GET("/schemas", h.ListSchemas)
		collectionsGroup.GET("/visualize", h.GetVisualizeSchema)
		collectionsGroup.PATCH("/rules", h.UpdateCollectionRules)
		collectionsGroup.PATCH("/rls", h.UpdateCollectionRLS)
		collectionsGroup.PATCH("/realtime", h.UpdateRealtimeToggle)
		collectionsGroup.PATCH("/:name/rename", h.RenameCollection)

		// Tables (Alias for Frontend compatibility)
		tablesGroup := apiGroup.Group("/tables", authRequired)
		tablesGroup.GET("/:name", h.ListRecords)
		tablesGroup.POST("/:name", h.CreateRecord)
		tablesGroup.DELETE("/:name/:id", h.DeleteRecord)
		tablesGroup.GET("/:name/:id", h.GetRecord)

		// Project Info
		apiGroup.GET("/project/info", h.GetProjectInfo, authRequired)
		apiGroup.GET("/project/connection", h.GetProjectConnection, authRequired, adminOnly)
		apiGroup.GET("/project/config", h.GetProjectConfig, authRequired, adminOnly)
		apiGroup.POST("/project/mcp", h.HandleMcpJsonRpc, authRequired, adminOnly)
		apiGroup.POST("/project/mcp/device/start", h.StartMcpDeviceFlow)
		apiGroup.GET("/project/mcp/device/approve", h.GetApproveMcpDevice)
		apiGroup.POST("/project/mcp/device/approve/confirm", h.ConfirmMcpDeviceApproval)
		apiGroup.GET("/project/mcp/device/status", h.GetMcpDeviceStatus)
		apiGroup.GET("/project/update-status", h.GetProjectUpdateStatus, authRequired)
		apiGroup.GET("/project/health", h.GetHealthIssues, authRequired)
		apiGroup.GET("/project/performance/advisor", h.GetPerformanceAdvisor, authRequired, adminOnly)
		apiGroup.GET("/project/performance/advisor/history", h.GetPerformanceAdvisorHistory, authRequired, adminOnly)
		apiGroup.GET("/project/vector/status", h.GetVectorStatus, authRequired, adminOnly)
		apiGroup.POST("/project/vector/setup", h.SetupVectorStore, authRequired, adminOnly)
		apiGroup.POST("/project/vector/upsert", h.UpsertVectorItems, authRequired, adminOnly)
		apiGroup.POST("/project/vector/search", h.SearchVectorItems, authRequired, adminOnly)
		apiGroup.POST("/project/nlq/translate", h.TranslateNLQ, authRequired, adminOnly)
		apiGroup.POST("/project/nlq/query", h.ExecuteNLQ, authRequired, adminOnly)
		apiGroup.GET("/project/security/policies", h.GetSecurityPolicies, authRequired)
		apiGroup.POST("/project/security/policies", h.UpdateSecurityPolicy, authRequired, adminOnly)
		apiGroup.GET("/project/security/stats", h.GetSecurityStats, authRequired)
		apiGroup.GET("/project/security/alerts", h.GetSecurityAlerts, authRequired)
		apiGroup.GET("/project/security/requests", workspaceHandler.ListAccessRequests, authRequired, adminOnly)
		apiGroup.PATCH("/project/security/requests/:id", workspaceHandler.DecideAccessRequest, authRequired, adminOnly)
		apiGroup.GET("/project/security/notifications", h.GetNotificationRecipients, authRequired)
		apiGroup.POST("/project/security/notifications", h.AddNotificationRecipient, authRequired, adminOnly)
		apiGroup.DELETE("/project/security/notifications/:id", h.DeleteNotificationRecipient, authRequired, adminOnly)
		apiGroup.GET("/project/observability/slo", h.GetSLOStatus, authRequired, adminOnly)
		apiGroup.GET("/project/observability/storage", h.GetStorageObservability, authRequired, adminOnly)
		apiGroup.GET("/project/security/alert-routing", h.GetAlertRouting, authRequired, adminOnly)
		apiGroup.POST("/project/security/alert-routing", h.UpdateAlertRouting, authRequired, adminOnly)
		apiGroup.GET("/project/security/advisor/scan", h.GetSecurityAdvisorScan, authRequired, adminOnly)
		apiGroup.POST("/project/security/advisor/fix", h.FixSecurityAdvisor, authRequired, adminOnly)
		apiGroup.GET("/project/security/rls/coverage", h.GetRLSPolicyCoverage, authRequired, adminOnly)
		apiGroup.GET("/project/security/rls/coverage/history", h.GetRLSPolicyCoverageHistory, authRequired, adminOnly)
		apiGroup.POST("/project/security/rls/enforce", h.EnforceRLSAll, authRequired, adminOnly)
		apiGroup.POST("/project/security/rls/closeout", h.RunRLSCloseout, authRequired, adminOnly)
		apiGroup.GET("/project/security/admin-audit", h.ListAdminAuditEvents, authRequired, adminOnly)
		apiGroup.GET("/project/schema/types", h.ExportTypeScriptTypes, authRequired)

		// Integrations (Slack, Discord, SIEM)
		apiGroup.GET("/project/integrations", h.ListIntegrations, authRequired)
		apiGroup.POST("/project/integrations", h.CreateIntegration, authRequired, adminOnly)
		apiGroup.DELETE("/project/integrations/:id", h.DeleteIntegration, authRequired, adminOnly)
		apiGroup.POST("/project/integrations/:id/test", h.TestIntegration, authRequired, adminOnly)
		apiGroup.GET("/project/integrations/metrics", h.GetIntegrationDeliveryMetrics, authRequired, adminOnly)
		apiGroup.GET("/project/integrations/dlq", h.ListIntegrationDLQ, authRequired, adminOnly)
		apiGroup.POST("/project/integrations/dlq/:id/retry", h.RetryIntegrationDLQ, authRequired, adminOnly)

		// Analytics (High Performance Go Aggregations)
		apiGroup.GET("/analytics/traffic", h.GetTrafficStats, authRequired)
		apiGroup.GET("/analytics/geo", h.GetGeoStats, authRequired)

		// Security Dashboard Routes
		apiGroup.POST("/project/health/fix", h.FixHealthIssues, authRequired, adminOnly)
		apiGroup.POST("/project/health/review", h.ReviewHealthIssues, authRequired, adminOnly)
		apiGroup.GET("/project/logs", h.GetLogs, authRequired)
		apiGroup.GET("/project/logs/export", h.ExportLogs, authRequired)
		apiGroup.GET("/security/firewall", h.ListIPRules, authRequired)
		apiGroup.GET("/security/firewall/metrics", h.GetFirewallMetrics, authRequired, adminOnly)
		apiGroup.POST("/security/sessions/terminate-by-ip", h.TerminateSessionsByIP, authRequired, adminOnly)
		apiGroup.POST("/security/sessions/terminate-by-country", h.TerminateSessionsByCountry, authRequired, adminOnly)
		apiGroup.POST("/project/security/sessions/terminate-by-ip", h.TerminateSessionsByIP, authRequired, adminOnly)
		apiGroup.POST("/project/security/sessions/terminate-by-country", h.TerminateSessionsByCountry, authRequired, adminOnly)
		apiGroup.GET("/security/advisor/scan", h.GetSecurityAdvisorScan, authRequired, adminOnly)
		apiGroup.POST("/security/advisor/fix", h.FixSecurityAdvisor, authRequired, adminOnly)
		apiGroup.POST("/security/firewall", h.CreateIPRule, authRequired, adminOnly)
		apiGroup.DELETE("/security/firewall/:id", h.DeleteIPRule, authRequired, adminOnly)

		// Extensions
		apiGroup.GET("/extensions", h.ListExtensions, authRequired)
		apiGroup.POST("/extensions/:name", h.ToggleExtension, authRequired, adminOnly)
		apiGroup.GET("/extensions/marketplace", h.ListExtensionMarketplace, authRequired, adminOnly)
		apiGroup.POST("/extensions/marketplace/sync", h.SyncExtensionMarketplace, authRequired, adminOnly)
		apiGroup.POST("/extensions/marketplace/:slug/install", h.InstallMarketplaceExtension, authRequired, adminOnly)
		apiGroup.DELETE("/extensions/marketplace/:slug/install", h.UninstallMarketplaceExtension, authRequired, adminOnly)

		// Integrations (Modern Handlers)
		apiGroup.GET("/webhooks", webhookHandler.List, authRequired)
		apiGroup.POST("/webhooks", webhookHandler.Create, authRequired)
		apiGroup.DELETE("/webhooks/:id", webhookHandler.Delete, authRequired)

		apiGroup.GET("/cron", cronHandler.List, authRequired, adminOnly)
		apiGroup.POST("/cron/enable", cronHandler.Enable, authRequired, adminOnly)
		apiGroup.POST("/cron", cronHandler.Create, authRequired, adminOnly)
		apiGroup.DELETE("/cron/:id", cronHandler.Delete, authRequired, adminOnly)
		apiGroup.GET("/cron/:id/logs", cronHandler.Logs, authRequired, adminOnly)

		apiGroup.GET("/vault", h.ListSecrets, authRequired)
		apiGroup.POST("/vault", h.CreateSecret, authRequired, adminOnly)
		apiGroup.DELETE("/vault/:id", h.DeleteSecret, authRequired, adminOnly)

		apiGroup.GET("/wrappers", h.ListWrappers, authRequired)
		apiGroup.POST("/wrappers", h.CreateWrapper, authRequired, adminOnly)
		apiGroup.DELETE("/wrappers/:name", h.DeleteWrapper, authRequired, adminOnly)
		apiGroup.POST("/graphql/v1", h.HandleGraphQL, authRequired)

		apiGroup.GET("/schema/:name/definition", h.GetTableDefinition, authRequired)
		apiGroup.GET("/schema/:name", h.GetTableSchema, authRequired)
		apiGroup.POST("/sql", h.HandleExecuteSQL, authRequired)
		apiGroup.POST("/sql/sync", h.HandleSyncSystem, authRequired, adminOnly)
		apiGroup.GET("/sql/history", h.HandleGetSQLHistory, authRequired)
		apiGroup.DELETE("/sql/history", h.HandleClearSQLHistory, authRequired, adminOnly)

		// Records
		apiGroup.POST("/collections/:name/records", h.CreateRecord, authOptional, accessCreate)
		apiGroup.GET("/collections/:name/records", h.ListRecords, authOptional, accessList)
		apiGroup.GET("/collections/:name/records/:id", h.GetRecord, authOptional, accessList)
		apiGroup.PATCH("/collections/:name/records/:id", h.UpdateRecord, authOptional, accessUpdate)
		apiGroup.DELETE("/collections/:name/records/:id", h.DeleteRecord, authOptional, accessDelete)

		// Tables (Generic/Dashboard endpoints) - Now PROTECTED
		apiGroup.POST("/tables/:name/rows", h.CreateRecord, authRequired)
		apiGroup.PATCH("/tables/:name/rows/:id", h.UpdateRecord, authRequired)
		apiGroup.DELETE("/tables/:name/rows/:id", h.DeleteRecord, authRequired)
		apiGroup.POST("/tables/:name/rows/bulk", h.BulkRowsAction, authRequired)
		apiGroup.POST("/tables/:name/import", h.ImportRecords, authRequired)
		apiGroup.POST("/collections/:name/duplicate", h.DuplicateCollection, authRequired)
		apiGroup.POST("/tables/:name/columns", h.AddColumn, authRequired)
		apiGroup.PATCH("/tables/:name/columns/:col", h.UpdateColumn, authRequired)
		apiGroup.PATCH("/tables/:name/primary-key", h.UpdateTablePrimaryKey, authRequired)
		apiGroup.DELETE("/tables/:name/columns/:col", h.DeleteColumn, authRequired)
		apiGroup.GET("/tables/:name/views", h.ListTableViews, authRequired)
		apiGroup.POST("/tables/:name/views", h.CreateTableView, authRequired)
		apiGroup.PATCH("/tables/:name/views/:id", h.UpdateTableView, authRequired)
		apiGroup.DELETE("/tables/:name/views/:id", h.DeleteTableView, authRequired)
	}

	// Standard Supabase / PostgREST compatible REST API (/rest/v1/*)
	restGroup := e.Group("/rest/v1", api.MetricsMiddleware(h), api.APIKeyMiddleware(h.DB), api.RLSMiddleware(h.DB), api.WorkspaceMiddleware(h.DB, cfg.JWTSecret, cfg.IsSingleTenant()))
	{
		restGroup.GET("/:name", h.ListRecords, authOptional, accessList)
		restGroup.POST("/:name", h.CreateRecord, authOptional, accessCreate)
		restGroup.GET("/:name/:id", h.GetRecord, authOptional, accessList)
		restGroup.PATCH("/:name/:id", h.UpdateRecord, authOptional, accessUpdate)
		restGroup.DELETE("/:name/:id", h.DeleteRecord, authOptional, accessDelete)
		restGroup.POST("/rpc/:name", functionsHandler.Invoke, authOptional)
	}

	// Static Frontend (SPA)
	api.RegisterStaticRoutes(e)

	return e
}
