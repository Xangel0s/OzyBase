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

// InjectUserContext sets local variables in the current transaction for RLS policies to use.
func (db *DB) InjectUserContext(ctx context.Context, rls RLSContext) error {
	_, err := db.Pool.Exec(ctx,
		"SET LOCAL request.jwt.claim.sub = $1; SET LOCAL request.jwt.claim.email = $2; SET LOCAL request.jwt.claim.roles = $3; SET LOCAL request.jwt.claim.is_admin = $4",
		rls.UserID, rls.Email, strings.Join(rls.Roles, ","), rls.IsAdmin,
	)
	return err
}

// WithTransactionAndRLS wraps a query in a transaction that injects RLS context.
// If RLS context is found in the context, it's injected automatically.
func (db *DB) WithTransactionAndRLS(ctx context.Context, fn func(tx pgx.Tx) error) error {
	rls, ok := FromContext(ctx)

	return pgx.BeginFunc(ctx, db.Pool, func(tx pgx.Tx) error {
		if ok {
			_, err := tx.Exec(ctx,
				"SET LOCAL request.jwt.claim.sub = $1; SET LOCAL request.jwt.claim.email = $2; SET LOCAL request.jwt.claim.roles = $3; SET LOCAL request.jwt.claim.is_admin = $4",
				rls.UserID, rls.Email, strings.Join(rls.Roles, ","), rls.IsAdmin,
			)
			if err != nil {
				return err
			}
		}
		return fn(tx)
	})
}
