package api

import (
	"testing"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
)

func TestExtractUserIDFromClaims(t *testing.T) {
	t.Run("prefers user_id", func(t *testing.T) {
		claims := jwt.MapClaims{"user_id": "user-1", "sub": "user-2"}
		assert.Equal(t, "user-1", extractUserIDFromClaims(claims))
	})

	t.Run("falls back to sub", func(t *testing.T) {
		claims := jwt.MapClaims{"sub": "user-2"}
		assert.Equal(t, "user-2", extractUserIDFromClaims(claims))
	})

	t.Run("returns empty when missing", func(t *testing.T) {
		claims := jwt.MapClaims{"role": "admin"}
		assert.Equal(t, "", extractUserIDFromClaims(claims))
	})
}
