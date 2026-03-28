package api

import "testing"

func TestNormalizeWorkspaceID(t *testing.T) {
	if got := normalizeWorkspaceID(""); got != nil {
		t.Fatalf("expected nil for empty workspace id, got %#v", got)
	}

	value := "c2a07892-0d0f-41b3-a1b7-c10a94f45938"
	got := normalizeWorkspaceID(value)
	gotValue, ok := got.(string)
	if !ok {
		t.Fatalf("expected string workspace id, got %T", got)
	}
	if gotValue != value {
		t.Fatalf("expected %q, got %q", value, gotValue)
	}
}
