package data

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5"
)

// RLSContext holds security-related information to be injected into Postgres
type RLSContext struct {
	UserID  string
	Email   string
	Roles   []string
	IsAdmin bool
}

type rlsKey struct{}

// NewContext returns a new context with the RLS information
func NewContext(ctx context.Context, rls RLSContext) context.Context {
	return context.WithValue(ctx, rlsKey{}, rls)
}

// FromContext retrieves RLS information from the context
func FromContext(ctx context.Context) (RLSContext, bool) {
	rls, ok := ctx.Value(rlsKey{}).(RLSContext)
	return rls, ok
}

func primaryRole(roles []string) string {
	for _, role := range roles {
		role = strings.TrimSpace(role)
		if role != "" {
			return role
		}
	}
	return ""
}

// InjectUserContext sets local variables in the current transaction for RLS policies to use.
func (db *DB) InjectUserContext(ctx context.Context, rls RLSContext) error {
	isAdminStr := "false"
	if rls.IsAdmin {
		isAdminStr = "true"
	}
	_, err := db.Pool.Exec(ctx,
		"SELECT set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.email', $2, true), set_config('request.jwt.claim.role', $3, true), set_config('request.jwt.claim.roles', $4, true), set_config('request.jwt.claim.is_admin', $5, true)",
		rls.UserID, rls.Email, primaryRole(rls.Roles), strings.Join(rls.Roles, ","), isAdminStr,
	)
	return err
}

// WithTransactionAndRLS wraps a query in a transaction that injects RLS context.
// If RLS context is found in the context, it's injected automatically.
func (db *DB) WithTransactionAndRLS(ctx context.Context, fn func(tx pgx.Tx) error) error {
	rls, ok := FromContext(ctx)

	return pgx.BeginFunc(ctx, db.Pool, func(tx pgx.Tx) error {
		if ok {
			isAdminStr := "false"
			if rls.IsAdmin {
				isAdminStr = "true"
			}
			_, err := tx.Exec(ctx,
				"SELECT set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.email', $2, true), set_config('request.jwt.claim.role', $3, true), set_config('request.jwt.claim.roles', $4, true), set_config('request.jwt.claim.is_admin', $5, true)",
				rls.UserID, rls.Email, primaryRole(rls.Roles), strings.Join(rls.Roles, ","), isAdminStr,
			)
			if err != nil {
				return err
			}
		}
		return fn(tx)
	})
}
