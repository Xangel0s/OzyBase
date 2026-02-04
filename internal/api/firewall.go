package api

import (
	"context"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
)

type IPRule struct {
	ID        string     `json:"id"`
	IPAddress string     `json:"ip_address"`
	RuleType  string     `json:"rule_type"`
	Reason    string     `json:"reason"`
	ExpiresAt *time.Time `json:"expires_at"`
	CreatedAt time.Time  `json:"created_at"`
}

// FirewallMiddleware checks every request against the IP blacklist/whitelist
func (h *Handler) FirewallMiddleware() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			ip := c.RealIP()

			ctx, cancel := context.WithTimeout(c.Request().Context(), 2*time.Second)
			defer cancel()

			var ruleType string
			var expiresAt *time.Time

			err := h.DB.Pool.QueryRow(ctx, `
				SELECT rule_type, expires_at 
				FROM _v_ip_rules 
				WHERE ip_address = $1
			`, ip).Scan(&ruleType, &expiresAt)

			if err != nil {
				// No rule found (or DB error), proceed normally
				return next(c)
			}

			// Rule found - check expiration
			if expiresAt != nil && expiresAt.Before(time.Now()) {
				// Expired, allow proceed
				return next(c)
			}

			if ruleType == "BLOCK" {
				return c.JSON(http.StatusForbidden, map[string]string{
					"error": "Access denied by firewall policy",
					"code":  "IP_BLOCKED",
				})
			}

			// If ALLOW or any other positive rule, proceed
			return next(c)
		}
	}
}

// --- API Handlers for Managing Rules ---

func (h *Handler) ListIPRules(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	rows, err := h.DB.Pool.Query(ctx, "SELECT id, ip_address, rule_type, reason, expires_at, created_at FROM _v_ip_rules ORDER BY created_at DESC")
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	var rules []IPRule
	for rows.Next() {
		var r IPRule
		if err := rows.Scan(&r.ID, &r.IPAddress, &r.RuleType, &r.Reason, &r.ExpiresAt, &r.CreatedAt); err != nil {
			continue
		}
		rules = append(rules, r)
	}

	if err := rows.Err(); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, rules)
}

func (h *Handler) CreateIPRule(c echo.Context) error {
	var req struct {
		IPAddress string `json:"ip_address"`
		RuleType  string `json:"rule_type"` // ALLOW or BLOCK
		Reason    string `json:"reason"`
		Duration  int    `json:"duration_hours,omitempty"` // 0 = permanent
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	var expiresAt *time.Time
	if req.Duration > 0 {
		t := time.Now().Add(time.Duration(req.Duration) * time.Hour)
		expiresAt = &t
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	_, err := h.DB.Pool.Exec(ctx, `
		INSERT INTO _v_ip_rules (ip_address, rule_type, reason, expires_at, created_by)
		VALUES ($1, $2, $3, $4, 'admin')
		ON CONFLICT (ip_address) DO UPDATE 
		SET rule_type = $2, reason = $3, expires_at = $4
	`, req.IPAddress, req.RuleType, req.Reason, expiresAt)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusCreated, map[string]string{"status": "rule_applied"})
}

func (h *Handler) DeleteIPRule(c echo.Context) error {
	id := c.Param("id")
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	_, err := h.DB.Pool.Exec(ctx, "DELETE FROM _v_ip_rules WHERE id = $1", id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.NoContent(http.StatusOK)
}
