package realtime

import (
	"sync"
)

// Event represents a realtime event data
type Event struct {
	Table string      `json:"table"`
	Data  interface{} `json:"data"`
}

// Broker manages connected clients and broadcasts events
type Broker struct {
	notifier       chan Event
	newClients     chan chan Event
	closingClients chan chan Event
	clients        map[chan Event]bool
	mu             sync.Mutex
}

// NewBroker creates a new event broker
func NewBroker() *Broker {
	broker := &Broker{
		notifier:       make(chan Event, 1),
		newClients:     make(chan chan Event),
		closingClients: make(chan chan Event),
		clients:        make(map[chan Event]bool),
	}

	go broker.listen()
	return broker
}

func (b *Broker) listen() {
	for {
		select {
		case s := <-b.newClients:
			b.mu.Lock()
			b.clients[s] = true
			b.mu.Unlock()
		case s := <-b.closingClients:
			b.mu.Lock()
			delete(b.clients, s)
			b.mu.Unlock()
		case event := <-b.notifier:
			b.mu.Lock()
			for clientChan := range b.clients {
				clientChan <- event
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
}

