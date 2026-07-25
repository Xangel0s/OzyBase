package auth

import (
	"strings"
	"testing"
)

// Unit tests for admin CLI helpers — these test pure validation logic
// without requiring a real database connection.

func TestCreateAdminWithWorkspace_EmailValidation(t *testing.T) {
	tests := []struct {
		name    string
		email   string
		wantErr string
	}{
		{"empty email", "", "email is required"},
		{"invalid email", "notanemail", "invalid email format"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := CreateAdminWithWorkspace(nil, nil, tc.email, "SecurePass123!")
			if err == nil {
				t.Fatalf("expected error %q, got nil", tc.wantErr)
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Errorf("expected error to contain %q, got %q", tc.wantErr, err.Error())
			}
		})
	}
}

func TestCreateAdminWithWorkspace_ValidEmailReachesDBCheck(t *testing.T) {
	// A valid email + valid password should pass all validation and fail at the DB guard (nil db).
	err := CreateAdminWithWorkspace(nil, nil, "admin@example.com", "SecurePass123!")
	if err == nil {
		t.Fatal("expected error from nil db, got nil")
	}
	if strings.Contains(err.Error(), "email") || strings.Contains(err.Error(), "password") {
		t.Errorf("validation should have passed; got validation error: %v", err)
	}
	// Must fail at db nil-guard, not at bcrypt or later
	if !strings.Contains(err.Error(), "database") {
		t.Errorf("expected db-related error, got: %v", err)
	}
}

func TestCreateAdminWithWorkspace_PasswordTooShort(t *testing.T) {
	err := CreateAdminWithWorkspace(nil, nil, "admin@example.com", "short")
	if err == nil {
		t.Fatal("expected error for short password, got nil")
	}
	if !strings.Contains(err.Error(), "12") {
		t.Errorf("expected error to mention '12', got: %v", err)
	}
}

func TestCreateAdminWithWorkspace_PasswordAtMinLength(t *testing.T) {
	// Exactly 12 chars — should pass validation, fail at nil DB guard
	err := CreateAdminWithWorkspace(nil, nil, "admin@example.com", "ExactlyTwelve!")
	if err == nil {
		t.Fatal("expected db error, got nil")
	}
	if strings.Contains(err.Error(), "password") {
		t.Errorf("12-char password should pass validation, got: %v", err)
	}
}

func TestResetAdminPassword_Validation(t *testing.T) {
	tests := []struct {
		name     string
		email    string
		password string
		wantErr  string
	}{
		{"empty email", "", "ValidPass123!", "email is required"},
		{"short password", "a@b.com", "tooshort", "12"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := ResetAdminPassword(nil, nil, tc.email, tc.password)
			if err == nil {
				t.Fatalf("expected error containing %q, got nil", tc.wantErr)
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Errorf("expected %q in error, got: %v", tc.wantErr, err)
			}
		})
	}
}

func TestResetAdminPassword_ValidInputsReachDB(t *testing.T) {
	// Valid inputs must fail at DB guard, not at validation
	err := ResetAdminPassword(nil, nil, "a@b.com", "ValidPass123456!")
	if err == nil {
		t.Fatal("expected db error, got nil")
	}
	if strings.Contains(err.Error(), "email") || strings.Contains(err.Error(), "password") {
		t.Errorf("valid inputs should pass validation, got: %v", err)
	}
}

func TestMinAdminPassword_Constant(t *testing.T) {
	if MinAdminPassword != 12 {
		t.Errorf("MinAdminPassword = %d, want 12", MinAdminPassword)
	}
}
