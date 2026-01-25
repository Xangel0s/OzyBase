/**
 * OzyBase Realtime Module
 * Supabase-style realtime subscriptions using SSE
 * 
 * Usage:
 *   const channel = client
 *     .channel('products')
 *     .on('INSERT', (payload) => console.log('New product:', payload.new))
 *     .on('UPDATE', (payload) => console.log('Updated:', payload.new))
 *     .subscribe();
 */

import type {
    RealtimeEvent,
    RealtimePayload,
    RealtimeCallback,
    RealtimeChannel,
} from './types';
import type { OzyBaseClient } from './client';

interface RealtimeSubscription {
    event: RealtimeEvent;
    callback: RealtimeCallback<unknown>;
    table?: string;
    filter?: string;
}

export class OzyBaseRealtimeChannel implements RealtimeChannel {
    private _client: OzyBaseClient;
    private _name: string;
    private _subscriptions: RealtimeSubscription[] = [];
    private _eventSource: EventSource | null = null;
    private _isSubscribed: boolean = false;
    private _reconnectAttempts: number = 0;
    private _maxReconnectAttempts: number = 10;
    private _reconnectDelay: number = 1000;
    private _statusCallback?: (status: string) => void;

    constructor(client: OzyBaseClient, name: string) {
        this._client = client;
        this._name = name;
    }

    // ============================================================================
    // Fluent API (Supabase-style)
    // ============================================================================

    /**
     * Subscribe to a specific event type
     * @param event - Event type: 'INSERT', 'UPDATE', 'DELETE', or '*' for all
     * @param callback - Function to call when event occurs
     */
    on<T = Record<string, unknown>>(
        event: RealtimeEvent,
        callback: RealtimeCallback<T>
    ): this {
        this._subscriptions.push({
            event,
            callback: callback as RealtimeCallback<unknown>,
            table: this._name,
        });
        return this;
    }

    /**
     * Filter events by column value
     * @param column - Column name
     * @param operator - Comparison operator
     * @param value - Value to compare
     */
    filter(column: string, operator: 'eq' | 'neq' | 'gt' | 'lt', value: unknown): this {
        // Apply filter to the last subscription
        const lastSub = this._subscriptions[this._subscriptions.length - 1];
        if (lastSub) {
            lastSub.filter = `${column}=${operator}.${value}`;
        }
        return this;
    }

    /**
     * Start the subscription
     * @param callback - Optional callback for connection status updates
     */
    subscribe(callback?: (status: string) => void): this {
        if (this._isSubscribed) {
            callback?.('SUBSCRIBED');
            return this;
        }

        this._statusCallback = callback;
        this._connect();
        return this;
    }

    /**
     * Stop the subscription and disconnect
     */
    unsubscribe(): void {
        this._disconnect();
        this._subscriptions = [];
        this._isSubscribed = false;
        this._statusCallback?.('UNSUBSCRIBED');
    }

    // ============================================================================
    // Connection Management
    // ============================================================================

    private _connect(): void {
        if (typeof EventSource === 'undefined') {
            console.error('OzyBase Realtime: EventSource not available (server-side?)');
            this._statusCallback?.('ERROR');
            return;
        }

        const url = this._buildUrl();

        this._statusCallback?.('CONNECTING');

        try {
            this._eventSource = new EventSource(url);

            this._eventSource.onopen = () => {
                this._isSubscribed = true;
                this._reconnectAttempts = 0;
                this._statusCallback?.('SUBSCRIBED');
            };

            this._eventSource.onmessage = (event) => {
                this._handleMessage(event);
            };

            this._eventSource.onerror = () => {
                this._handleError();
            };

            // Listen for specific event types
            this._eventSource.addEventListener('insert', (event) => {
                this._handleEvent('INSERT', event as MessageEvent);
            });

            this._eventSource.addEventListener('update', (event) => {
                this._handleEvent('UPDATE', event as MessageEvent);
            });

            this._eventSource.addEventListener('delete', (event) => {
                this._handleEvent('DELETE', event as MessageEvent);
            });

        } catch (error) {
            console.error('OzyBase Realtime: Connection failed', error);
            this._statusCallback?.('ERROR');
        }
    }

