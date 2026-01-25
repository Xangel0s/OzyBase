package api

import (
	"errors"
	"regexp"
	"strings"
	"unicode"
)

// PasswordPolicy defines the requirements for a valid password
type PasswordPolicy struct {
	MinLength        int
	RequireUppercase bool
	RequireLowercase bool
	RequireNumber    bool
	RequireSpecial   bool
}

// DefaultPasswordPolicy returns the default password requirements
func DefaultPasswordPolicy() PasswordPolicy {
	return PasswordPolicy{
		MinLength:        8,
		RequireUppercase: true,
		RequireLowercase: true,
		RequireNumber:    true,
		RequireSpecial:   true,
	}
}

// ValidationError represents a validation failure with details
type ValidationError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

func (e ValidationError) Error() string {
	return e.Message
}

// ValidatePasswordComplexity validates password against the policy
func ValidatePasswordComplexity(password string, policy PasswordPolicy) error {
	var issues []string

	if len(password) < policy.MinLength {
		issues = append(issues, "must be at least 8 characters")
	}

	if policy.RequireUppercase && !hasUppercase(password) {
		issues = append(issues, "must contain at least one uppercase letter")
	}

	if policy.RequireLowercase && !hasLowercase(password) {
		issues = append(issues, "must contain at least one lowercase letter")
	}

	if policy.RequireNumber && !hasNumber(password) {
		issues = append(issues, "must contain at least one number")
	}

	if policy.RequireSpecial && !hasSpecialChar(password) {
		issues = append(issues, "must contain at least one special character (!@#$%^&*)")
	}

	if len(issues) > 0 {
		return errors.New("password " + strings.Join(issues, ", "))
	}

	return nil
}

// ValidatePasswordSimple performs basic password validation (minimum length only)
// Use this for less strict environments, ValidatePasswordComplexity for production
func ValidatePasswordSimple(password string) error {
	if len(password) < 8 {
		return errors.New("password must be at least 8 characters long")
	}
	return nil
}

// ValidateEmail validates email format using regex for more precise control
func ValidateEmail(email string) error {
	// RFC 5322 simplified pattern
	emailPattern := regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)
	
	if !emailPattern.MatchString(email) {
		return errors.New("invalid email format")
	}

	// Additional checks
	if len(email) > 254 {
		return errors.New("email address too long")
	}

	parts := strings.Split(email, "@")
	if len(parts[0]) > 64 {
		return errors.New("email local part too long")
	}

	return nil
}

// IsCommonPassword checks if the password is in a list of common passwords
func IsCommonPassword(password string) bool {
	commonPasswords := []string{
		"password", "123456", "12345678", "qwerty", "abc123",
		"monkey", "1234567", "letmein", "trustno1", "dragon",
		"baseball", "iloveyou", "master", "sunshine", "ashley",
		"bailey", "shadow", "123123", "654321", "superman",
		"qazwsx", "michael", "football", "password1", "password123",
	}

	lowerPass := strings.ToLower(password)
	for _, common := range commonPasswords {
		if lowerPass == common {
			return true
		}
	}
	return false
}

// Helper functions
func hasUppercase(s string) bool {
	for _, r := range s {
		if unicode.IsUpper(r) {
			return true
		}
	}
	return false
}

func hasLowercase(s string) bool {
	for _, r := range s {
		if unicode.IsLower(r) {
			return true
		}
	}
	return false
}

func hasNumber(s string) bool {
	for _, r := range s {
		if unicode.IsDigit(r) {
			return true
		}
	}
	return false
}

func hasSpecialChar(s string) bool {
	specialChars := "!@#$%^&*()_+-=[]{}|;':\",./<>?"
	for _, r := range s {
		if strings.ContainsRune(specialChars, r) {
			return true
		}
	}
	return false
}
