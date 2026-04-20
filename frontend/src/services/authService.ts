import { fetchWithAuth } from '../utils/api';

export interface LoginResponse {
    token?: string;
    user?: any;
    mfa_required?: boolean;
    mfa_store?: string;
    error?: string;
}

export const login = async (email: string, password: string): Promise<LoginResponse> => {
    const res = await fetchWithAuth('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
    });
    return res.json();
};

export const verifyMfa = async (userId: string, code: string): Promise<LoginResponse> => {
    const res = await fetchWithAuth('/api/auth/2fa/verify', {
        method: 'POST',
        body: JSON.stringify({ user_id: userId, code }),
    });
    return res.json();
};

export const requestPasswordReset = async (email: string): Promise<{ token?: string; error?: string }> => {
    const res = await fetchWithAuth('/api/auth/reset-password/request', {
        method: 'POST',
        body: JSON.stringify({ email }),
    });
    return res.json();
};

export const confirmPasswordReset = async (token: string, newPassword: string): Promise<{ error?: string }> => {
    const res = await fetchWithAuth('/api/auth/reset-password/confirm', {
        method: 'POST',
        body: JSON.stringify({ token, new_password: newPassword }),
    });
    return res.json();
};

export const getSocialLoginUrl = async (provider: 'google' | 'github'): Promise<string> => {
    const res = await fetch(`/api/auth/login/${provider}`);
    const data = await res.json();
    if (!data.url) throw new Error('Failed to get auth URL');
    return data.url;
};
