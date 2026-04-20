package realtime

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pglogrepl"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgproto3"
)

const logicalWALStatusInterval = 10 * time.Second

// LogicalWALBridgeConfig defines runtime options for logical replication bridging.
type LogicalWALBridgeConfig struct {
	DatabaseURL     string
	SlotName        string
	PublicationName string
	NodeID          string
	Channel         string
}

type logicalWALBridge struct {
	cfg        LogicalWALBridgeConfig
	broker     *Broker
	dispatcher *WebhookDispatcher
	pubsub     PubSub
	decoder    *pgoutputDecoder
}

// StartLogicalWALBridge starts a reconnecting logical replication bridge that forwards
// Postgres WAL changes into the broker used by SSE realtime clients.
func StartLogicalWALBridge(ctx context.Context, cfg LogicalWALBridgeConfig, broker *Broker, dispatcher *WebhookDispatcher, pubsub PubSub) error {
	if strings.TrimSpace(cfg.DatabaseURL) == "" {
		return fmt.Errorf("database url is required for realtime WAL bridge")
	}
	if strings.TrimSpace(cfg.SlotName) == "" {
		return fmt.Errorf("slot name is required for realtime WAL bridge")
	}
	if strings.TrimSpace(cfg.PublicationName) == "" {
		return fmt.Errorf("publication name is required for realtime WAL bridge")
	}
	if broker == nil {
		return fmt.Errorf("broker is required for realtime WAL bridge")
	}

	bridge := &logicalWALBridge{
		cfg:        cfg,
		broker:     broker,
		dispatcher: dispatcher,
		pubsub:     pubsub,
		decoder:    newPGOutputDecoder(),
	}

	go bridge.run(ctx)
	log.Printf("Realtime WAL bridge scheduled (slot=%s, publication=%s)", cfg.SlotName, cfg.PublicationName)
	return nil
}

func (b *logicalWALBridge) run(ctx context.Context) {
	backoff := 2 * time.Second
	for {
		if ctx.Err() != nil {
			return
		}

		err := b.runOnce(ctx)
		if err == nil || ctx.Err() != nil {
			return
		}

		log.Printf("Realtime WAL bridge error: %v", err)
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		if backoff < 30*time.Second {
			backoff *= 2
			if backoff > 30*time.Second {
				backoff = 30 * time.Second
			}
		}
	}
}

func (b *logicalWALBridge) runOnce(ctx context.Context) error {
	replConnString, err := withReplicationDatabase(b.cfg.DatabaseURL)
	if err != nil {
		return err
	}

	conn, err := pgconn.Connect(ctx, replConnString)
	if err != nil {
		return fmt.Errorf("connect replication: %w", err)
	}
	defer conn.Close(context.Background())

	sysident, err := pglogrepl.IdentifySystem(ctx, conn)
	if err != nil {
		return fmt.Errorf("identify system: %w", err)
	}

	if _, err := pglogrepl.CreateReplicationSlot(ctx, conn, b.cfg.SlotName, "pgoutput", pglogrepl.CreateReplicationSlotOptions{}); err != nil {
		if pgErr, ok := err.(*pgconn.PgError); !ok || pgErr.Code != "42710" {
			return fmt.Errorf("create replication slot: %w", err)
		}
	}

	if err := pglogrepl.StartReplication(ctx, conn, b.cfg.SlotName, sysident.XLogPos, pglogrepl.StartReplicationOptions{
		PluginArgs: []string{
			"proto_version '1'",
			"publication_names '" + b.cfg.PublicationName + "'",
		},
	}); err != nil {
		return fmt.Errorf("start replication: %w", err)
	}

	lastStandbyStatus := time.Now()
	if err := b.sendStandbyStatus(ctx, conn, sysident.XLogPos); err != nil {
		return fmt.Errorf("initial standby status: %w", err)
	}

	log.Printf("Realtime WAL bridge active (slot=%s, publication=%s)", b.cfg.SlotName, b.cfg.PublicationName)

	flushLSN := sysident.XLogPos
	for {
		if ctx.Err() != nil {
			return nil
		}

		timeoutCtx, cancel := context.WithTimeout(ctx, logicalWALStatusInterval)
		msg, err := conn.ReceiveMessage(timeoutCtx)
		cancel()
		if err != nil {
			if pgconn.Timeout(err) {
				if time.Since(lastStandbyStatus) >= logicalWALStatusInterval {
					if err := b.sendStandbyStatus(ctx, conn, flushLSN); err != nil {
						return fmt.Errorf("standby status timeout tick: %w", err)
					}
					lastStandbyStatus = time.Now()
				}
				continue
			}
			return fmt.Errorf("receive replication message: %w", err)
		}

		copyData, ok := msg.(*pgproto3.CopyData)
		if !ok || len(copyData.Data) == 0 {
			if !ok {
				log.Printf("[REALTIME] unexpected replication message type: %T", msg)
			}
			continue
		}

		switch copyData.Data[0] {
		case pglogrepl.PrimaryKeepaliveMessageByteID:
			keepalive, err := pglogrepl.ParsePrimaryKeepaliveMessage(copyData.Data[1:])
			if err != nil {
				continue
			}
			log.Printf("[REALTIME] keepalive server_wal_end=%s reply_requested=%t", keepalive.ServerWALEnd, keepalive.ReplyRequested)
			if keepalive.ReplyRequested {
				if err := b.sendStandbyStatus(ctx, conn, flushLSN); err != nil {
					return fmt.Errorf("standby keepalive response: %w", err)
				}
				lastStandbyStatus = time.Now()
			}
		case pglogrepl.XLogDataByteID:
			xld, err := pglogrepl.ParseXLogData(copyData.Data[1:])
			if err != nil {
				continue
			}
			log.Printf("[REALTIME] xlogdata wal_start=%s bytes=%d", xld.WALStart, len(xld.WALData))
			flushLSN = xld.WALStart + pglogrepl.LSN(len(xld.WALData))
			events := b.decoder.Decode(xld.WALData)
			if len(events) > 0 {
				log.Printf("[REALTIME] decoded %d event(s) from WAL", len(events))
			}
			for _, event := range events {
				event.NodeID = strings.TrimSpace(b.cfg.NodeID)
				event.Source = "wal"
				log.Printf("[REALTIME] emit action=%s table=%s source=%s", event.Action, event.Table, event.Source)
				b.broker.Broadcast(event)
				if b.pubsub != nil {
					if err := b.pubsub.Publish(ctx, b.cfg.Channel, event); err != nil {
						log.Printf("Realtime WAL publish failed: %v", err)
					}
				}
				if b.dispatcher != nil {
					b.dispatcher.Dispatch(event)
				}
			}

			if time.Since(lastStandbyStatus) >= logicalWALStatusInterval {
				if err := b.sendStandbyStatus(ctx, conn, flushLSN); err != nil {
					return fmt.Errorf("standby status periodic: %w", err)
				}
				lastStandbyStatus = time.Now()
			}
		}
	}
}

