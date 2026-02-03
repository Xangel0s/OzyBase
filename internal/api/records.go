package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
)

func (h *Handler) extractRlsOwnerInfo(c echo.Context) (string, string) {
	rlsEnabled, _ := c.Get("rls_enabled").(bool)
	if !rlsEnabled {
		return "", ""
	}

	rlsRule, _ := c.Get("rls_rule").(string)
	userID, _ := c.Get("user_id").(string)

	if rlsRule != "" && userID != "" && strings.Contains(rlsRule, "auth.uid()") {
		ruleParts := strings.Split(rlsRule, "=")
		if len(ruleParts) == 2 {
			return strings.TrimSpace(ruleParts[0]), userID
		}
	}

	return "", ""
}

// CreateRecord handles POST /api/collections/:name/records
func (h *Handler) CreateRecord(c echo.Context) error {
	collectionName := c.Param("name")
	if collectionName == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Collection name is required",
		})
	}

	// Parse body as dynamic map using json decoder directly
	var data map[string]interface{}
	if err := json.NewDecoder(c.Request().Body).Decode(&data); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid JSON body: " + err.Error(),
		})
	}

	if len(data) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Request body cannot be empty",
		})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	// Insert the record
	id, err := h.DB.InsertRecord(ctx, collectionName, data)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": err.Error(),
		})
	}

	// Fetch the complete record to return
	ownerField, ownerID := h.extractRlsOwnerInfo(c)
	record, err := h.DB.GetRecord(ctx, collectionName, id, ownerField, ownerID)
	if err != nil {
		// Return at least the ID if fetch fails
		return c.JSON(http.StatusCreated, map[string]string{
			"id": id,
		})
	}

	return c.JSON(http.StatusCreated, record)
}

// ListRecords handles GET /api/collections/:name/records
func (h *Handler) ListRecords(c echo.Context) error {
	collectionName := c.Param("name")
	if collectionName == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Collection name is required",
		})
	}

	orderBy := c.QueryParam("order")

	// Collect all query parameters as filters
	filters := c.QueryParams()

	// Inject RLS filter if enabled
	ownerField, ownerID := h.extractRlsOwnerInfo(c)
	if ownerField != "" && ownerID != "" {
		filters[ownerField] = append(filters[ownerField], "eq."+ownerID)
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	records, err := h.DB.ListRecords(ctx, collectionName, filters, orderBy)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": err.Error(),
		})
	}

	if records == nil {
		records = []map[string]interface{}{}
	}

	return c.JSON(http.StatusOK, records)
}

// GetRecord handles GET /api/collections/:name/records/:id
func (h *Handler) GetRecord(c echo.Context) error {
	collectionName := c.Param("name")
	recordID := c.Param("id")

	if collectionName == "" || recordID == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Collection name and record ID are required",
		})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	ownerField, ownerID := h.extractRlsOwnerInfo(c)
	record, err := h.DB.GetRecord(ctx, collectionName, recordID, ownerField, ownerID)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": err.Error(),
		})
	}

	return c.JSON(http.StatusOK, record)
}

// UpdateRecord handles PATCH /api/collections/:name/records/:id
func (h *Handler) UpdateRecord(c echo.Context) error {
	collectionName := c.Param("name")
	recordID := c.Param("id")

	if collectionName == "" || recordID == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Collection name and record ID are required",
		})
	}

	var data map[string]interface{}
	if err := json.NewDecoder(c.Request().Body).Decode(&data); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid JSON body: " + err.Error(),
		})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	ownerField, ownerID := h.extractRlsOwnerInfo(c)
	err := h.DB.UpdateRecord(ctx, collectionName, recordID, data, ownerField, ownerID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": err.Error(),
		})
	}

	return c.NoContent(http.StatusNoContent)
}

// DeleteRecord handles DELETE /api/collections/:name/records/:id
func (h *Handler) DeleteRecord(c echo.Context) error {
	collectionName := c.Param("name")
	recordID := c.Param("id")

	if collectionName == "" || recordID == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Collection name and record ID are required",
		})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	ownerField, ownerID := h.extractRlsOwnerInfo(c)
	err := h.DB.DeleteRecord(ctx, collectionName, recordID, ownerField, ownerID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": err.Error(),
		})
	}

	return c.NoContent(http.StatusNoContent)
}

// ImportRecords handles POST /api/tables/:name/import
func (h *Handler) ImportRecords(c echo.Context) error {
	collectionName := c.Param("name")
	if collectionName == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Name required"})
	}

	var records []map[string]interface{}
	if err := json.NewDecoder(c.Request().Body).Decode(&records); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid JSON array"})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 30*time.Second)
	defer cancel()

	if err := h.DB.BulkInsertRecord(ctx, collectionName, records); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]string{"message": fmt.Sprintf("Imported %d records", len(records))})
}
