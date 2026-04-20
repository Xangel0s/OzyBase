package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"regexp"
	"strings"

	"github.com/Xangel0s/OzyBase/internal/data"
)

var sqlIdentifierRegex = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)

const (
	defaultRealtimePublication = "ozybase_realtime"
	defaultRealtimeSlot        = "ozybase_realtime_slot"
)

func handleRealtimeCLI(ctx context.Context, db *data.DB, args []string) error {
	if len(args) == 0 {
		return errors.New("usage: ozybase realtime enable <table_name> [--schema public] [--publication ozybase_realtime] [--slot ozybase_realtime_slot]")
	}

	switch args[0] {
	case "enable":
		return handleRealtimeEnable(ctx, db, args[1:])
	default:
		return fmt.Errorf("unknown realtime command %q", args[0])
	}
}

func handleRealtimeEnable(ctx context.Context, db *data.DB, args []string) error {
	fs := flag.NewFlagSet("realtime enable", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)

	schema := fs.String("schema", "public", "Schema of the table to enable realtime for")
	publication := fs.String("publication", defaultRealtimePublication, "Publication name used for realtime replication")
	slot := fs.String("slot", defaultRealtimeSlot, "Logical replication slot name")

	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("missing table name: ozybase realtime enable <table_name>")
	}

	tableName := strings.TrimSpace(fs.Arg(0))
	schemaName := strings.TrimSpace(*schema)
	publicationName := strings.TrimSpace(*publication)
	slotName := strings.TrimSpace(*slot)

	if err := validateIdentifier("schema", schemaName); err != nil {
		return err
	}
	if err := validateIdentifier("table", tableName); err != nil {
		return err
	}
	if err := validateIdentifier("publication", publicationName); err != nil {
		return err
	}
	if err := validateIdentifier("slot", slotName); err != nil {
		return err
	}

	if err := ensureLogicalWAL(ctx, db); err != nil {
		return err
	}

	if err := ensureTableExists(ctx, db, schemaName, tableName); err != nil {
		return err
	}

	if err := ensurePublication(ctx, db, publicationName); err != nil {
		return err
	}

	if err := ensureTableInPublication(ctx, db, publicationName, schemaName, tableName); err != nil {
		return err
	}

	if err := ensureReplicationSlot(ctx, db, slotName); err != nil {
		return err
	}

	log.Printf("✅ Realtime enabled for %s.%s (publication=%s, slot=%s)", schemaName, tableName, publicationName, slotName)
	return nil
}

func ensureLogicalWAL(ctx context.Context, db *data.DB) error {
	var walLevel string
	if err := db.Pool.QueryRow(ctx, "SHOW wal_level").Scan(&walLevel); err != nil {
		return fmt.Errorf("failed to read wal_level: %w", err)
	}
	if !strings.EqualFold(strings.TrimSpace(walLevel), "logical") {
		return fmt.Errorf("wal_level must be logical before enabling realtime (current=%s)", walLevel)
	}
	return nil
}

func ensureTableExists(ctx context.Context, db *data.DB, schemaName string, tableName string) error {
	const tableExistsSQL = `
		SELECT EXISTS (
			SELECT 1
			FROM information_schema.tables
			WHERE table_schema = $1 AND table_name = $2
		)
	`

	var exists bool
	if err := db.Pool.QueryRow(ctx, tableExistsSQL, schemaName, tableName).Scan(&exists); err != nil {
		return fmt.Errorf("failed to verify table existence: %w", err)
	}
	if !exists {
		return fmt.Errorf("table not found: %s.%s", schemaName, tableName)
	}
	return nil
}

func ensurePublication(ctx context.Context, db *data.DB, publicationName string) error {
	var exists bool
	if err := db.Pool.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = $1)", publicationName).Scan(&exists); err != nil {
		return fmt.Errorf("failed to check publication: %w", err)
	}
	if exists {
		return nil
	}

	query := fmt.Sprintf("CREATE PUBLICATION %s", publicationName)
	if _, err := db.Pool.Exec(ctx, query); err != nil {
		return fmt.Errorf("failed to create publication %s: %w", publicationName, err)
	}
	return nil
}

func ensureTableInPublication(ctx context.Context, db *data.DB, publicationName string, schemaName string, tableName string) error {
	const publicationTableExistsSQL = `
		SELECT EXISTS (
			SELECT 1
			FROM pg_publication_tables
			WHERE pubname = $1 AND schemaname = $2 AND tablename = $3
		)
	`

	var exists bool
	if err := db.Pool.QueryRow(ctx, publicationTableExistsSQL, publicationName, schemaName, tableName).Scan(&exists); err != nil {
		return fmt.Errorf("failed to inspect publication table list: %w", err)
	}
	if exists {
		return nil
	}

	query := fmt.Sprintf("ALTER PUBLICATION %s ADD TABLE %s.%s", publicationName, schemaName, tableName)
	if _, err := db.Pool.Exec(ctx, query); err != nil {
		return fmt.Errorf("failed to add table to publication: %w", err)
	}
	return nil
}

func ensureReplicationSlot(ctx context.Context, db *data.DB, slotName string) error {
	var exists bool
	if err := db.Pool.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_name = $1)", slotName).Scan(&exists); err != nil {
		return fmt.Errorf("failed to check replication slot: %w", err)
	}
	if exists {
		return nil
	}

	if _, err := db.Pool.Exec(ctx, "SELECT * FROM pg_create_logical_replication_slot($1, 'pgoutput')", slotName); err != nil {
		return fmt.Errorf("failed to create replication slot %s: %w", slotName, err)
	}
	return nil
}

func validateIdentifier(kind string, value string) error {
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("%s name is required", kind)
	}
	if !sqlIdentifierRegex.MatchString(value) {
		return fmt.Errorf("invalid %s name %q: use letters, numbers, and underscore, starting with a letter or underscore", kind, value)
	}
	return nil
}
