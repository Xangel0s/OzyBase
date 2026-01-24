package core

import "time"

// User represents a system user or admin
type User struct {
	ID           string    `json:"id"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"` // Never return in JSON
	Role         string    `json:"role"` // 'admin' or 'user'
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}
