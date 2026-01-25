/**
 * OzyBase Auth Module
 * Supabase-style authentication API
 * 
 * Usage:
 *   const { data, error } = await client.auth.signUp({
 *     email: 'user@example.com',
 *     password: 'securePassword123!'
 *   });
 */

import type {
    User,
    Session,
    AuthResponse,
    SignUpCredentials,
    SignInCredentials,
    OzyBaseError,
} from './types';
import type { OzyBaseClient } from './client';

// Storage interface for session persistence
interface StorageAdapter {
    getItem(key: string): string | null | Promise<string | null>;
    setItem(key: string, value: string): void | Promise<void>;
    removeItem(key: string): void | Promise<void>;
}

// Default localStorage adapter (browser)
const browserStorage: StorageAdapter = {
    getItem: (key) => {
        if (typeof localStorage !== 'undefined') {
            return localStorage.getItem(key);
        }
        return null;
    },
    setItem: (key, value) => {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(key, value);
        }
    },
    removeItem: (key) => {
        if (typeof localStorage !== 'undefined') {
            localStorage.removeItem(key);
        }
    },
};

// Memory storage (for Node.js or when localStorage is unavailable)
const memoryStorage: StorageAdapter = (() => {
    const store = new Map<string, string>();
    return {
        getItem: (key) => store.get(key) ?? null,
        setItem: (key, value) => { store.set(key, value); },
        removeItem: (key) => { store.delete(key); },
    };
})();

export interface AuthConfig {
    autoRefreshToken?: boolean;
    persistSession?: boolean;
    storageKey?: string;
    storage?: StorageAdapter;
}

export class OzyBaseAuth {
    private _client: OzyBaseClient;
    private _config: Required<AuthConfig>;
    private _storage: StorageAdapter;
    private _currentSession: Session | null = null;
    private _currentUser: User | null = null;
    private _refreshTimer?: ReturnType<typeof setTimeout>;
    private _listeners: Set<(event: AuthChangeEvent, session: Session | null) => void> = new Set();

    constructor(client: OzyBaseClient, config?: AuthConfig) {
        this._client = client;
        this._config = {
            autoRefreshToken: config?.autoRefreshToken ?? true,
            persistSession: config?.persistSession ?? true,
            storageKey: config?.storageKey ?? 'OzyBase-auth-token',
            storage: config?.storage ?? (typeof localStorage !== 'undefined' ? browserStorage : memoryStorage),
        };
        this._storage = this._config.storage;

        // Try to recover session on init
        this._recoverSession();
    }

    // ============================================================================
    // Public API (Supabase-compatible)
    // ============================================================================

    /**
     * Sign up a new user
     */
    async signUp(credentials: SignUpCredentials): Promise<AuthResponse> {
        try {
            const response = await this._client.request<{ user: User; token?: string; session?: Session }>(
                '/api/auth/signup',
                {
                    method: 'POST',
                    body: JSON.stringify({
                        email: credentials.email,
                        password: credentials.password,
                        ...credentials.options?.data,
                    }),
                }
            );

            // Build session from response
            const session: Session | null = response.token ? {
                access_token: response.token,
                token_type: 'bearer',
                user: response.user,
            } : response.session ?? null;

            if (session) {
                await this._setSession(session);
            }

            return {
                data: {
                    user: response.user,
                    session,
                },
                error: null,
            };
        } catch (err) {
            return this._handleError(err);
        }
    }

    /**
     * Sign in with email and password
     */
    async signInWithPassword(credentials: SignInCredentials): Promise<AuthResponse> {
        try {
            const response = await this._client.request<{ user: User; token: string }>(
                '/api/auth/login',
                {
                    method: 'POST',
                    body: JSON.stringify({
                        email: credentials.email,
                        password: credentials.password,
                    }),
                }
            );

            const session: Session = {
                access_token: response.token,
                token_type: 'bearer',
                user: response.user,
            };

            await this._setSession(session);

            return {
                data: {
                    user: response.user,
                    session,
                },
                error: null,
            };
        } catch (err) {
            return this._handleError(err);
        }
    }

    /**
     * Alias for signInWithPassword (Supabase compatibility)
     */
    async signIn(credentials: SignInCredentials): Promise<AuthResponse> {
        return this.signInWithPassword(credentials);
    }

    /**
     * Sign out the current user
     */
    async signOut(): Promise<{ error: OzyBaseError | null }> {
        try {
            await this._clearSession();
            return { error: null };
        } catch (err) {
            const error = err as Error;
            return {
                error: {
                    message: error.message,
                    code: 'SIGNOUT_ERROR',
                },
            };
        }
    }

    /**
     * Get the current session
     */
    async getSession(): Promise<{ data: { session: Session | null }; error: null }> {
        return {
            data: { session: this._currentSession },
            error: null,
        };
    }

