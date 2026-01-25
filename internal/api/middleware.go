package api

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/Xangel0s/OzyBase/internal/data"
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
			token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
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

			column := "list_rule"
			if requirement == "create" {
				column = "create_rule"
			}

			var rule string
			err := db.Pool.QueryRow(c.Request().Context(), 
				fmt.Sprintf("SELECT %s FROM _v_collections WHERE name = $1", column), 
				collectionName).Scan(&rule)

			if err != nil {
				return c.JSON(http.StatusNotFound, map[string]string{"error": "collection not found"})
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
				return c.JSON(http.StatusForbidden, map[string]string{"error": "access denied"})
			}
		}
	}
}

