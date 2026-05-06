import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
    LayoutGrid,
    Table2,
    Code,
    Database,
    Lock,
    FolderOpen,
    Zap,
    Activity,
    FileText,
    ShieldCheck,
    Settings,
    Bell,
    HelpCircle,
    ChevronDown,
    ChevronRight,
    Search,
    BarChart,
    Home,
    Terminal,
    Users,
    Key,
    PanelLeftClose,
    PanelLeftOpen,
    LogOut,
    Plus,
    X,
    MousePointer2,
    Lightbulb,
    Wifi,
    Telescope,
    List,
    User,
    Pin,
    PinOff,
    Shield,
    Globe,
    ShieldAlert,
    Cpu,
    History,
    CreditCard,
    Server,
    Check,
    Trash2,
    MoreHorizontal,
    Copy,
    Pencil,
    Download,
    CopyPlus,
    ShieldBan,
    AlertTriangle,
    Briefcase
} from 'lucide-react';
import { fetchWithAuth, isAbortLikeError, readJsonIfOk } from '../utils/api';
import { applyHealthFix, formatHealthFixSuccessMessage, type HealthFixIssue } from '../utils/healthFix';
import { findRLSIssueForTable, isRLSHealthIssue } from '../utils/healthIssues';
import { addProjectSyncListener, dispatchProjectSync } from '../utils/projectEvents';

import CreateTableModal from './CreateTableModal';
import ConnectionModal from './ConnectionModal';
import NotificationCenter from './NotificationCenter';
import AutoFixModal from './AutoFixModal';
import ConfirmModal from './ConfirmModal';
import WorkspaceSwitcher from './WorkspaceSwitcher';
import { BrandedToast } from './OverlayPrimitives';
import {
    PRIMARY_NAV,
    SUBMENUS,
    getDefaultViewForSection,
    getExplorerModule,
    getViewMeta,
    getViewLabel,
    isPrimaryNavActive,
    shouldRenderExplorerSidebar,
    shouldShowExplorer
} from '../viewRegistry';

interface LayoutProps {
    children: React.ReactNode;
    selectedView: string;
    selectedTable: string | null;
    workspaceId: string | null;
    onTableSelect: (tableName: string | null) => void;
    onMenuViewSelect: (view: string) => void;
    tables?: any[];
    refreshTables: () => void;
    onWorkspaceChange: (workspaceId: string | null) => void;
    isCreateTableModalOpen: boolean;
    setIsCreateTableModalOpen: (open: boolean) => void;
    tableModalMode: 'create' | 'edit';
    setTableModalMode: (mode: 'create' | 'edit') => void;
    tableBeingEdited: any | null;
    setTableBeingEdited: (table: any | null) => void;
}

interface CoreUpdateStatus {
    update_available?: boolean;
    latest_version?: string;
    current_version?: string;
    release_url?: string;
    status?: string;
    message?: string;
}

interface ActiveWorkspaceMeta {
    id: string;
    name: string;
    slug?: string;
}

type SystemPulseOverall = 'ok' | 'warning' | 'fail' | 'unknown';

interface HealthPulseResponse {
    database?: string;
    pulse?: {
        overall?: string;
    };
}

const resetScrollPosition = (viewport: HTMLElement | null) => {
    if (!viewport) {
        return;
    }

    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    viewport.scrollTo({ top: 0, left: 0, behavior: 'auto' });

    viewport.querySelectorAll<HTMLElement>('*').forEach((node) => {
        const styles = window.getComputedStyle(node);
        const scrollsY = node.scrollHeight > node.clientHeight + 8 && /(auto|scroll)/.test(styles.overflowY);
        const scrollsX = node.scrollWidth > node.clientWidth + 8 && /(auto|scroll)/.test(styles.overflowX);

        if (scrollsY || scrollsX || node.classList.contains('custom-scrollbar')) {
            node.scrollTop = 0;
            node.scrollLeft = 0;
        }
    });
};

const normalizeWorkspaceSlug = (value: string | null | undefined) => (
    String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
);

