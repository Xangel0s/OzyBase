import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getDefaultViewForSection, VIEW_REGISTRY } from '../viewRegistry';

const DEFAULT_VIEW = 'overview';

export function useViewRouting(): [string, (view: string) => void] {
    const [searchParams, setSearchParams] = useSearchParams();

    const resolveView = useCallback((raw: string) => {
        if (!raw || raw === DEFAULT_VIEW) return DEFAULT_VIEW;
        if (VIEW_REGISTRY[raw]) return raw;
        return getDefaultViewForSection(raw) || DEFAULT_VIEW;
    }, []);

    const viewFromUrl = useMemo(() => {
        return resolveView(searchParams.get('view') || DEFAULT_VIEW);
    }, [searchParams, resolveView]);

    const setView = useCallback((view: string) => {
        const target = VIEW_REGISTRY[view] ? view : (getDefaultViewForSection(view) || DEFAULT_VIEW);
        setSearchParams({ view: target }, { replace: true });
    }, [setSearchParams]);

    return [viewFromUrl, setView];
}
