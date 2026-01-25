/**
 * OzyBase Client
 * Main entry point - Supabase-style API
 * 
 * Usage:
 *   import { createClient } from '@OzyBase/sdk';
 *   
 *   const OzyBase = createClient('https://your-api.com');
 *   
 *   // Auth
 *   await OzyBase.auth.signIn({ email, password });
 *   
 *   // Database queries
 *   const { data, error } = await OzyBase
 *     .from('products')
 *     .select('*')
 *     .eq('active', true);
 *   
 *   // Realtime
 *   OzyBase
 *     .channel('products')
 *     .on('INSERT', (payload) => console.log(payload))
 *     .subscribe();
 */

import type { OzyBaseClientOptions, Database, TableName } from './types';
import { OzyBaseQueryBuilder } from './query-builder';
import { OzyBaseAuth } from './auth';
import { OzyBaseRealtime, OzyBaseRealtimeChannel } from './realtime';

export class OzyBaseClient<DB extends Database = Database> {
    private _baseUrl: string;
    private _headers: Record<string, string>;
    private _customFetch: typeof fetch;

    public readonly auth: OzyBaseAuth;
    private readonly _realtime: OzyBaseRealtime;

    constructor(url: string, options?: OzyBaseClientOptions) {
        // Normalize URL (remove trailing slash)
        this._baseUrl = url.replace(/\/$/, '');

        // Setup headers
        this._headers = {
            'Content-Type': 'application/json',
            ...options?.headers,
        };

        // Setup fetch
        this._customFetch = options?.fetch ?? globalThis.fetch.bind(globalThis);

        // Initialize modules
        this.auth = new OzyBaseAuth(this as any, options?.auth);
        this._realtime = new OzyBaseRealtime(this as any);
    }

    // ============================================================================
    // Database Operations (Supabase-style)
    // ============================================================================

    /**
     * Start a query on a table
     * @param table - Table/collection name
     * @returns Query builder with fluent API
     * 
     * @example
     * // Select all products
     * const { data, error } = await client.from('products').select('*');
     * 
     * // With filters and ordering
     * const { data, error } = await client
     *   .from('products')
     *   .select('id, name, price')
     *   .eq('active', true)
     *   .gt('price', 100)
     *   .order('created_at', { ascending: false })
     *   .limit(10);
     * 
     * // Insert
     * const { data, error } = await client
     *   .from('products')
     *   .insert({ name: 'New Product', price: 99.99 });
     * 
     * // Update
     * const { data, error } = await client
     *   .from('products')
     *   .update({ price: 149.99 })
     *   .eq('id', 'product-id');
     * 
     * // Delete
     * const { data, error } = await client
     *   .from('products')
     *   .delete()
     *   .eq('id', 'product-id');
     */
    from<TableNameT extends TableName<DB> | string>(
        table: TableNameT
    ): OzyBaseQueryBuilder<
        TableNameT extends TableName<DB>
        ? DB[TableNameT]['Row']
        : Record<string, unknown>
    > {
        return new OzyBaseQueryBuilder(this as any, table);
    }

    // ============================================================================
    // Realtime Operations
    // ============================================================================

    /**
     * Create a realtime channel for a table
     * @param name - Channel/table name (use '*' for all)
     * 
     * @example
     * const channel = client
     *   .channel('products')
     *   .on('INSERT', (payload) => {
     *     console.log('New product:', payload.new);
     *   })
     *   .on('UPDATE', (payload) => {
     *     console.log('Updated:', payload.new);
     *   })
     *   .subscribe((status) => {
     *     console.log('Subscription status:', status);
     *   });
     * 
     * // Unsubscribe when done
     * channel.unsubscribe();
     */
    channel(name: string): OzyBaseRealtimeChannel {
        return this._realtime.channel(name);
    }

    /**
     * Remove a realtime channel
     */
    removeChannel(channel: OzyBaseRealtimeChannel): void {
        this._realtime.removeChannel(channel);
    }

    /**
     * Remove all realtime channels
     */
    removeAllChannels(): void {
        this._realtime.removeAllChannels();
    }

    // ============================================================================
    // RPC (Remote Procedure Calls)
    // ============================================================================

    /**
     * Call a server function
     * @param fn - Function name
     * @param params - Function parameters
     * 
     * @example
     * const { data, error } = await client.rpc('calculate_total', { 
     *   order_id: '123' 
     * });
     */
    async rpc<T = unknown>(
        fn: string,
        params?: Record<string, unknown>
    ): Promise<{ data: T | null; error: { message: string } | null }> {
        try {
            const data = await this.request<T>(`/api/rpc/${fn}`, {
                method: 'POST',
                body: params ? JSON.stringify(params) : undefined,
            });
            return { data, error: null };
        } catch (err) {
            const error = err as Error;
            return { data: null, error: { message: error.message } };
        }
    }

    // ============================================================================
    // Internal Methods (exposed for modules)
    // ============================================================================

    /**
     * Make an authenticated request to the API
     * @internal
     */
    async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
        const url = `${this._baseUrl}${endpoint}`;

        // Build headers with auth token
        const headers: Record<string, string> = {
            ...this._headers,
            ...(options.headers as Record<string, string> || {}),
        };

        // Add auth token if available
        const token = this.auth.getAccessToken();
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await this._customFetch(url, {
            ...options,
            headers,
        });

        // Parse response
        const contentType = response.headers.get('content-type');
        const isJson = contentType?.includes('application/json');

        if (!response.ok) {
            const errorBody = isJson ? await response.json() : await response.text();
            const error = new Error(
                typeof errorBody === 'object' && errorBody.error
                    ? errorBody.error
                    : typeof errorBody === 'object' && errorBody.message
                        ? errorBody.message
                        : errorBody || `HTTP ${response.status}`
            ) as Error & { status: number; code: string };
            error.status = response.status;
            error.code = `HTTP_${response.status}`;
            throw error;
        }

        if (!isJson) {
            return (await response.text()) as unknown as T;
        }

        return response.json();
    }

    /**
     * Get the base URL
     * @internal
     */
    getBaseUrl(): string {
        return this._baseUrl;
    }

    /**
     * Get the current access token
     * @internal
     */
    getAccessToken(): string | null {
        return this.auth.getAccessToken();
    }
}

// ============================================================================
// Factory Function (Supabase-style)
// ============================================================================

/**
 * Create a new OzyBase client
 * 
 * @param url - Your OzyBase API URL
 * @param options - Client configuration options
 * @returns OzyBase client instance
 * 
 * @example
 * import { createClient } from '@OzyBase/sdk';
 * 
 * // Basic usage
 * const OzyBase = createClient('https://your-api.com');
 * 
 * // With options
 * const OzyBase = createClient('https://your-api.com', {
 *   auth: {
 *     persistSession: true,
 *     autoRefreshToken: true,
 *   },
 *   headers: {
 *     'X-Custom-Header': 'value',
 *   },
 * });
 * 
 * // With TypeScript types (after running `OzyBase gen-types`)
 * import { Database } from './types/OzyBase';
 * const OzyBase = createClient<Database>('https://your-api.com');
 */
export function createClient<DB extends Database = Database>(
    url: string,
    options?: OzyBaseClientOptions
): OzyBaseClient<DB> {
    return new OzyBaseClient<DB>(url, options);
}

// Default export for convenience
export default createClient;

