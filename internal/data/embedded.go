package data

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/Xangel0s/OzyBase/internal/logger"
	embeddedpostgres "github.com/fergusstrange/embedded-postgres"
	"github.com/jackc/pgx/v5"
)

// EmbeddedDB handles the lifecycle of an embedded PostgreSQL instance
type EmbeddedDB struct {
	postgres          *embeddedpostgres.EmbeddedPostgres
	config            embeddedpostgres.Config
	dataPath          string
	binPath           string
	port              uint32
	wasAlreadyRunning bool
}

// NewEmbeddedDB creates a new embedded PostgreSQL instance configuration
func NewEmbeddedDB() *EmbeddedDB {
	// Create data directory in project root (or env override for isolated test runs)
	cwd, _ := os.Getwd()
	rootPath := strings.TrimSpace(os.Getenv("OZY_EMBEDDED_ROOT"))
	if rootPath == "" {
		rootPath = filepath.Join(cwd, "ozy_data")
	}
	dataPath := strings.TrimSpace(os.Getenv("OZY_EMBEDDED_DATA_PATH"))
	if dataPath == "" {
		dataPath = filepath.Join(rootPath, "pg_data")
	}
	binPath := strings.TrimSpace(os.Getenv("OZY_EMBEDDED_BIN_PATH"))
	if binPath == "" {
		binPath = filepath.Join(rootPath, "bin")
	}
	port := uint32(5433)
	if rawPort := strings.TrimSpace(os.Getenv("OZY_EMBEDDED_PORT")); rawPort != "" {
		if parsed, err := strconv.Atoi(rawPort); err == nil && parsed > 0 && parsed <= 65535 {
			port = uint32(parsed)
		}
	}

	// Ensure directories exist
	_ = os.MkdirAll(dataPath, 0755)
	_ = os.MkdirAll(binPath, 0755)

	config := embeddedpostgres.DefaultConfig().
		Username("ozybase").
		Password("ozybase").
		Database("ozybase").
		Port(port).
		DataPath(dataPath).
		RuntimePath(binPath)

	return &EmbeddedDB{
		config:   config,
		dataPath: dataPath,
		binPath:  binPath,
		port:     port,
	}
}

// Start initializes and starts the embedded PostgreSQL engine
func (e *EmbeddedDB) Start() error {
	logger.Log.Info().Msg("[OzyBase] No external DB detected. Starting embedded PostgreSQL engine...")

	connURL := e.GetConnectionString()
	if canConnectToPostgres(context.Background(), connURL) {
		e.wasAlreadyRunning = true
		logger.Log.Info().Uint32("port", e.port).Msg("[OzyBase] Embedded PostgreSQL is already running on port 5433. Reusing existing instance.")
		return nil
	}

	// Check if bin folder is empty to notify about first start
	// Note: embedded-postgres might create subfolders inside binPath
	binDir, err := os.ReadDir(e.binPath)
	if err != nil || len(binDir) == 0 {
		logger.Log.Info().Msg("[OzyBase] First start: Downloading/Preparing PostgreSQL engine... this may take a moment.")
	}

	e.postgres = embeddedpostgres.NewDatabase(e.config)

	if err := e.postgres.Start(); err != nil {
		if canConnectToPostgres(context.Background(), connURL) {
			e.wasAlreadyRunning = true
			logger.Log.Info().Uint32("port", e.port).Msg("[OzyBase] Embedded PostgreSQL is already listening on port 5433. Reusing existing instance.")
			return nil
		}
		return fmt.Errorf("failed to start embedded postgres: %w", err)
	}

	logger.Log.Info().Uint32("port", e.port).Msg("[OzyBase] Embedded PostgreSQL is ready")
	return nil
}

// Stop gracefully shuts down the embedded PostgreSQL engine
func (e *EmbeddedDB) Stop() error {
	if e.postgres != nil && !e.wasAlreadyRunning {
		logger.Log.Info().Msg("[OzyBase] Stopping embedded PostgreSQL")
		return e.postgres.Stop()
	}
	return nil
}

func canConnectToPostgres(ctx context.Context, connURL string) bool {
	for attempt := 0; attempt < 5; attempt++ {
		connCtx, cancel := context.WithTimeout(ctx, 1*time.Second)
		conn, err := pgx.Connect(connCtx, connURL)
		cancel()
		if err == nil {
			_ = conn.Close(context.Background())
			return true
		}
		time.Sleep(300 * time.Millisecond)
	}
	return false
}

// GetConnectionString returns the DSN for the embedded instance
func (e *EmbeddedDB) GetConnectionString() string {
	return e.config.GetConnectionURL()
}