func (b *logicalWALBridge) sendStandbyStatus(ctx context.Context, conn *pgconn.PgConn, lsn pglogrepl.LSN) error {
	return pglogrepl.SendStandbyStatusUpdate(ctx, conn, pglogrepl.StandbyStatusUpdate{
		WALWritePosition: lsn,
		WALFlushPosition: lsn,
		WALApplyPosition: lsn,
		ClientTime:       time.Now(),
	})
}

func withReplicationDatabase(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", fmt.Errorf("database url is empty")
	}

	u, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("parse database url: %w", err)
	}
	query := u.Query()
	query.Set("replication", "database")
	u.RawQuery = query.Encode()
	return u.String(), nil
}

type pgoutputRelationMeta struct {
	table   string
	columns map[uint16]string
}

type pgoutputDecoder struct {
	relations map[uint32]pgoutputRelationMeta
}

func newPGOutputDecoder() *pgoutputDecoder {
	return &pgoutputDecoder{relations: make(map[uint32]pgoutputRelationMeta)}
}

func (d *pgoutputDecoder) Decode(walData []byte) []Event {
	msg, err := pglogrepl.Parse(walData)
	if err != nil {
		log.Printf("[REALTIME] parse wal message failed: %v", err)
		return nil
	}

	switch m := msg.(type) {
	case *pglogrepl.RelationMessage:
		columns := make(map[uint16]string, len(m.Columns))
		for i, col := range m.Columns {
			columns[uint16(i)] = col.Name
		}
		tableName := strings.TrimSpace(m.RelationName)
		if tableName == "" {
			tableName = fmt.Sprintf("rel_%d", m.RelationID)
		}
		d.relations[m.RelationID] = pgoutputRelationMeta{table: tableName, columns: columns}
		return nil
	case *pglogrepl.InsertMessage:
		record := d.tupleToMap(m.RelationID, m.Tuple)
		return []Event{{Table: d.relationTableName(m.RelationID), Action: "INSERT", Record: record, Data: record}}
	case *pglogrepl.UpdateMessage:
		record := d.tupleToMap(m.RelationID, m.NewTuple)
		return []Event{{Table: d.relationTableName(m.RelationID), Action: "UPDATE", Record: record, Data: record}}
	case *pglogrepl.DeleteMessage:
		record := d.tupleToMap(m.RelationID, m.OldTuple)
		return []Event{{Table: d.relationTableName(m.RelationID), Action: "DELETE", Record: record, Data: record}}
	default:
		log.Printf("[REALTIME] unhandled wal message type: %T", msg)
		return nil
	}
}

func (d *pgoutputDecoder) relationTableName(relationID uint32) string {
	meta, ok := d.relations[relationID]
	if !ok || strings.TrimSpace(meta.table) == "" {
		return fmt.Sprintf("rel_%d", relationID)
	}
	return meta.table
}

func (d *pgoutputDecoder) tupleToMap(relationID uint32, tuple *pglogrepl.TupleData) map[string]any {
	if tuple == nil {
		return map[string]any{}
	}
	result := make(map[string]any, len(tuple.Columns))
	meta, hasMeta := d.relations[relationID]
	for idx, col := range tuple.Columns {
		name := fmt.Sprintf("col_%d", idx)
		if hasMeta {
			if n, ok := meta.columns[uint16(idx)]; ok && n != "" {
				name = n
			}
		}
		switch col.DataType {
		case 'n':
			result[name] = nil
		case 'u':
			result[name] = "[unchanged_toast]"
		default:
			result[name] = string(col.Data)
		}
	}

	// Best-effort normalization to render JSON payloads in inspector.
	for key, value := range result {
		text, ok := value.(string)
		if !ok {
			continue
		}
		trimmed := strings.TrimSpace(text)
		if trimmed == "" {
			continue
		}
		if strings.HasPrefix(trimmed, "{") || strings.HasPrefix(trimmed, "[") {
			var decoded any
			if err := json.Unmarshal([]byte(trimmed), &decoded); err == nil {
				result[key] = decoded
			}
		}
	}

	return result
}
