package api

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/Xangel0s/OzyBase/internal/realtime"
	"github.com/labstack/echo/v4"
)

// LogEntry represents a single request log
// LogEntry represents a single request log
type LogEntry struct {
	ID        int64     `json:"id"`
	Time      string    `json:"time"`
	Method    string    `json:"method"`
	Path      string    `json:"path"`
	Status    int       `json:"status"`
	Latency   string    `json:"latency"`
	IP        string    `json:"ip"`
	Timestamp time.Time `json:"-"`
}

// Metrics holds in-memory activity stats
type Metrics struct {
	sync.RWMutex
	DbRequests      int
	AuthRequests    int
	StorageRequests int
	DbHistory       []int
	AuthHistory     []int
	StorageHistory  []int
	RealtimeHistory []int
	Logs            []LogEntry
}

// Handler holds dependencies for HTTP handlers
type Handler struct {
	DB       *data.DB
	Metrics  *Metrics
	Broker   *realtime.Broker
	Webhooks *realtime.WebhookDispatcher
}

// NewHandler creates a new Handler with the given dependencies
func NewHandler(db *data.DB, broker *realtime.Broker, webhooks *realtime.WebhookDispatcher) *Handler {
	m := &Metrics{
		DbHistory:       make([]int, 60),
		AuthHistory:     make([]int, 60),
		StorageHistory:  make([]int, 60),
		RealtimeHistory: make([]int, 60),
		Logs:            make([]LogEntry, 0, 100),
	}
	// Start history rotator
	go m.rotateHistory(db)

	return &Handler{
		DB:       db,
		Metrics:  m,
		Broker:   broker,
		Webhooks: webhooks,
	}
}

// AddLog adds a new log entry to the metrics
func (m *Metrics) AddLog(entry LogEntry) {
	m.Lock()
	defer m.Unlock()

	// Prepend to show latest first
	m.Logs = append([]LogEntry{entry}, m.Logs...)
	if len(m.Logs) > 100 {
		m.Logs = m.Logs[:100]
	}
}

func (m *Metrics) rotateHistory(db *data.DB) {
	ticker := time.NewTicker(time.Minute)
	for range ticker.C {
		m.Lock()
		// Rotate all histories
		copy(m.DbHistory[0:], m.DbHistory[1:])
		m.DbHistory[59] = m.DbRequests
		m.DbRequests = 0 // Reset counter for next bucket if we want per-minute,
		// but since we want "activity", maybe we keep it cumulative or reset?
		// Supabase usually shows "requests in the last X", so resetting is better for bars.

		copy(m.AuthHistory[0:], m.AuthHistory[1:])
		m.AuthHistory[59] = m.AuthRequests
		m.AuthRequests = 0

		copy(m.StorageHistory[0:], m.StorageHistory[1:])
		m.StorageHistory[59] = m.StorageRequests
		m.StorageRequests = 0

		copy(m.RealtimeHistory[0:], m.RealtimeHistory[1:])
		// Get real active backends for realtime history point
		var active int
		db.Pool.QueryRow(context.Background(), "SELECT COUNT(*) FROM pg_stat_activity WHERE state = 'active'").Scan(&active)
		m.RealtimeHistory[59] = active

		m.Unlock()
	}
}

// HealthResponse represents the health check response
type HealthResponse struct {
	Status    string `json:"status"`
	Database  string `json:"database"`
	Timestamp string `json:"timestamp"`
}

// Health handles GET /api/health
func (h *Handler) Health(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 2*time.Second)
	defer cancel()

	dbStatus := "connected"
	if err := h.DB.Health(ctx); err != nil {
		dbStatus = "disconnected"
	}

	status := "ok"
	if dbStatus == "disconnected" {
		status = "degraded"
	}

	return c.JSON(http.StatusOK, HealthResponse{
		Status:    status,
		Database:  dbStatus,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	})
}

// GetLogs handles GET /api/project/logs
func (h *Handler) GetLogs(c echo.Context) error {
	h.Metrics.RLock()
	defer h.Metrics.RUnlock()
	return c.JSON(http.StatusOK, h.Metrics.Logs)
}
