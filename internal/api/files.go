package api

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/Xangel0s/OzyBase/internal/core"
	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/labstack/echo/v4"
)

func (h *FileHandler) checkBucketAccess(c echo.Context, bucketName string) (string, string, error) {
	var bucketID string
	var public bool
	var rlsEnabled bool
	var rlsRule string

	err := h.DB.Pool.QueryRow(c.Request().Context(), `
		SELECT id, public, rls_enabled, rls_rule 
		FROM _v_buckets WHERE name = $1
	`, bucketName).Scan(&bucketID, &public, &rlsEnabled, &rlsRule)

	if err != nil {
		if bucketName == "default" {
			err = h.DB.Pool.QueryRow(c.Request().Context(), `
				INSERT INTO _v_buckets (name, public) VALUES ('default', true)
				RETURNING id, public, rls_enabled, rls_rule
			`).Scan(&bucketID, &public, &rlsEnabled, &rlsRule)
			if err != nil {
				return "", "", err
			}
		} else {
			return "", "", fmt.Errorf("bucket not found")
		}
	}

	userID, _ := c.Get("user_id").(string)
	userRole, _ := c.Get("role").(string)

	if !public && userID == "" {
		return "", "", fmt.Errorf("authentication required")
	}

	// Advanced RLS Logic
	ownerFilter := ""
	if rlsEnabled {
		switch rlsRule {
		case "auth.uid() = owner_id":
			if userID == "" {
				return "", "", fmt.Errorf("policy requires authentication")
			}
			ownerFilter = userID
		case "auth.role() = 'admin'":
			if userRole != "admin" {
				return "", "", fmt.Errorf("policy requires admin role")
			}
		case "true":
			// Access granted to all authenticated (or public if bucket is public)
		case "false":
			return "", "", fmt.Errorf("access denied by policy")
		default:
			// Fallback: if it contains auth.uid() = owner_id, assume that
			if strings.Contains(rlsRule, "auth.uid() = owner_id") {
				ownerFilter = userID
			}
		}
	}

	return bucketID, ownerFilter, nil
}

// FileHandler handles file uploads and storage policies
type FileHandler struct {
	DB         *data.DB
	StorageDir string
}

// NewFileHandler creates a new instance of FileHandler
func NewFileHandler(db *data.DB, storageDir string) *FileHandler {
	return &FileHandler{
		DB:         db,
		StorageDir: storageDir,
	}
}

// Upload handles POST /api/files
func (h *FileHandler) Upload(c echo.Context) error {
	bucketName := c.QueryParam("bucket")
	if bucketName == "" {
		bucketName = "default"
	}

	bucketID, _, err := h.checkBucketAccess(c, bucketName)
	if err != nil {
		return c.JSON(http.StatusForbidden, map[string]string{"error": err.Error()})
	}

	// Source
	file, err := c.FormFile("file")
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Failed to get file from request: " + err.Error(),
		})
	}

	// Save to disk
	filename, err := core.SaveFile(file, h.StorageDir)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to save file: " + err.Error(),
		})
	}

	// Save metadata to DB
	userID, _ := c.Get("user_id").(string)
	var ownerID *string
	if userID != "" {
		ownerID = &userID
	}

	var objectID string
	err = h.DB.Pool.QueryRow(c.Request().Context(), `
		INSERT INTO _v_storage_objects (bucket_id, owner_id, name, size, content_type, path)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id
	`, bucketID, ownerID, filename, file.Size, file.Header.Get("Content-Type"), "/api/files/"+filename).Scan(&objectID)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to save metadata: " + err.Error(),
		})
	}

	return c.JSON(http.StatusCreated, map[string]any{
		"id":       objectID,
		"filename": filename,
		"url":      "/api/files/" + filename,
	})
}

// List handles GET /api/files
func (h *FileHandler) List(c echo.Context) error {
	bucketName := c.QueryParam("bucket")
	if bucketName == "" {
		bucketName = "default"
	}

	bucketID, ownerFilter, err := h.checkBucketAccess(c, bucketName)
	if err != nil {
		return c.JSON(http.StatusForbidden, map[string]string{"error": err.Error()})
	}

	query := `SELECT name, size, content_type, path, created_at FROM _v_storage_objects WHERE bucket_id = $1`
	args := []any{bucketID}

	if ownerFilter != "" {
		query += ` AND owner_id = $2`
		args = append(args, ownerFilter)
	}

	rows, err := h.DB.Pool.Query(c.Request().Context(), query, args...)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	var files []map[string]any
	for rows.Next() {
		var name, contentType, path string
		var size int64
		var createdAt any
		if err := rows.Scan(&name, &size, &contentType, &path, &createdAt); err == nil {
			files = append(files, map[string]any{
				"name":         name,
				"size":         size,
				"content_type": contentType,
				"path":         path,
				"created_at":   createdAt,
			})
		}
	}

	if files == nil {
		files = []map[string]any{}
	}

	return c.JSON(http.StatusOK, files)
}

// ListBuckets handles GET /api/files/buckets
func (h *FileHandler) ListBuckets(c echo.Context) error {
	rows, err := h.DB.Pool.Query(c.Request().Context(), `
		SELECT id, name, public, rls_enabled, rls_rule, created_at 
		FROM _v_buckets ORDER BY created_at ASC
	`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	var buckets []map[string]any
	for rows.Next() {
		var id, name, rlsRule string
		var public, rlsEnabled bool
		var createdAt any
		if err := rows.Scan(&id, &name, &public, &rlsEnabled, &rlsRule, &createdAt); err == nil {
			buckets = append(buckets, map[string]any{
				"id":          id,
				"name":        name,
				"public":      public,
				"rls_enabled": rlsEnabled,
				"rls_rule":    rlsRule,
				"created_at":  createdAt,
			})
		}
	}

	if buckets == nil {
		buckets = []map[string]any{}
	}

	return c.JSON(http.StatusOK, buckets)
}

// CreateBucket handles POST /api/files/buckets
func (h *FileHandler) CreateBucket(c echo.Context) error {
	var req struct {
		Name       string `json:"name"`
		Public     bool   `json:"public"`
		RLSEnabled bool   `json:"rls_enabled"`
		RLSRule    string `json:"rls_rule"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	if req.Name == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Bucket name is required"})
	}

	if req.RLSRule == "" {
		req.RLSRule = "auth.uid() = owner_id"
	}

	var bucketID string
	err := h.DB.Pool.QueryRow(c.Request().Context(), `
		INSERT INTO _v_buckets (name, public, rls_enabled, rls_rule)
		VALUES ($1, $2, $3, $4)
		RETURNING id
	`, req.Name, req.Public, req.RLSEnabled, req.RLSRule).Scan(&bucketID)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create bucket: " + err.Error()})
	}

	return c.JSON(http.StatusCreated, map[string]string{"id": bucketID, "name": req.Name})
}
