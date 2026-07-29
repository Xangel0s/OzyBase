package auth

import (
	"bufio"
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log"
	"math/big"
	"net/mail"
	"os"
	"strings"

	"github.com/Xangel0s/OzyBase/internal/core"
	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/bcrypt"
)

const (
	passwordChars    = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*"
	MinAdminPassword = 12
)

func generateRandomPassword(length int) string {
	result := make([]byte, length)
	for i := range result {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(passwordChars))))
		result[i] = passwordChars[n.Int64()]
	}
	return string(result)
}

// EnsureAdminUser creates an admin from ENV vars if none exists. Called at server startup.
func EnsureAdminUser(db *data.DB) {
	ctx := context.Background()

	var count int
	err := db.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM _v_users WHERE role = 'admin'").Scan(&count)
	if err != nil {
		log.Printf("warning: error checking for admin user: %v", err)
		return
	}

	if count > 0 {
		return
	}

	email := os.Getenv("INITIAL_ADMIN_EMAIL")
	if email == "" {
		appDomain := strings.TrimSpace(os.Getenv("APP_DOMAIN"))
		if appDomain == "" || appDomain == "localhost" || strings.HasPrefix(appDomain, "localhost:") {
			email = "system@ozybase.local"
		} else {
			email = "admin@" + appDomain
		}
	}

	password := os.Getenv("INITIAL_ADMIN_PASSWORD")
	isGenerated := false
	if password == "" {
		password = generateRandomPassword(32)
		isGenerated = true
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		log.Printf("warning: error hashing admin password: %v", err)
		return
	}

	commandTag, err := db.Pool.Exec(ctx, `
		INSERT INTO _v_users (email, password_hash, role, is_verified)
		VALUES ($1, $2, $3, TRUE)
		ON CONFLICT (email) DO NOTHING
	`, email, string(hashedPassword), "admin")
	if err != nil {
		log.Printf("warning: error creating initial admin user: %v", err)
		return
	}
	if commandTag.RowsAffected() == 0 {
		return
	}

	// Ensure default workspace is created and collections are bound
	_, _ = db.EnsureDefaultWorkspace(ctx)

	fmt.Println("\n*************************************************")
	fmt.Println("*  OZYBASE INITIAL ADMIN CREDENTIALS            *")
	fmt.Printf("*  Email: %-37s *\n", email)
	if isGenerated {
		fmt.Printf("*  Password: %-34s *\n", password)
		fmt.Println("*  (One-time use log: Save it now!)             *")
	} else {
		fmt.Println("*  Password: [FROM ENVIRONMENT VARIABLE]        *")
	}
	fmt.Println("*  Please change this after your first login!   *")
	fmt.Println("*************************************************")
}

