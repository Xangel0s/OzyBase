import { useEffect, useState } from 'react';
import { fetchWithAuth } from '../utils/api';

interface DeploymentProfile {
    isSingleTenant: boolean;
    profile: string;
    loading: boolean;
}

export function useDeploymentProfile(): DeploymentProfile {
    const [profile, setProfile] = useState<string>('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        fetchWithAuth('/api/project/info')
            .then(res => res.json().catch(() => ({})))
            .then(data => {
                if (cancelled) return;
                const p = String(data?.production?.profile || 'single_project_local');
                setProfile(p);
                setLoading(false);
            })
            .catch(() => {
                if (cancelled) return;
                setProfile('single_project_local');
                setLoading(false);
            });
        return () => { cancelled = true; };
    }, []);

    const isSingleTenant = profile === 'self_host' || profile === 'single_project_local';

    return { isSingleTenant, profile, loading };
}