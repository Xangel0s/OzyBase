package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
)

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
	record, err := h.DB.GetRecord(ctx, collectionName, id)
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

	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	records, err := h.DB.ListRecords(ctx, collectionName, orderBy)
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

	record, err := h.DB.GetRecord(ctx, collectionName, recordID)
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

	err := h.DB.UpdateRecord(ctx, collectionName, recordID, data)
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

	err := h.DB.DeleteRecord(ctx, collectionName, recordID)
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
