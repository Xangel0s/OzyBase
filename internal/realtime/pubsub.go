package realtime

import (
	"context"
	"encoding/json"

	"github.com/go-redis/redis/v8"
)

// PubSub interface defines methods for distributed event broadcasting
type PubSub interface {
	Publish(ctx context.Context, channel string, event Event) error
	Subscribe(ctx context.Context, channel string) (<-chan Event, error)
}

// RedisPubSub implementation using Redis
type RedisPubSub struct {
	client *redis.Client
}

func NewRedisPubSub(addr, password string, db int) *RedisPubSub {
	client := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: password,
		DB:       db,
	})
	return &RedisPubSub{client: client}
}

func (r *RedisPubSub) Publish(ctx context.Context, channel string, event Event) error {
	data, err := json.Marshal(event)
	if err != nil {
		return err
	}
	return r.client.Publish(ctx, channel, data).Err()
}

func (r *RedisPubSub) Subscribe(ctx context.Context, channel string) (<-chan Event, error) {
	pubsub := r.client.Subscribe(ctx, channel)
	eventChan := make(chan Event)

	go func() {
		defer close(eventChan)
		ch := pubsub.Channel()
		for msg := range ch {
			var event Event
			if err := json.Unmarshal([]byte(msg.Payload), &event); err == nil {
				eventChan <- event
			}
		}
	}()

	return eventChan, nil
}

// LocalPubSub implementation for single-node deployments (default)
type LocalPubSub struct {
	broker *Broker
}

func NewLocalPubSub(broker *Broker) *LocalPubSub {
	return &LocalPubSub{broker: broker}
}

func (l *LocalPubSub) Publish(ctx context.Context, channel string, event Event) error {
	l.broker.Broadcast(event)
	return nil
}

func (l *LocalPubSub) Subscribe(ctx context.Context, channel string) (<-chan Event, error) {
	// In the local case, the Broker already manages its own internal fan-out
	// This is a dummy for compliance with the interface
	return nil, nil
}
