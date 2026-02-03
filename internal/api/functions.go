package api

import (
	"net/http"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/dop251/goja"
	"github.com/labstack/echo/v4"
)

type FunctionInfo struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Status  string `json:"status"`
	Method  string `json:"method"`
	URL     string `json:"url"`
	LastRun string `json:"lastRun"`
	Script  string `json:"script,omitempty"`
}

type FunctionsHandler struct {
	DB           *data.DB
	FunctionsDir string
}

func NewFunctionsHandler(db *data.DB, dir string) *FunctionsHandler {
	return &FunctionsHandler{
		DB:           db,
		FunctionsDir: dir,
	}
}

func (h *FunctionsHandler) List(c echo.Context) error {
	rows, err := h.DB.Pool.Query(c.Request().Context(), `
		SELECT id, name, status, script, created_at FROM _v_functions ORDER BY created_at DESC
	`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	var functions []FunctionInfo
	for rows.Next() {
		var f FunctionInfo
		var createdAt interface{}
		err := rows.Scan(&f.ID, &f.Name, &f.Status, &f.Script, &createdAt)
		if err == nil {
			f.Method = "POST"
			f.URL = "/api/functions/" + f.Name + "/invoke"
			f.LastRun = "Idle"
			functions = append(functions, f)
		}
	}

	if functions == nil {
		functions = []FunctionInfo{}
	}

	return c.JSON(http.StatusOK, functions)
}

func (h *FunctionsHandler) Create(c echo.Context) error {
	var req struct {
		Name   string `json:"name"`
		Script string `json:"script"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	var id string
	err := h.DB.Pool.QueryRow(c.Request().Context(), `
		INSERT INTO _v_functions (name, script)
		VALUES ($1, $2)
		ON CONFLICT (name) DO UPDATE SET script = $2, updated_at = NOW()
		RETURNING id
	`, req.Name, req.Script).Scan(&id)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]string{"id": id, "message": "Function saved successfully"})
}

func (h *FunctionsHandler) Invoke(c echo.Context) error {
	name := c.Param("name")
	var script string
	err := h.DB.Pool.QueryRow(c.Request().Context(), "SELECT script FROM _v_functions WHERE name = $1", name).Scan(&script)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Function not found"})
	}

	// Setup Goja VM
	vm := goja.New()

	// Expose useful globals
	reqBody := make(map[string]interface{})
	_ = c.Bind(&reqBody)
	vm.Set("body", reqBody)

	// Expose Ozy DB access
	vm.Set("ozy", map[string]interface{}{
		"query": func(sql string, args ...interface{}) []map[string]interface{} {
			rows, err := h.DB.Pool.Query(c.Request().Context(), sql, args...)
			if err != nil {
				panic(vm.ToValue(err.Error()))
			}
			defer rows.Close()

			var result []map[string]interface{}
			fields := rows.FieldDescriptions()
			for rows.Next() {
				values, _ := rows.Values()
				row := make(map[string]interface{})
				for i, field := range fields {
					row[string(field.Name)] = values[i]
				}
				result = append(result, row)
			}
			return result
		},
	})

	// Add console.log
	vm.Set("console", map[string]interface{}{
		"log": func(args ...interface{}) {
			// In production, capture this to logs
		},
	})

	// Run script
	v, err := vm.RunString(script)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Execution error: " + err.Error()})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"result": v.Export(),
	})
}
