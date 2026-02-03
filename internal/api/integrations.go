package api

import (
	"context"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
)

type Secret struct {
	ID          string    `json:"id"`
	Key         string    `json:"key"`
	Value       string    `json:"value"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"created_at"`
}

type Webhook struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	URL       string    `json:"url"`
	Events    string    `json:"events"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
}

type CronJob struct {
	JobID    int    `json:"jobid"`
	Schedule string `json:"schedule"`
	Command  string `json:"command"`
	Status   string `json:"status"`
}

type Wrapper struct {
	Name    string `json:"name"`
	Handler string `json:"handler"`
	Status  string `json:"status"`
}

// VAULT HANDLERS
func (h *Handler) ListSecrets(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	rows, err := h.DB.Pool.Query(ctx, "SELECT id, key, value, description, created_at FROM _v_secrets ORDER BY key ASC")
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	var secrets []Secret
	for rows.Next() {
		var s Secret
		if err := rows.Scan(&s.ID, &s.Key, &s.Value, &s.Description, &s.CreatedAt); err != nil {
			continue
		}
		secrets = append(secrets, s)
	}

	return c.JSON(http.StatusOK, secrets)
}

func (h *Handler) CreateSecret(c echo.Context) error {
	var input struct {
		Key         string `json:"key"`
		Value       string `json:"value"`
		Description string `json:"description"`
	}
	if err := c.Bind(&input); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	_, err := h.DB.Pool.Exec(ctx, "INSERT INTO _v_secrets (key, value, description) VALUES ($1, $2, $3)", input.Key, input.Value, input.Description)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.NoContent(http.StatusCreated)
}

func (h *Handler) DeleteSecret(c echo.Context) error {
	id := c.Param("id")
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	_, err := h.DB.Pool.Exec(ctx, "DELETE FROM _v_secrets WHERE id = $1", id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.NoContent(http.StatusOK)
}

// WRAPPERS HANDLERS
func (h *Handler) ListWrappers(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	rows, err := h.DB.Pool.Query(ctx, "SELECT fdwname, fdwhandler::regproc::text FROM pg_foreign_data_wrapper")
	if err != nil {
		return c.JSON(http.StatusOK, []Wrapper{})
	}
	defer rows.Close()

	var wrappers []Wrapper
	for rows.Next() {
		var w Wrapper
		if err := rows.Scan(&w.Name, &w.Handler); err != nil {
			continue
		}
		w.Status = "active"
		wrappers = append(wrappers, w)
	}

	return c.JSON(http.StatusOK, wrappers)
}

// WEBHOOK HANDLERS
func (h *Handler) ListWebhooks(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	rows, err := h.DB.Pool.Query(ctx, "SELECT id, name, url, events, status, created_at FROM _v_webhooks ORDER BY created_at DESC")
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	var webhooks []Webhook
	for rows.Next() {
		var w Webhook
		if err := rows.Scan(&w.ID, &w.Name, &w.URL, &w.Events, &w.Status, &w.CreatedAt); err != nil {
			continue
		}
		webhooks = append(webhooks, w)
	}

	return c.JSON(http.StatusOK, webhooks)
}

func (h *Handler) CreateWebhook(c echo.Context) error {
	var input struct {
		Name   string `json:"name"`
		URL    string `json:"url"`
		Events string `json:"events"`
	}
	if err := c.Bind(&input); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	_, err := h.DB.Pool.Exec(ctx, "INSERT INTO _v_webhooks (name, url, events) VALUES ($1, $2, $3)", input.Name, input.URL, input.Events)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.NoContent(http.StatusCreated)
}

func (h *Handler) DeleteWebhook(c echo.Context) error {
	id := c.Param("id")
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	_, err := h.DB.Pool.Exec(ctx, "DELETE FROM _v_webhooks WHERE id = $1", id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.NoContent(http.StatusOK)
}

// CRON HANDLERS
func (h *Handler) ListCronJobs(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	var exists bool
	_ = h.DB.Pool.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')").Scan(&exists)

	if !exists {
		return c.JSON(http.StatusOK, map[string]interface{}{
			"enabled": false,
			"jobs":    []CronJob{},
		})
	}

	rows, err := h.DB.Pool.Query(ctx, "SELECT jobid, schedule, command, 'active' as status FROM cron.job")
	if err != nil {
		return c.JSON(http.StatusOK, map[string]interface{}{"enabled": true, "jobs": []CronJob{}})
	}
	defer rows.Close()

	var jobs []CronJob
	for rows.Next() {
		var j CronJob
		if err := rows.Scan(&j.JobID, &j.Schedule, &j.Command, &j.Status); err != nil {
			continue
		}
		jobs = append(jobs, j)
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"enabled": true,
		"jobs":    jobs,
	})
}

func (h *Handler) CreateCronJob(c echo.Context) error {
	var input struct {
		Schedule string `json:"schedule"`
		Command  string `json:"command"`
	}
	if err := c.Bind(&input); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	_, err := h.DB.Pool.Exec(ctx, "SELECT cron.schedule($1, $2)", input.Schedule, input.Command)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.NoContent(http.StatusCreated)
}

func (h *Handler) DeleteCronJob(c echo.Context) error {
	id := c.Param("id")
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	_, err := h.DB.Pool.Exec(ctx, "SELECT cron.unschedule($1::int)", id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.NoContent(http.StatusOK)
}

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
	err := h.DB.Pool.QueryRow(ctx, "SELECT graphql.resolve($1, $2)", input.Query, input.Variables).Scan(&result)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.Blob(http.StatusOK, "application/json", []byte(result))
}
