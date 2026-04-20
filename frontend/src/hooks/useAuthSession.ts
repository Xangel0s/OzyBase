import { useEffect, useState } from 'react';
import { fetchWithAuth } from '../utils/api';

const isLikelyJWT = (value: unknown) => /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(String(value || ''));

export const useAuthSession = () => {
    const [isAuthenticated, setIsAuthenticated] = useState(isLikelyJWT(localStorage.getItem('ozy_token')));

    useEffect(() => {
        const url = new URL(window.location.href);
        const token = url.searchParams.get('token');
        if (!token) {
            return;
        }

        const clearTokenFromURL = () => {
            url.searchParams.delete('token');
            const search = url.searchParams.toString();
            const cleanURL = `${url.pathname}${search ? `?${search}` : ''}${url.hash}`;
            window.history.replaceState({}, document.title, cleanURL);
        };

        const pathname = window.location.pathname;

        if (pathname === '/reset-password') {
            sessionStorage.setItem('ozy_reset_token', token);
            clearTokenFromURL();
            return;
        }

        if (pathname === '/verify-email') {
            clearTokenFromURL();
            fetchWithAuth('/api/auth/verify-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token }),
            }).finally(() => {
                window.history.replaceState({}, document.title, '/');
            });
            return;
        }

        const isCallback = pathname === '/oauth/callback' || pathname.startsWith('/auth/callback');
        if (isCallback && isLikelyJWT(token)) {
            localStorage.setItem('ozy_token', token);
            clearTokenFromURL();
            setIsAuthenticated(true);
            return;
        }

        clearTokenFromURL();
    }, []);

    return {
        isAuthenticated,
        setIsAuthenticated,
    };
};

