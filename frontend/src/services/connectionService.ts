import { fetchWithAuth } from '../utils/api';

export interface ProjectConnection {
    host: string;
    port: number;
    user: string;
    database: string;
    ssl: boolean;
    type?: string;
}

export interface ProjectKeys {
    role: string;
    key: string;
    prefix: string;
}

export interface ConnectionSummary {
    connection?: ProjectConnection;
    api_url?: string;
    anon_key_prefix?: string;
    service_role_key_prefix?: string;
    last_verified_at?: string;
    edge_functions_count?: number;
    schemas_count?: number;
}

export const fetchConnectionMetadata = async (): Promise<ConnectionSummary> => {
    const res = await fetchWithAuth('/api/project/connection');
    if (!res.ok) {
        throw new Error('Failed to fetch connection metadata');
    }
    return res.json();
};

export const verifyAdminIdentity = async (password: string): Promise<{ verified_until: string; verification_token?: string }> => {
    const res = await fetchWithAuth('/api/project/keys/essential/verify', {
        method: 'POST',
        body: JSON.stringify({ password }),
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Identity verification failed' }));
        throw new Error(data.error || 'Identity verification failed');
    }
    return res.json();
};

export const revealProjectKey = async (role: 'anon' | 'service_role', verificationToken?: string | null): Promise<{ key: string; prefix: string }> => {
    const res = await fetchWithAuth(`/api/project/keys/essential/${role}/reveal`, {
        method: 'POST',
        body: JSON.stringify({ verification_token: verificationToken }),
        onUnauthorized: 'passthrough'
    });
    if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to reveal ${role} key`);
    }
    return res.json();
};
