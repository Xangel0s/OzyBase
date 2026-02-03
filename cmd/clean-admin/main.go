package main

import (
	"context"
	"fmt"
	"os"

	"github.com/jackc/pgx/v5"
	"github.com/joho/godotenv"
)

func main() {
	if err := godotenv.Load(".env"); err != nil {
		fmt.Println("Warning: .env not found (trying default connection)")
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://postgres:postgres@localhost:5432/ozybase_db"
	}

	conn, err := pgx.Connect(context.Background(), dbURL)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Unable to connect to database: %v\n", err)
		os.Exit(1)
	}
	defer conn.Close(context.Background())

	_, err = conn.Exec(context.Background(), "DELETE FROM _v_users WHERE role = 'admin'")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Check failed: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("✅ All admins deleted. System is now uninitialized.")
}
