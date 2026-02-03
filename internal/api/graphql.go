package api

import (
	"context"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
)

// GRAPHQL HANDLER
func (h *Handler) HandleGraphQL(c echo.Context) error {
	var input struct {
		Query     string                 `json:"query"`
		Variables map[string]interface{} `json:"variables"`
	}
	if err := c.Bind(&input); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	var result string
	// Requires pg_graphql extension
	err := h.DB.Pool.QueryRow(ctx, "SELECT graphql.resolve($1, $2)", input.Query, input.Variables).Scan(&result)
	if err != nil {
		// Log error but don't panic. If pg_graphql is missing, this will fail.
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.Blob(http.StatusOK, "application/json", []byte(result))
}
