package realtime

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type WebhookIntegration struct {
	pool *pgxpool.Pool
}

type IntegrationType string

const (
	IntegrationSlack   IntegrationType = "slack"
	IntegrationDiscord IntegrationType = "discord"
	IntegrationSIEM    IntegrationType = "siem"
	IntegrationCustom  IntegrationType = "custom"
)

type Integration struct {
	ID         string                 `json:"id"`
	Name       string                 `json:"name"`
	Type       IntegrationType        `json:"type"`
	WebhookURL string                 `json:"webhook_url"`
	IsActive   bool                   `json:"is_active"`
	Config     map[string]interface{} `json:"config,omitempty"`
	CreatedAt  time.Time              `json:"created_at"`
}

type SecurityAlertPayload struct {
	Type      string                 `json:"type"`
	Severity  string                 `json:"severity"`
	Details   map[string]interface{} `json:"details"`
	Timestamp string                 `json:"timestamp"`
}

func NewWebhookIntegration(pool *pgxpool.Pool) *WebhookIntegration {
	return &WebhookIntegration{pool: pool}
}

// SendSecurityAlert sends a security alert to all active integrations
func (w *WebhookIntegration) SendSecurityAlert(ctx context.Context, alert SecurityAlertPayload) error {
	rows, err := w.pool.Query(ctx, `
		SELECT id, name, type, webhook_url, config 
		FROM _v_integrations 
		WHERE is_active = true AND type IN ('slack', 'discord', 'siem', 'custom')
	`)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var integration Integration
		var configJSON []byte

		if err := rows.Scan(&integration.ID, &integration.Name, &integration.Type, &integration.WebhookURL, &configJSON); err != nil {
			continue
		}

		if len(configJSON) > 0 {
			_ = json.Unmarshal(configJSON, &integration.Config)
		}

		go w.sendToIntegration(integration, alert)
	}

	return nil
}

func (w *WebhookIntegration) sendToIntegration(integration Integration, alert SecurityAlertPayload) {
	var payload interface{}

	switch integration.Type {
	case IntegrationSlack:
		payload = w.formatSlackMessage(alert)
	case IntegrationDiscord:
		payload = w.formatDiscordMessage(alert)
	case IntegrationSIEM:
		payload = w.formatSIEMMessage(alert)
	default:
		payload = alert
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		return
	}

	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest("POST", integration.WebhookURL, bytes.NewBuffer(jsonData))
	if err != nil {
		return
	}

	req.Header.Set("Content-Type", "application/json")

	// Add custom headers from config
	if headers, ok := integration.Config["headers"].(map[string]interface{}); ok {
		for key, value := range headers {
			if strValue, ok := value.(string); ok {
				req.Header.Set(key, strValue)
			}
		}
	}

	resp, err := client.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()
}

func (w *WebhookIntegration) formatSlackMessage(alert SecurityAlertPayload) map[string]interface{} {
	color := "danger"
	if alert.Severity == "warning" {
		color = "warning"
	}

	return map[string]interface{}{
		"attachments": []map[string]interface{}{
			{
				"color": color,
				"title": fmt.Sprintf("🚨 Security Alert: %s", alert.Type),
				"text":  fmt.Sprintf("Severity: *%s*", alert.Severity),
				"fields": []map[string]interface{}{
					{
						"title": "Details",
						"value": formatDetails(alert.Details),
						"short": false,
					},
					{
						"title": "Timestamp",
						"value": alert.Timestamp,
						"short": true,
					},
				},
				"footer": "OzyBase Security System",
				"ts":     time.Now().Unix(),
			},
		},
	}
}

func (w *WebhookIntegration) formatDiscordMessage(alert SecurityAlertPayload) map[string]interface{} {
	color := 15158332 // Red
	if alert.Severity == "warning" {
		color = 16776960 // Yellow
	}

	return map[string]interface{}{
		"embeds": []map[string]interface{}{
			{
				"title":       fmt.Sprintf("🚨 Security Alert: %s", alert.Type),
				"description": fmt.Sprintf("**Severity:** %s", alert.Severity),
				"color":       color,
				"fields": []map[string]interface{}{
					{
						"name":   "Details",
						"value":  formatDetails(alert.Details),
						"inline": false,
					},
				},
				"footer": map[string]string{
					"text": "OzyBase Security System",
				},
				"timestamp": alert.Timestamp,
			},
		},
	}
}

func (w *WebhookIntegration) formatSIEMMessage(alert SecurityAlertPayload) map[string]interface{} {
	// Common Event Format (CEF) or JSON format for SIEM
	return map[string]interface{}{
		"event_type": "security_alert",
		"source":     "ozybase",
		"alert_type": alert.Type,
		"severity":   alert.Severity,
		"timestamp":  alert.Timestamp,
		"details":    alert.Details,
		"version":    "1.0",
	}
}

func formatDetails(details map[string]interface{}) string {
	result := ""
	for key, value := range details {
		result += fmt.Sprintf("**%s:** %v\n", key, value)
	}
	return result
}

// SendLogBatch sends a batch of logs to SIEM integrations
func (w *WebhookIntegration) SendLogBatch(ctx context.Context, logs []map[string]interface{}) error {
	rows, err := w.pool.Query(ctx, `
		SELECT id, name, webhook_url, config 
		FROM _v_integrations 
		WHERE is_active = true AND type = 'siem'
	`)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var integration Integration
		var configJSON []byte

		if err := rows.Scan(&integration.ID, &integration.Name, &integration.WebhookURL, &configJSON); err != nil {
			continue
		}

		if len(configJSON) > 0 {
			_ = json.Unmarshal(configJSON, &integration.Config)
		}

		go w.sendLogBatchToSIEM(integration, logs)
	}

	return nil
}

func (w *WebhookIntegration) sendLogBatchToSIEM(integration Integration, logs []map[string]interface{}) {
	payload := map[string]interface{}{
		"source":    "ozybase",
		"timestamp": time.Now().Format(time.RFC3339),
		"logs":      logs,
		"count":     len(logs),
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		return
	}

	client := &http.Client{Timeout: 30 * time.Second}
	req, err := http.NewRequest("POST", integration.WebhookURL, bytes.NewBuffer(jsonData))
	if err != nil {
		return
	}

	req.Header.Set("Content-Type", "application/json")

	// Add custom headers (e.g., API keys for Splunk, ELK)
	if headers, ok := integration.Config["headers"].(map[string]interface{}); ok {
		for key, value := range headers {
			if strValue, ok := value.(string); ok {
				req.Header.Set(key, strValue)
			}
		}
	}

	resp, err := client.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()
}
