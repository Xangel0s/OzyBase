/**
 * OzyBase SDK Types
 * Supabase-compatible response format
 */

// ============================================================================
// Response Types (Supabase-style)
// ============================================================================

/**
 * Standard response format - identical to Supabase
 * Always returns { data, error } for consistent error handling
 */
export type OzyBaseResponse<T> = {
    data: T;
    error: null;
} | {
    data: null;
    error: OzyBaseError;
};

/**
 * Single item response
 */
export type SingleResponse<T> = OzyBaseResponse<T>;

/**
 * Array response with optional count
 */
export type ListResponse<T> = OzyBaseResponse<T[]> & {
    count?: number;
};

// ============================================================================
// Error Types
// ============================================================================

export interface OzyBaseError {
    message: string;
    code?: string;
    status?: number;
    details?: unknown;
}

// ============================================================================
// Auth Types
// ============================================================================

export interface User {
    id: string;
    email: string;
    role?: string;
    created_at: string;
    updated_at: string;
}

export interface Session {
    access_token: string;
    token_type: string;
    expires_in?: number;
    expires_at?: number;
    refresh_token?: string;
    user: User;
}

export interface AuthResponse {
    data: {
        user: User | null;
        session: Session | null;
    };
    error: OzyBaseError | null;
}

export interface SignUpCredentials {
    email: string;
    password: string;
    options?: {
        data?: Record<string, unknown>;
    };
}

export interface SignInCredentials {
    email: string;
    password: string;
}

// ============================================================================
// Database Types
// ============================================================================

/**
 * Base record with common fields (like Supabase rows)
 */
export interface BaseRecord {
    id: string;
    created_at: string;
    updated_at: string;
}

/**
 * Generic database row
 */
export type Row<T = Record<string, unknown>> = T & BaseRecord;

/**
 * Insert payload (without auto-generated fields)
 */
export type InsertPayload<T> = Omit<T, 'id' | 'created_at' | 'updated_at'>;

/**
 * Update payload (partial, without auto-generated fields)
 */
export type UpdatePayload<T> = Partial<Omit<T, 'id' | 'created_at' | 'updated_at'>>;

// ============================================================================
// Query Builder Types
// ============================================================================

export type FilterOperator =
    | 'eq' | 'neq'
    | 'gt' | 'gte' | 'lt' | 'lte'
    | 'like' | 'ilike'
    | 'in' | 'is'
    | 'contains' | 'containedBy';

export interface FilterCondition {
    column: string;
    operator: FilterOperator;
    value: unknown;
}

export interface QueryOptions {
    columns?: string;
    filters?: FilterCondition[];
    order?: { column: string; ascending?: boolean }[];
    limit?: number;
    offset?: number;
    single?: boolean;
    count?: 'exact' | 'planned' | 'estimated';
}

// ============================================================================
// Realtime Types
// ============================================================================

export type RealtimeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*';

export interface RealtimePayload<T = Record<string, unknown>> {
    eventType: RealtimeEvent;
    new: T | null;
    old: T | null;
    table: string;
    schema: string;
    commit_timestamp: string;
}

export type RealtimeCallback<T = Record<string, unknown>> = (
    payload: RealtimePayload<T>
) => void;

export interface RealtimeChannel {
    on<T = Record<string, unknown>>(
        event: RealtimeEvent,
        callback: RealtimeCallback<T>
    ): RealtimeChannel;
    subscribe(callback?: (status: string) => void): RealtimeChannel;
    unsubscribe(): void;
}

// ============================================================================
// Storage Types
// ============================================================================

export interface FileObject {
    id: string;
    name: string;
    bucket_id?: string;
    owner?: string;
    created_at: string;
    updated_at: string;
    metadata?: Record<string, unknown>;
}

export interface UploadOptions {
    cacheControl?: string;
    contentType?: string;
    upsert?: boolean;
}

// ============================================================================
// Client Configuration
// ============================================================================

export interface OzyBaseClientOptions {
    /**
     * Custom headers to include in every request
     */
    headers?: Record<string, string>;

    /**
     * Custom fetch implementation
     */
    fetch?: typeof fetch;

    /**
     * Auth configuration
     */
    auth?: {
        /**
         * Automatically refresh the token before expiry
         * @default true
         */
        autoRefreshToken?: boolean;

        /**
         * Persist session to localStorage
         * @default true
         */
        persistSession?: boolean;

        /**
         * Storage key for the session
         * @default 'OzyBase-auth-token'
         */
        storageKey?: string;
    };

    /**
     * Realtime configuration
     */
    realtime?: {
        /**
         * Enable realtime subscriptions
         * @default true
         */
        enabled?: boolean;
    };
}

// ============================================================================
// Utility Types for TypeGen (Phase 3)
// ============================================================================

/**
 * Database schema type - will be generated by `OzyBase gen-types`
 * Users can extend this with their own generated types
 */
export interface Database {
    [tableName: string]: {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
    };
}

/**
 * Helper to extract table names from schema
 */
export type TableName<T extends Database> = keyof T & string;

/**
 * Helper to extract Row type from schema
 */
export type TableRow<T extends Database, Name extends TableName<T>> = T[Name]['Row'];

/**
 * Helper to extract Insert type from schema
 */
export type TableInsert<T extends Database, Name extends TableName<T>> = T[Name]['Insert'];

/**
 * Helper to extract Update type from schema
 */
export type TableUpdate<T extends Database, Name extends TableName<T>> = T[Name]['Update'];

