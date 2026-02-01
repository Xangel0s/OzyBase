package api

import (
	"net/http"

	"github.com/Xangel0s/OzyBase/internal/core"
	"github.com/labstack/echo/v4"
)

// FileHandler handles file uploads
type FileHandler struct {
	StorageDir string
}

// NewFileHandler creates a new instance of FileHandler
func NewFileHandler(storageDir string) *FileHandler {
	return &FileHandler{StorageDir: storageDir}
}

// Upload handles POST /api/files
func (h *FileHandler) Upload(c echo.Context) error {
	// Source
	file, err := c.FormFile("file")
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Failed to get file from request: " + err.Error(),
		})
	}

	// Save
	filename, err := core.SaveFile(file, h.StorageDir)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to save file: " + err.Error(),
		})
	}

	return c.JSON(http.StatusCreated, map[string]string{
		"filename": filename,
		"url":      "/api/files/" + filename,
	})
}

// List handles GET /api/files
func (h *FileHandler) List(c echo.Context) error {
	files, err := core.ListFiles(h.StorageDir)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to list files: " + err.Error(),
		})
	}

	return c.JSON(http.StatusOK, files)
}
