package api

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/Xangel0s/OzyBase/internal/core"
	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/labstack/echo/v4"
)

// LimitsEnforcementMiddleware applies workspace hard limits for API/Reatime/Functions requests.
// It is additive and can be toggled by feature flag.
func LimitsEnforcementMiddleware(db *data.DB, enabled bool) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			if !enabled {
				return next(c)
			}

			workspaceID, _ := c.Get("workspace_id").(string)
			workspaceID = strings.TrimSpace(workspaceID)
			if workspaceID == "" {
				return next(c)
			}

			metric := classifyWorkspaceQuotaMetric(c.Request().URL.Path)
			if metric == "" {
				return next(c)
			}

			err := core.NewWorkspaceService(db).EnforceRequestRateLimit(c.Request().Context(), workspaceID, metric, 1)
			if err == nil {
				return next(c)
			}

			var rateErr *core.WorkspaceRateLimitExceededError
			if errors.As(err, &rateErr) {
				retryAfter := rateErr.RetryAfter
				if retryAfter < 1 {
					retryAfter = 1
				}
				c.Response().Header().Set("Retry-After", fmt.Sprintf("%d", retryAfter))
				return c.JSON(http.StatusTooManyRequests, map[string]any{
					"error":       "workspace quota exceeded",
					"error_code":  "QUOTA_EXCEEDED",
					"metric":      rateErr.Metric,
					"limit":       rateErr.Limit,
					"current":     rateErr.Current,
					"window":      fmt.Sprintf("%ds", rateErr.WindowSeconds),
					"retry_after": retryAfter,
				})
			}

			return c.JSON(http.StatusInternalServerError, map[string]any{
				"error":      "Unable to validate workspace limits",
				"error_code": "QUOTA_CHECK_FAILED",
			})
		}
	}
}

func classifyWorkspaceQuotaMetric(path string) string {
	path = strings.TrimSpace(path)
	if !strings.HasPrefix(path, "/api/") {
		return ""
	}
	if strings.HasPrefix(path, "/api/realtime") {
		return "realtime_events"
	}
	if strings.Contains(path, "/api/functions/") && strings.Contains(path, "/invoke") {
		return "function_invocations"
	}
	return "api_requests"
}
