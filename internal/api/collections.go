package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/labstack/echo/v4"
)

// Collection represents a collection in the system
type Collection struct {
	ID         string             `json:"id"`
	Name       string             `json:"name"`
	Schema     []data.FieldSchema `json:"schema"`
	ListRule   string             `json:"list_rule"`
	CreateRule string             `json:"create_rule"`
	CreatedAt  time.Time          `json:"created_at"`
	UpdatedAt  time.Time          `json:"updated_at"`
}

// CreateCollectionRequest represents the request to create a new collection
type CreateCollectionRequest struct {
	Name       string             `json:"name"`
	Schema     []data.FieldSchema `json:"schema"`
	ListRule   string             `json:"list_rule"`   // "public", "auth", "admin"
	CreateRule string             `json:"create_rule"` // "auth", "admin"
}

// CreateCollection handles POST /api/collections
func (h *Handler) CreateCollection(c echo.Context) error {
	var req CreateCollectionRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid request body",
		})
	}

	// Validate request
	if req.Name == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Collection name is required",
		})
	}

	if len(req.Schema) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Schema is required and must have at least one field",
		})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	// Build the CREATE TABLE SQL
	createSQL, err := data.BuildCreateTableSQL(req.Name, req.Schema)
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": err.Error(),
		})
	}

	// Start transaction
	tx, err := h.DB.Pool.Begin(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to start transaction",
		})
	}
	defer tx.Rollback(ctx)

	// Execute CREATE TABLE
	if _, err := tx.Exec(ctx, createSQL); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to create table: " + err.Error(),
		})
	}

	// Attach Realtime Trigger
	triggerSQL := fmt.Sprintf(`
		CREATE TRIGGER tr_notify_%s 
		AFTER INSERT OR UPDATE ON %s 
		FOR EACH ROW EXECUTE FUNCTION notify_event();
	`, req.Name, req.Name)

	if _, err := tx.Exec(ctx, triggerSQL); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to attach realtime trigger: " + err.Error(),
		})
	}

	// Set defaults if empty
	if req.ListRule == "" {
		req.ListRule = "auth"
	}
	if req.CreateRule == "" {
		req.CreateRule = "admin"
	}

	// Store collection metadata
	schemaJSON, _ := json.Marshal(req.Schema)
	var collection Collection
	err = tx.QueryRow(ctx, `
		INSERT INTO _v_collections (name, schema_def, list_rule, create_rule)
		VALUES ($1, $2, $3, $4)
		RETURNING id, name, list_rule, create_rule, created_at, updated_at
	`, req.Name, schemaJSON, req.ListRule, req.CreateRule).Scan(
		&collection.ID, &collection.Name, &collection.ListRule, &collection.CreateRule, &collection.CreatedAt, &collection.UpdatedAt,
	)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to save collection metadata: " + err.Error(),
		})
	}

	// Commit transaction
	if err := tx.Commit(ctx); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to commit transaction",
		})
	}

	collection.Schema = req.Schema
	return c.JSON(http.StatusCreated, collection)
}

// ListCollections handles GET /api/collections
func (h *Handler) ListCollections(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	// Fetch all tables from information_schema
	tables, err := h.DB.ListTables(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to fetch tables: " + err.Error(),
		})
	}

	// Fetch metadata from _v_collections to match details
	rows, err := h.DB.Pool.Query(ctx, `
		SELECT name, schema_def, list_rule, create_rule, created_at, updated_at
		FROM _v_collections
	`)

	metaMap := make(map[string]Collection)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var col Collection
			var schemaJSON []byte
			if err := rows.Scan(&col.Name, &schemaJSON, &col.ListRule, &col.CreateRule, &col.CreatedAt, &col.UpdatedAt); err == nil {
				json.Unmarshal(schemaJSON, &col.Schema)
				metaMap[col.Name] = col
			}
		}
	}

	// Combine information
	var result []Collection
	for _, tableName := range tables {
		if meta, ok := metaMap[tableName]; ok {
			result = append(result, meta)
		} else {
			// Basic entry for non-OzyBase managed tables
			result = append(result, Collection{
				Name:       tableName,
				ListRule:   "public",
				CreateRule: "admin",
				Schema:     []data.FieldSchema{}, // Will be filled by dynamic introspection on select
			})
		}
	}

	if result == nil {
		result = []Collection{}
	}

	return c.JSON(http.StatusOK, result)
}

// GetTableSchema handles GET /api/schema/:name
func (h *Handler) GetTableSchema(c echo.Context) error {
	tableName := c.Param("name")
	if tableName == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Table name is required",
		})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	schema, err := h.DB.GetTableSchema(ctx, tableName)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": err.Error(),
		})
	}

	return c.JSON(http.StatusOK, schema)
}
