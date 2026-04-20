package mailer

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/mail"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/Xangel0s/OzyBase/internal/data"
)

const (
	SMTPSecretHostKey     = "ozy.smtp.host"
	SMTPSecretPortKey     = "ozy.smtp.port"
	SMTPSecretUsernameKey = "ozy.smtp.username"
	SMTPSecretPasswordKey = "ozy.smtp.password"
	SMTPSecretFromKey     = "ozy.smtp.from"
)

var managedSMTPSecretKeys = []string{
	SMTPSecretHostKey,
	SMTPSecretPortKey,
	SMTPSecretUsernameKey,
	SMTPSecretPasswordKey,
	SMTPSecretFromKey,
}

type SMTPConfig struct {
	Host     string
	Port     string
	Username string
	Password string
	From     string
}

type SMTPConfigSource string

const (
	SMTPConfigSourceConsole     SMTPConfigSource = "console"
	SMTPConfigSourceEnvironment SMTPConfigSource = "environment"
	SMTPConfigSourceDatabase    SMTPConfigSource = "database"
)

func SMTPConfigFromEnvironment() SMTPConfig {
	return SMTPConfig{
		Host:     strings.TrimSpace(os.Getenv("SMTP_HOST")),
		Port:     strings.TrimSpace(os.Getenv("SMTP_PORT")),
		Username: strings.TrimSpace(os.Getenv("SMTP_USER")),
		Password: strings.TrimSpace(os.Getenv("SMTP_PASSWORD")),
		From:     strings.TrimSpace(os.Getenv("SMTP_FROM")),
	}.normalized()
}

func (c SMTPConfig) normalized() SMTPConfig {
	normalized := SMTPConfig{
		Host:     strings.TrimSpace(c.Host),
		Port:     strings.TrimSpace(c.Port),
		Username: strings.TrimSpace(c.Username),
		Password: strings.TrimSpace(c.Password),
		From:     strings.TrimSpace(c.From),
	}
	if normalized.Host != "" && normalized.Port == "" {
		normalized.Port = "587"
	}
	return normalized
}

func (c SMTPConfig) Configured() bool {
	normalized := c.normalized()
	return normalized.Host != "" && normalized.Port != "" && normalized.From != ""
}

func (c SMTPConfig) Validate() error {
	normalized := c.normalized()
	if normalized.Host == "" {
		return errors.New("smtp host is required")
	}
	if normalized.Port == "" {
		return errors.New("smtp port is required")
	}
	port, err := strconv.Atoi(normalized.Port)
	if err != nil || port < 1 || port > 65535 {
		return errors.New("smtp port must be between 1 and 65535")
	}
	if normalized.From == "" {
		return errors.New("from address is required")
	}
	if _, err := mail.ParseAddress(normalized.From); err != nil {
		return errors.New("from address is invalid")
	}
	return nil
}

func IsManagedSMTPSecretKey(key string) bool {
	normalized := strings.ToLower(strings.TrimSpace(key))
	return strings.HasPrefix(normalized, "ozy.smtp.")
}

func LoadSMTPConfig(ctx context.Context, db *data.DB, fallback SMTPConfig) (SMTPConfig, SMTPConfigSource, error) {
	resolved := fallback.normalized()
	source := SMTPConfigSourceConsole
	if resolved.Host != "" || resolved.Port != "" || resolved.Username != "" || resolved.Password != "" || resolved.From != "" {
		source = SMTPConfigSourceEnvironment
	}
	if db == nil {
		return resolved, source, nil
	}

	queryCtx, cancel := withSMTPTimeout(ctx)
	defer cancel()

	rows, err := db.Pool.Query(queryCtx, `
		SELECT key, value
		FROM _v_secrets
		WHERE key = ANY($1)
	`, managedSMTPSecretKeys)
	if err != nil {
		return resolved, source, err
	}
	defer rows.Close()

	values := map[string]string{}
	for rows.Next() {
		var key string
		var value string
		if scanErr := rows.Scan(&key, &value); scanErr != nil {
			return resolved, source, scanErr
		}
		values[key] = value
	}
	if rowsErr := rows.Err(); rowsErr != nil {
		return resolved, source, rowsErr
	}
	if len(values) == 0 {
		return resolved, source, nil
	}

	if value, ok := values[SMTPSecretHostKey]; ok {
		resolved.Host = strings.TrimSpace(value)
	}
	if value, ok := values[SMTPSecretPortKey]; ok {
		resolved.Port = strings.TrimSpace(value)
	}
	if value, ok := values[SMTPSecretUsernameKey]; ok {
		resolved.Username = strings.TrimSpace(value)
	}
	if value, ok := values[SMTPSecretPasswordKey]; ok {
		resolved.Password = strings.TrimSpace(value)
	}
	if value, ok := values[SMTPSecretFromKey]; ok {
		resolved.From = strings.TrimSpace(value)
	}

	return resolved.normalized(), SMTPConfigSourceDatabase, nil
}

