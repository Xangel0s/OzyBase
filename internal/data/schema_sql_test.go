package data

import (
	"strings"
	"testing"
)

func TestBuildCreateTableSQL_QuotesReservedIdentifiers(t *testing.T) {
	sql, err := BuildCreateTableSQL("menu", []FieldSchema{
		{Name: "group", Type: "text", Required: true},
		{Name: "label", Type: "text"},
	})
	if err != nil {
		t.Fatalf("expected build to succeed, got %v", err)
	}

	if !strings.Contains(sql, `CREATE TABLE IF NOT EXISTS "menu"`) {
		t.Fatalf("expected quoted table name, got %s", sql)
	}
	if !strings.Contains(sql, `"group" TEXT NOT NULL`) {
		t.Fatalf("expected quoted reserved column, got %s", sql)
	}
	if !strings.Contains(sql, `"label" TEXT`) {
		t.Fatalf("expected quoted regular column, got %s", sql)
	}
}

func TestBuildCreateTableSQL_DoesNotInjectImplicitID(t *testing.T) {
	sql, err := BuildCreateTableSQL("notes", []FieldSchema{
		{Name: "title", Type: "text", Required: true},
		{Name: "body", Type: "text"},
	})
	if err != nil {
		t.Fatalf("expected build to succeed, got %v", err)
	}

	if strings.Contains(strings.ToLower(sql), `"id" uuid primary key default gen_random_uuid()`) {
		t.Fatalf("did not expect implicit id injection, got %s", sql)
	}
}

func TestBuildBulkInsertStatement_QuotesReservedIdentifiers(t *testing.T) {
	query, values, err := buildBulkInsertStatement(
		"menu",
		[]string{"group", "label"},
		map[string]string{
			"group": "text",
			"label": "text",
		},
		[]map[string]any{
			{
				"group": "admin",
				"label": "Dashboard",
			},
		},
		0,
	)
	if err != nil {
		t.Fatalf("expected insert statement build to succeed, got %v", err)
	}

	if query != `INSERT INTO "menu" ("group", "label") VALUES ($1, $2)` {
		t.Fatalf("unexpected insert query: %s", query)
	}
	if len(values) != 2 || values[0] != "admin" || values[1] != "Dashboard" {
		t.Fatalf("unexpected values: %#v", values)
	}
}

func TestMapPostgresTypeToOzy_CharacterVaryingUsesVarchar(t *testing.T) {
	got := mapPostgresTypeToOzy("character varying")
	if got != "varchar" {
		t.Fatalf("expected character varying to map to varchar, got %q", got)
	}
}

func TestNormalizePostgresTypeToOzy_InformationSchemaVariants(t *testing.T) {
	testCases := []struct {
		name    string
		pgType  string
		udtName string
		expect  string
	}{
		{
			name:   "smallint maps to int2",
			pgType: "smallint",
			expect: "int2",
		},
		{
			name:   "time without time zone maps to time",
			pgType: "time without time zone",
			expect: "time",
		},
		{
			name:   "time with time zone maps to timetz",
			pgType: "time with time zone",
			expect: "timetz",
		},
		{
			name:   "timestamp with time zone maps to timestamptz",
			pgType: "timestamp with time zone",
			expect: "timestamptz",
		},
		{
			name:    "int array via udt_name maps to int_array",
			pgType:  "ARRAY",
			udtName: "_int4",
			expect:  "int_array",
		},
		{
			name:    "text array via udt_name maps to text_array",
			pgType:  "ARRAY",
			udtName: "_text",
			expect:  "text_array",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			got := NormalizePostgresTypeToOzy(tc.pgType, tc.udtName)
			if got != tc.expect {
				t.Fatalf("expected %q to map to %q (udt=%q), got %q", tc.pgType, tc.expect, tc.udtName, got)
			}
		})
	}
}
