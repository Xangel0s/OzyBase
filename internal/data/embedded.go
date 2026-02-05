package data

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/Xangel0s/OzyBase/internal/logger"
	embeddedpostgres "github.com/fergusstrange/embedded-postgres"
)

// EmbeddedDB handles the lifecycle of an embedded PostgreSQL instance
type EmbeddedDB struct {
	postgres *embeddedpostgres.EmbeddedPostgres
	config   embeddedpostgres.Config
	dataPath string
	binPath  string
	port     uint32
}

// NewEmbeddedDB creates a new embedded PostgreSQL instance configuration
func NewEmbeddedDB() *EmbeddedDB {
	// Create data directory in project root
	cwd, _ := os.Getwd()
	dataPath := filepath.Join(cwd, "ozy_data", "pg_data")
	binPath := filepath.Join(cwd, "ozy_data", "bin")
	port := uint32(5433)

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
	logger.Log.Info().Msg("🐘 [OzyBase] No external DB detected. Starting embedded PostgreSQL engine...")

	// Check if bin folder is empty to notify about first start
	// Note: embedded-postgres might create subfolders inside binPath
	binDir, err := os.ReadDir(e.binPath)
	if err != nil || len(binDir) == 0 {
		logger.Log.Info().Msg("📥 [OzyBase] First start: Downloading/Preparing PostgreSQL engine... this may take a moment.")
	}

	e.postgres = embeddedpostgres.NewDatabase(e.config)

	if err := e.postgres.Start(); err != nil {
		return fmt.Errorf("failed to start embedded postgres: %w", err)
	}

	logger.Log.Info().Uint32("port", e.port).Msg("✅ [OzyBase] Embedded PostgreSQL is ready")
	return nil
}

// Stop gracefully shuts down the embedded PostgreSQL engine
func (e *EmbeddedDB) Stop() error {
	if e.postgres != nil {
		logger.Log.Info().Msg("🛑 [OzyBase] Stopping embedded PostgreSQL...")
		return e.postgres.Stop()
	}
	return nil
}

// GetConnectionString returns the DSN for the embedded instance
func (e *EmbeddedDB) GetConnectionString() string {
	return e.config.GetConnectionURL()
}