func SaveSMTPConfig(ctx context.Context, db *data.DB, cfg SMTPConfig, preservePassword, clearPassword bool) error {
	if db == nil {
		return errors.New("database is unavailable")
	}

	normalized := cfg.normalized()
	if err := normalized.Validate(); err != nil {
		return err
	}

	queryCtx, cancel := withSMTPTimeout(ctx)
	defer cancel()

	tx, err := db.Pool.Begin(queryCtx)
	if err != nil {
		return fmt.Errorf("begin smtp config transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(queryCtx) }()

	upserts := []struct {
		key   string
		value string
	}{
		{key: SMTPSecretHostKey, value: normalized.Host},
		{key: SMTPSecretPortKey, value: normalized.Port},
		{key: SMTPSecretUsernameKey, value: normalized.Username},
		{key: SMTPSecretFromKey, value: normalized.From},
	}
	for _, item := range upserts {
		if _, err := tx.Exec(queryCtx, `
			INSERT INTO _v_secrets (key, value, description)
			VALUES ($1, $2, $3)
			ON CONFLICT (key) DO UPDATE
			SET value = EXCLUDED.value,
			    description = EXCLUDED.description
		`, item.key, item.value, managedSMTPSecretDescription(item.key)); err != nil {
			return fmt.Errorf("save smtp setting %s: %w", item.key, err)
		}
	}

	switch {
	case clearPassword:
		if _, err := tx.Exec(queryCtx, `
			INSERT INTO _v_secrets (key, value, description)
			VALUES ($1, '', $2)
			ON CONFLICT (key) DO UPDATE
			SET value = EXCLUDED.value,
			    description = EXCLUDED.description
		`, SMTPSecretPasswordKey, managedSMTPSecretDescription(SMTPSecretPasswordKey)); err != nil {
			return fmt.Errorf("clear smtp password: %w", err)
		}
	case !preservePassword:
		if _, err := tx.Exec(queryCtx, `
			INSERT INTO _v_secrets (key, value, description)
			VALUES ($1, $2, $3)
			ON CONFLICT (key) DO UPDATE
			SET value = EXCLUDED.value,
			    description = EXCLUDED.description
		`, SMTPSecretPasswordKey, normalized.Password, managedSMTPSecretDescription(SMTPSecretPasswordKey)); err != nil {
			return fmt.Errorf("save smtp password: %w", err)
		}
	}

	if err := tx.Commit(queryCtx); err != nil {
		return fmt.Errorf("commit smtp config transaction: %w", err)
	}
	return nil
}

func NewRuntimeMailer(db *data.DB, fallback SMTPConfig) Mailer {
	return &RuntimeMailer{
		db:       db,
		fallback: fallback.normalized(),
	}
}

type RuntimeMailer struct {
	db       *data.DB
	fallback SMTPConfig
}

func (m *RuntimeMailer) resolveSender() Mailer {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	cfg, source, err := LoadSMTPConfig(ctx, m.db, m.fallback)
	if err != nil {
		log.Printf("runtime_smtp_resolver_error source=%s error=%v", source, err)
	}
	if cfg.Configured() {
		return NewSMTPMailer(cfg.Host, cfg.Port, cfg.Username, cfg.Password, cfg.From)
	}
	return NewLogMailer()
}

func (m *RuntimeMailer) Send(to, subject, body string) error {
	return m.resolveSender().Send(to, subject, body)
}

func (m *RuntimeMailer) SendVerificationEmail(to, token string) error {
	return m.resolveSender().SendVerificationEmail(to, token)
}

func (m *RuntimeMailer) SendPasswordResetEmail(to, token string) error {
	return m.resolveSender().SendPasswordResetEmail(to, token)
}

func (m *RuntimeMailer) SendSecurityAlert(to, alertType, details string) error {
	return m.resolveSender().SendSecurityAlert(to, alertType, details)
}

func (m *RuntimeMailer) SendWorkspaceInvite(to, workspaceName, inviterEmail string) error {
	return m.resolveSender().SendWorkspaceInvite(to, workspaceName, inviterEmail)
}

func withSMTPTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	if ctx == nil {
		return context.WithTimeout(context.Background(), 3*time.Second)
	}
	if _, hasDeadline := ctx.Deadline(); hasDeadline {
		return ctx, func() {}
	}
	return context.WithTimeout(ctx, 3*time.Second)
}

func managedSMTPSecretDescription(key string) string {
	switch key {
	case SMTPSecretHostKey:
		return "Managed SMTP host for transactional mail"
	case SMTPSecretPortKey:
		return "Managed SMTP port for transactional mail"
	case SMTPSecretUsernameKey:
		return "Managed SMTP username for transactional mail"
	case SMTPSecretPasswordKey:
		return "Managed SMTP password for transactional mail"
	case SMTPSecretFromKey:
		return "Managed SMTP from address for transactional mail"
	default:
		return "Managed SMTP setting"
	}
}
