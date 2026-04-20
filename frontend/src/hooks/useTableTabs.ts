import { useCallback, useEffect, useMemo, useState } from 'react';

interface UseTableTabsOptions {
    scopeKey?: string | null;
    availableTables?: string[];
}

const normalizeTabs = (raw: unknown): string[] => {
    if (!Array.isArray(raw)) return [];
    const unique = new Set<string>();
    for (const value of raw) {
        const normalized = String(value || '').trim();
        if (!normalized) continue;
        unique.add(normalized);
    }
    return Array.from(unique);
};

const readStoredTabs = (storageKey: string): string[] => {
    try {
        const stored = localStorage.getItem(storageKey);
        if (!stored) return [];
        return normalizeTabs(JSON.parse(stored));
    } catch {
        return [];
    }
};

export const useTableTabs = ({ scopeKey, availableTables = [] }: UseTableTabsOptions = {}) => {
    const storageKey = useMemo(
        () => (scopeKey ? `ozy_open_tabs_${scopeKey}` : 'ozy_open_tabs'),
        [scopeKey],
    );
    const availableTableSet = useMemo(() => {
        const normalized = availableTables
            .map((tableName) => String(tableName || '').trim())
            .filter(Boolean);
        return new Set(normalized);
    }, [availableTables]);

    const [selectedView, setSelectedView] = useState('overview');
    const [selectedTable, setSelectedTable] = useState<string | null>(null);
    const [openTableTabs, setOpenTableTabs] = useState<string[]>(() => readStoredTabs(storageKey));
    const [initialSqlQuery, setInitialSqlQuery] = useState<string | null>(null);

    useEffect(() => {
        setOpenTableTabs(readStoredTabs(storageKey));
        setSelectedTable(null);
        setInitialSqlQuery(null);
        setSelectedView('overview');
    }, [storageKey]);

    useEffect(() => {
        localStorage.setItem(storageKey, JSON.stringify(openTableTabs));
    }, [openTableTabs, storageKey]);

    useEffect(() => {
        setOpenTableTabs((current) => {
            if (current.length === 0) return current;
            const filtered = current.filter((tableName) => availableTableSet.has(tableName));
            return filtered.length === current.length ? current : filtered;
        });
    }, [availableTableSet]);

    useEffect(() => {
        if (!selectedTable) return;
        if (selectedTable.startsWith('__visualizer')) return;
        if (availableTableSet.has(selectedTable)) return;
        setSelectedTable(null);
        if (selectedView === 'table') {
            setSelectedView('overview');
        }
    }, [availableTableSet, selectedTable, selectedView]);

    const handleTableSelect = useCallback((tableName: string | null) => {
        if (
            tableName &&
            !tableName.startsWith('__visualizer') &&
            availableTableSet.size > 0 &&
            !availableTableSet.has(tableName)
        ) {
            return;
        }

        setSelectedTable(tableName);
        if (tableName && !tableName.startsWith('__visualizer')) {
            setOpenTableTabs((current) => (current.includes(tableName) ? current : [...current, tableName]));
        }

        if (tableName === '__visualizer__' || tableName === '__visualizer_system__') {
            setSelectedView('visualizer');
            return;
        }

        if (tableName) {
            setSelectedView('table');
        }
    }, [availableTableSet]);

    const handleCloseTab = useCallback((tableNameToClose: string) => {
        setOpenTableTabs((current) => {
            const next = current.filter((tableName) => tableName !== tableNameToClose);
            if (selectedTable === tableNameToClose) {
                if (next.length > 0) {
                    const closedIndex = current.indexOf(tableNameToClose);
                    const nextSelected = next[Math.min(closedIndex, next.length - 1)];
                    setSelectedTable(nextSelected);
                    setSelectedView('table');
                } else {
                    setSelectedTable(null);
                    setSelectedView('overview');
                }
            }
            return next;
        });
    }, [selectedTable]);

    const handleOpenSqlEditor = useCallback((tableName: string | null, prefillQuery?: string) => {
        setSelectedTable(tableName);
        setInitialSqlQuery(prefillQuery || null);
        setSelectedView('sql');
    }, []);

    return {
        selectedView,
        setSelectedView,
        selectedTable,
        setSelectedTable,
        openTableTabs,
        handleTableSelect,
        handleCloseTab,
        handleOpenSqlEditor,
        initialSqlQuery,
        setInitialSqlQuery,
    };
};

