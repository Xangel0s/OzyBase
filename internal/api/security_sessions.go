package api

import (
	"context"
	"net/http"
	"net/netip"
	"slices"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
)

type terminateSessionsByIPRequest struct {
	IP     string `json:"ip"`
	DryRun bool   `json:"dry_run"`
}

type terminateSessionsByCountryRequest struct {
	CountryCode string `json:"country_code"`
	DryRun      bool   `json:"dry_run"`
}

func normalizeSessionTerminationIP(raw string) (string, error) {
	ip, err := netip.ParseAddr(strings.TrimSpace(raw))
	if err != nil {
		return "", err
	}
	return ip.Unmap().String(), nil
}

func normalizeCountryCode(raw string) string {
	code := strings.ToUpper(strings.TrimSpace(raw))
	if len(code) != 2 {
		return ""
	}
	for _, r := range code {
		if r < 'A' || r > 'Z' {
			return ""
		}
	}
	return code
}

func (h *Handler) resolveSessionCountryCode(ip netip.Addr) (string, error) {
	if ip.IsLoopback() {
		return "LO", nil
	}
	if h.firewallEngine == nil {
		return "", nil
	}
	return h.firewallEngine.lookupCountryCode(ip)
}

func (h *Handler) TerminateSessionsByIP(c echo.Context) error {
	var req terminateSessionsByIPRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}

	normalizedIP, err := normalizeSessionTerminationIP(req.IP)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid ip"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 12*time.Second)
	defer cancel()

	var activeSessions int64
	if err := h.DB.Pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM _v_sessions
		WHERE ip_address::text = $1
		  AND expires_at > NOW()
	`, normalizedIP).Scan(&activeSessions); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to inspect active sessions"})
	}

	if req.DryRun {
		return c.JSON(http.StatusOK, map[string]any{
			"mode":                   "targeted",
			"dry_run":                true,
			"ip":                     normalizedIP,
			"matched_sessions":       activeSessions,
			"sessions_terminated":    int64(0),
			"refresh_tokens_revoked": int64(0),
		})
	}

	tx, err := h.DB.Pool.Begin(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to start termination transaction"})
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var revokeTag interface{ RowsAffected() int64 }
	if h.DB.HasColumn(ctx, "_v_refresh_tokens", "last_ip") {
		revokeTag, err = tx.Exec(ctx, `
			UPDATE _v_refresh_tokens rt
			SET revoked_at = NOW(),
				last_used_at = COALESCE(rt.last_used_at, NOW())
			FROM _v_sessions s
			WHERE rt.session_id::text = s.id::text
			  AND rt.revoked_at IS NULL
			  AND (COALESCE(rt.last_ip::text, '') = $1 OR s.ip_address::text = $1)
		`, normalizedIP)
		if err != nil {
			revokeTag, err = tx.Exec(ctx, `
				UPDATE _v_refresh_tokens rt
				SET revoked_at = NOW(),
					last_used_at = COALESCE(rt.last_used_at, NOW())
				FROM _v_sessions s
				WHERE rt.session_id::text = s.id::text
				  AND rt.revoked_at IS NULL
				  AND s.ip_address::text = $1
			`, normalizedIP)
		}
	} else {
		revokeTag, err = tx.Exec(ctx, `
			UPDATE _v_refresh_tokens rt
			SET revoked_at = NOW(),
				last_used_at = COALESCE(rt.last_used_at, NOW())
			FROM _v_sessions s
			WHERE rt.session_id::text = s.id::text
			  AND rt.revoked_at IS NULL
			  AND s.ip_address::text = $1
		`, normalizedIP)
	}
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to revoke refresh tokens"})
	}

	deleteTag, err := tx.Exec(ctx, `
		DELETE FROM _v_sessions
		WHERE ip_address::text = $1
	`, normalizedIP)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to terminate sessions"})
	}

	if err := tx.Commit(ctx); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to commit session termination"})
	}

	return c.JSON(http.StatusOK, map[string]any{
		"mode":                   "targeted",
		"dry_run":                false,
		"ip":                     normalizedIP,
		"matched_sessions":       activeSessions,
		"sessions_terminated":    deleteTag.RowsAffected(),
		"refresh_tokens_revoked": revokeTag.RowsAffected(),
	})
}

func (h *Handler) TerminateSessionsByCountry(c echo.Context) error {
	var req terminateSessionsByCountryRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid request"})
	}

	countryCode := normalizeCountryCode(req.CountryCode)
	if countryCode == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid country_code"})
	}

	if h.firewallEngine == nil {
		return c.JSON(http.StatusServiceUnavailable, map[string]string{"error": "firewall engine unavailable"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 15*time.Second)
	defer cancel()

	type sessionRow struct {
		id string
		ip string
	}

	rows, err := h.DB.Pool.Query(ctx, `
		SELECT id::text, ip_address
		FROM _v_sessions
		WHERE expires_at > NOW()
		  AND ip_address IS NOT NULL
		  AND ip_address <> ''
	`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to inspect active sessions"})
	}
	defer rows.Close()

	targetSessionIDs := make([]string, 0, 32)
	targetIPs := make([]string, 0, 16)
	targetIPSet := map[string]struct{}{}

	for rows.Next() {
		var row sessionRow
		if err := rows.Scan(&row.id, &row.ip); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to read active sessions"})
		}

		normalizedIP, parseErr := normalizeSessionTerminationIP(row.ip)
		if parseErr != nil {
			continue
		}

		parsedIP, parseAddrErr := netip.ParseAddr(normalizedIP)
		if parseAddrErr != nil {
			continue
		}

		sessionCountry, lookupErr := h.resolveSessionCountryCode(parsedIP)
		if lookupErr != nil || sessionCountry != countryCode {
			continue
		}

		targetSessionIDs = append(targetSessionIDs, row.id)
		if _, exists := targetIPSet[normalizedIP]; !exists {
			targetIPSet[normalizedIP] = struct{}{}
			targetIPs = append(targetIPs, normalizedIP)
		}
	}
	if err := rows.Err(); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed while scanning sessions"})
	}

	slices.Sort(targetIPs)

	if req.DryRun {
		return c.JSON(http.StatusOK, map[string]any{
			"mode":                   "nuclear",
			"dry_run":                true,
			"country_code":           countryCode,
			"matched_ips":            targetIPs,
			"matched_sessions":       len(targetSessionIDs),
			"sessions_terminated":    int64(0),
			"refresh_tokens_revoked": int64(0),
		})
	}

	if len(targetSessionIDs) == 0 {
		return c.JSON(http.StatusOK, map[string]any{
			"mode":                   "nuclear",
			"dry_run":                false,
			"country_code":           countryCode,
			"matched_ips":            []string{},
			"matched_sessions":       0,
			"sessions_terminated":    int64(0),
			"refresh_tokens_revoked": int64(0),
		})
	}

	tx, err := h.DB.Pool.Begin(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to start termination transaction"})
	}
	defer func() { _ = tx.Rollback(ctx) }()

	revokeTag, err := tx.Exec(ctx, `
		UPDATE _v_refresh_tokens
		SET revoked_at = NOW(),
			last_used_at = COALESCE(last_used_at, NOW())
		WHERE revoked_at IS NULL
		  AND session_id::text = ANY($1::text[])
	`, targetSessionIDs)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to revoke refresh tokens"})
	}

	deleteTag, err := tx.Exec(ctx, `
		DELETE FROM _v_sessions
		WHERE id::text = ANY($1::text[])
	`, targetSessionIDs)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to terminate sessions"})
	}

	if err := tx.Commit(ctx); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to commit session termination"})
	}

	return c.JSON(http.StatusOK, map[string]any{
		"mode":                   "nuclear",
		"dry_run":                false,
		"country_code":           countryCode,
		"matched_ips":            targetIPs,
		"matched_sessions":       len(targetSessionIDs),
		"sessions_terminated":    deleteTag.RowsAffected(),
		"refresh_tokens_revoked": revokeTag.RowsAffected(),
	})
}
