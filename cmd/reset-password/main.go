package main

import (
	"context"
	"fmt"
	"log"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

func main() {
	dbURL := "postgres://ozyuser:ozypassword123@localhost:5432/Ozydb?sslmode=disable"
	ctx := context.Background()

	db, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		log.Fatalf("Unable to connect to database: %v", err)
	}
	defer db.Close()

	email := "system@ozybase.local"
	newPassword := "admin123"

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(newPassword), 12)
	if err != nil {
		log.Fatalf("Error hashing password: %v", err)
	}

	// Update or Insert admin user
	// Check if admin exists
	var count int
	err = db.QueryRow(ctx, "SELECT COUNT(*) FROM _v_users WHERE email = $1", email).Scan(&count)
	if err != nil {
		log.Fatalf("Error checking user: %v", err)
	}

	if count > 0 {
		_, err = db.Exec(ctx, "UPDATE _v_users SET password_hash = $1 WHERE email = $2", string(hashedPassword), email)
		if err != nil {
			log.Fatalf("Error updating password: %v", err)
		}
		fmt.Printf("✅ Updated password for %s\n", email)
	} else {
		_, err = db.Exec(ctx, "INSERT INTO _v_users (email, password_hash, role) VALUES ($1, $2, 'admin')", email, string(hashedPassword))
		if err != nil {
			log.Fatalf("Error creating user: %v", err)
		}
		fmt.Printf("✅ Created admin user %s\n", email)
	}
}
