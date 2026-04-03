package api

import (
	"strings"
	"testing"
)

func TestSplitSetupMigrationStatements_RespectsMySQLDelimiterBlocks(t *testing.T) {
	t.Parallel()

	raw := strings.TrimSpace(`
DELIMITER $$
CREATE DEFINER=` + "`demo`@`localhost`" + ` PROCEDURE ` + "`sp_profile_sync`" + ` () BEGIN
    INSERT INTO profile_menu (profile_menu_id, menu_id, profile_id, access)
    SELECT profile_menu_id, menu_id, 1, access
    FROM temp_profile_menu;
END$$
DELIMITER ;
CREATE TABLE ` + "`menu`" + ` (
  ` + "`id`" + ` int(11) NOT NULL,
  ` + "`label`" + ` varchar(120) NOT NULL
);
INSERT INTO ` + "`menu`" + ` VALUES
  (1,'Dashboard');
`)

	statements := splitSetupMigrationStatements(stripSQLComments(raw))
	if len(statements) != 3 {
		t.Fatalf("expected 3 statements after delimiter-aware split, got %d: %#v", len(statements), statements)
	}
	if !strings.HasPrefix(strings.ToUpper(strings.TrimSpace(statements[0])), "CREATE DEFINER") {
		t.Fatalf("expected first statement to keep the stored procedure intact, got %q", statements[0])
	}
	if !strings.Contains(statements[0], "FROM temp_profile_menu;") {
		t.Fatalf("expected procedure body to remain intact, got %q", statements[0])
	}
	if !strings.HasPrefix(strings.ToUpper(strings.TrimSpace(statements[1])), "CREATE TABLE") {
		t.Fatalf("expected second statement to be CREATE TABLE, got %q", statements[1])
	}
	if !strings.HasPrefix(strings.ToUpper(strings.TrimSpace(statements[2])), "INSERT INTO") {
		t.Fatalf("expected third statement to be INSERT INTO, got %q", statements[2])
	}
}

func TestSplitSetupMigrationStatements_RespectsPostgresDollarQuotedBodies(t *testing.T) {
	t.Parallel()

	raw := strings.TrimSpace(`
CREATE FUNCTION demo_sync() RETURNS void AS $$
BEGIN
  INSERT INTO audit_log (event_name)
  SELECT 'sync';
END;
$$ LANGUAGE plpgsql;
CREATE TABLE public.account (
  id BIGINT PRIMARY KEY,
  email TEXT NOT NULL
);
INSERT INTO public.account VALUES
  (1,'ana@example.com');
`)

	statements := splitSetupMigrationStatements(raw)
	if len(statements) != 3 {
		t.Fatalf("expected 3 statements after dollar-quote-aware split, got %d: %#v", len(statements), statements)
	}
	if !strings.HasPrefix(strings.ToUpper(strings.TrimSpace(statements[0])), "CREATE FUNCTION") {
		t.Fatalf("expected first statement to keep the function intact, got %q", statements[0])
	}
	if !strings.Contains(statements[0], "SELECT 'sync';") {
		t.Fatalf("expected function body to remain intact, got %q", statements[0])
	}
}

func TestBuildSQLMigrationPlan_IgnoresRoutineBlocksAndKeepsMySQLDataPreview(t *testing.T) {
	t.Parallel()

	raw := strings.TrimSpace(`
DELIMITER $$
CREATE DEFINER=` + "`demo`@`localhost`" + ` PROCEDURE ` + "`sp_profile_sync`" + ` () BEGIN
    INSERT INTO profile_menu (profile_menu_id, menu_id, profile_id, access)
    SELECT profile_menu_id, menu_id, 1, access
    FROM temp_profile_menu;
END$$
DELIMITER ;
CREATE TABLE ` + "`menu`" + ` (
  ` + "`id`" + ` int(11) NOT NULL,
  ` + "`label`" + ` varchar(120) NOT NULL
);
INSERT INTO ` + "`menu`" + ` VALUES
  (1,'Dashboard'),
  (2,'Users');
`)

	plan, err := buildSetupMigrationPlan(setupMigrationRequest{
		SourceKind: "mysql_sql",
		RawInput:   raw,
		ImportRows: true,
	})
	if err != nil {
		t.Fatalf("buildSetupMigrationPlan returned error: %v", err)
	}
	if len(plan.Tables) != 1 {
		t.Fatalf("expected 1 migrated table, got %d", len(plan.Tables))
	}
	if plan.Tables[0].Name != "menu" {
		t.Fatalf("expected migrated table to be menu, got %q", plan.Tables[0].Name)
	}
	if plan.Tables[0].DetectedRows != 2 {
		t.Fatalf("expected 2 preview rows, got %d", plan.Tables[0].DetectedRows)
	}
	if len(plan.Tables[0].PreviewRows) != 2 {
		t.Fatalf("expected 2 preview rows in memory, got %d", len(plan.Tables[0].PreviewRows))
	}
	if !containsSubstring(plan.Warnings, "Ignored unsupported setup statement: CREATE DEFINER") {
		t.Fatalf("expected warning about ignored procedure block, got %#v", plan.Warnings)
	}
}

func TestBuildSQLMigrationPlan_IgnoresInsertSelectStatements(t *testing.T) {
	t.Parallel()

	raw := strings.TrimSpace(`
CREATE TABLE audit_log (
  id INT NOT NULL,
  event_name VARCHAR(120) NOT NULL
);
INSERT INTO audit_log (id, event_name)
SELECT 1, 'seeded';
CREATE TABLE menu (
  id INT NOT NULL,
  label VARCHAR(120) NOT NULL
);
INSERT INTO menu VALUES
  (1,'Dashboard');
`)

	plan, err := buildSetupMigrationPlan(setupMigrationRequest{
		SourceKind: "mysql_sql",
		RawInput:   raw,
		ImportRows: true,
	})
	if err != nil {
		t.Fatalf("buildSetupMigrationPlan returned error: %v", err)
	}
	if len(plan.Tables) != 2 {
		t.Fatalf("expected 2 migrated tables, got %d", len(plan.Tables))
	}
	if plan.TotalRows != 1 {
		t.Fatalf("expected only VALUES rows to be counted, got %d", plan.TotalRows)
	}
	if !containsSubstring(plan.Warnings, "Ignored unsupported INSERT statement: INSERT INTO audit_log") {
		t.Fatalf("expected warning about INSERT ... SELECT, got %#v", plan.Warnings)
	}
}

func TestParseSQLInsertStatement_SupportsMySQLEscapedQuotesAndBitLiterals(t *testing.T) {
	t.Parallel()

	statement := strings.TrimSpace(`
INSERT INTO ` + "`document`" + ` (` + "`document_id`" + `, ` + "`code`" + `, ` + "`is_active`" + `) VALUES
  (9136, 'prueba\'01', b'0'),
  (9137, 'normal', b'1');
`)

	parsed, err := parseSQLInsertStatement(statement, nil)
	if err != nil {
		t.Fatalf("parseSQLInsertStatement returned error: %v", err)
	}
	if len(parsed.Rows) != 2 {
		t.Fatalf("expected 2 parsed rows, got %d", len(parsed.Rows))
	}
	if got := parsed.Rows[0]["code"]; got != "prueba'01" {
		t.Fatalf("expected escaped quote to be preserved, got %#v", got)
	}
	if got := parsed.Rows[0]["is_active"]; got != false {
		t.Fatalf("expected b'0' to parse as false, got %#v", got)
	}
	if got := parsed.Rows[1]["is_active"]; got != true {
		t.Fatalf("expected b'1' to parse as true, got %#v", got)
	}
}