    private _disconnect(): void {
        if (this._eventSource) {
            this._eventSource.close();
            this._eventSource = null;
        }
        this._isSubscribed = false;
    }

    private _handleMessage(event: MessageEvent): void {
        try {
            const data = JSON.parse(event.data) as {
                collection?: string;
                table?: string;
                action?: string;
                eventType?: string;
                record?: unknown;
                new?: unknown;
                old?: unknown;
            };

            // Normalize the payload format
            const payload: RealtimePayload = {
                eventType: (data.action?.toUpperCase() || data.eventType || 'UPDATE') as RealtimeEvent,
                new: (data.record || data.new) as Record<string, unknown> | null,
                old: (data.old || null) as Record<string, unknown> | null,
                table: data.collection || data.table || this._name,
                schema: 'public',
                commit_timestamp: new Date().toISOString(),
            };

            this._notifySubscribers(payload);
        } catch (e) {
            console.error('OzyBase Realtime: Error parsing message', e);
        }
    }

    private _handleEvent(eventType: RealtimeEvent, event: MessageEvent): void {
        try {
            const data = JSON.parse(event.data);

            const payload: RealtimePayload = {
                eventType,
                new: data.new || data.record || data,
                old: data.old || null,
                table: data.table || this._name,
                schema: 'public',
                commit_timestamp: new Date().toISOString(),
            };

            this._notifySubscribers(payload);
        } catch (e) {
            console.error('OzyBase Realtime: Error parsing event', e);
        }
    }

    private _handleError(): void {
        this._disconnect();
        this._statusCallback?.('CHANNEL_ERROR');

        // Attempt to reconnect
        if (this._reconnectAttempts < this._maxReconnectAttempts) {
            this._reconnectAttempts++;
            const delay = this._reconnectDelay * Math.pow(2, this._reconnectAttempts - 1);

            setTimeout(() => {
                console.log(`OzyBase Realtime: Reconnecting (attempt ${this._reconnectAttempts})`);
                this._statusCallback?.('RECONNECTING');
                this._connect();
            }, delay);
        } else {
            console.error('OzyBase Realtime: Max reconnection attempts reached');
            this._statusCallback?.('CLOSED');
        }
    }

    private _notifySubscribers(payload: RealtimePayload): void {
        for (const sub of this._subscriptions) {
            // Check if this subscriber cares about this event
            if (sub.event === '*' || sub.event === payload.eventType) {
                // Check table filter
                if (!sub.table || sub.table === payload.table) {
                    sub.callback(payload);
                }
            }
        }
    }

    private _buildUrl(): string {
        const baseUrl = this._client.getBaseUrl();
        const token = this._client.getAccessToken();

        let url = `${baseUrl}/api/realtime`;

        const params = new URLSearchParams();

        // Add auth token if available
        if (token) {
            params.set('token', token);
        }

        // Add table filter
        if (this._name !== '*') {
            params.set('table', this._name);
        }

        const queryString = params.toString();
        return queryString ? `${url}?${queryString}` : url;
    }
}

// ============================================================================
// Realtime Manager
// ============================================================================

export class OzyBaseRealtime {
    private _client: OzyBaseClient;
    private _channels: Map<string, OzyBaseRealtimeChannel> = new Map();

    constructor(client: OzyBaseClient) {
        this._client = client;
    }

    /**
     * Create or get a channel for a table
     * @param name - Table/channel name (use '*' for all tables)
     */
    channel(name: string): OzyBaseRealtimeChannel {
        if (this._channels.has(name)) {
            return this._channels.get(name)!;
        }

        const channel = new OzyBaseRealtimeChannel(this._client, name);
        this._channels.set(name, channel);
        return channel;
    }

    /**
     * Remove and unsubscribe a channel
     */
    removeChannel(channel: OzyBaseRealtimeChannel): void {
        channel.unsubscribe();
        for (const [name, ch] of this._channels) {
            if (ch === channel) {
                this._channels.delete(name);
                break;
            }
        }
    }

    /**
     * Remove all channels
     */
    removeAllChannels(): void {
        for (const channel of this._channels.values()) {
            channel.unsubscribe();
        }
        this._channels.clear();
    }
}