// CreateAdminWithWorkspace creates an admin user + a "Primary Project" workspace atomically.
// Used by the `admin create` CLI command. Returns an error if an admin already exists.
func CreateAdminWithWorkspace(ctx context.Context, db *data.DB, email, password string) error {
	email = strings.TrimSpace(strings.ToLower(email))
	if email == "" {
		return errors.New("email is required")
	}
	if _, err := mail.ParseAddress(email); err != nil {
		return errors.New("invalid email format")
	}
	if len(password) < MinAdminPassword {
		return fmt.Errorf("password must be at least %d characters", MinAdminPassword)
	}

	if db == nil || db.Pool == nil {
		return fmt.Errorf("database connection is required")
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	// Fast-path: check without a transaction first to give a clear error message early
	var existingCount int
	if err := db.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM _v_users WHERE role = 'admin'").Scan(&existingCount); err == nil && existingCount > 0 {
		rows, _ := db.Pool.Query(ctx, "SELECT email FROM _v_users WHERE role = 'admin' ORDER BY created_at LIMIT 5")
		var existing []string
		if rows != nil {
			for rows.Next() {
				var e string
				if err := rows.Scan(&e); err == nil {
					existing = append(existing, e)
				}
			}
			rows.Close()
		}
		if len(existing) > 0 {
			return fmt.Errorf("an admin account already exists (%s). Use 'admin reset --email %s' to change the password, or 'admin delete-all' to reset", strings.Join(existing, ", "), existing[0])
		}
		return errors.New("an admin account already exists. Use 'admin reset' to change the password")
	}

	tx, err := db.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to start transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Use a session-level advisory lock to serialize concurrent admin creation
	// This avoids LOCK TABLE which is incompatible with pgx DescribeExec mode.
	const adminCreateLockKey = int64(20260101)
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", adminCreateLockKey); err != nil {
		return fmt.Errorf("failed to acquire creation lock: %w", err)
	}

	// Re-check inside the lock to guard against races
	var count int
	if err := tx.QueryRow(ctx, "SELECT COUNT(*) FROM _v_users WHERE role = 'admin'").Scan(&count); err != nil {
		return fmt.Errorf("failed to check existing admins: %w", err)
	}
	if count > 0 {
		return errors.New("an admin account already exists. Use 'admin reset' to change the password")
	}

	var userID string
	err = tx.QueryRow(ctx, `
		INSERT INTO _v_users (email, password_hash, role, is_verified)
		VALUES ($1, $2, 'admin', TRUE)
		RETURNING id
	`, email, string(hashed)).Scan(&userID)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return errors.New("an admin account already exists. Use 'admin reset' to change the password")
		}
		return fmt.Errorf("failed to create admin: %w", err)
	}

	wsID, err := core.CreateWorkspaceTx(ctx, tx, "Primary Project", userID)
	if err != nil {
		return fmt.Errorf("failed to create workspace: %w", err)
	}

	// Commit the core transaction (user + workspace) first.
	// The _v_collections bind is optional and must happen OUTSIDE this tx —
	// any statement error inside a PostgreSQL transaction sets it to ABORTED state,
	// making the subsequent COMMIT always fail even if the Go error is ignored.
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to finalize admin creation: %w", err)
	}

	// Non-fatal post-commit: bind any orphaned collections to the new workspace.
	// Runs on a fresh pool connection, completely isolated from the tx above.
	_, _ = db.Pool.Exec(ctx, `
		UPDATE _v_collections
		SET workspace_id = $1
		WHERE workspace_id IS NULL OR workspace_id = '' OR workspace_id NOT IN (SELECT id::text FROM _v_workspaces)
	`, wsID.ID)

	return nil
}

// ResetAdminPassword updates the password for an existing admin user.
func ResetAdminPassword(ctx context.Context, db *data.DB, email, password string) error {
	email = strings.TrimSpace(strings.ToLower(email))
	if email == "" {
		return errors.New("email is required")
	}
	if len(password) < MinAdminPassword {
		return fmt.Errorf("password must be at least %d characters", MinAdminPassword)
	}
	if db == nil || db.Pool == nil {
		return fmt.Errorf("database connection is required")
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return fmt.Errorf("failed to hash password: %w", err)
	}

	tag, err := db.Pool.Exec(ctx,
		"UPDATE _v_users SET password_hash = $1 WHERE LOWER(email) = LOWER($2) AND role = 'admin'",
		string(hashed), email,
	)
	if err != nil {
		return fmt.Errorf("failed to update password: %w", err)
	}
	if tag.RowsAffected() == 0 {
		rows, _ := db.Pool.Query(ctx, "SELECT email FROM _v_users WHERE role = 'admin' ORDER BY created_at LIMIT 5")
		var existing []string
		if rows != nil {
			for rows.Next() {
				var e string
				if err := rows.Scan(&e); err == nil {
					existing = append(existing, e)
				}
			}
			rows.Close()
		}
		if len(existing) > 0 {
			return fmt.Errorf("no admin found with email %q. Existing admin email(s): %s", email, strings.Join(existing, ", "))
		}
		return fmt.Errorf("no admin found with email %q. No admin accounts exist in database — run 'ozybase admin create' to create one", email)
	}
	return nil
}

// DeleteAllAdmins removes every admin user from the database.
func DeleteAllAdmins(ctx context.Context, db *data.DB) (int64, error) {
	tag, err := db.Pool.Exec(ctx, "DELETE FROM _v_users WHERE role = 'admin'")
	if err != nil {
		return 0, fmt.Errorf("failed to delete admins: %w", err)
	}
	return tag.RowsAffected(), nil
}

// PromptLine reads a single line from stdin with an optional prompt label.
func PromptLine(prompt string) string {
	fmt.Print(prompt)
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Scan()
	return strings.TrimSpace(scanner.Text())
}
