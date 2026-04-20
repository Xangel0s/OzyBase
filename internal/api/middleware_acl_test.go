package api

import "testing"

func TestResolveCollectionAccessRule(t *testing.T) {
	t.Run("maps each requirement to its own rule", func(t *testing.T) {
		if got := resolveCollectionAccessRule("list", "public", "auth", "editor", "manager"); got != "public" {
			t.Fatalf("list rule = %q, want public", got)
		}
		if got := resolveCollectionAccessRule("create", "public", "auth", "editor", "manager"); got != "auth" {
			t.Fatalf("create rule = %q, want auth", got)
		}
		if got := resolveCollectionAccessRule("update", "public", "auth", "editor", "manager"); got != "editor" {
			t.Fatalf("update rule = %q, want editor", got)
		}
		if got := resolveCollectionAccessRule("delete", "public", "auth", "editor", "manager"); got != "manager" {
			t.Fatalf("delete rule = %q, want manager", got)
		}
	})
}

func TestEvaluateCollectionAccessRule(t *testing.T) {
	tests := []struct {
		name      string
		rule      string
		userID    any
		role      any
		wantAllow bool
		wantError string
	}{
		{name: "public allows everyone", rule: "public", wantAllow: true},
		{name: "auth blocks anonymous", rule: "auth", wantError: "authentication required for this collection"},
		{name: "auth allows authenticated user", rule: "auth", userID: "user_123", role: "user", wantAllow: true},
		{name: "admin blocks non admin", rule: "admin", userID: "user_123", role: "manager", wantError: "admin access required for this collection"},
		{name: "admin allows admin", rule: "admin", userID: "user_123", role: "admin", wantAllow: true},
		{name: "plain manager role is supported", rule: "manager", userID: "user_123", role: "manager", wantAllow: true},
		{name: "prefixed manager role is supported", rule: "role:manager", userID: "user_123", role: "manager", wantAllow: true},
		{name: "custom role mismatch is denied", rule: "editor", userID: "user_123", role: "manager", wantError: "editor role required for this collection"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			decision := evaluateCollectionAccessRule(tt.rule, tt.userID, tt.role)
			if decision.allowed != tt.wantAllow {
				t.Fatalf("allowed = %v, want %v", decision.allowed, tt.wantAllow)
			}
			if tt.wantError != "" && decision.message != tt.wantError {
				t.Fatalf("message = %q, want %q", decision.message, tt.wantError)
			}
		})
	}
}
