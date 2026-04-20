import { useCallback, useEffect, useState } from 'react';

const SYSTEM_STATUS_RETRY_DELAYS_MS = [0, 250, 600];

export const useSystemStatus = () => {
    const [isSystemInitialized, setIsSystemInitialized] = useState(true);
    const [checkingSystem, setCheckingSystem] = useState(true);

    const checkSystemStatus = useCallback(async () => {
        try {
            for (let attempt = 0; attempt < SYSTEM_STATUS_RETRY_DELAYS_MS.length; attempt += 1) {
                if (attempt > 0) {
                    await new Promise((resolve) => window.setTimeout(resolve, SYSTEM_STATUS_RETRY_DELAYS_MS[attempt]));
                }

                const res = await fetch('/api/system/status', {
                    cache: 'no-store',
                    headers: { Accept: 'application/json' },
                });
                if (!res.ok) {
                    continue;
                }

                const data = await res.json();
                setIsSystemInitialized(Boolean(data.initialized));
                return;
            }
        } catch {
            setIsSystemInitialized(false);
        } finally {
            setCheckingSystem(false);
        }
    }, []);

    useEffect(() => {
        void checkSystemStatus();
    }, [checkSystemStatus]);

    return {
        isSystemInitialized,
        setIsSystemInitialized,
        checkingSystem,
    };
};

