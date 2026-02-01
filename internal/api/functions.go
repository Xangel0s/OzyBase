package api

import (
	"net/http"
	"os"
	"path/filepath"

	"github.com/labstack/echo/v4"
)

type FunctionInfo struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Status  string `json:"status"`
	Method  string `json:"method"`
	URL     string `json:"url"`
	LastRun string `json:"lastRun"`
}

type FunctionsHandler struct {
	FunctionsDir string
}

func NewFunctionsHandler(dir string) *FunctionsHandler {
	return &FunctionsHandler{FunctionsDir: dir}
}

func (h *FunctionsHandler) List(c echo.Context) error {
	entries, err := os.ReadDir(h.FunctionsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return c.JSON(http.StatusOK, []FunctionInfo{})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	var functions []FunctionInfo
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		ext := filepath.Ext(name)
		baseName := name[0 : len(name)-len(ext)]

		functions = append(functions, FunctionInfo{
			ID:      baseName,
			Name:    baseName,
			Status:  "Active",
			Method:  "POST",
			URL:     "/functions/" + baseName,
			LastRun: "Idle",
		})
	}

	return c.JSON(http.StatusOK, functions)
}
