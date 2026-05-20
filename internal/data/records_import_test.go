package data

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

func TestCollectBulkInsertColumnsSkipsInvalidAndSystemColumns(t *testing.T) {
	validColumns := map[string]bool{
		"name":       true,
		"age":        true,
		"created_at": true,
		"deleted_at": true,
	}
	records := []map[string]any{
		{"name": "Alice", "age": "28", "id": "ignore-me", "bad-name": "skip"},
		{"age": "31", "created_at": "skip", "deleted_at": "skip"},
	}

	got := collectBulkInsertColumns(validColumns, records)
	want := []string{"age", "name"}

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("expected columns %v, got %v", want, got)
	}
}

func TestNormalizeImportedValue(t *testing.T) {
	t.Run("empty strings become null", func(t *testing.T) {
		value, err := normalizeImportedValue("text", "   ")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if value != nil {
			t.Fatalf("expected nil for blank text, got %#v", value)
		}
	})

	t.Run("integer strings are coerced", func(t *testing.T) {
		value, err := normalizeImportedValue("bigint", "42")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got, ok := value.(int64); !ok || got != 42 {
			t.Fatalf("expected int64(42), got %#v", value)
		}
	})

	t.Run("boolean aliases are accepted", func(t *testing.T) {
		value, err := normalizeImportedValue("boolean", "yes")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got, ok := value.(bool); !ok || !got {
			t.Fatalf("expected true, got %#v", value)
		}
	})

	t.Run("json strings are preserved as raw json", func(t *testing.T) {
		value, err := normalizeImportedValue("jsonb", `{"name":"alice"}`)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		raw, ok := value.(json.RawMessage)
		if !ok {
			t.Fatalf("expected json.RawMessage, got %#v", value)
		}
		if string(raw) != `{"name":"alice"}` {
			t.Fatalf("unexpected json payload: %s", string(raw))
		}
	})

	t.Run("timestamps parse into time values", func(t *testing.T) {
		value, err := normalizeImportedValue("timestamp without time zone", "2026-03-31 19:30:00")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if _, ok := value.(time.Time); !ok {
			t.Fatalf("expected time.Time, got %#v", value)
		}
	})

	t.Run("invalid integer returns context error", func(t *testing.T) {
		if _, err := normalizeImportedValue("integer", "abc"); err == nil {
			t.Fatalf("expected integer coercion error")
		}
	})
}

func TestBulkImportDiagnosticCollectorCapsReportedRows(t *testing.T) {
	collector := newBulkImportDiagnosticCollector(2)
	collector.addRowError(1, fmt.Errorf("row 1 column age: expected integer value"))
	collector.addRowError(2, fmt.Errorf("row 2 column active: expected boolean value"))
	collector.addRowError(3, fmt.Errorf("row 3 column joined_at: expected date or timestamp value"))

	importErr := collector.toError()
	if importErr == nil {
		t.Fatalf("expected collector error")
	}
	if len(importErr.RowErrors) != 2 {
		t.Fatalf("expected 2 row errors, got %d", len(importErr.RowErrors))
	}
	if !importErr.Truncated {
		t.Fatalf("expected collector to report truncated diagnostics")
	}
}

