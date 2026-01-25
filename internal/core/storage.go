package core

import (
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"

	"github.com/google/uuid"
)

// SaveFile saves a multipart file to the destination path with a unique name
func SaveFile(fileHeader *multipart.FileHeader, storageDir string) (string, error) {
	// Create storage directory if it doesn't exist
	if err := os.MkdirAll(storageDir, os.ModePerm); err != nil {
		return "", fmt.Errorf("failed to create storage directory: %w", err)
	}

	// Open the source file
	src, err := fileHeader.Open()
	if err != nil {
		return "", fmt.Errorf("failed to open uploaded file: %w", err)
	}
	defer src.Close()

	// Generate a unique filename: UUID_originalName
	uniqueID := uuid.New().String()
	safeFilename := fmt.Sprintf("%s_%s", uniqueID, fileHeader.Filename)
	destPath := filepath.Join(storageDir, safeFilename)

	// Create the destination file
	dst, err := os.Create(destPath)
	if err != nil {
		return "", fmt.Errorf("failed to create destination file: %w", err)
	}
	defer dst.Close()

	// Copy the contents
	if _, err = io.Copy(dst, src); err != nil {
		return "", fmt.Errorf("failed to copy file contents: %w", err)
	}

	return safeFilename, nil
}

