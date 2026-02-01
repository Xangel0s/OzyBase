package realtime

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type WebhookDispatcher struct {
	pool *pgxpool.Pool
}

func NewWebhookDispatcher(pool *pgxpool.Pool) *WebhookDispatcher {
	return &WebhookDispatcher{pool: pool}
}

func (d *WebhookDispatcher) Dispatch(event Event) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// 1. Get all active webhooks for this event type
	rows, err := d.pool.Query(ctx, "SELECT url FROM _v_webhooks WHERE events LIKE '%' || $1 || '%'", event.Table)
	if err != nil {
		log.Printf("Failed to fetch webhooks: %v", err)
		return
	}
	defer rows.Close()

	var urls []string
	for rows.Next() {
		var url string
		if err := rows.Scan(&url); err == nil {
			urls = append(urls, url)
		}
	}

	// 2. Send payload to each URL
	payload, _ := json.Marshal(event)
	for _, url := range urls {
		go func(target string) {
			resp, err := http.Post(target, "application/json", bytes.NewBuffer(payload))
			if err != nil {
				log.Printf("Webhook failed to %s: %v", target, err)
				return
			}
			defer resp.Body.Close()
			log.Printf("Webhook sent to %s with status %d", target, resp.StatusCode)
		}(url)
	}
}