func TestBulkInsertRecordReportsBoundedRowErrorsAndRollsBack(t *testing.T) {
	db := setupBulkImportTestDB(t)
	tableName := fmt.Sprintf("bulk_import_%d", time.Now().UnixNano())

	ctx := context.Background()
	_, err := db.Pool.Exec(ctx, fmt.Sprintf(`
		CREATE TABLE %s (
			name text NOT NULL,
			age integer NOT NULL
		)
	`, QuoteIdentifier(tableName)))
	if err != nil {
		t.Fatalf("create bulk import test table: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.Pool.Exec(context.Background(), fmt.Sprintf("DROP TABLE IF EXISTS %s", QuoteIdentifier(tableName)))
	})

	rows := []map[string]any{
		{"name": "Alice", "age": "33"},
	}
	for index := 0; index < 30; index++ {
		rows = append(rows, map[string]any{
			"name": fmt.Sprintf("Broken %d", index),
			"age":  "not-a-number",
		})
	}

	err = db.BulkInsertRecord(ctx, tableName, rows)
	if err == nil {
		t.Fatalf("expected bulk import error")
	}

	var importErr *BulkImportError
	if !errors.As(err, &importErr) {
		t.Fatalf("expected BulkImportError, got %T", err)
	}
	if len(importErr.RowErrors) == 0 {
		t.Fatalf("expected at least 1 row error, got 0")
	}
	if importErr.RowErrors[0].Row == 0 {
		t.Fatalf("expected first invalid row >= 1, got %d", importErr.RowErrors[0].Row)
	}
	if !strings.Contains(strings.ToLower(importErr.RowErrors[0].Message), "expected integer value") &&
		!strings.Contains(strings.ToLower(importErr.RowErrors[0].Message), "invalid") &&
		!strings.Contains(strings.ToLower(importErr.RowErrors[0].Message), "validation") &&
		!strings.Contains(strings.ToLower(importErr.RowErrors[0].Message), "type") {
		t.Fatalf("expected sanitized type message, got %q", importErr.RowErrors[0].Message)
	}
	if !importErr.Truncated && len(importErr.RowErrors) != 30 {
		t.Fatalf("expected diagnostics to be truncated after the configured cap, got %d row errors", len(importErr.RowErrors))
	}

	var count int
	if err := db.Pool.QueryRow(ctx, fmt.Sprintf("SELECT COUNT(*) FROM %s", QuoteIdentifier(tableName))).Scan(&count); err != nil {
		t.Fatalf("count imported rows: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected bulk import rollback, found %d persisted rows", count)
	}
}

func setupBulkImportTestDB(t *testing.T) *DB {
	t.Helper()

	databaseURL := strings.TrimSpace(os.Getenv("OZY_TEST_DATABASE_URL"))
	if databaseURL == "" {
		databaseURL = strings.TrimSpace(os.Getenv("DATABASE_URL"))
	}

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	if databaseURL == "" {
		db := startTestContainerDB(ctx, t)
		return db
	}

	db, err := Connect(ctx, databaseURL)
	if err != nil {
		if strings.Contains(err.Error(), "dial error") || strings.Contains(err.Error(), "connection refused") {
			t.Skipf("postgres not reachable at %s: %v", databaseURL, err)
		}
		t.Fatalf("connect bulk import test db: %v", err)
	}
	t.Cleanup(db.Close)

	if err := db.RunMigrations(ctx); err != nil {
		t.Fatalf("run migrations for bulk import test db: %v", err)
	}

	return db
}

func startTestContainerDB(ctx context.Context, t *testing.T) *DB {
	t.Helper()

	postgresContainer, err := postgres.Run(ctx, "postgres:15-alpine",
		postgres.WithDatabase("ozybase_test"),
		postgres.WithUsername("postgres"),
		postgres.WithPassword("password"),
		testcontainers.WithWaitStrategyAndDeadline(60*time.Second,
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).
				WithStartupTimeout(60*time.Second),
		),
	)
	if err != nil {
		if strings.Contains(err.Error(), "cannot connect to the Docker daemon") ||
			strings.Contains(err.Error(), "pipe") ||
			strings.Contains(err.Error(), "no such host") {
			t.Skip("docker not available: install Docker Desktop to run integration tests automatically")
		}
		t.Fatalf("start postgres container: %v", err)
	}
	t.Cleanup(func() {
		terminateCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := postgresContainer.Terminate(terminateCtx); err != nil {
			t.Logf("failed to terminate postgres container: %v", err)
		}
	})

	connStr, err := postgresContainer.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("get postgres connection string: %v", err)
	}

	db, err := Connect(ctx, connStr)
	if err != nil {
		t.Fatalf("connect bulk import test db: %v", err)
	}
	t.Cleanup(db.Close)

	if err := db.RunMigrations(ctx); err != nil {
		t.Fatalf("run migrations for bulk import test db: %v", err)
	}

	return db
}
