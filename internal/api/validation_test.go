package api

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestValidatePasswordSimple(t *testing.T) {
	tests := []struct {
		name     string
		password string
		wantErr  bool
	}{
		{"Valid password 8 chars", "password", false},
		{"Valid password long", "thisisaverylongpassword", false},
		{"Too short 7 chars", "passwor", true},
		{"Too short 1 char", "a", true},
		{"Empty password", "", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidatePasswordSimple(tt.password)
			if tt.wantErr {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestValidatePasswordComplexity(t *testing.T) {
	policy := DefaultPasswordPolicy()

	tests := []struct {
		name     string
		password string
		wantErr  bool
	}{
		{"Valid complex password", "Password1!", false},
		{"Valid with all requirements", "MyP@ssw0rd", false},
		{"Missing uppercase", "password1!", true},
		{"Missing lowercase", "PASSWORD1!", true},
		{"Missing number", "Password!!", true},
		{"Missing special char", "Password11", true},
		{"Too short", "Pass1!", true},
		{"Only lowercase", "password", true},
		{"Only uppercase", "PASSWORD", true},
		{"Only numbers", "12345678", true},
		{"Empty", "", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidatePasswordComplexity(tt.password, policy)
			if tt.wantErr {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestValidateEmail(t *testing.T) {
	tests := []struct {
		name    string
		email   string
		wantErr bool
	}{
		{"Valid simple email", "test@example.com", false},
		{"Valid with subdomain", "test@mail.example.com", false},
		{"Valid with numbers", "test123@example.com", false},
		{"Valid with dots", "test.user@example.com", false},
		{"Valid with plus", "test+tag@example.com", false},
		{"Valid with hyphen", "test-user@example.com", false},
		{"Invalid - no @", "testexample.com", true},
		{"Invalid - no domain", "test@", true},
		{"Invalid - no TLD", "test@example", true},
		{"Invalid - double @", "test@@example.com", true},
		{"Invalid - spaces", "test @example.com", true},
		{"Invalid - special chars", "test<>@example.com", true},
		{"Empty", "", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateEmail(tt.email)
			if tt.wantErr {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestIsCommonPassword(t *testing.T) {
	tests := []struct {
		name     string
		password string
		isCommon bool
	}{
		{"Common - password", "password", true},
		{"Common - 123456", "123456", true},
		{"Common - qwerty", "qwerty", true},
		{"Common - uppercase", "PASSWORD", true}, // Should be case-insensitive
		{"Not common", "MyUnique@Pass123", false},
		{"Not common random", "xK9#mP2$vL", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := IsCommonPassword(tt.password)
			assert.Equal(t, tt.isCommon, result)
		})
	}
}

func TestHasUppercase(t *testing.T) {
	assert.True(t, hasUppercase("Hello"))
	assert.True(t, hasUppercase("helloWorld"))
	assert.False(t, hasUppercase("hello"))
	assert.False(t, hasUppercase("123"))
	assert.False(t, hasUppercase(""))
}

func TestHasLowercase(t *testing.T) {
	assert.True(t, hasLowercase("Hello"))
	assert.True(t, hasLowercase("HELLOworld"))
	assert.False(t, hasLowercase("HELLO"))
	assert.False(t, hasLowercase("123"))
	assert.False(t, hasLowercase(""))
}

func TestHasNumber(t *testing.T) {
	assert.True(t, hasNumber("Hello1"))
	assert.True(t, hasNumber("123"))
	assert.False(t, hasNumber("Hello"))
	assert.False(t, hasNumber(""))
}

func TestHasSpecialChar(t *testing.T) {
	assert.True(t, hasSpecialChar("Hello!"))
	assert.True(t, hasSpecialChar("pass@word"))
	assert.True(t, hasSpecialChar("test#123"))
	assert.False(t, hasSpecialChar("Hello123"))
	assert.False(t, hasSpecialChar(""))
}

func TestDefaultPasswordPolicy(t *testing.T) {
	policy := DefaultPasswordPolicy()

	assert.Equal(t, 8, policy.MinLength)
	assert.True(t, policy.RequireUppercase)
	assert.True(t, policy.RequireLowercase)
	assert.True(t, policy.RequireNumber)
	assert.True(t, policy.RequireSpecial)
}
