package data

import (
	"strings"
	"testing"
)

func TestBuildRecordSearchExpression_UsesLowerConcatForTextColumns(t *testing.T) {
	expr := BuildRecordSearchExpression(map[string]string{
		"title":  "text",
		"notes":  "varchar",
		"amount": "int8",
		"id":     "uuid",
	})

	if !strings.Contains(expr, "LOWER(") {
		t.Fatalf("expected lowered search expression, got %q", expr)
	}
	if !strings.Contains(expr, `"title"::text`) {
		t.Fatalf("expected title to be part of search expression, got %q", expr)
	}
	if !strings.Contains(expr, `"notes"::text`) {
		t.Fatalf("expected notes to be part of search expression, got %q", expr)
	}
	if strings.Contains(expr, `"amount"::text`) {
		t.Fatalf("did not expect numeric column in search expression, got %q", expr)
	}
	if strings.Contains(expr, `"id"::text`) {
		t.Fatalf("did not expect id in shared trigram expression, got %q", expr)
	}
}

func TestBuildRecordSearchClause_AddsIDFallbackForIdentifierQueries(t *testing.T) {
	clause := buildRecordSearchClause(map[string]string{
		"title": "text",
		"id":    "uuid",
	}, "$1", "550e8400-e29b-41d4-a716-446655440000")

	if !strings.Contains(clause, `"id"::text ILIKE $1`) {
		t.Fatalf("expected id fallback in search clause, got %q", clause)
	}
	if !strings.Contains(clause, "LOWER(") {
		t.Fatalf("expected trigram-friendly expression in search clause, got %q", clause)
	}
}

func TestBuildRecordSearchIndexSQL_BuildsGinTrgmExpressionIndex(t *testing.T) {
	sql := BuildRecordSearchIndexSQL("projects", map[string]string{
		"title": "text",
		"notes": "text",
	})

	if !strings.Contains(sql, `USING GIN`) {
		t.Fatalf("expected GIN index SQL, got %q", sql)
	}
	if !strings.Contains(sql, `gin_trgm_ops`) {
		t.Fatalf("expected trigram operator class, got %q", sql)
	}
	if !strings.Contains(sql, `LOWER(`) {
		t.Fatalf("expected search expression in index SQL, got %q", sql)
	}
}
