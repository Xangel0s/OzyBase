/**
 * OzyBase SDK
 * The official JavaScript/TypeScript SDK for OzyBase BaaS
 * 
 * @packageDocumentation
 * @module @OzyBase/sdk
 * 
 * @example
 * ```typescript
 * import { createClient } from '@OzyBase/sdk';
 * 
 * const OzyBase = createClient('https://your-api.com');
 * 
 * // Authentication
 * const { data, error } = await OzyBase.auth.signIn({
 *   email: 'user@example.com',
 *   password: 'password123'
 * });
 * 
 * // Database queries (Supabase-style)
 * const { data: products } = await OzyBase
 *   .from('products')
 *   .select('*')
 *   .eq('active', true)
 *   .order('created_at', { ascending: false });
 * 
 * // Realtime subscriptions
 * OzyBase
 *   .channel('products')
 *   .on('INSERT', (payload) => console.log('New:', payload.new))
 *   .subscribe();
 * ```
 */

// Main client
export { createClient, OzyBaseClient } from './client';
export type { OzyBaseClient as Client } from './client';

// Query Builder
export { OzyBaseQueryBuilder } from './query-builder';

// Auth
export { OzyBaseAuth, type AuthChangeEvent } from './auth';

// Realtime
export { OzyBaseRealtime, OzyBaseRealtimeChannel } from './realtime';

// Types
export type {
    // Response types
    OzyBaseResponse,
    SingleResponse,
    ListResponse,
    OzyBaseError,

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
    OzyBaseClientOptions,

    // TypeGen helpers
    Database,
    TableName,
    TableRow,
    TableInsert,
    TableUpdate,
} from './types';

// Default export
export { createClient as default } from './client';

