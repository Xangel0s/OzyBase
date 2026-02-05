package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/Xangel0s/OzyBase/internal/realtime"
	"github.com/golang-jwt/jwt/v5"
	"github.com/labstack/echo/v4"
)

func AuthMiddleware(jwtSecret string, optional bool) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			authHeader := c.Request().Header.Get("Authorization")
			if authHeader == "" {
				if optional {
					return next(c)
				}
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "missing authorization header"})
			}

			tokenParts := strings.Split(authHeader, " ")
			if len(tokenParts) != 2 || strings.ToLower(tokenParts[0]) != "bearer" {
				if optional {
					return next(c)
				}
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "invalid authorization header format"})
			}

			tokenString := tokenParts[1]
			token, err := jwt.Parse(tokenString, func(token *jwt.Token) (any, error) {
				if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
					return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
				}
				return []byte(jwtSecret), nil
			})

			if err != nil || !token.Valid {
				if optional {
					return next(c)
				}
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "invalid or expired token"})
			}

			claims, ok := token.Claims.(jwt.MapClaims)
			if !ok {
				if optional {
					return next(c)
				}
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "invalid token claims"})
			}

			c.Set("user_id", claims["user_id"])
			c.Set("role", claims["role"])

			return next(c)
		}
	}
}

// AccessMiddleware checks per-collection permissions (ACL)
func AccessMiddleware(db *data.DB, requirement string) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			collectionName := c.Param("name")
			if collectionName == "" {
				return next(c) // Public routes or collections management
			}

			var listRule, createRule, updateRule, deleteRule, rlsRule string
			var rlsEnabled bool
			err := db.Pool.QueryRow(c.Request().Context(),
				"SELECT list_rule, create_rule, update_rule, delete_rule, rls_enabled, rls_rule FROM _v_collections WHERE name = $1",
				collectionName).Scan(&listRule, &createRule, &updateRule, &deleteRule, &rlsEnabled, &rlsRule)

			if err != nil {
				return c.JSON(http.StatusNotFound, map[string]string{"error": "collection not found"})
			}

			// Store RLS config for later use in handlers
			c.Set("rls_enabled", rlsEnabled)
			c.Set("rls_rule", rlsRule)

			rule := listRule
			if requirement == "create" {
				rule = createRule
			}

			// ACL Logic
			switch rule {
			case "public":
				return next(c)
			case "auth":
				if c.Get("user_id") == nil {
					return c.JSON(http.StatusForbidden, map[string]string{"error": "authentication required for this collection"})
				}
				return next(c)
			case "admin":
				role := c.Get("role")
				if role == nil || role.(string) != "admin" {
					return c.JSON(http.StatusForbidden, map[string]string{"error": "admin access required for this collection"})
				}
				return next(c)
			default:
				// Support custom roles like 'role:manager'
				if strings.HasPrefix(rule, "role:") {
					requiredRole := strings.TrimPrefix(rule, "role:")
					userRole := c.Get("role")
					if userRole == nil || userRole.(string) != requiredRole {
						return c.JSON(http.StatusForbidden, map[string]string{"error": fmt.Sprintf("%s role required for this collection", requiredRole)})
					}
					return next(c)
				}
				return c.JSON(http.StatusForbidden, map[string]string{"error": "access denied"})
			}
		}
	}
}

// MetricsMiddleware tracks activity for the dashboard and persists audit logs
func MetricsMiddleware(h *Handler) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			start := time.Now()
			err := next(c)
			stop := time.Now()

			path := c.Path()
			if path == "" {
				path = c.Request().URL.Path
			}

			// Don't log metrics/logs requests to avoid infinite recursion noise
			if strings.HasPrefix(path, "/api/project/stats") || strings.HasPrefix(path, "/api/project/logs") {
				return err
			}

			h.Metrics.Lock()
			if strings.HasPrefix(path, "/api/collections") || strings.HasPrefix(path, "/api/tables") {
				h.Metrics.DbRequests++
			} else if strings.HasPrefix(path, "/api/auth") {
				h.Metrics.AuthRequests++
			} else if strings.HasPrefix(path, "/api/files") {
				h.Metrics.StorageRequests++
			}
			h.Metrics.Unlock()

			// Add to logs with Geolocation
			ip := c.RealIP()
			latency := stop.Sub(start)
			status := c.Response().Status
			userID, _ := c.Get("user_id").(string)

			go func() {
				geo, _ := h.Geo.GetLocation(context.Background(), ip)

				entry := LogEntry{
					ID:        fmt.Sprintf("%d", time.Now().UnixNano()),
					Time:      stop.Format("15:04:05"),
					Method:    c.Request().Method,
					Path:      path,
					Status:    status,
					Latency:   fmt.Sprintf("%v", latency.Truncate(time.Millisecond)),
					IP:        ip,
					Country:   geo.Country,
					City:      geo.City,
					Timestamp: stop,
				}
				h.Metrics.AddLog(entry)

				// Check for Geo Breach
				isBreach, _ := h.Geo.CheckBreach(context.Background(), ip, geo.Country)

				// Persist to DB
				_, _ = h.DB.Pool.Exec(context.Background(), `
					INSERT INTO _v_audit_logs (user_id, ip_address, method, path, status, latency_ms, country, city, user_agent)
					VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
				`, userID, ip, entry.Method, entry.Path, entry.Status, latency.Milliseconds(), geo.Country, geo.City, c.Request().UserAgent())

				if isBreach {
					details, _ := json.Marshal(map[string]any{
						"ip":      ip,
						"country": geo.Country,
						"city":    geo.City,
						"method":  entry.Method,
						"path":    entry.Path,
					})
					_, _ = h.DB.Pool.Exec(context.Background(), `
						INSERT INTO _v_security_alerts (type, severity, details)
						VALUES ($1, $2, $3)
					`, "geo_breach", "critical", details)

					// Send email notifications to all active recipients
					go func() {
						rows, err := h.DB.Pool.Query(context.Background(), `
							SELECT email FROM _v_security_notification_recipients
							WHERE is_active = true AND 'geo_breach' = ANY(alert_types)
						`)
						if err != nil {
							return
						}
						defer rows.Close()

						alertDetails := fmt.Sprintf("IP: %s from %s, %s attempted to access %s %s",
							ip, geo.Country, geo.City, entry.Method, entry.Path)

						for rows.Next() {
							var email string
							if err := rows.Scan(&email); err == nil {
								_ = h.Mailer.SendSecurityAlert(email, "Geographic Access Breach", alertDetails)
							}
						}
					}()

					// Send to webhook integrations (Slack, Discord, SIEM)
					go func() {
						var detailsMap map[string]any
						_ = json.Unmarshal(details, &detailsMap)

						_ = h.Integrations.SendSecurityAlert(context.Background(), realtime.SecurityAlertPayload{
							Type:      "geo_breach",
							Severity:  "critical",
							Details:   detailsMap,
							Timestamp: time.Now().Format(time.RFC3339),
						})
					}()
				}
			}()

			return err
		}
	}
}
