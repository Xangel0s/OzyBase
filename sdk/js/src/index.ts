/**
 * FlowKore SDK
 * The official JavaScript/TypeScript SDK for FlowKore BaaS
 * 
 * @packageDocumentation
 * @module @flowkore/sdk
 * 
 * @example
 * ```typescript
 * import { createClient } from '@flowkore/sdk';
 * 
 * const flowkore = createClient('https://your-api.com');
 * 
 * // Authentication
 * const { data, error } = await flowkore.auth.signIn({
 *   email: 'user@example.com',
 *   password: 'password123'
 * });
 * 
 * // Database queries (Supabase-style)
 * const { data: products } = await flowkore
 *   .from('products')
 *   .select('*')
 *   .eq('active', true)
 *   .order('created_at', { ascending: false });
 * 
 * // Realtime subscriptions
 * flowkore
 *   .channel('products')
 *   .on('INSERT', (payload) => console.log('New:', payload.new))
 *   .subscribe();
 * ```
 */

// Main client
export { createClient, FlowKoreClient } from './client';
export type { FlowKoreClient as Client } from './client';

// Query Builder
export { FlowKoreQueryBuilder } from './query-builder';

// Auth
export { FlowKoreAuth, type AuthChangeEvent } from './auth';

// Realtime
export { FlowKoreRealtime, FlowKoreRealtimeChannel } from './realtime';

// Types
export type {
    // Response types
    FlowKoreResponse,
    SingleResponse,
    ListResponse,
    FlowKoreError,

    // Auth types
    User,
    Session,
    AuthResponse,
    SignUpCredentials,
    SignInCredentials,

    // Database types
    BaseRecord,
    Row,
    InsertPayload,
    UpdatePayload,

    // Query types
    FilterOperator,
    FilterCondition,
    QueryOptions,

    // Realtime types
    RealtimeEvent,
    RealtimePayload,
    RealtimeCallback,
    RealtimeChannel,

    // Storage types
    FileObject,
    UploadOptions,

    // Configuration
    FlowKoreClientOptions,

    // TypeGen helpers
    Database,
    TableName,
    TableRow,
    TableInsert,
    TableUpdate,
} from './types';

// Default export
export { createClient as default } from './client';
