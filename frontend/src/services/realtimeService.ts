import { fetchWithAuth } from '../utils/api';

export interface RealtimeSession {
    token: string;
    channels: string[];
}

export const createRealtimeSession = async (channels: string[] = []): Promise<RealtimeSession> => {
    const res = await fetchWithAuth('/api/realtime/session', {
        method: 'POST',
        body: JSON.stringify({
            channels,
            expires_in: 300,
        }),
    });

    if (res.status === 404 || res.status === 405) {
        // Fallback for legacy realtime endpoints without session tokens
        return { token: '', channels: [] };
    }

    if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || `Failed to create realtime session (${res.status})`);
    }

    return res.json();
};

export const fetchRealtimeStatus = async (tableName: string): Promise<boolean> => {
    const res = await fetchWithAuth('/api/collections');
    if (!res.ok) return false;
    const collections = await res.json();
    const current = collections.find((c: any) => c.name === tableName);
    return Boolean(current?.realtime_enabled);
};

export const toggleRealtime = async (tableName: string, enabled: boolean): Promise<void> => {
    const res = await fetchWithAuth('/api/collections/realtime', {
        method: 'PATCH',
        body: JSON.stringify({ name: tableName, enabled }),
    });
    if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to toggle realtime');
    }
};
