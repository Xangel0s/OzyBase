export type AuthFetchOptions = RequestInit & {
    headers?: HeadersInit;
    onUnauthorized?: 'logout' | 'passthrough';
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
let csrfTokenCache: string | null = null;
let csrfTokenPromise: Promise<string | null> | null = null;
let pageLifecycleSettling = false;

declare global {
    interface Window {
        __ozyLifecycleHooksInstalled?: boolean;
    }
}

if (typeof window !== 'undefined' && !window.__ozyLifecycleHooksInstalled) {
    window.__ozyLifecycleHooksInstalled = true;
    window.addEventListener('pagehide', () => {
        pageLifecycleSettling = true;
    }, { capture: true });
    window.addEventListener('beforeunload', () => {
        pageLifecycleSettling = true;
    }, { capture: true });
    window.addEventListener('pageshow', () => {
        pageLifecycleSettling = false;
    }, { capture: true });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            pageLifecycleSettling = false;
        }
    });
}

const clearAuthStorage = () => {
    localStorage.removeItem('ozy_token');
    localStorage.removeItem('ozy_api_key');
    localStorage.removeItem('ozy_user');
    localStorage.removeItem('ozy_workspace_id');
    localStorage.removeItem('ozy_auth_mode');
};

const isLikelyJWT = (value: string): boolean => {
    const parts = String(value || '').trim().split('.');
    return parts.length === 3 && parts.every((part) => part.length > 0);
};

const isSameOriginRequest = (url: string): boolean => {
    try {
        const target = new URL(url, window.location.origin);
        return target.origin === window.location.origin;
    } catch {
        return false;
    }
};

const looksLikeCSRFFailure = async (res: Response): Promise<boolean> => {
    try {
        const payload = await res.clone().json() as { error?: unknown; message?: unknown };
        const message = String(payload.error ?? payload.message ?? '').toLowerCase();
        return message.includes('csrf');
    } catch {
        return false;
    }
};

const resolveCSRFToken = async (forceRefresh = false): Promise<string | null> => {
    if (!forceRefresh && csrfTokenCache) {
        return csrfTokenCache;
    }
    if (!forceRefresh && csrfTokenPromise) {
        return csrfTokenPromise;
    }

    csrfTokenPromise = fetch('/api/auth/csrf', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
    })
        .then(async (res) => {
            if (!res.ok) {
                return null;
            }
            const data = await res.json() as { csrf_token?: unknown };
            const token = typeof data.csrf_token === 'string' ? data.csrf_token.trim() : '';
            csrfTokenCache = token || null;
            return csrfTokenCache;
        })
        .catch(() => null)
        .finally(() => {
            csrfTokenPromise = null;
        });

    return csrfTokenPromise;
};

const fetchWithAuthInternal = async (url: string, options: AuthFetchOptions = {}, retryingCSRF = false): Promise<Response> => {
    const token = localStorage.getItem('ozy_token')?.trim();
    const apiKey = localStorage.getItem('ozy_api_key')?.trim();
    const workspaceId = localStorage.getItem('ozy_workspace_id')?.trim();
    const method = (options.method || 'GET').toUpperCase();
    const sameOrigin = isSameOriginRequest(url);

    const { onUnauthorized, ...requestOptions } = options;
    const unauthorizedMode = onUnauthorized || 'logout';
    const headers = new Headers(options.headers ?? {});
    const hasBody = options.body !== undefined && options.body !== null;
    const isFormDataBody = typeof FormData !== 'undefined' && options.body instanceof FormData;
    if (hasBody && !isFormDataBody && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }
    if (sameOrigin && token && isLikelyJWT(token) && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
    } else if (sameOrigin && apiKey && !headers.has('apikey') && !headers.has('X-Ozy-Key')) {
        headers.set('apikey', apiKey);
    }
    if (sameOrigin && workspaceId && !headers.has('X-Workspace-Id')) {
        headers.set('X-Workspace-Id', workspaceId);
    }
    if (sameOrigin && workspaceId && !headers.has('X-Ozy-Project-ID')) {
        headers.set('X-Ozy-Project-ID', workspaceId);
    }

    const authenticatedRequest = headers.has('Authorization') || headers.has('apikey') || headers.has('X-Ozy-Key');
    const needsCSRF = sameOrigin && !SAFE_METHODS.has(method) && !headers.has('X-CSRF-Token');
    if (needsCSRF) {
        const csrfToken = await resolveCSRFToken(retryingCSRF);
        if (csrfToken) {
            headers.set('X-CSRF-Token', csrfToken);
        }
    }

    const res = await fetch(url, {
        credentials: sameOrigin ? 'same-origin' : requestOptions.credentials,
        ...requestOptions,
        headers,
    });

    if (res.status === 403 && needsCSRF && !retryingCSRF && await looksLikeCSRFFailure(res)) {
        csrfTokenCache = null;
        return fetchWithAuthInternal(url, options, true);
    }

    if (res.status === 401 && authenticatedRequest && unauthorizedMode !== 'passthrough') {
        clearAuthStorage();
        window.location.reload();
        throw new Error('Unauthorized');
    }

    return res;
};

export const fetchWithAuth = async (url: string, options: AuthFetchOptions = {}): Promise<Response> => (
    fetchWithAuthInternal(url, options)
);

export const readJsonIfOk = async <T>(res: Response): Promise<T | null> => {
    if (!res.ok) {
        return null;
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('json')) {
        return null;
    }

    return res.json().catch(() => null) as Promise<T | null>;
};

const isPageLifecycleSettling = () => {
    if (pageLifecycleSettling) {
        return true;
    }

    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return true;
    }

    return false;
};

export const isAbortLikeError = (error: unknown, signal?: AbortSignal | null): boolean => {
    if (!error) {
        return false;
    }

    if (signal?.aborted) {
        return true;
    }

    if (error instanceof DOMException && error.name === 'AbortError') {
        return true;
    }

    const name = typeof error === 'object' && error && 'name' in error
        ? String((error as { name?: unknown }).name ?? '')
        : '';
    if (name === 'AbortError') {
        return true;
    }

    const message = typeof error === 'object' && error && 'message' in error
        ? String((error as { message?: unknown }).message ?? '')
        : String(error);
    const normalizedMessage = message.toLowerCase();

    if (normalizedMessage.includes('aborted')) {
        return true;
    }

    if (!isPageLifecycleSettling()) {
        return false;
    }

    return (
        normalizedMessage.includes('failed to fetch')
        || normalizedMessage.includes('networkerror')
        || name === 'TypeError'
    );
};

