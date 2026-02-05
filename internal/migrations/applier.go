package migrations

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Applier handles the logic for applying pending SQL migrations
type Applier struct {
	pool           *pgxpool.Pool
	migrationsPath string
}

// NewApplier creates a new migration applier
func NewApplier(pool *pgxpool.Pool, path string) *Applier {
	if path == "" {
		path = "./migrations"
	}
	return &Applier{
		pool:           pool,
		migrationsPath: path,
	}
}

// ApplyPendingMigrations reads the local migrations directory and applies any new files
func (a *Applier) ApplyPendingMigrations(ctx context.Context) error {
	// 1. Ensure migrations path exists
	if _, err := os.Stat(a.migrationsPath); os.IsNotExist(err) {
		log.Printf("📂 Migrations directory %s does not exist, skipping applier.", a.migrationsPath)
		return nil
	}

	// 2. Fetch applied migrations from DB
	applied := make(map[string]bool)
	rows, err := a.pool.Query(ctx, "SELECT file_name FROM _v_migrations_history")
	if err != nil {
		// If table doesn't exist yet, it will be created by RunMigrations called before this,
		// but if it still fails, we assume no migrations applied.
		log.Printf("⚠️ Could not fetch migration history: %v", err)
	} else {
		defer rows.Close()
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err == nil {
				applied[name] = true
			}
		}
	}

	// 3. List local migration files
	files, err := os.ReadDir(a.migrationsPath)
	if err != nil {
		return fmt.Errorf("failed to read migrations directory: %w", err)
	}

	var pending []string
	for _, f := range files {
		if !f.IsDir() && strings.HasSuffix(f.Name(), ".sql") {
			if !applied[f.Name()] {
				pending = append(pending, f.Name())
			}
		}
	}

	// 4. Sort migrations to ensure they run in order
	sort.Strings(pending)

	if len(pending) == 0 {
		log.Println("✅ No pending migrations to apply.")
		return nil
	}

	log.Printf("🚀 Found %d pending migrations. Applying...", len(pending))

	// 5. Apply each migration in a transaction
	for _, fileName := range pending {
		filePath := filepath.Join(a.migrationsPath, fileName)
		content, err := os.ReadFile(filePath)
		if err != nil {
			return fmt.Errorf("failed to read migration file %s: %w", fileName, err)
		}

		log.Printf("📝 Applying migration: %s", fileName)

		// Run in transaction
		tx, err := a.pool.Begin(ctx)
		if err != nil {
			return err
		}
		defer func() { _ = tx.Rollback(ctx) }()

		// Execute the SQL
		if _, err := tx.Exec(ctx, string(content)); err != nil {
			return fmt.Errorf("failed to execute migration %s: %w", fileName, err)
		}

		// Record in history
		_, err = tx.Exec(ctx, "INSERT INTO _v_migrations_history (file_name) VALUES ($1)", fileName)
		if err != nil {
			return fmt.Errorf("failed to record migration history for %s: %w", fileName, err)
		}

		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("failed to commit migration %s: %w", fileName, err)
		}

		log.Printf("✅ Migration applied successfully: %s", fileName)
	}

	return nil
}
