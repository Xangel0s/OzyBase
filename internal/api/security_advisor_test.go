package api

import "testing"

func TestIsSensitiveTableName(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		want bool
	}{
		{name: "users", want: true},
		{name: "billing_events", want: true},
		{name: "secrets_store", want: true},
		{name: "orders", want: false},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := isSensitiveTableName(tc.name); got != tc.want {
				t.Fatalf("isSensitiveTableName(%q)=%v want %v", tc.name, got, tc.want)
			}
		})
	}
}

func TestBuildTableRiskReasons(t *testing.T) {
	t.Parallel()

	reasons := buildTableRiskReasons(false, true, false, true)
	if len(reasons) != 3 {
		t.Fatalf("expected 3 reasons, got %d", len(reasons))
	}
	if reasons[0] != "PERMISSIVE_SELECT_TRUE" || reasons[1] != "RLS_DISABLED" || reasons[2] != "SENSITIVE_NO_AUTH_UID" {
		t.Fatalf("unexpected reasons ordering: %+v", reasons)
	}
}

func TestBuildSecurityAdvisorSummary(t *testing.T) {
	t.Parallel()

	tables := []securityAdvisorTableScan{
		{TableName: "users", RLSStatus: "VULNERABLE", PermissiveRead: true, Sensitive: true, UsesAuthUID: false},
		{TableName: "orders", RLSStatus: "PROTECTED", PermissiveRead: false, Sensitive: false, UsesAuthUID: true},
	}
	infra := []securityAdvisorInfraScan{{SlotName: "slot1", LikelyOrphan: true}}

	summary := buildSecurityAdvisorSummary(tables, infra)
	if summary.TotalTables != 2 {
		t.Fatalf("total tables = %d, want 2", summary.TotalTables)
	}
	if summary.VulnerableTables != 1 || summary.PermissivePolicies != 1 || summary.SensitiveWithoutUID != 1 || summary.LikelyOrphanedSlots != 1 {
		t.Fatalf("unexpected summary: %+v", summary)
	}
	if summary.RiskScore >= 100 {
		t.Fatalf("risk score should be reduced, got %d", summary.RiskScore)
	}
}

func TestCategorizeSchema(t *testing.T) {
	t.Parallel()

	cases := []struct {
		schema string
		want   string
	}{
		{schema: "public", want: "user"},
		{schema: "storage", want: "system"},
		{schema: "net", want: "system"},
		{schema: "vault", want: "system"},
		{schema: "realtime", want: "system"},
		{schema: "_realtime", want: "system"},
		{schema: "supabase_functions", want: "system"},
		{schema: "pg_catalog", want: "system"},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.schema, func(t *testing.T) {
			t.Parallel()
			if got := categorizeSchema(tc.schema); got != tc.want {
				t.Fatalf("categorizeSchema(%q)=%q want %q", tc.schema, got, tc.want)
			}
		})
	}
}

func TestSecurityAdvisorQualifiedName(t *testing.T) {
	t.Parallel()

	if got := securityAdvisorQualifiedName("storage", "objects"); got != "storage.objects" {
		t.Fatalf("unexpected qualified name %q", got)
	}
	if got := securityAdvisorQualifiedName("", "orders"); got != "orders" {
		t.Fatalf("unexpected fallback name %q", got)
	}
}

func TestBuildSecurityAdvisorSuggestionsWithGoja(t *testing.T) {
	t.Parallel()

	input := []securityAdvisorTableScan{
		{
			Schema:      "public",
			TableName:   "orders",
			Category:    "user",
			RiskReasons: []string{"RLS_DISABLED"},
		},
		{
			Schema:      "vault",
			TableName:   "secrets",
			Category:    "system",
			RiskReasons: []string{"RLS_DISABLED"},
		},
	}

	suggestions := buildSecurityAdvisorSuggestionsWithGoja(input)
	if len(suggestions) != 1 {
		t.Fatalf("expected 1 suggestion for user/public table, got %d (%+v)", len(suggestions), suggestions)
	}
	if suggestions[0] == "" {
		t.Fatalf("expected non-empty suggestion")
	}
}
