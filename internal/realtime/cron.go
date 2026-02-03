package realtime

import (
	"context"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/robfig/cron/v3"
)

type CronManager struct {
	pool      *pgxpool.Pool
	scheduler *cron.Cron
}

func NewCronManager(pool *pgxpool.Pool) *CronManager {
	return &CronManager{
		pool:      pool,
		scheduler: cron.New(),
	}
}

func (m *CronManager) Start() {
	m.Refresh()
	m.scheduler.Start()
	log.Println("⏰ Cron scheduler started")
}

func (m *CronManager) Refresh() {
	// 1. Remove all existing jobs
	for _, entry := range m.scheduler.Entries() {
		m.scheduler.Remove(entry.ID)
	}

	// 2. Fetch active jobs from DB
	ctx := context.Background()
	rows, err := m.pool.Query(ctx, "SELECT id, name, schedule, command FROM _v_cron_jobs WHERE is_active = TRUE")
	if err != nil {
		log.Printf("Failed to fetch cron jobs: %v", err)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var id, name, schedule, command string
		if err := rows.Scan(&id, &name, &schedule, &command); err == nil {
			m.scheduler.AddFunc(schedule, func() {
				m.executeJob(id, name, command)
			})
			log.Printf("⏰ Job added: %s (%s)", name, schedule)
		}
	}
}

func (m *CronManager) executeJob(id, name, command string) {
	log.Printf("⏰ Executing job: %s", name)
	ctx := context.Background()

	start := time.Now()
	_, err := m.pool.Exec(ctx, command)

	status := "success"
	if err != nil {
		log.Printf("❌ Job %s failed: %v", name, err)
		status = "error: " + err.Error()
	}

	// Update last_run
	_, _ = m.pool.Exec(ctx, `
		UPDATE _v_cron_jobs 
		SET last_run = $2, updated_at = NOW() 
		WHERE id = $1
	`, id, start)

	log.Printf("✅ Job %s finished with status: %s", name, status)
}
