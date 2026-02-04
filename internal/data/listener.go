package data

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/Xangel0s/OzyBase/internal/realtime"
	"github.com/jackc/pgx/v5"
)

// ListenDB connects to Postgres using a dedicated connection and listens for notifications
func ListenDB(ctx context.Context, databaseURL string, broker *realtime.Broker) {
	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		log.Fatalf("❌ Realtime Listener failed to connect: %v", err)
	}
	defer conn.Close(ctx)

	_, err = conn.Exec(ctx, "LISTEN OzyBase_events")
	if err != nil {
		log.Fatalf("❌ Realtime Listener failed to execute LISTEN: %v", err)
	}

	log.Println("⚡ Realtime Listener active on channel 'OzyBase_events'")

	for {
		select {
		case <-ctx.Done():
			return
		default:
			// Wait for a notification
			notification, err := conn.WaitForNotification(ctx)
			if err != nil {
				log.Printf("⚠️ Realtime Listener error: %v. Retrying in 5s...", err)
				time.Sleep(5 * time.Second)
				// Reconnect logic could be added here
				continue
			}

			// Broadcast raw payload
			var payload map[string]interface{}
			if err := json.Unmarshal([]byte(notification.Payload), &payload); err != nil {
				log.Printf("⚠️ Failed to parse notification payload: %v", err)
				continue
			}

			// Ideally the payload should contain info about which table it came from
			// For now let's assume the trigger sends the whole record
			broker.Broadcast(realtime.Event{
				Table: "unknown", // We could improve the trigger to include table name
				Data:  payload,
			})
		}
	}
}
