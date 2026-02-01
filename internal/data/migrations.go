package data

import (
	"context"
	"fmt"
	"log"
)

// RunMigrations creates the system tables if they don't exist
func (db *DB) RunMigrations(ctx context.Context) error {
	log.Println("🔄 Running migrations...")

	migrations := []string{
		// Collections registry - tracks all user-defined collections
		`CREATE TABLE IF NOT EXISTS _v_collections (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			name VARCHAR(255) UNIQUE NOT NULL,
			schema_def JSONB NOT NULL,
			list_rule VARCHAR(50) DEFAULT 'auth',
			create_rule VARCHAR(50) DEFAULT 'admin',
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,

		// Migration: Add rule columns if they don't exist
		`ALTER TABLE _v_collections ADD COLUMN IF NOT EXISTS list_rule VARCHAR(50) DEFAULT 'auth'`,
		`ALTER TABLE _v_collections ADD COLUMN IF NOT EXISTS create_rule VARCHAR(50) DEFAULT 'admin'`,

		// Users table for future authentication
		`CREATE TABLE IF NOT EXISTS _v_users (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			email VARCHAR(255) UNIQUE NOT NULL,
			password_hash VARCHAR(255) NOT NULL,
			role VARCHAR(50) DEFAULT 'user',
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,

		// Index for faster collection lookups by name
		`CREATE INDEX IF NOT EXISTS idx_collections_name ON _v_collections(name)`,

		// Index for user email lookups
		`CREATE INDEX IF NOT EXISTS idx_users_email ON _v_users(email)`,

		// Global notify function for realtime events
		`CREATE OR REPLACE FUNCTION notify_event() RETURNS TRIGGER AS $$
		DECLARE
			payload JSONB;
		BEGIN
			payload = jsonb_build_object(
				'table', TG_TABLE_NAME,
				'action', TG_OP,
				'data', CASE 
					WHEN TG_OP = 'DELETE' THEN row_to_json(OLD)::jsonb
					ELSE row_to_json(NEW)::jsonb
				END
			);
			PERFORM pg_notify('ozy_events', payload::text);
			RETURN NULL;
		END;
		$$ LANGUAGE plpgsql;`,

		// Secrets / Vault
		`CREATE TABLE IF NOT EXISTS _v_secrets (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			key VARCHAR(255) UNIQUE NOT NULL,
			value TEXT NOT NULL,
			description TEXT,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,

		// Webhooks
		`CREATE TABLE IF NOT EXISTS _v_webhooks (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			name VARCHAR(255) NOT NULL,
			url TEXT NOT NULL,
			events VARCHAR(100) NOT NULL, -- e.g. "INSERT,UPDATE"
			status VARCHAR(20) DEFAULT 'active',
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
	}

	for i, migration := range migrations {
		if _, err := db.Pool.Exec(ctx, migration); err != nil {
			return fmt.Errorf("migration %d failed: %w", i+1, err)
		}
	}

	log.Println("✅ Migrations completed successfully")
	return nil
}
