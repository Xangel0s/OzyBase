package core

import (
	"context"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/Xangel0s/OzyBase/internal/logger"
)

// AuditService handles asynchronous log buffering and persistence.
type AuditService struct {
	db        *data.DB
	logChan   chan data.AuditLog
	batchSize int
	shutdown  chan struct{}
	wg        sync.WaitGroup
	running   atomic.Bool
}

// NewAuditService creates a new AuditService.
func NewAuditService(db *data.DB) *AuditService {
	return &AuditService{
		db:        db,
		logChan:   make(chan data.AuditLog, 2000),
		batchSize: 50,
		shutdown:  make(chan struct{}),
	}
}

// Start spawns the background worker.
func (s *AuditService) Start() {
	s.wg.Add(1)
	s.running.Store(true)
	go s.process()
	logger.Log.Info().Msg("audit worker started")
}

// Stop gracefully shuts down the worker, flushing remaining logs.
func (s *AuditService) Stop() {
	logger.Log.Info().Msg("audit worker stopping")
	close(s.shutdown)
	s.wg.Wait()
	s.running.Store(false)
	logger.Log.Info().Msg("audit worker stopped")
}

// Log adds a new log entry to the buffer.
func (s *AuditService) Log(log data.AuditLog) {
	select {
	case s.logChan <- log:
	default:
		// Drop log if buffer full to prevent blocking API (load shedding).
		logger.Log.Warn().Str("path", log.Path).Msg("audit buffer full, dropping log")
	}
}

// IsRunning reports whether the audit worker goroutine is currently active.
func (s *AuditService) IsRunning() bool {
	if s == nil {
		return false
	}
	return s.running.Load()
}

// QueueDepth reports the current number of buffered audit log entries.
func (s *AuditService) QueueDepth() int {
	if s == nil {
		return 0
	}
	return len(s.logChan)
}

func (s *AuditService) process() {
	defer s.wg.Done()
	buffer := make([]data.AuditLog, 0, s.batchSize)
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	flush := func() {
		if len(buffer) == 0 {
			return
		}

		if err := s.db.BulkInsertAuditLogs(context.Background(), buffer); err != nil {
			// If a token points to a missing user, keep the audit row but store user_id as NULL.
			if strings.Contains(err.Error(), "_v_audit_logs_user_id_fkey") {
				sanitized := make([]data.AuditLog, len(buffer))
				copy(sanitized, buffer)
				for i := range sanitized {
					sanitized[i].UserID = nil
				}
				if retryErr := s.db.BulkInsertAuditLogs(context.Background(), sanitized); retryErr == nil {
					buffer = buffer[:0]
					return
				}
			}
			logger.Log.Warn().Err(err).Msg("audit bulk insert failed")
		}

		buffer = buffer[:0]
	}

	for {
		select {
		case log := <-s.logChan:
			buffer = append(buffer, log)
			if len(buffer) >= s.batchSize {
				flush()
			}
		case <-ticker.C:
			flush()
		case <-s.shutdown:
			flush()
			return
		}
	}
}
