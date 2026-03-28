package realtime

import (
	"context"
	"fmt"
	"sync"
)

// Event represents a realtime event data matching Postgres trigger payload
type Event struct {
	Table  string `json:"table"`
	Action string `json:"action"`
	Record any    `json:"record"`
	Old    any    `json:"old,omitempty"`
}

// Broker manages connected clients and broadcasts events
type Broker struct {
	notifier       chan Event
	newClients     chan chan Event
	closingClients chan chan Event
	clients        map[chan Event]bool
	mu             sync.Mutex
	Dispatcher     *WebhookDispatcher
	shutdownCtx    context.Context
	shutdownFunc   context.CancelFunc
	wg             sync.WaitGroup
}

// NewBroker creates a new event broker
func NewBroker() *Broker {
	ctx, cancel := context.WithCancel(context.Background())
	broker := &Broker{
		notifier:       make(chan Event, 1),
		newClients:     make(chan chan Event),
		closingClients: make(chan chan Event),
		clients:        make(map[chan Event]bool),
		shutdownCtx:    ctx,
		shutdownFunc:   cancel,
	}

	broker.wg.Add(1)
	go broker.listen()
	return broker
}

// Shutdown gracefully stops the broker
func (b *Broker) Shutdown() {
	fmt.Println("🛑 [Broker] Shutting down...")
	b.shutdownFunc()
	b.wg.Wait()
	fmt.Println("✅ [Broker] Stopped")
}

func (b *Broker) listen() {
	defer b.wg.Done()
	for {
		select {
		case <-b.shutdownCtx.Done():
			// Close all client channels
			b.mu.Lock()
			for clientChan := range b.clients {
				close(clientChan)
			}
			b.clients = make(map[chan Event]bool)
			b.mu.Unlock()
			return
		case s := <-b.newClients:
			b.mu.Lock()
			b.clients[s] = true
			b.mu.Unlock()
		case s := <-b.closingClients:
			b.mu.Lock()
			delete(b.clients, s)
			close(s)
			b.mu.Unlock()
		case event := <-b.notifier:
			b.mu.Lock()
			for clientChan := range b.clients {
				select {
				case clientChan <- event:
				default:
					// Client is slow, skip to prevent blocking
				}
			}
			b.mu.Unlock()
		}
	}
}

// Subscribe adds a new client and returns their event channel
func (b *Broker) Subscribe() chan Event {
	clientChan := make(chan Event)
	b.newClients <- clientChan
	return clientChan
}

// Unsubscribe removes a client channel
func (b *Broker) Unsubscribe(clientChan chan Event) {
	b.closingClients <- clientChan
}

// Broadcast sends an event to all connected clients
func (b *Broker) Broadcast(event Event) {
	b.notifier <- event
	if b.Dispatcher != nil {
		b.Dispatcher.Dispatch(event)
	}
}