    /**
     * Get the current user
     */
    async getUser(): Promise<{ data: { user: User | null }; error: null }> {
        return {
            data: { user: this._currentUser },
            error: null,
        };
    }

    /**
     * Update the current user's data
     */
    async updateUser(attributes: Partial<User>): Promise<AuthResponse> {
        try {
            const response = await this._client.request<User>(
                '/api/auth/user',
                {
                    method: 'PATCH',
                    body: JSON.stringify(attributes),
                }
            );

            if (this._currentSession) {
                this._currentSession.user = response;
                this._currentUser = response;
                await this._saveSession(this._currentSession);
            }

            return {
                data: {
                    user: response,
                    session: this._currentSession,
                },
                error: null,
            };
        } catch (err) {
            return this._handleError(err);
        }
    }

    /**
     * Subscribe to auth state changes
     */
    onAuthStateChange(
        callback: (event: AuthChangeEvent, session: Session | null) => void
    ): { data: { subscription: { unsubscribe: () => void } } } {
        this._listeners.add(callback);

        // Immediately call with current state
        callback(
            this._currentSession ? 'SIGNED_IN' : 'SIGNED_OUT',
            this._currentSession
        );

        return {
            data: {
                subscription: {
                    unsubscribe: () => {
                        this._listeners.delete(callback);
                    },
                },
            },
        };
    }

    /**
     * Get the current access token (for manual use)
     */
    getAccessToken(): string | null {
        return this._currentSession?.access_token ?? null;
    }

    // ============================================================================
    // Internal Methods
    // ============================================================================

    private async _setSession(session: Session): Promise<void> {
        this._currentSession = session;
        this._currentUser = session.user;

        if (this._config.persistSession) {
            await this._saveSession(session);
        }

        this._notifyListeners('SIGNED_IN', session);

        // Setup auto refresh if enabled
        if (this._config.autoRefreshToken && session.expires_in) {
            this._setupRefreshTimer(session.expires_in);
        }
    }

    private async _clearSession(): Promise<void> {
        this._currentSession = null;
        this._currentUser = null;

        if (this._refreshTimer) {
            clearTimeout(this._refreshTimer);
        }

        if (this._config.persistSession) {
            await this._storage.removeItem(this._config.storageKey);
        }

        this._notifyListeners('SIGNED_OUT', null);
    }

    private async _saveSession(session: Session): Promise<void> {
        await this._storage.setItem(
            this._config.storageKey,
            JSON.stringify(session)
        );
    }

    private async _recoverSession(): Promise<void> {
        try {
            const stored = await this._storage.getItem(this._config.storageKey);
            if (stored) {
                const session = JSON.parse(stored) as Session;
                this._currentSession = session;
                this._currentUser = session.user;
                this._notifyListeners('INITIAL_SESSION', session);
            }
        } catch {
            // Ignore parsing errors
        }
    }

    private _setupRefreshTimer(expiresIn: number): void {
        // Refresh 1 minute before expiry
        const refreshTime = (expiresIn - 60) * 1000;

        if (this._refreshTimer) {
            clearTimeout(this._refreshTimer);
        }

        this._refreshTimer = setTimeout(() => {
            this._refreshToken();
        }, Math.max(refreshTime, 0));
    }

    private async _refreshToken(): Promise<void> {
        if (!this._currentSession?.refresh_token) {
            return;
        }

        try {
            const response = await this._client.request<{ token: string; user: User }>(
                '/api/auth/refresh',
                {
                    method: 'POST',
                    body: JSON.stringify({
                        refresh_token: this._currentSession.refresh_token,
                    }),
                }
            );

            const newSession: Session = {
                ...this._currentSession,
                access_token: response.token,
                user: response.user,
            };

            await this._setSession(newSession);
            this._notifyListeners('TOKEN_REFRESHED', newSession);
        } catch {
            // Token refresh failed, sign out
            await this._clearSession();
        }
    }

    private _notifyListeners(event: AuthChangeEvent, session: Session | null): void {
        for (const listener of this._listeners) {
            listener(event, session);
        }
    }

    private _handleError(err: unknown): AuthResponse {
        const error = err as Error & { status?: number; code?: string };
        return {
            data: {
                user: null,
                session: null,
            },
            error: {
                message: error.message,
                code: error.code ?? 'AUTH_ERROR',
                status: error.status,
            },
        };
    }
}

// Auth event types
export type AuthChangeEvent =
    | 'INITIAL_SESSION'
    | 'SIGNED_IN'
    | 'SIGNED_OUT'
    | 'TOKEN_REFRESHED'
    | 'USER_UPDATED'
    | 'PASSWORD_RECOVERY';