const Layout: React.FC<LayoutProps> = ({
    children,
    selectedView,
    selectedTable,
    workspaceId,
    onTableSelect,
    onMenuViewSelect,
    tables = [],
    refreshTables,
    onWorkspaceChange,
    isCreateTableModalOpen,
    setIsCreateTableModalOpen,
    tableModalMode,
    setTableModalMode,
    tableBeingEdited,
    setTableBeingEdited
}) => {
    const [dbStatus, setDbStatus] = useState('Checking...');
    const [user] = useState(() => {
        const storedUser = localStorage.getItem('ozy_user');
        return storedUser ? JSON.parse(storedUser) : null;
    });
    const [isSidebarPinned, setIsSidebarPinned] = useState(false);
    const [isSidebarHovered, setIsSidebarHovered] = useState(false);
    const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
    const [isConnectionModalOpen, setIsConnectionModalOpen] = useState(false);
    const [schemas, setSchemas] = useState(['public']);
    const [selectedSchema, setSelectedSchema] = useState('public');
    const [isSchemaDropdownOpen, setIsSchemaDropdownOpen] = useState(false);
    const [healthIssues, setHealthIssues] = useState<any[]>([]);
    const [updateStatus, setUpdateStatus] = useState<CoreUpdateStatus | null>(null);
    const [isNotificationOpen, setIsNotificationOpen] = useState(false);
    const [selectedFixIssue, setSelectedFixIssue] = useState<any>(null);
    const [isAutoFixModalOpen, setIsAutoFixModalOpen] = useState(false);
    const [isBannerDismissed, setIsBannerDismissed] = useState(false);
    const [isFixingCoverageBanner, setIsFixingCoverageBanner] = useState(false);
    const [isUpdateBannerDismissed, setIsUpdateBannerDismissed] = useState(false);
    const [toast, setToast] = useState<any>(null);
    const [confirmDeleteTable, setConfirmDeleteTable] = useState<any>(null);
    const [activeTableMenu, setActiveTableMenu] = useState<string | null>(null);
    const [explorerSearchTerm, setExplorerSearchTerm] = useState('');
    const [docsFilter, setDocsFilter] = useState('all');
    const [isSystemTablesExpanded, setIsSystemTablesExpanded] = useState(false);
    const [activeWorkspaceMeta, setActiveWorkspaceMeta] = useState<ActiveWorkspaceMeta | null>(null);
    const [pendingAccessRequestsCount, setPendingAccessRequestsCount] = useState(0);
    const [systemPulse, setSystemPulse] = useState<SystemPulseOverall>('unknown');
    const [isProjectSwitcherOpen, setIsProjectSwitcherOpen] = useState(false);
    const [isSidebarLocked, setIsSidebarLocked] = useState(false);

    const notificationRef = useRef<HTMLDivElement | null>(null);
    const userDropdownRef = useRef<HTMLDivElement | null>(null);
    const contentViewportRef = useRef<HTMLDivElement | null>(null);

    // Derived state (js-combine-iterations)
    const safeHealthIssues = useMemo(() => Array.isArray(healthIssues) ? healthIssues : [], [healthIssues]);
    const rlsCoverageIssues = useMemo(
        () => safeHealthIssues.filter((issue: any) => isRLSHealthIssue(issue)),
        [safeHealthIssues]
    );
    const getRLSIssueForTable = React.useCallback((tableName: string) => (
        findRLSIssueForTable(safeHealthIssues, tableName)
    ), [safeHealthIssues]);
    const activeWorkspaceSlug = useMemo(() => {
        if (!activeWorkspaceMeta?.slug) {
            return null;
        }

        const normalizedNameSlug = normalizeWorkspaceSlug(activeWorkspaceMeta.name);
        const normalizedSlug = normalizeWorkspaceSlug(activeWorkspaceMeta.slug);
        if (!normalizedSlug || normalizedSlug === normalizedNameSlug) {
            return null;
        }

        return activeWorkspaceMeta.slug;
    }, [activeWorkspaceMeta]);

    const isAdminUser = useMemo(() => (
        String(user?.role || '').trim().toLowerCase() === 'admin'
    ), [user?.role]);

    const notificationIssues = useMemo(() => {
        const issues = [...safeHealthIssues];
        
        if (isAdminUser && pendingAccessRequestsCount > 0) {
            issues.unshift({
                type: 'security',
                title: 'Access requests pending approval',
                description: `${pendingAccessRequestsCount} request${pendingAccessRequestsCount === 1 ? '' : 's'} waiting for decision.`,
                count: pendingAccessRequestsCount,
                fixable: false,
                reviewable: false,
                action_view: 'security',
                action_target: 'access_requests',
                action_label: 'Review access requests',
            });
        }
        return issues;
    }, [isAdminUser, pendingAccessRequestsCount, safeHealthIssues]);

    const fetchPendingAccessRequestsCount = React.useCallback(async (signal?: AbortSignal) => {
        if (!isAdminUser || !workspaceId) {
            setPendingAccessRequestsCount(0);
            return;
        }

        try {
            const res = await fetchWithAuth('/api/project/security/requests', { signal });
            if (!res.ok) {
                setPendingAccessRequestsCount(0);
                return;
            }
            const payload = await res.json().catch(() => null) as { requests?: unknown } | null;
            const requests = Array.isArray(payload?.requests) ? payload.requests : [];
            const pendingCount = requests.reduce((count, request) => {
                const status = String((request as { status?: unknown })?.status || '').toUpperCase();
                return status === 'PENDING' ? count + 1 : count;
            }, 0);
            setPendingAccessRequestsCount(pendingCount);
        } catch (err) {
            if (!isAbortLikeError(err, signal)) {
                console.error('Failed to fetch pending access requests count', err);
            }
        }
    }, [isAdminUser, workspaceId]);



    useEffect(() => {
        if (isProjectSwitcherOpen) {
            // If the switcher is opened while the sidebar is already expanded (hovered or pinned),
            // lock it in that state to prevent jumping when moving the mouse to the dropdown.
            if (isSidebarHovered || isSidebarPinned) {
                setIsSidebarLocked(true);
            }
        } else {
            setIsSidebarLocked(false);
        }
    }, [isProjectSwitcherOpen, isSidebarHovered, isSidebarPinned]);

    // Pre-calculate and memoize filtered table lists for performance (js-combine-iterations)
    const { filteredUserTables, filteredSystemTables } = useMemo(() => {
        const lowerSearch = explorerSearchTerm.toLowerCase();
        const user: any[] = [];
        const system: any[] = [];

        tables.forEach((t: any) => {
            const isSystem = t.is_system || t.name?.startsWith('_v_') || t.name?.startsWith('_ozy_');
            const label = (t.display_name || t.name || '').toLowerCase();
            const matchesSearch = label.includes(lowerSearch) || t.name?.toLowerCase().includes(lowerSearch);

            if (matchesSearch) {
                if (isSystem) system.push(t);
                else user.push(t);
            }
        });

        // Sort alphabetically by name (or display name if available)
        const sortFn = (a: any, b: any) => {
            const nameA = (a.display_name || a.name || '').toLowerCase();
            const nameB = (b.display_name || b.name || '').toLowerCase();
            return nameA.localeCompare(nameB);
        };

        return { 
            filteredUserTables: user.sort(sortFn), 
            filteredSystemTables: system.sort(sortFn) 
        };
    }, [tables, explorerSearchTerm]);

    const showToast = React.useCallback((message: any, type: any = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 5000);
    }, []);

    const handleDeleteTable = React.useCallback((tableName: any, e: any) => {
        e.stopPropagation();
        setConfirmDeleteTable(tableName);
    }, []);

    const confirmTableDeletion = React.useCallback(async () => {
        const tableName = confirmDeleteTable;
        try {
            const res = await fetchWithAuth(`/api/collections/${tableName}`, {
                method: 'DELETE'
            });
            if (res.ok) {
                showToast(`Table "${tableName}" deleted successfully`, 'success');
                refreshTables();
                if (selectedTable === tableName) {
                    onTableSelect(null);
                }
            } else {
                showToast('Failed to delete table', 'error');
            }
        } catch (err) {
            console.error(err);
            showToast('Network error', 'error');
        }
    }, [confirmDeleteTable, refreshTables, selectedTable, onTableSelect, showToast]);

    const copyText = React.useCallback(async (value: string, successMessage: string) => {
        try {
            await navigator.clipboard.writeText(value);
            showToast(successMessage, 'success');
        } catch (err) {
            console.error(err);
            showToast('Clipboard is unavailable in this session', 'error');
        }
    }, [showToast]);

    const getNextDuplicateTableName = React.useCallback((tableName: string) => {
        const existing = new Set(tables.map((table: any) => String(table.name || '').trim()).filter(Boolean));
        const base = `${tableName}_copy`;
        let candidate = base;
        let index = 2;
        while (existing.has(candidate)) {
            candidate = `${base}_${index}`;
            index += 1;
        }
        return candidate;
    }, [tables]);

    const buildCreateTableSnippet = React.useCallback((tableName: string, schemaItems: any[]) => {
        const columnLines = Array.isArray(schemaItems)
            ? schemaItems.map((column: any) => {
                const required = column?.required ? ' NOT NULL' : '';
                return `  "${column.name}" ${column.type}${required}`;
            })
            : [];
        return `CREATE TABLE public."${tableName}" (\n${columnLines.join(',\n')}\n);`;
    }, []);

    const handleCopyTableSchema = React.useCallback(async (tableName: string) => {
        try {
            const res = await fetchWithAuth(`/api/schema/${tableName}`);
            if (!res.ok) {
                showToast('Failed to load table schema', 'error');
                return;
            }
            const schemaItems = await res.json();
            await copyText(buildCreateTableSnippet(tableName, schemaItems), `Schema copied for ${tableName}`);
        } catch (err) {
            console.error(err);
            showToast('Failed to load table schema', 'error');
        } finally {
            setActiveTableMenu(null);
        }
    }, [buildCreateTableSnippet, copyText, showToast]);

    const handleLogout = React.useCallback(() => {
        localStorage.removeItem('ozy_token');
        localStorage.removeItem('ozy_user');
        localStorage.removeItem('ozy_api_key');
        window.location.reload();
    }, []);

    const handleDuplicateTable = React.useCallback(async (tableName: string) => {
        const nextName = getNextDuplicateTableName(tableName);
        try {
            const res = await fetchWithAuth(`/api/collections/${tableName}/duplicate`, {
                method: 'POST',
                body: JSON.stringify({ name: nextName, copy_data: true }),
            });
            if (!res.ok) {
                const payload = await res.json().catch(() => null);
                showToast(payload?.error || 'Failed to duplicate table', 'error');
                return;
            }
            refreshTables();
            showToast(`Table duplicated as "${nextName}"`, 'success');
        } catch (err) {
            console.error(err);
            showToast('Failed to duplicate table', 'error');
        } finally {
            setActiveTableMenu(null);
        }
    }, [getNextDuplicateTableName, refreshTables, showToast]);

    const handleExportTable = React.useCallback(async (tableName: string) => {
        try {
            const schemaRes = await fetchWithAuth(`/api/schema/${tableName}`);
            if (!schemaRes.ok) {
                showToast('Failed to load table schema for export', 'error');
                return;
            }
            const schemaItems = await schemaRes.json();
            const headers = Array.isArray(schemaItems) ? schemaItems.map((column: any) => column.name) : [];
            const rows: any[] = [];
            let offset = 0;
            let hasMore = true;

            while (hasMore) {
                const res = await fetchWithAuth(`/api/tables/${tableName}?limit=1000&offset=${offset}&count_mode=auto`);
                if (!res.ok) {
                    const payload = await res.json().catch(() => null);
                    throw new Error(payload?.error || 'Failed to load table rows');
                }
                const payload = await res.json();
                const chunk = Array.isArray(payload?.data) ? payload.data : [];
                rows.push(...chunk);
                hasMore = Boolean(payload?.hasMore) && chunk.length > 0;
                offset += 1000;
            }

            const csvRows = [
                headers.join(','),
                ...rows.map((row) => headers.map((header) => {
                    const value = row?.[header];
                    return typeof value === 'string' ? `"${value.replace(/"/g, '""')}"` : value ?? '';
                }).join(',')),
            ];

            const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${tableName}_export.csv`;
            link.click();
            window.URL.revokeObjectURL(url);
            showToast(`Exported ${tableName}`, 'success');
        } catch (err) {
            console.error(err);
            showToast(err instanceof Error ? err.message : 'Failed to export table', 'error');
        } finally {
            setActiveTableMenu(null);
        }
    }, [showToast]);

    const handleOpenTablePolicies = React.useCallback((tableName: string) => {
        const rlsIssue = getRLSIssueForTable(tableName);
        if (rlsIssue && rlsIssue.fixable !== false) {
            setSelectedFixIssue(rlsIssue);
            setIsAutoFixModalOpen(true);
            setActiveTableMenu(null);
            return;
        }
        localStorage.setItem('ozy_policies_focus_table', tableName);
        onMenuViewSelect('policies');
        setActiveTableMenu(null);
    }, [getRLSIssueForTable, onMenuViewSelect]);

    useEffect(() => {
        let active = true;
        const requestController = new AbortController();

        const isSettlingRequestError = (err: unknown, signal: AbortSignal = requestController.signal) => (
            !active || signal.aborted || isAbortLikeError(err, signal)
        );

        // Status check
        fetchWithAuth('/api/health', { signal: requestController.signal })
            .then((res: any) => readJsonIfOk<HealthPulseResponse>(res))
            .then((data: any) => {
                if (active) {
                    if (!data) {
                        setDbStatus('Disconnected');
                        setSystemPulse('fail');
                        return;
                    }
                    setDbStatus(data.database === 'connected' ? 'Connected' : 'Degraded');
                    const overall = String(data?.pulse?.overall || '').toLowerCase();
                    if (overall === 'ok' || overall === 'warning' || overall === 'fail') {
                        setSystemPulse(overall as SystemPulseOverall);
                    } else {
                        setSystemPulse(data.database === 'connected' ? 'ok' : 'warning');
                    }
                }
            })
            .catch((err: any) => {
                if (active && !isSettlingRequestError(err)) {
                    setDbStatus('Disconnected');
                    setSystemPulse('fail');
                }
            });


        // Load schemas
        fetchWithAuth('/api/collections/schemas', { signal: requestController.signal })
            .then((res: any) => readJsonIfOk<any>(res))
            .then((data: any) => {
                if (!active) {
                    return;
                }
                if (Array.isArray(data)) {
                    setSchemas(data);
                } else {
                    setSchemas(['public']);
                }
            })
            .catch((err: any) => {
                if (active && !isSettlingRequestError(err)) {
                    console.error("Failed to load schemas", err);
                    setSchemas(['public']);
                }
            });

        // Load health issues
        const fetchHealth = () => {
            fetchWithAuth('/api/project/health', { signal: requestController.signal })
                .then((res: any) => readJsonIfOk<any>(res))
                .then((data: any) => {
                    if (active) {
                        setHealthIssues(Array.isArray(data) ? data : []);
                    }
                })
                .catch((err: any) => {
                    if (active && !isSettlingRequestError(err)) {
                        console.error("Failed to fetch health info", err);
                    }
                });
        };
        const fetchUpdateStatus = () => {
            fetchWithAuth('/api/project/update-status', { signal: requestController.signal })
                .then((res: any) => readJsonIfOk<any>(res))
                .then((data: any) => {
                    if (active) {
                        setUpdateStatus(data && typeof data === 'object' ? data : null);
                    }
                })
                .catch((err: any) => {
                    if (active && !isSettlingRequestError(err)) {
                        setUpdateStatus(null);
                    }
                });
        };

        fetchHealth();
        fetchUpdateStatus();
        const healthInterval = setInterval(fetchHealth, 10000); // Check every 10s

        // Re-show banner every 10 minutes if still not fixed
        const bannerReminderInterval = setInterval(() => {
            setIsBannerDismissed(false);
        }, 10 * 60 * 1000);

        return () => {
            active = false;
            requestController.abort();
            clearInterval(healthInterval);
            clearInterval(bannerReminderInterval);
        };
    }, []);

    useEffect(() => {
        const unsubscribe = addProjectSyncListener((detail) => {
            if (!detail.health) {
                return;
            }

            fetchWithAuth('/api/project/health?refresh=true')
                .then((res: any) => readJsonIfOk<any>(res))
                .then((data: any) => {
                    setHealthIssues(Array.isArray(data) ? data : []);
                })
                .catch((err: any) => {
                    console.error("Failed to fetch health info", err);
                });
        });

        return unsubscribe;
    }, []);

    useEffect(() => {
        if (!isAdminUser || !workspaceId) {
            setPendingAccessRequestsCount(0);
            return;
        }

        const controller = new AbortController();
        void fetchPendingAccessRequestsCount(controller.signal);
        const interval = window.setInterval(() => {
            void fetchPendingAccessRequestsCount();
        }, 25000);

        return () => {
            controller.abort();
            window.clearInterval(interval);
        };
    }, [fetchPendingAccessRequestsCount, isAdminUser, workspaceId]);



    useEffect(() => {
        if (!isAdminUser || !workspaceId) {
            return;
        }

        let disposed = false;
        let eventSource: EventSource | null = null;
        let refreshTimeout: number | null = null;

        const attachRealtimeHandlers = (source: EventSource) => {
            source.onmessage = (event: MessageEvent) => {
                try {
                    const payload = JSON.parse(event.data || '{}') as { table?: unknown; action?: unknown };
                    const tableName = String(payload?.table || '');
                    const action = String(payload?.action || '').toUpperCase();
                    if (tableName !== '_v_access_requests') {
                        return;
                    }
                    if (!['INSERT', 'UPDATE', 'DELETE'].includes(action)) {
                        return;
                    }
                    if (refreshTimeout !== null) {
                        return;
                    }
                    refreshTimeout = window.setTimeout(() => {
                        refreshTimeout = null;
                        void fetchPendingAccessRequestsCount();
                    }, 280);
                } catch (err) {
                    console.error('Failed to parse access request realtime payload', err);
                }
            };

            source.onerror = () => {
                source.close();
            };
        };

        const openRealtime = async () => {
            const normalizedWorkspaceId = String(workspaceId || '').trim().toLowerCase();
            const requestedChannels = normalizedWorkspaceId ? [`workspace:${normalizedWorkspaceId}`] : [];

            const sessionRes = await fetchWithAuth('/api/realtime/session', {
                method: 'POST',
                body: JSON.stringify({ channels: requestedChannels, expires_in: 300 }),
            });

            if (disposed) {
                return;
            }

            if (sessionRes.status === 404 || sessionRes.status === 405) {
                eventSource = new EventSource('/api/realtime');
                attachRealtimeHandlers(eventSource);
                return;
            }

            if (!sessionRes.ok) {
                return;
            }

            const sessionPayload = await sessionRes.json().catch(() => null) as { token?: unknown; channels?: unknown } | null;
            const token = typeof sessionPayload?.token === 'string' ? sessionPayload.token.trim() : '';
            if (!token) {
                return;
            }

            const grantedChannels = Array.isArray(sessionPayload?.channels)
                ? sessionPayload.channels
                    .filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
                    .map((item) => item.trim())
                : [];
            const streamUrl = new URL('/api/realtime', window.location.origin);
            streamUrl.searchParams.set('token', token);
            if (grantedChannels.length > 0) {
                streamUrl.searchParams.set('channels', grantedChannels.join(','));
            }
            eventSource = new EventSource(`${streamUrl.pathname}${streamUrl.search}`);
            attachRealtimeHandlers(eventSource);
        };

        void openRealtime().catch((err) => {
            console.error('Failed to bootstrap access requests realtime stream', err);
        });

        return () => {
            disposed = true;
            eventSource?.close();
            if (refreshTimeout !== null) {
                window.clearTimeout(refreshTimeout);
            }
        };
    }, [fetchPendingAccessRequestsCount, isAdminUser, workspaceId]);

    useEffect(() => {
        const handleClickOutside = (event: any) => {
            if (notificationRef.current && !notificationRef.current.contains(event.target)) {
                setIsNotificationOpen(false);
            }
            if (userDropdownRef.current && !userDropdownRef.current.contains(event.target)) {
                setIsUserDropdownOpen(false);
            }
            if (!(event.target instanceof HTMLElement) || !event.target.closest('[data-table-menu-root]')) {
                setActiveTableMenu(null);
            }
        };

        if (isNotificationOpen || isUserDropdownOpen || activeTableMenu) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [activeTableMenu, isNotificationOpen, isUserDropdownOpen]);

    useEffect(() => {
        const normalizedWorkspaceId = String(workspaceId || '').trim();
        if (!normalizedWorkspaceId) {
            setActiveWorkspaceMeta(null);
            return;
        }

        let cancelled = false;
        const requestController = new AbortController();

        fetchWithAuth('/api/workspaces', { signal: requestController.signal })
            .then((res: any) => res.ok ? res.json() : [])
            .then((data: any) => {
                if (cancelled || requestController.signal.aborted) {
                    return;
                }
                const workspaces = Array.isArray(data) ? data : [];
                const activeWorkspace = workspaces.find((workspace: any) => String(workspace?.id || '').trim() === normalizedWorkspaceId);
                if (!activeWorkspace) {
                    setActiveWorkspaceMeta(null);
                    return;
                }
                setActiveWorkspaceMeta({
                    id: String(activeWorkspace.id),
                    name: String(activeWorkspace.name || 'Project'),
                    slug: String(activeWorkspace.slug || '').trim() || undefined,
                });
            })
            .catch((err: any) => {
                if (cancelled || isAbortLikeError(err, requestController.signal)) {
                    return;
                }
                console.error('Failed to load active workspace summary', err);
                if (!cancelled) {
                    setActiveWorkspaceMeta(null);
                }
            });

        return () => {
            cancelled = true;
            requestController.abort();
        };
    }, [workspaceId]);

    useEffect(() => {
        const viewport = contentViewportRef.current;
        if (!viewport) return undefined;

        let rafTwo = 0;
        const rafOne = window.requestAnimationFrame(() => {
            resetScrollPosition(viewport);
            rafTwo = window.requestAnimationFrame(() => {
                resetScrollPosition(viewport);
            });
        });
        const timeoutId = window.setTimeout(() => {
            resetScrollPosition(viewport);
        }, 140);

        return () => {
            window.cancelAnimationFrame(rafOne);
            window.cancelAnimationFrame(rafTwo);
            window.clearTimeout(timeoutId);
        };
    }, [selectedView, selectedTable, workspaceId]);

    const handleApplyFix = React.useCallback(async (issue: HealthFixIssue) => {
        try {
            await applyHealthFix(issue);
            showToast(formatHealthFixSuccessMessage(issue), 'success');
            fetchWithAuth('/api/project/health?refresh=true')
                .then((res: any) => res.json())
                .then((data: any) => setHealthIssues(Array.isArray(data) ? data : []));
        } catch (error) {
            console.error(error);
            showToast(error instanceof Error ? error.message : 'Network error or server unavailable', 'error');
        }
    }, [showToast]);

    const handleReviewIssue = React.useCallback(async (issue: any) => {
        try {
            const res = await fetchWithAuth('/api/project/health/review', {
                method: 'POST',
                body: JSON.stringify({
                    type: issue?.type,
                    issue: issue?.title,
                    review_key: issue?.review_key || ''
                })
            });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                showToast(errData.error || 'Failed to mark alert as reviewed', 'error');
                return;
            }
            showToast(`Reviewed: ${issue?.title || 'selected alert'}`, 'success');
            const healthRes = await fetchWithAuth('/api/project/health?refresh=true');
            const healthData = await healthRes.json();
            setHealthIssues(Array.isArray(healthData) ? healthData : []);
        } catch (error) {
            console.error(error);
            showToast('Network error or server unavailable', 'error');
        }
    }, [showToast]);

    const handleFixCoverageBanner = React.useCallback(async () => {
        if (isFixingCoverageBanner) {
            return;
        }

        setIsFixingCoverageBanner(true);
        try {
            const response = await fetchWithAuth('/api/project/security/rls/closeout', {
                method: 'POST',
                body: JSON.stringify({
                    dry_run: false,
                    auto_enforce: true,
                }),
            });

            const payload = await response.json().catch(() => null) as {
                error?: string;
                summary?: {
                    eligible_tables_with_gaps?: number;
                };
                non_eligible?: Array<unknown>;
            } | null;

            if (!response.ok) {
                showToast(payload?.error || 'Failed to run automatic RLS coverage fix', 'error');
                return;
            }

            const remainingGaps = Number(payload?.summary?.eligible_tables_with_gaps || 0);
            const nonEligible = Array.isArray(payload?.non_eligible) ? payload.non_eligible.length : 0;

            dispatchProjectSync({
                tables: true,
                health: true,
                coverage: true,
                reason: 'layout-coverage-closeout',
            });

            if (remainingGaps === 0) {
                setIsBannerDismissed(true);
                if (nonEligible > 0) {
                    showToast(`RLS was enforced on eligible tables. ${nonEligible} table(s) still need manual policy design.`, 'warning');
                } else {
                    showToast('RLS coverage fixed for all eligible tables.', 'success');
                }
                return;
            }

            showToast(`Auto-fix completed but ${remainingGaps} eligible table(s) still have coverage gaps.`, 'warning');
            onMenuViewSelect('policies');
        } catch (error) {
            console.error(error);
            showToast(error instanceof Error ? error.message : 'Failed to run automatic RLS coverage fix', 'error');
        } finally {
            setIsFixingCoverageBanner(false);
        }
    }, [isFixingCoverageBanner, onMenuViewSelect, showToast]);

    const openIssueTarget = React.useCallback((issue: any) => {
        const targetView = String(issue?.action_view || '').trim();
        const resolvedView = targetView && getViewMeta(targetView).id === targetView
            ? targetView
            : 'overview';
        onMenuViewSelect(resolvedView);
        if (resolvedView === 'security' && String(issue?.action_target || '') === 'access_requests') {
            window.dispatchEvent(new CustomEvent('ozy:navigate-intent', {
                detail: { view: 'security', target: 'access_requests' },
            }));
        }
        setIsNotificationOpen(false);
    }, [onMenuViewSelect]);

    const isExpanded = isSidebarPinned || isSidebarHovered || isSidebarLocked;
    const showExplorerSidebar = shouldRenderExplorerSidebar(selectedView);

    // --- Explorer Sidebar Submodules Content ---
    const renderExplorerContent = () => {
        const currentModule = getExplorerModule(selectedView);
        const resolvedView = getDefaultViewForSection(selectedView);
        const activeSubmenu = SUBMENUS[currentModule] || [
            { id: 'general', name: 'Dashboard', icon: LayoutGrid },
            { id: 'status', name: 'System Status', icon: Activity }
        ];


        if (currentModule === 'sql') {
            return (
                <div className="space-y-6">
                    <div>
                        <div className="mb-4 px-2">
                            <div className="flex items-center gap-2 px-3 py-1.5 bg-background border border-border rounded-md group focus-within:border-zinc-500 transition-colors">
                                <Search size={12} className="text-zinc-600 group-focus-within:text-white" />
                                <input
                                    type="text"
                                    placeholder="Search queries..."
                                    className="bg-transparent border-none text-xs text-white placeholder:text-zinc-600 focus:outline-none w-full"
                                />
                            </div>
                        </div>

                        <div className="flex-1 flex flex-col items-center justify-center px-4 py-8 text-center">
                            <div className="w-10 h-10 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-3">
                                <Terminal size={18} className="text-zinc-600" />
                            </div>
                            <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest mb-1">No Saved Queries</p>
                            <p className="text-[9px] text-zinc-700">Run a query and save it for later.</p>
                        </div>
                    </div>
                </div>
            );
        }

        if (currentModule === 'tables') {
            return (
                <div className="space-y-6">
                    <div className="animate-in fade-in slide-in-from-left-2 duration-300">
                        {/* Schema Selector */}
                        <div className="px-3 mb-6">
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-[0.2em] ml-1">Schema</label>
                                <div className="relative">
                                    <button
                                        onClick={() => setIsSchemaDropdownOpen(!isSchemaDropdownOpen)}
                                        className="w-full flex items-center justify-between gap-3 px-3 py-2 bg-[#0c0c0c] border border-zinc-800 hover:border-zinc-700 rounded-lg transition-all text-xs group shadow-sm"
                                    >
                                        <div className="flex items-center gap-2">
                                            <Database size={13} className="text-zinc-600" />
                                            <span className="text-zinc-200 font-medium tracking-tight">{selectedSchema}</span>
                                        </div>
                                        <ChevronDown size={14} className={`text-zinc-600 transition-transform duration-200 ${isSchemaDropdownOpen ? 'rotate-180' : ''}`} />
                                    </button>
                                    
                                    {isSchemaDropdownOpen && (
                                        <div className="absolute top-full left-0 right-0 mt-1.5 z-50 bg-[#131313] border border-zinc-800 rounded-lg shadow-2xl overflow-hidden py-1 animate-in fade-in zoom-in-95 duration-150">
                                            {schemas.map((schema: any) => (
                                                <button
                                                    key={schema}
                                                    onClick={() => {
                                                        setSelectedSchema(schema);
                                                        setIsSchemaDropdownOpen(false);
                                                    }}
                                                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-xs text-left transition-colors ${selectedSchema === schema ? 'bg-zinc-900 text-primary font-bold' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                                                >
                                                    <span>{schema}</span>
                                                    {selectedSchema === schema && <Check size={12} />}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* New Table Button */}
                        <div className="px-3 mb-6">
                            <button
                                onClick={() => {
                                    setTableModalMode('create');
                                    setTableBeingEdited(null);
                                    setIsCreateTableModalOpen(true);
                                }}
                                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-background border border-border hover:border-zinc-500 hover:bg-zinc-900/40 text-zinc-300 hover:text-white rounded-lg transition-all text-[11px] font-bold uppercase tracking-[0.15em] group shadow-sm"
                            >
                                <Plus size={14} className="text-zinc-500 group-hover:text-primary transition-colors" />
                                New table
                            </button>
                        </div>

                        <div className="px-3 mb-2">
                            <div className="flex items-center gap-2 px-3 py-1.5 bg-background border border-border rounded-md group focus-within:border-primary/50 transition-all">
                                <Search size={12} className="text-zinc-600 group-focus-within:text-primary" />
                                <input
                                    type="text"
                                    placeholder="Filter tables..."
                                    value={explorerSearchTerm}
                                    onChange={(e: any) => setExplorerSearchTerm(e.target.value)}
                                    className="bg-transparent border-none text-[10px] text-zinc-300 placeholder:text-zinc-700 focus:outline-none w-full uppercase font-bold tracking-widest"
                                />
                                {explorerSearchTerm && (
                                    <button onClick={() => setExplorerSearchTerm('')} className="text-zinc-700 hover:text-white">
                                        <X size={10} />
                                    </button>
                                )}
                            </div>
                        </div>


                        <div className="space-y-4">
                            <div>
                                <div className="flex items-center justify-between px-3 mb-2">
                                    <h4 className="text-[9px] font-bold text-zinc-600 uppercase tracking-[0.2em]">User Tables ({filteredUserTables.length})</h4>
                                </div>
                                <div className="space-y-0.5">
                                    {filteredUserTables.map((t: any, idx: number) => (
                                        <div key={t.name} data-table-menu-root className={`relative group ${activeTableMenu === t.name ? 'z-50' : 'z-0'}`}>
                                            <button
                                                onClick={() => {
                                                    setActiveTableMenu(null);
                                                    onTableSelect(t.name);
                                                }}
                                                className={`w-full flex items-center justify-between gap-3 px-3 py-1.5 rounded-md text-xs transition-all pr-11 ${selectedTable === t.name
                                                    ? 'bg-zinc-900 text-primary font-bold border border-border'
                                                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/40 border border-transparent'
                                                    }`}
                                            >
                                                <div className="flex items-center gap-3 truncate">
                                                    <Table2 size={14} className={selectedTable === t.name ? 'text-primary' : 'text-zinc-800 group-hover:text-zinc-600'} />
                                                    <span className="truncate">{t.display_name || t.name}</span>
                                                    {t.realtime_enabled && (
                                                        <div className="flex items-center" title="Realtime Enabled">
                                                            <Wifi size={10} className="text-primary animate-pulse" />
                                                        </div>
                                                    )}
                                                </div>
                                            </button>

                                            <button
                                                type="button"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    setActiveTableMenu((current) => current === t.name ? null : t.name);
                                                }}
                                                className={`absolute right-2 top-1/2 -translate-y-1/2 rounded-md border p-1.5 transition-all ${
                                                    activeTableMenu === t.name || selectedTable === t.name
                                                        ? 'border-zinc-700 bg-zinc-900 text-zinc-200'
                                                        : 'border-transparent text-zinc-700 opacity-0 group-hover:opacity-100 hover:border-zinc-800 hover:bg-zinc-900 hover:text-zinc-200'
                                                }`}
                                                aria-label={`Open actions for ${t.name}`}
                                            >
                                                <MoreHorizontal size={12} />
                                            </button>

                                            {activeTableMenu === t.name && (
                                                <div className={`absolute right-2 z-30 w-56 overflow-hidden rounded-md border border-border bg-background shadow-2xl animate-in fade-in zoom-in-95 duration-200 ${
                                                    idx >= filteredUserTables.length - 3 && filteredUserTables.length > 5
                                                        ? 'bottom-full mb-1 origin-bottom'
                                                        : 'top-full mt-1 origin-top'
                                                }`}>
                                                    <div className="p-1.5 text-xs">
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setActiveTableMenu(null);
                                                                setTableModalMode('edit');
                                                                setTableBeingEdited(t);
                                                                setIsCreateTableModalOpen(true);
                                                            }}
                                                            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
                                                        >
                                                            <Pencil size={14} className="text-zinc-500" />
                                                            Edit table
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setActiveTableMenu(null);
                                                                void copyText(t.name, `Copied ${t.name}`);
                                                            }}
                                                            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
                                                        >
                                                            <Copy size={14} className="text-zinc-500" />
                                                            Copy name
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => void handleCopyTableSchema(t.name)}
                                                            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
                                                        >
                                                            <Code size={14} className="text-zinc-500" />
                                                            Copy table schema
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => void handleDuplicateTable(t.name)}
                                                            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
                                                        >
                                                            <CopyPlus size={14} className="text-zinc-500" />
                                                            Duplicate table
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleOpenTablePolicies(t.name)}
                                                            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
                                                        >
                                                            <Shield size={14} className="text-zinc-500" />
                                                            {getRLSIssueForTable(t.name) ? 'Auto-fix RLS' : 'View policies'}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => void handleExportTable(t.name)}
                                                            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
                                                        >
                                                            <Download size={14} className="text-zinc-500" />
                                                            Export data
                                                        </button>
                                                        <div className="my-1 h-px bg-[#2b2b2b]" />
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setConfirmDeleteTable(t.name);
                                                                setActiveTableMenu(null);
                                                            }}
                                                            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-red-300 transition-colors hover:bg-red-500/10 hover:text-red-200"
                                                        >
                                                            <Trash2 size={14} className="text-red-400" />
                                                            Delete table
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                    {filteredUserTables.length === 0 && (
                                        <p className="px-3 py-4 text-[10px] text-zinc-600 italic uppercase">No user tables yet</p>
                                    )}
                                </div>
                            </div>

                            <div className="border-t border-border pt-4">
                                <button
                                    onClick={() => setIsSystemTablesExpanded(!isSystemTablesExpanded)}
                                    className="w-full flex items-center justify-between px-3 mb-2 group"
                                >
                                    <h4 className="text-[9px] font-bold text-zinc-600 uppercase tracking-[0.2em] group-hover:text-zinc-400 transition-colors flex items-center gap-2">
                                        {isSystemTablesExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                                        System Tables ({filteredSystemTables.length})
                                    </h4>
                                </button>

                                {isSystemTablesExpanded && (
                                    <div className="space-y-0.5 animate-in slide-in-from-top-1 duration-200">
                                        {filteredSystemTables.map((t: any) => (
                                            <button
                                                key={t.name}
                                                onClick={() => onTableSelect(t.name)}
                                                className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-md text-xs transition-all group ${selectedTable === t.name
                                                    ? 'bg-zinc-900 text-primary font-bold border border-border/50 shadow-xl'
                                                    : 'text-zinc-600/60 hover:text-zinc-300 hover:bg-zinc-900/40 border border-transparent'
                                                    }`}
                                            >
                                                <div className="flex items-center gap-3 truncate">
                                                    <Lock size={12} className={selectedTable === t.name ? 'text-primary' : 'text-zinc-800 group-hover:text-zinc-500'} />
                                                    <span className="truncate font-mono opacity-80">{t.display_name || t.name}</span>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        if (currentModule === 'database') {
            return (
                <div className="space-y-6">
                    <div>
                        <div className="flex items-center justify-between px-3 mb-2 pt-0">
                            <h4 className="text-[9px] font-bold text-zinc-600 uppercase tracking-[0.2em]">Database Management</h4>
                        </div>

                        <div className="space-y-0.5 mb-4">
                            <button
                                onClick={() => onTableSelect('__visualizer__')}
                                className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-xs transition-all group ${selectedTable === '__visualizer__'
                                    ? 'bg-zinc-900 text-primary font-bold border border-border'
                                    : 'text-zinc-600 hover:text-zinc-300 hover:bg-zinc-900/40 border border-transparent'
                                    }`}
                            >
                                <LayoutGrid size={14} className={selectedTable === '__visualizer__' ? 'text-primary' : 'text-zinc-800 group-hover:text-zinc-600'} />
                                <span className="truncate">Schema Visualizer</span>
                            </button>
                            <button
                                onClick={() => onTableSelect('__visualizer_system__')}
                                className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-xs transition-all group ${selectedTable === '__visualizer_system__'
                                    ? 'bg-amber-900/10 text-amber-500 font-bold border border-amber-500/20'
                                    : 'text-zinc-600 hover:text-zinc-300 hover:bg-zinc-900/40 border border-transparent'
                                    }`}
                            >
                                <Lock size={14} className={selectedTable === '__visualizer_system__' ? 'text-amber-500' : 'text-zinc-800 group-hover:text-zinc-500'} />
                                <span className="truncate">System Schemas</span>
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        if (currentModule === 'docs') {
            const filteredDocs = activeSubmenu.filter((item: any) => {
                const matchesSearch = item.name.toLowerCase().includes(explorerSearchTerm.toLowerCase());
                const matchesFilter = docsFilter === 'all' ||
                    (docsFilter === 'core' && ['intro', 'sdk'].includes(item.id)) ||
                    (docsFilter === 'apis' && item.id.includes('_api'));
                return matchesSearch && matchesFilter;
            });

            return (
                <div className="space-y-6 animate-in fade-in duration-300">
                    <div className="px-2 space-y-4">
                        <div className="relative group">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 group-focus-within:text-primary transition-colors" size={12} />
                            <input
                                type="text"
                                placeholder="Search documentation..."
                                value={explorerSearchTerm}
                                onChange={(e: any) => setExplorerSearchTerm(e.target.value)}
                                className="w-full bg-background border border-border rounded-md pl-9 pr-4 py-2 text-[10px] text-white placeholder:text-zinc-700 focus:outline-none focus:border-primary/50 transition-all"
                            />
                        </div>

                        <div className="flex flex-wrap gap-1.5">
                            {['all', 'core', 'apis'].map((f: any) => (
                                <button
                                    key={f}
                                    onClick={() => setDocsFilter(f)}
                                    className={`px-2 py-0.5 rounded text-[8px] font-medium border transition-all ${docsFilter === f ? 'bg-primary text-black border-primary' : 'bg-transparent border-zinc-800 text-zinc-600 hover:text-zinc-400'}`}
                                >
                                    {f}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <h4 className="px-3 mb-4 text-[9px] font-bold text-zinc-600 uppercase tracking-[0.2em]">
                            Documentation Sections
                        </h4>
                        <div className="space-y-0.5">
                            {filteredDocs.length > 0 ? (
                                filteredDocs.map((item: any) => (
                                    <button
                                        key={item.id}
                                        data-testid={`explorer-doc-${item.id}`}
                                        onClick={() => onMenuViewSelect(item.id)}
                                        className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-xs transition-all group ${resolvedView === item.id ? 'bg-zinc-900 text-primary font-bold border border-border' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/40'}`}
                                    >
                                        <item.icon size={14} className="text-zinc-800 group-hover:text-zinc-600" />
                                        <span className="truncate font-medium">{item.name}</span>
                                    </button>
                                ))
                            ) : (
                                <div className="px-3 py-10 text-center space-y-2">
                                    <div className="w-8 h-8 rounded-md bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-700">
                                        <Search size={14} />
                                    </div>
                                    <p className="text-[9px] text-zinc-700 font-bold uppercase tracking-widest">No results found</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            );
        }

        return (
            <div className="space-y-6 animate-in fade-in duration-300">
                <div>
                    <h4 className="px-3 mb-4 text-[9px] font-bold text-zinc-600 uppercase tracking-[0.2em]">
                        {currentModule === 'docs' ? 'Documentation' : `${currentModule.replace('_', ' ')} Management`}
                    </h4>
                    <div className="space-y-0.5">
                        {activeSubmenu.map((item: any) => (
                            <button
                                key={item.id}
                                data-testid={`explorer-submenu-${item.id}`}
                                onClick={() => onMenuViewSelect(item.id)}
                                className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-xs transition-all group ${resolvedView === item.id ? 'bg-zinc-900 text-primary font-bold' : 'text-zinc-600 hover:text-zinc-300 hover:bg-zinc-900/40'}`}
                            >
                                <item.icon size={14} className="text-zinc-800 group-hover:text-zinc-500" />
                                <span className="truncate font-medium">{item.name}</span>
                                {item.id === 'security' && pendingAccessRequestsCount > 0 ? (
                                    <span className="ml-auto inline-flex min-w-[18px] items-center justify-center rounded-full border border-red-500/30 bg-red-500/15 px-1.5 py-0.5 text-[9px] font-bold tracking-widest text-red-300">
                                        {pendingAccessRequestsCount > 99 ? '99+' : pendingAccessRequestsCount}
                                    </span>
                                ) : null}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        );
    };


    return (
        <div className="flex h-screen bg-background overflow-hidden text-zinc-400 font-sans selection:bg-primary selection:text-black">
            {/* Primary Sidebar (Expandable) */}
            <div
                onMouseEnter={() => setIsSidebarHovered(true)}
                onMouseLeave={() => setIsSidebarHovered(false)}
                className={`bg-background border-r border-border flex flex-col py-4 shrink-0 z-50 transition-all duration-300 ease-in-out ${isExpanded ? 'w-64' : 'w-14'
                    }`}
            >
                <div className="px-3 mb-8 flex items-center h-8">
                    <div
                        className="w-8 h-8 rounded-md flex items-center justify-center shadow-[0_0_15px_rgba(254,254,0,0.2)] cursor-pointer hover:scale-105 transition-transform shrink-0 overflow-hidden border border-zinc-800"
                        onClick={() => onMenuViewSelect('overview')}
                    >
                        <img src="/branding/logo.jpg" alt="OzyBase" className="w-full h-full object-cover" />
                    </div>
                    {isExpanded && (
                        <span className="ml-3 font-bold text-white italic tracking-tighter text-xl uppercase animate-in fade-in duration-300 truncate">OzyBase</span>
                    )}
                </div>

                <WorkspaceSwitcher 
                    isExpanded={isExpanded}
                    workspaceId={workspaceId}
                    onWorkspaceChange={onWorkspaceChange} 
                    onViewSelect={onMenuViewSelect}
                    onOpenStateChange={setIsProjectSwitcherOpen}
                />

                <div className="flex-1 flex flex-col gap-1 w-full overflow-y-auto scrollbar-hide px-2">
                    {PRIMARY_NAV.map((item: any, i: any) => {
                        if (item.type === 'separator') return <div key={i} className="h-px bg-border my-2 mx-2 shrink-0" />;
                        const Icon = (item as any).icon;
                        const isActive = isPrimaryNavActive(String(item.id || ''), selectedView);

                        return (
                            <button
                                key={item.id}
                                aria-label={item.label}
                                data-testid={`primary-nav-${item.id}`}
                                onClick={() => {
                                    if (item.id === 'tables' && tables.length > 0) {
                                        // Prioritize user tables over system tables
                                        const firstUserTable = tables.find((t: any) => !(t.is_system || t.name?.startsWith('_v_') || t.name?.startsWith('_ozy_')));
                                        onTableSelect(String(firstUserTable ? firstUserTable.name : tables[0].name || ''));
                                    } else if (item.id === 'database') {
                                        onTableSelect('__visualizer__');
                                    } else {
                                        onMenuViewSelect(getDefaultViewForSection(String(item.id || 'overview')));
                                    }
                                }}
                                className={`flex items-center w-full p-2 rounded-md transition-all group relative shrink-0 ${isActive ? 'text-primary bg-zinc-900 border border-border' : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900/40'
                                    }`}
                            >
                                <div className="w-6 flex justify-center shrink-0">
                                    <Icon size={18} strokeWidth={isActive ? 2.5 : 2} />
                                </div>
                                {isExpanded && (
                                    <span className="ml-3 text-xs font-bold tracking-tight truncate animate-in slide-in-from-left-2 duration-300 uppercase">
                                        {item.label}
                                    </span>
                                )}
                                {isActive && (
                                    <div className="absolute left-0 top-2.5 bottom-2.5 w-[2px] bg-primary rounded-full shadow-[0_0_8px_rgba(254,254,0,0.6)]" />
                                )}
                            </button>
                        );
                    })}
                </div>

                <div className="mt-auto flex flex-col gap-1 px-2 border-t border-border pt-4 shrink-0">


                    <button
                        data-testid="primary-nav-settings"
                        onClick={() => onMenuViewSelect(getDefaultViewForSection('settings'))}
                        className={`flex items-center w-full p-2 transition-all rounded-md ${getExplorerModule(selectedView) === 'settings' ? 'text-primary bg-zinc-900 border border-border' : 'text-zinc-600 hover:text-zinc-300 hover:bg-zinc-900/40'
                            }`}
                    >
                        <div className="w-6 flex justify-center shrink-0">
                            <Settings size={18} />
                        </div>
                        {isExpanded && (
                            <span className="ml-3 text-xs font-bold tracking-tight truncate animate-in slide-in-from-left-2 duration-300 uppercase">Settings</span>
                        )}
                    </button>

                    <button
                        onClick={() => setIsSidebarPinned(!isSidebarPinned)}
                        className="flex items-center w-full p-2 text-zinc-600 hover:text-zinc-200 transition-colors"
                    >
                        <div className="w-6 flex justify-center shrink-0">
                            {isSidebarPinned ? <Pin size={18} className="text-primary fill-primary/20" /> : <PinOff size={18} />}
                        </div>
                        {isExpanded && (
                            <span className="ml-3 text-xs font-bold tracking-tight truncate animate-in slide-in-from-left-2 duration-300 uppercase">
                                {isSidebarPinned ? 'Unpin Sidebar' : 'Pin Sidebar'}
                            </span>
                        )}
                    </button>

                </div>
            </div>

            {/* Explorer Sidebar - only rendered for views that need it */}
            {showExplorerSidebar && (
            <div data-testid="explorer-sidebar" className="bg-background border-r border-border flex flex-col w-48 xl:w-52 2xl:w-60">
                <div className="h-12 shrink-0 border-b border-border px-3 flex items-center xl:h-14 xl:px-4">
                    <span className="font-bold text-[10px] uppercase tracking-[0.25em] text-zinc-500 truncate">
                        Explorer
                    </span>
                </div>

                <div className="flex-1 overflow-y-auto py-4 px-3 custom-scrollbar xl:py-5">
                    {renderExplorerContent()}
                </div>

            </div>
            )}

            {/* Main Content Area */}
            <div ref={contentViewportRef} data-testid="module-shell" className={`flex-1 flex min-h-0 flex-col min-w-0 bg-background ${!showExplorerSidebar ? 'animate-in fade-in slide-in-from-left-2 duration-300' : ''}`}>
                <header className="min-h-[54px] shrink-0 border-b border-border bg-background px-4 py-2 sm:px-5">
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                            <div className="flex min-w-0 items-center gap-2 overflow-hidden text-[10px] font-bold tracking-tight">
                                <span className="text-zinc-500 hover:text-zinc-300 cursor-pointer transition-colors uppercase tracking-[0.15em]">OzyBase</span>
                                <span className="text-zinc-800 font-thin mx-1">/</span>
                                <span className={`flex items-center gap-2 truncate text-zinc-400 font-medium ${
                                    activeWorkspaceMeta ? 'text-zinc-200' : ''
                                }`}>
                                    <span className="truncate">
                                        {activeWorkspaceMeta?.name || (workspaceId ? 'Resolving Project' : 'No Project')}
                                    </span>
                                </span>
                                <span className="text-zinc-800 font-thin mx-1">/</span>
                                <span className="truncate font-semibold text-primary">
                                    {selectedTable || getViewLabel(selectedView)}
                                </span>
                            </div>

                            {activeWorkspaceSlug ? (
                                <span className="hidden max-w-[160px] truncate font-mono text-[9px] font-medium] text-zinc-700 xl:inline">
                                    {activeWorkspaceSlug}
                                </span>
                            ) : null}
                            {!activeWorkspaceMeta && !workspaceId ? (
                                <button
                                    onClick={() => onMenuViewSelect?.('workspaces')}
                                    className="inline-flex items-center gap-2 rounded-full border border-amber-500/25 bg-[#19130c] px-3 py-1 text-[9px] font-medium] text-amber-200 transition-colors hover:border-amber-400/40 hover:text-white"
                                >
                                    <Briefcase size={10} />
                                    Open Projects
                                </button>
                            ) : null}
                        </div>

                        <div className="flex shrink-0 items-center gap-3">
                            <button
                                type="button"
                                data-testid="open-connection-modal"
                                onClick={() => setIsConnectionModalOpen(true)}
                                className="flex items-center gap-3 rounded-full border border-white/5 bg-black/40 px-3 py-1.5 transition-all group hover:border-zinc-700 shadow-inner"
                            >
                                <div className={`w-1.5 h-1.5 rounded-full ${dbStatus === 'Connected' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'}`} />
                                <span className={`text-[9px] font-bold uppercase tracking-[0.2em] transition-colors ${dbStatus === 'Connected' ? 'text-white group-hover:text-white/80' : 'text-zinc-500 group-hover:text-zinc-300'}`}>
                                    {dbStatus === 'Connected' ? 'CONNECTED' : dbStatus.toUpperCase()}
                                </span>
                            </button>

                            <div className="relative" ref={notificationRef}>
                                <button
                                    aria-label="Open notifications"
                                    onClick={() => setIsNotificationOpen(!isNotificationOpen)}
                                    className={`w-9 h-9 rounded-md bg-black/40 border transition-all flex items-center justify-center shadow-inner ${notificationIssues.length > 0
                                        ? notificationIssues.some((i: any) => i.type === 'security')
                                            ? 'text-red-500 border-red-500/30 animate-security-pulse'
                                            : 'text-amber-500 border-amber-500/30 animate-notification-pulse'
                                        : 'text-zinc-500 border-white/5 hover:text-white hover:border-white/20'
                                        }`}
                                >
                                    <Bell size={16} className={notificationIssues.some((i: any) => i.type === 'security') ? 'animate-bounce' : ''} />
                                    {notificationIssues.length > 0 && (
                                        <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-background flex items-center justify-center text-[7px] font-bold text-white">
                                            {notificationIssues.length}
                                        </span>
                                    )}
                                </button>

                                <NotificationCenter
                                    isOpen={isNotificationOpen}
                                    onClose={() => setIsNotificationOpen(false)}
                                    issues={notificationIssues}
                                    onIssueAction={(issue: any) => {
                                        if (issue?.fixable === false) {
                                            openIssueTarget(issue);
                                            return;
                                        }
                                        setSelectedFixIssue(issue);
                                        setIsAutoFixModalOpen(true);
                                        setIsNotificationOpen(false);
                                    }}
                                    onReviewIssue={handleReviewIssue}
                                    onViewLogs={() => {
                                        setIsNotificationOpen(false);
                                    }}
                                />
                            </div>

                            <div className="relative" ref={userDropdownRef}>
                                <div
                                    className="w-9 h-9 rounded-md bg-black/40 border border-white/5 flex items-center justify-center text-yellow-400 text-[11px] font-bold cursor-pointer hover:border-white/20 transition-all shadow-inner font-mono"
                                    onClick={() => setIsUserDropdownOpen(!isUserDropdownOpen)}
                                >
                                    {user?.email?.charAt(0).toUpperCase() || 'K'}
                                </div>

                                <div
                                    className={`absolute top-10 right-0 w-48 bg-[#131313] border border-border rounded-md shadow-2xl z-100 overflow-hidden origin-top-right transition-all duration-200 ${
                                        isUserDropdownOpen
                                            ? 'opacity-100 scale-100 translate-y-0 pointer-events-auto'
                                            : 'opacity-0 scale-95 -translate-y-2 pointer-events-none'
                                    }`}
                                    aria-hidden={!isUserDropdownOpen}
                                >
                                    <div className="px-4 py-3 border-b border-border bg-background">
                                        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Signed in as</p>
                                        <p className="text-xs font-bold text-white truncate">{user?.email}</p>
                                    </div>
                                    <div className="p-1">
                                        <button
                                            onClick={() => {
                                                onMenuViewSelect('settings');
                                                setIsUserDropdownOpen(false);
                                            }}
                                            className="w-full flex items-center gap-3 px-3 py-2 text-xs font-medium text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all rounded-md"
                                        >
                                            <Settings size={14} /> Settings
                                        </button>
                                        <button
                                            onClick={handleLogout}
                                            className="w-full flex items-center gap-3 px-3 py-2 text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-all rounded-md mt-0.5"
                                        >
                                            <LogOut size={14} /> Sign Out
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </header>

                {rlsCoverageIssues.length > 0 && !isBannerDismissed && (
                    <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-1.5 flex items-center justify-between animate-in slide-in-from-top-full duration-500 shadow-[0_4px_12px_rgba(239,68,68,0.1)] sm:px-5">
                        <div className="flex items-center gap-3">
                            <Shield size={14} className="text-red-500 animate-pulse" />
                            <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest">
                                Access Advisor: {rlsCoverageIssues.length} table{rlsCoverageIssues.length === 1 ? '' : 's'} aun tienen RLS desactivado
                            </p>
                        </div>
                        <div className="flex items-center gap-4">
                            <button
                                onClick={() => { void handleFixCoverageBanner(); }}
                                disabled={isFixingCoverageBanner}
                                className="text-[9px] font-bold bg-red-500 text-white px-3 py-1 rounded-md uppercase tracking-widest hover:bg-red-600 hover:scale-105 transition-all shadow-lg disabled:opacity-60 disabled:hover:scale-100"
                            >
                                {isFixingCoverageBanner ? 'Aplicando…' : 'Configurar Acceso'}
                            </button>
                            <button
                                onClick={() => setIsBannerDismissed(true)}
                                className="p-1 text-red-500/50 hover:text-red-500 transition-colors bg-red-500/5 hover:bg-red-500/10 rounded"
                                title="Dismiss for 10 minutes"
                            >
                                <X size={14} />
                            </button>
                        </div>
                    </div>
                )}

                {updateStatus?.update_available && !isUpdateBannerDismissed && (
                    <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-1.5 flex items-center justify-between animate-in slide-in-from-top-full duration-500 shadow-[0_4px_12px_rgba(245,158,11,0.08)] sm:px-5">
                        <div className="flex items-center gap-3">
                            <AlertTriangle size={14} className="text-amber-300" />
                            <p className="text-[10px] font-bold text-amber-300 uppercase tracking-widest">
                                Core Update Available: {updateStatus.latest_version || 'latest release'} is newer than {updateStatus.current_version || 'this build'}
                            </p>
                        </div>
                        <div className="flex items-center gap-3">
                            {updateStatus.release_url ? (
                                <button
                                    onClick={() => window.open(updateStatus.release_url, '_blank', 'noopener,noreferrer')}
                                    className="text-[9px] font-bold bg-amber-400 text-black px-3 py-1 rounded-md uppercase tracking-widest hover:bg-amber-300 transition-all"
                                >
                                    View Release
                                </button>
                            ) : null}
                            <button
                                onClick={() => {
                                    onMenuViewSelect('settings');
                                    setIsUpdateBannerDismissed(true);
                                }}
                                className="text-[9px] font-bold border border-amber-300/30 text-amber-200 px-3 py-1 rounded-md uppercase tracking-widest hover:bg-amber-500/10 transition-all"
                            >
                                Open Settings
                            </button>
                            <button
                                onClick={() => setIsUpdateBannerDismissed(true)}
                                className="p-1 text-amber-200/50 hover:text-amber-200 transition-colors bg-amber-500/5 hover:bg-amber-500/10 rounded"
                                title="Dismiss update banner"
                            >
                                <X size={14} />
                            </button>
                        </div>
                    </div>
                )}

                <main className="relative flex-1 min-h-0 overflow-hidden flex flex-col">
                    {children}
                </main>
            </div>

            <style dangerouslySetInnerHTML={{
                __html: `
                .custom-scrollbar::-webkit-scrollbar {
                    width: 4px;
                    height: 4px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: #2e2e2e;
                    border-radius: 10px;
                }
                .scrollbar-hide::-webkit-scrollbar {
                    display: none;
                }
                .scrollbar-hide {
                    -ms-overflow-style: none;
                    scrollbar-width: none;
                }
            `}} />

            <CreateTableModal
                isOpen={isCreateTableModalOpen}
                mode={tableModalMode}
                tableToEdit={tableBeingEdited}
                onClose={() => {
                    setIsCreateTableModalOpen(false);
                    setTableModalMode('create');
                    setTableBeingEdited(null);
                }}
                onMenuViewSelect={onMenuViewSelect}
                schema={selectedSchema}
                onTableCreated={(tableName?: string) => {
                    refreshTables();
                    if (tableName) {
                        onTableSelect(tableName);
                    }
                }}
            />

            <ConnectionModal
                  isOpen={isConnectionModalOpen}
                  onClose={() => setIsConnectionModalOpen(false)}
                  activeWorkspaceId={workspaceId}
                />

            {/* Standardized Global Toasts */}
            {toast && (
                <BrandedToast
                    message={toast.message}
                    tone={toast.type}
                    onClose={() => setToast(null)}
                />
            )}

            <AutoFixModal
                isOpen={isAutoFixModalOpen}
                issue={selectedFixIssue}
                onClose={() => setIsAutoFixModalOpen(false)}
                onConfirm={handleApplyFix}
            />

            <ConfirmModal
                isOpen={!!confirmDeleteTable}
                onClose={() => setConfirmDeleteTable(null)}
                onConfirm={confirmTableDeletion}
                title="Delete Table"
                message={`Are you sure you want to delete table "${confirmDeleteTable}"? All data within this collection will be lost forever.`}
                confirmText="Burn Table"
            />
        </div>
    );
};

export default Layout;


