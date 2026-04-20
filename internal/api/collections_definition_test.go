package api

import (
	"strings"
	"testing"
)

func TestBuildTableDefinitionEditorSQL(t *testing.T) {
	editorSQL := buildTableDefinitionEditorSQL("orders", "CREATE TABLE \"public\".\"orders\" (\n    \"id\" uuid NOT NULL\n);")

	if !strings.Contains(editorSQL, "-- CREATE TABLE \"public\".\"orders\" (") {
		t.Fatalf("expected definition SQL to be commented in editor script")
	}
	if !strings.Contains(editorSQL, "SELECT * FROM \"public\".\"orders\" LIMIT 200;") {
		t.Fatalf("expected editor script to include data preview query")
	}
}
