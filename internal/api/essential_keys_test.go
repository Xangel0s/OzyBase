package api

import (
	"testing"
	"time"
)

func TestEncryptDecryptKeyMaterial(t *testing.T) {
	secret := "unit-test-secret-32-characters-minimum"
	plaintext := "ozys_deadbeef_abcdef1234567890"

	ciphertext, err := encryptKeyMaterial(secret, plaintext)
	if err != nil {
		t.Fatalf("encryptKeyMaterial returned error: %v", err)
	}
	if ciphertext == "" {
		t.Fatalf("expected ciphertext")
	}

	restored, err := decryptKeyMaterial(secret, ciphertext)
	if err != nil {
		t.Fatalf("decryptKeyMaterial returned error: %v", err)
	}
	if restored != plaintext {
		t.Fatalf("decryptKeyMaterial() = %q, want %q", restored, plaintext)
	}
}

func TestAdminVerificationTokenRoundTrip(t *testing.T) {
	now := time.Date(2026, time.March, 28, 18, 30, 0, 0, time.UTC)
	token, expiresAt, err := issueAdminVerificationToken("jwt-secret", "11111111-1111-1111-1111-111111111111", adminVerifyScopeEssential, now, 10*time.Minute)
	if err != nil {
		t.Fatalf("issueAdminVerificationToken returned error: %v", err)
	}
	if expiresAt.Sub(now) != 10*time.Minute {
		t.Fatalf("unexpected expiry delta: %v", expiresAt.Sub(now))
	}

	if err := validateAdminVerificationToken("jwt-secret", token, "11111111-1111-1111-1111-111111111111", adminVerifyScopeEssential, now.Add(5*time.Minute)); err != nil {
		t.Fatalf("validateAdminVerificationToken returned error: %v", err)
	}
}

func TestAdminVerificationTokenRejectsWrongScopeOrExpiry(t *testing.T) {
	now := time.Date(2026, time.March, 28, 18, 30, 0, 0, time.UTC)
	token, _, err := issueAdminVerificationToken("jwt-secret", "11111111-1111-1111-1111-111111111111", adminVerifyScopeEssential, now, time.Minute)
	if err != nil {
		t.Fatalf("issueAdminVerificationToken returned error: %v", err)
	}

	if err := validateAdminVerificationToken("jwt-secret", token, "11111111-1111-1111-1111-111111111111", "other_scope", now.Add(30*time.Second)); err == nil {
		t.Fatalf("expected scope validation error")
	}
	if err := validateAdminVerificationToken("jwt-secret", token, "11111111-1111-1111-1111-111111111111", adminVerifyScopeEssential, now.Add(2*time.Minute)); err == nil {
		t.Fatalf("expected expiry validation error")
	}
}

func TestGenerateManagedAPIKey(t *testing.T) {
	key, prefix, err := generateManagedAPIKey(APIKeyRoleServiceRole)
	if err != nil {
		t.Fatalf("generateManagedAPIKey returned error: %v", err)
	}
	if prefix == "" || key == "" {
		t.Fatalf("expected key and prefix")
	}
	if len(prefix) > 10 {
		t.Fatalf("prefix should fit schema column, got %q", prefix)
	}
	if len(key) <= len(prefix) {
		t.Fatalf("expected key to contain secret material after prefix")
	}
}

func TestBuildEssentialAPIKeySummaryIncludesCopyValueOnlyForAnon(t *testing.T) {
	t.Setenv("JWT_SECRET", "unit-test-secret-32-characters-minimum")

	anonCiphertext, err := encryptKeyMaterial(apiKeySecretEncryptionSecret(), "ozy_anon_live_value")
	if err != nil {
		t.Fatalf("encryptKeyMaterial returned error: %v", err)
	}

	now := time.Date(2026, time.April, 7, 12, 0, 0, 0, time.UTC)
	anonSummary, err := buildEssentialAPIKeySummary(APIKey{
		ID:         "anon-id",
		Role:       APIKeyRoleAnon,
		Prefix:     "ozy_anon",
		KeyVersion: 2,
		IsActive:   true,
		CreatedAt:  now,
	}, anonCiphertext)
	if err != nil {
		t.Fatalf("buildEssentialAPIKeySummary returned error: %v", err)
	}
	if anonSummary.CopyValue != "ozy_anon_live_value" {
		t.Fatalf("anon copy_value = %q, want full publishable key", anonSummary.CopyValue)
	}

	serviceCiphertext, err := encryptKeyMaterial(apiKeySecretEncryptionSecret(), "ozy_service_role_live_value")
	if err != nil {
		t.Fatalf("encryptKeyMaterial returned error: %v", err)
	}
	serviceSummary, err := buildEssentialAPIKeySummary(APIKey{
		ID:         "service-id",
		Role:       APIKeyRoleServiceRole,
		Prefix:     "ozy_serv",
		KeyVersion: 4,
		IsActive:   true,
		CreatedAt:  now,
	}, serviceCiphertext)
	if err != nil {
		t.Fatalf("buildEssentialAPIKeySummary returned error: %v", err)
	}
	if serviceSummary.CopyValue != "" {
		t.Fatalf("service_role copy_value = %q, want empty", serviceSummary.CopyValue)
	}
}

func TestIsPlaceholderKeyMaterial(t *testing.T) {
	tests := []struct {
		name  string
		value string
		want  bool
	}{
		{name: "replace with marker", value: "replace-with-a-long-random-anon-key", want: true},
		{name: "mock marker", value: "MOCK_service_key", want: true},
		{name: "real anon key", value: "ozya_1234_abcdef0123456789", want: false},
		{name: "empty", value: "", want: false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := isPlaceholderKeyMaterial(tc.value)
			if got != tc.want {
				t.Fatalf("isPlaceholderKeyMaterial(%q) = %v, want %v", tc.value, got, tc.want)
			}
		})
	}
}
