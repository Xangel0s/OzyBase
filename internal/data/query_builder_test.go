package data

import (
	"strings"
	"testing"
)

func TestQueryBuilderOrder(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		wantOrder string
	}{
		{
			name:      "single column desc",
			input:     "created_at.desc",
			wantOrder: `ORDER BY "created_at" DESC`,
		},
		{
			name:      "single column asc",
			input:     "name.asc",
			wantOrder: `ORDER BY "name" ASC`,
		},
		{
			name:      "multiple columns",
			input:     "created_at.desc,name.asc",
			wantOrder: `ORDER BY "created_at" DESC, "name" ASC`,
		},
		{
			name:      "invalid column ignored",
			input:     "created_at.desc,drop table",
			wantOrder: `ORDER BY "created_at" DESC`,
		},
		{
			name:      "empty input",
			input:     "",
			wantOrder: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			qb := NewQueryBuilder("users")
			qb.Order(tt.input)
			query, _ := qb.BuildSelect()

			if tt.wantOrder == "" {
				if strings.Contains(query, "ORDER BY") {
					t.Fatalf("expected no ORDER BY, got %s", query)
				}
				return
			}

			if !strings.Contains(query, tt.wantOrder) {
				t.Fatalf("expected %q in query, got %s", tt.wantOrder, query)
			}
		})
	}
}

func TestQueryBuilderQuotesReservedIdentifiers(t *testing.T) {
	qb := NewQueryBuilder("menu")
	qb.Where("group", "eq", "admin")
	qb.Order("group.asc")

	query, args := qb.BuildSelect()
	if !strings.Contains(query, `SELECT * FROM "menu"`) {
		t.Fatalf("expected quoted table name, got %s", query)
	}
	if !strings.Contains(query, `"group" = $1`) {
		t.Fatalf("expected quoted reserved column in WHERE, got %s", query)
	}
	if !strings.Contains(query, `ORDER BY "group" ASC`) {
		t.Fatalf("expected quoted reserved column in ORDER BY, got %s", query)
	}
	if len(args) != 1 || args[0] != "admin" {
		t.Fatalf("unexpected args: %#v", args)
	}
}
