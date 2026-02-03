package api

import (
	"net/http"
	"time"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/Xangel0s/OzyBase/internal/realtime"
	"github.com/labstack/echo/v4"
)

type CronJobInfo struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Schedule string  `json:"schedule"`
	Command  string  `json:"command"`
	IsActive bool    `json:"is_active"`
	LastRun  *string `json:"last_run,omitempty"`
}

type CronHandler struct {
	DB   *data.DB
	Cron *realtime.CronManager
}

func NewCronHandler(db *data.DB, cronMgr *realtime.CronManager) *CronHandler {
	return &CronHandler{DB: db, Cron: cronMgr}
}

func (h *CronHandler) List(c echo.Context) error {
	rows, err := h.DB.Pool.Query(c.Request().Context(), `
		SELECT id, name, schedule, command, is_active, last_run FROM _v_cron_jobs ORDER BY created_at DESC
	`)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	var jobs []CronJobInfo
	for rows.Next() {
		var j CronJobInfo
		var lastRun *time.Time
		if err := rows.Scan(&j.ID, &j.Name, &j.Schedule, &j.Command, &j.IsActive, &lastRun); err == nil {
			if lastRun != nil {
				lr := lastRun.Format(time.RFC3339)
				j.LastRun = &lr
			}
			jobs = append(jobs, j)
		}
	}

	if jobs == nil {
		jobs = []CronJobInfo{}
	}

	return c.JSON(http.StatusOK, jobs)
}

func (h *CronHandler) Create(c echo.Context) error {
	var req struct {
		Name     string `json:"name"`
		Schedule string `json:"schedule"`
		Command  string `json:"command"`
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request"})
	}

	var id string
	err := h.DB.Pool.QueryRow(c.Request().Context(), `
		INSERT INTO _v_cron_jobs (name, schedule, command)
		VALUES ($1, $2, $3)
		RETURNING id
	`, req.Name, req.Schedule, req.Command).Scan(&id)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	// Refresh the scheduler to pick up the new job
	h.Cron.Refresh()

	return c.JSON(http.StatusCreated, map[string]string{"id": id, "message": "Cron job created"})
}

func (h *CronHandler) Delete(c echo.Context) error {
	id := c.Param("id")
	_, err := h.DB.Pool.Exec(c.Request().Context(), "DELETE FROM _v_cron_jobs WHERE id = $1", id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	h.Cron.Refresh()
	return c.NoContent(http.StatusNoContent)
}
