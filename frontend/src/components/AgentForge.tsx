import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import {
    Activity,
    AlertTriangle,
    BrainCircuit,
    Bug,
    Clock3,
    Code2,
    Copy,
    Cpu,
    Globe,
    History,
    KeyRound,
    Link2,
    ShieldCheck,
    RefreshCw,
    Radar,
    Sparkles,
    TerminalSquare,
    Zap,
    X,
    ZoomIn,
    ZoomOut,
    ChevronsUpDown,
    Database,
    PanelLeftClose,
    PanelLeftOpen,
    PanelRightClose,
    PanelRightOpen,
    PanelTopClose,
    PanelTopOpen,
} from 'lucide-react';
import { fetchConnectionMetadata, ConnectionSummary } from '../services/connectionService';
import { 
    Search, 
    ShieldAlert, 
    Loader2, 
    Code, 
    Box, 
    Server, 
    Plus, 
    ChevronDown, 
    MoreHorizontal, 
    Check, 
    Edit, 
    Settings, 
    HardDrive, 
    Shield, 
    Workflow,
    LogOut,
    Trash2
} from 'lucide-react';

import SkillStorePanel from './SkillStorePanel';
import { BrandedToast, type BrandedToastTone } from './OverlayPrimitives';
import { useMCPNexus } from '../hooks/useMCPNexus';
import { fetchWithAuth } from '../utils/api';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

type NodePoint = { x: number; y: number };

type DragNodeState = {
    key: string;
    startX: number;
    startY: number;
    initialX: number;
    initialY: number;
};

type ContextNodeType = 'core' | 'target';

type ContextFeedbackState = {
    message: string;
    tone: BrandedToastTone;
    title?: string;
};

const coreKey = 'core';
const targetKey = 'target';
const agentKey = (id: string) => `agent:${id}`;
const nodeCardWidth = 176;
const coreRadius = 40;
const standardRadius = 32;

const sourceMeta: Record<string, { label: string; icon: React.ComponentType<{ size?: number; className?: string }>; tone: string }> = {
    cursor: { label: 'Cursor', icon: Radar, tone: 'text-cyan-300' },
    claude: { label: 'Claude', icon: Sparkles, tone: 'text-amber-300' },
    vscode: { label: 'VS Code', icon: Code2, tone: 'text-blue-300' },
    python: { label: 'Python', icon: Cpu, tone: 'text-emerald-300' },
    mcp: { label: 'MCP', icon: BrainCircuit, tone: 'text-indigo-300' },
};

const fxThemeMap = {
    pulse: {
        inboundLabel: 'Pulse Check',
        outboundLabel: 'Inspecting',
        inboundText: 'text-cyan-300/90',
        outboundText: 'text-cyan-300/90',
        line: 'bg-cyan-400/70 shadow-[0_0_12px_rgba(34,211,238,0.45)]',
        inboundParticle: 'bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.75)] animate-[slide-right_2.25s_ease-in-out_infinite]',
        outboundParticle: 'bg-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.65)] animate-[slide-right_2.35s_ease-in-out_infinite_0.2s]',
        coreBorder: 'border-cyan-400/50',
        coreAnim: 'animate-[core-pulse-cyan_2.1s_ease-in-out_infinite]',
        coreRing: '',
        tagTone: 'border-cyan-300/45 text-cyan-200 bg-[#04080d]/85',
        tagAnim: 'animate-[slide-tag_2.25s_ease-in-out_infinite,tag-hover_2.25s_ease-in-out_infinite]',
    },
    flow: {
        inboundLabel: 'Injecting Intent',
        outboundLabel: 'Executing',
        inboundText: 'text-emerald-300/90',
        outboundText: 'text-emerald-300/90',
        line: 'bg-emerald-400/70 shadow-[0_0_12px_rgba(16,185,129,0.45)]',
        inboundParticle: 'bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.75)] animate-[slide-right_1.55s_ease-in-out_infinite]',
        outboundParticle: 'bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.75)] animate-[slide-right_1.35s_ease-in-out_infinite_0.2s]',
        coreBorder: 'border-emerald-400/50',
        coreAnim: 'animate-[core-pulse-emerald_1.7s_ease-in-out_infinite]',
        coreRing: '',
        tagTone: 'border-emerald-300/45 text-emerald-200 bg-[#04100a]/85',
        tagAnim: 'animate-[slide-tag_1.45s_ease-in-out_infinite,tag-hover_1.45s_ease-in-out_infinite]',
    },
    warp: {
        inboundLabel: 'Schema Shift',
        outboundLabel: 'Reconfiguring',
        inboundText: 'text-amber-300/90',
        outboundText: 'text-amber-300/90',
        line: 'bg-amber-400/80 shadow-[0_0_14px_rgba(251,191,36,0.45)] animate-[warp-cable_0.24s_linear_infinite]',
        inboundParticle: 'bg-amber-300 shadow-[0_0_14px_rgba(251,191,36,0.85)] animate-[slide-right_1.05s_linear_infinite]',
        outboundParticle: 'bg-rose-400 shadow-[0_0_14px_rgba(251,113,133,0.8)] animate-[slide-right_0.95s_linear_infinite_0.18s]',
        coreBorder: 'border-amber-400/60',
        coreAnim: 'animate-[core-pulse-warp_0.9s_ease-in-out_infinite]',
        coreRing: '',
        tagTone: 'border-amber-300/55 text-amber-100 bg-[#120807]/90',
        tagAnim: 'animate-[slide-tag_1.05s_linear_infinite,tag-hover_1.05s_ease-in-out_infinite]',
    },
    shield: {
        inboundLabel: 'Governance Guard',
        outboundLabel: 'Hardening',
        inboundText: 'text-sky-300/90',
        outboundText: 'text-sky-300/90',
        line: 'bg-sky-400/80 shadow-[0_0_14px_rgba(56,189,248,0.5)]',
        inboundParticle: 'bg-sky-300 shadow-[0_0_14px_rgba(56,189,248,0.85)] animate-[slide-right_1.8s_ease-in-out_infinite]',
        outboundParticle: 'bg-blue-300 shadow-[0_0_14px_rgba(96,165,250,0.85)] animate-[slide-right_1.9s_ease-in-out_infinite_0.18s]',
        coreBorder: 'border-sky-400/55',
        coreAnim: 'animate-[core-pulse-shield_1.35s_ease-in-out_infinite]',
        coreRing: 'animate-[shield-wave_1.25s_ease-out_infinite]',
        tagTone: 'border-sky-300/55 text-sky-100 bg-[#050a14]/90',
        tagAnim: 'animate-[slide-tag_1.85s_ease-in-out_infinite,tag-hover_1.85s_ease-in-out_infinite]',
    },
};

const securityLabelFromLevel = (level: string): string => {
    const normalized = String(level || '').trim().toLowerCase();
    if (normalized === 'restringido') return 'Restringido';
    if (normalized === 'medio') return 'Medio';
    if (normalized === 'libre') return 'Libre';
    return normalized ? normalized.toUpperCase() : 'Desconocido';
};

const cableColorByFX = (fx: string): string => {
    const normalized = String(fx || '').toLowerCase();
    if (normalized === 'flow') return 'rgba(16,185,129,0.95)';
    if (normalized === 'warp') return 'rgba(251,191,36,0.95)';
    if (normalized === 'shield') return 'rgba(56,189,248,0.95)';
    return 'rgba(34,211,238,0.95)';
};

const normalizeAgentToken = (value: string) => String(value || '').trim().toLowerCase();
const agentTokensMatch = (left: string, right: string) => {
    const a = normalizeAgentToken(left);
    const b = normalizeAgentToken(right);
    if (!a || !b) return false;
    return a === b || a.endsWith(`:${b}`) || b.endsWith(`:${a}`);
};

type MCPInstallEditor = 'vscode' | 'cursor' | 'antigravity' | 'windsurf';

const AgentForge: React.FC = () => {
    const governanceQueueRef = useRef<HTMLDivElement | null>(null);
    const [activeTab, setActiveTab] = useState<'store' | 'skills'>('store');
    const [autoSkillsEnabled, setAutoSkillsEnabled] = useState(false);
    const [selectedAgentID, setSelectedAgentID] = useState<string | null>(null);

    const [scale, setScale] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isSpacePressed, setIsSpacePressed] = useState(false);
    const [isPanning, setIsPanning] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [dragNode, setDragNode] = useState<DragNodeState | null>(null);
    const [connectionMeta, setConnectionMeta] = useState<ConnectionSummary | null>(null);
    const [topSectionPercent, setTopSectionPercent] = useState(96);
    const [isSplitResizing, setIsSplitResizing] = useState(false);
    const [bottomPanelOpen, setBottomPanelOpen] = useState(false);
    const [contextMenu, setContextMenu] = useState<{ isOpen: boolean; node: ContextNodeType | null; x: number; y: number }>({
        isOpen: false,
        node: null,
        x: 0,
        y: 0,
    });
    const [contextFeedback, setContextFeedback] = useState<ContextFeedbackState | null>(null);
    const lastNoticeKeyRef = useRef('');
    const [semanticPanelOpen, setSemanticPanelOpen] = useState(false);
    const [showDebugConsole, setShowDebugConsole] = useState(false);
    const [permissionsModalAgentID, setPermissionsModalAgentID] = useState<string | null>(null);
    const [permissionsNameDraft, setPermissionsNameDraft] = useState('');
    const [permissionsNameSaving, setPermissionsNameSaving] = useState(false);
    const [permissionsActionBusy, setPermissionsActionBusy] = useState<'' | 'disconnect' | 'delete'>('');
    const [dismissedAgentIDs, setDismissedAgentIDs] = useState<Record<string, true>>({});
    const [isHealthChecking, setIsHealthChecking] = useState(false);
    const [nodePulse, setNodePulse] = useState<Record<string, boolean>>({ core: false, target: false });
    const [coreCopyShake, setCoreCopyShake] = useState(false);
    const [forceWarpUntil, setForceWarpUntil] = useState(0);
    const [leftDrawerOpen, setLeftDrawerOpen] = useState(false);
    const [rightDrawerOpen, setRightDrawerOpen] = useState(true);
    const [storageLoading, setStorageLoading] = useState(false);
    const [storageQuery, setStorageQuery] = useState('');
    const [registeredCollections, setRegisteredCollections] = useState<string[]>([]);
    const [shadowTables, setShadowTables] = useState<string[]>([]);
    const [installEditor, setInstallEditor] = useState<MCPInstallEditor>('antigravity');

    // Ozy-Zen Layout States
    const [canvasMode, setCanvasMode] = useState<'architecture' | 'storage' | 'security'>('architecture');
    const [focusMode, setFocusMode] = useState(false);
    const [selectedTableID, setSelectedTableID] = useState<string | null>(null);

    const [nodePositions, setNodePositions] = useState<Record<string, NodePoint>>({
        [coreKey]: { x: 700, y: 120 },
        [targetKey]: { x: 1060, y: 120 },
    });

    const canvasRef = useRef<HTMLDivElement | null>(null);
    const contextMenuRef = useRef<HTMLDivElement | null>(null);
    const semanticPanelRef = useRef<HTMLDivElement | null>(null);
    const didManualCoreLayoutRef = useRef(false);

    const {
        agents,
        approvalsLoading,
        bridgeStatus,
        isBridgeConnected,
        rawMCPFrames,
        refreshBridge,
        pipelineState,
        semanticHealth,
        notice,
        clearNotice,
        skillCatalog,
        skillsLoading,
        engramCompactionRunning,
        skillUpdatePending,
        agentLevelUpdating,
        pendingApprovals,
        approvalActioningByID,
        updateSkillPolicy,
        updateAgentAccessLevel,
        resolvePendingApproval,
        compactEngramNow,
    } = useMCPNexus();

    // Auto-scroll Governance Queue to bottom
    useEffect(() => {
        if (governanceQueueRef.current) {
            governanceQueueRef.current.scrollTo({
                top: governanceQueueRef.current.scrollHeight,
                behavior: 'smooth',
            });
        }
    }, [pendingApprovals.length, permissionsModalAgentID]);

    const visibleAgents = useMemo(
        () => agents.filter((agent) => !dismissedAgentIDs[agent.id]),
        [agents, dismissedAgentIDs],
    );

    useEffect(() => {
        const loadMeta = async () => {
            try {
                const meta = await fetchConnectionMetadata();
                setConnectionMeta(meta);
            } catch (err) {
                console.error('Failed to load connection meta in forge:', err);
            }
        };
        void loadMeta();
    }, []);

    const mcpBridgeURL = useMemo(() => `${window.location.origin}/api/project/mcp`, []);
    const npxBridgeCommand = useMemo(
        () => `npx -y ozybase mcp bridge --url "${mcpBridgeURL}" --install-skills`,
        [mcpBridgeURL],
    );
    const mcpEditorRootKey = useMemo(() => (
        installEditor === 'vscode' ? 'servers' : 'mcpServers'
    ), [installEditor]);

    const buildInstallConfig = useCallback((editor: MCPInstallEditor, apiKey: string) => {
        const rootKey = editor === 'vscode' ? 'servers' : 'mcpServers';
        const payload = {
            [rootKey]: {
                ozybase: {
                    command: 'npx',
                    args: ['-y', 'ozybase', 'mcp', 'bridge', '--url', mcpBridgeURL],
                    env: {
                        OZYBASE_API_KEY: apiKey,
                    },
                },
            },
        };
        return JSON.stringify(payload, null, 2);
    }, [mcpBridgeURL]);
    
    const semanticHealthScore = useMemo(() => {
        if (!semanticHealth || typeof semanticHealth.physicalTables !== 'number') return 0;
        if (semanticHealth.physicalTables === 0) return 100;
        return Math.min(100, Math.round((semanticHealth.semanticSnapshots / semanticHealth.physicalTables) * 100));
    }, [semanticHealth]);
    const semanticCoveragePercent = semanticHealthScore;
    const semanticCoverageLabel = `${semanticHealth.semanticSnapshots}/${semanticHealth.physicalTables || 0}`;
    const bridgeSyncPercent = !isBridgeConnected
        ? 20
        : semanticHealth.status === 'synchronized'
            ? 100
            : semanticHealth.status === 'drift'
                ? 72
                : 58;
    const bridgeSyncLabel = !isBridgeConnected
        ? 'Offline'
        : semanticHealth.status === 'synchronized'
            ? 'Synchronized'
            : semanticHealth.status === 'drift'
                ? 'Drift'
                : semanticHealth.status === 'alert'
                    ? 'Alert'
                    : 'Connected';

    const isAgentExecuting = useCallback((agent: { status: string; lastActivityAt?: string; pendingCount?: number; recentTools?: string[] }) => {
        const status = String(agent.status || '').toLowerCase();
        if (['executing', 'running', 'busy', 'processing', 'pending'].includes(status)) return true;
        if (Number(agent.pendingCount || 0) > 0) return true;
        if (status !== 'active') return false;
        if (!pipelineState.isFlowing) return false;
        if (!Array.isArray(agent.recentTools) || agent.recentTools.length === 0) return false;
        const ts = Date.parse(String(agent.lastActivityAt || ''));
        if (Number.isNaN(ts)) return false;
        return (Date.now() - ts) <= 10000;
    }, [pipelineState.isFlowing]);

    useEffect(() => {
        setNodePositions((current) => {
            const next = { ...current };
            const spacing = 154;
            const baseX = 180;
            const centeredOffset = visibleAgents.length > 0 ? Math.max(0, (visibleAgents.length - 1) * spacing * 0.45) : 0;

            visibleAgents.forEach((agent, index) => {
                const key = agentKey(agent.id);
                if (next[key]) return;
                next[key] = {
                    x: baseX + (index * spacing) - centeredOffset,
                    y: 160 + ((index % 2) * 10),
                };
            });

            Object.keys(next)
                .filter((key) => key.startsWith('agent:'))
                .forEach((key) => {
                    const id = key.replace('agent:', '');
                    if (!visibleAgents.some((agent) => agent.id === id)) {
                        delete next[key];
                    }
                });

            return next;
        });
    }, [visibleAgents]);

    useEffect(() => {
        if (selectedAgentID) {
            const stillExists = visibleAgents.some((agent) => agent.id === selectedAgentID);
            if (stillExists) return;
        }

        if (visibleAgents.length > 0) {
            setSelectedAgentID(visibleAgents[0].id);
        } else {
            setSelectedAgentID(null);
        }
    }, [visibleAgents, selectedAgentID]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (event.code === 'Space' && !event.repeat && !(target && target.matches('input, textarea'))) {
                setIsSpacePressed(true);
            }

            if (event.ctrlKey || event.metaKey) {
                if (['Equal', 'NumpadAdd', 'Plus'].includes(event.code) || event.key === '+' || event.key === '=') {
                    event.preventDefault();
                    setScale((current) => clamp(current + 0.1, 0.5, 1.8));
                } else if (['Minus', 'NumpadSubtract', 'Hyphen'].includes(event.code) || event.key === '-') {
                    event.preventDefault();
                    setScale((current) => clamp(current - 0.1, 0.5, 1.8));
                } else if (['Digit0', 'Numpad0'].includes(event.code) || event.key === '0') {
                    event.preventDefault();
                    setScale(1);
                    setPan({ x: 0, y: 0 });
                }
            }
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.code === 'Space') {
                setIsSpacePressed(false);
                setIsPanning(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, []);

    const handleWheel = useCallback((event: WheelEvent) => {
        if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            event.stopPropagation();
            const delta = event.deltaY * -0.001;
            setScale((current) => clamp(current + delta, 0.5, 1.8));
            return;
        }

        setPan((current) => ({
            x: current.x - event.deltaX,
            y: current.y - event.deltaY,
        }));
    }, []);

    useEffect(() => {
        const container = canvasRef.current;
        if (!container) return;

        container.addEventListener('wheel', handleWheel, { passive: false });
        return () => container.removeEventListener('wheel', handleWheel);
    }, [handleWheel]);

    const selectedAgent = useMemo(() => visibleAgents.find((item) => item.id === selectedAgentID) || null, [visibleAgents, selectedAgentID]);

    const loadStorageDiscovery = async () => {
        setStorageLoading(true);
        try {
            const tableSQL = `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name NOT LIKE '_v_%' AND table_name NOT LIKE '_ozy_%' ORDER BY table_name`;
            const collectionSQL = `SELECT name FROM _v_collections WHERE name NOT LIKE '_v_%' AND name NOT LIKE '_ozy_%' ORDER BY name`;

            const [tableRes, collectionRes] = await Promise.all([
                fetchWithAuth('/api/sql', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: tableSQL, mode: 'safe', confirm_danger: false }),
                }),
                fetchWithAuth('/api/sql', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: collectionSQL, mode: 'safe', confirm_danger: false }),
                }),
            ]);

            if (!tableRes.ok || !collectionRes.ok) {
                throw new Error('storage discovery failed');
            }

            const tablePayload = await tableRes.json().catch(() => null) as { rows?: string[][] } | null;
            const collectionPayload = await collectionRes.json().catch(() => null) as { rows?: string[][] } | null;

            const sqlTables = Array.isArray(tablePayload?.rows)
                ? tablePayload!.rows.map((row) => String(row?.[0] || '').trim()).filter(Boolean)
                : [];
            const collections = Array.isArray(collectionPayload?.rows)
                ? collectionPayload!.rows.map((row) => String(row?.[0] || '').trim()).filter(Boolean)
                : [];

            const collectionSet = new Set(collections);
            const shadow = sqlTables.filter((table) => !collectionSet.has(table));

            setRegisteredCollections(collections);
            setShadowTables(shadow);
        } catch {
            setRegisteredCollections([]);
            setShadowTables([]);
        } finally {
            setStorageLoading(false);
        }
    };

    useEffect(() => {
        void loadStorageDiscovery();
        const interval = window.setInterval(() => {
            void loadStorageDiscovery();
        }, 30000);
        return () => window.clearInterval(interval);
    }, []);

    const storageQueryNormalized = storageQuery.trim().toLowerCase();
    const visibleCollections = useMemo(
        () => registeredCollections.filter((name) => !storageQueryNormalized || name.toLowerCase().includes(storageQueryNormalized)).slice(0, 32),
        [registeredCollections, storageQueryNormalized],
    );
    const visibleShadowTables = useMemo(
        () => shadowTables.filter((name) => !storageQueryNormalized || name.toLowerCase().includes(storageQueryNormalized)).slice(0, 16),
        [shadowTables, storageQueryNormalized],
    );

    const permissionsModalAgent = useMemo(
        () => agents.find((item) => item.id === permissionsModalAgentID) || null,
        [agents, permissionsModalAgentID],
    );

    const permissionsModalPendingApprovals = useMemo(
        () => permissionsModalAgent
            ? pendingApprovals
                .filter((item) => agentTokensMatch(String(item.token_id || ''), permissionsModalAgent.id))
                .sort((a, b) => (Date.parse(String(b.created_at || '')) || 0) - (Date.parse(String(a.created_at || '')) || 0))
            : [],
        [pendingApprovals, permissionsModalAgent],
    );

    const openPermissionsModalForAgent = (agentID: string) => {
        setDismissedAgentIDs((current) => {
            if (!current[agentID]) return current;
            const next = { ...current };
            delete next[agentID];
            return next;
        });
        setSelectedAgentID(agentID);
        setPermissionsModalAgentID(agentID);
    };

    useEffect(() => {
        if (!permissionsModalAgent) {
            setPermissionsNameDraft('');
            return;
        }
        setPermissionsNameDraft((permissionsModalAgent.name || permissionsModalAgent.label || permissionsModalAgent.id).trim());
    }, [permissionsModalAgent]);

    const savePermissionsAgentName = async () => {
        if (!permissionsModalAgent) return;
        const nextName = permissionsNameDraft.trim();
        if (!nextName) return;
        setPermissionsNameSaving(true);
        try {
            const res = await fetchWithAuth(`/api/project/mcp/agents/${encodeURIComponent(permissionsModalAgent.id)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ friendly_name: nextName }),
            });
            if (!res.ok) {
                throw new Error(`rename failed: ${res.status}`);
            }
            await refreshBridge();
            showTransientFeedback('Nombre del agente actualizado.', 'success', 'Agent Updated');
        } catch {
            showTransientFeedback('No se pudo actualizar el nombre del agente.', 'error', 'Action Failed');
        } finally {
            setPermissionsNameSaving(false);
        }
    };

    const executePermissionsAction = async (action: 'disconnect' | 'delete') => {
        if (!permissionsModalAgent) return;
        setPermissionsActionBusy(action);
        try {
            const res = await fetchWithAuth(`/api/project/mcp/agents/${encodeURIComponent(permissionsModalAgent.id)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action }),
            });
            if (!res.ok) {
                throw new Error(`agent action failed: ${res.status}`);
            }
            await refreshBridge();
            if (action === 'delete') {
                setDismissedAgentIDs((current) => ({ ...current, [permissionsModalAgent.id]: true }));
                setPermissionsModalAgentID(null);
                showTransientFeedback('Agente removido del panel activo.', 'success', 'Agent Removed');
            } else {
                showTransientFeedback('Agente marcado como desconectado.', 'success', 'Agent Disconnected');
            }
        } catch {
            showTransientFeedback('No se pudo completar la acción del agente.', 'error', 'Action Failed');
        } finally {
            setPermissionsActionBusy('');
        }
    };

    const activeAgentCount = visibleAgents.length;
    const totalPendingApprovals = useMemo(
        () => visibleAgents.reduce((sum, item) => sum + Number(item.pendingCount || 0), 0),
        [visibleAgents],
    );
    const enabledSkillsCount = useMemo(
        () => skillCatalog.filter((item) => item.enabled).length,
        [skillCatalog],
    );
    const selectedAgentSkillsCount = useMemo(
        () => (selectedAgent?.availableSkills?.length || 0),
        [selectedAgent],
    );
    const semanticMissingTables = useMemo(() => {
        const explicit = (semanticHealth.missingTables || []).map((table) => String(table || '').trim()).filter(Boolean);
        if (explicit.length > 0) return Array.from(new Set(explicit));

        const snapshotSet = new Set(
            (semanticHealth.semanticSnapshotTableNames || [])
                .map((table) => String(table || '').trim())
                .filter(Boolean),
        );
        return (semanticHealth.physicalTableNames || [])
            .map((table) => String(table || '').trim())
            .filter((table) => Boolean(table) && !snapshotSet.has(table));
    }, [semanticHealth.missingTables, semanticHealth.physicalTableNames, semanticHealth.semanticSnapshotTableNames]);

    const semanticStatusMeta = useMemo(() => {
        if (semanticHealth.status === 'alert') {
            return {
                label: 'Alert',
                dot: 'bg-rose-400',
                shell: 'border-rose-500/50 bg-rose-500/10',
                hint: 'Se detectó alerta de seguridad reciente.',
            };
        }
        if (semanticHealth.status === 'drift') {
            return {
                label: 'Drift',
                dot: 'bg-amber-400',
                shell: 'border-amber-500/50 bg-amber-500/10',
                hint: 'Hay tablas físicas sin snapshot semántico.',
            };
        }
        if (semanticHealth.status === 'synchronized') {
            return {
                label: 'Synced',
                dot: 'bg-emerald-400',
                shell: 'border-emerald-500/50 bg-emerald-500/10',
                hint: 'Plano físico y semántico alineados.',
            };
        }
        return {
            label: 'Unknown',
            dot: 'bg-zinc-500',
            shell: 'border-white/10 bg-black/40',
            hint: 'Aún no hay señal semántica disponible.',
        };
    }, [semanticHealth.status]);

    const hasRealBridgeFlow = isBridgeConnected && pipelineState.isFlowing && activeAgentCount > 0;
    const activePipelineFX = pipelineState.pipelineFX;
    const fxTheme = (Date.now() < forceWarpUntil)
        ? fxThemeMap.warp
        : (activePipelineFX ? fxThemeMap[activePipelineFX] : fxThemeMap.flow);
    const operationTag = pipelineState.operationTag;
    const getNodeCenter = (point: NodePoint, radius: number): NodePoint => ({
        x: point.x + (nodeCardWidth / 2),
        y: point.y + radius,
    });

    const coreCenter = useMemo(() => {
        const point = nodePositions[coreKey] || { x: 700, y: 120 };
        return getNodeCenter(point, coreRadius);
    }, [nodePositions]);

    const targetCenter = useMemo(() => {
        const point = nodePositions[targetKey] || { x: 1060, y: 120 };
        return getNodeCenter(point, standardRadius);
    }, [nodePositions]);

    const lineStyle = (from: NodePoint, to: NodePoint, fromRadius: number, toRadius: number) => {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const distance = Math.sqrt((dx * dx) + (dy * dy));
        const unitX = distance > 0 ? dx / distance : 0;
        const unitY = distance > 0 ? dy / distance : 0;

        const startX = from.x + (unitX * fromRadius);
        const startY = from.y + (unitY * fromRadius);
        const endX = to.x - (unitX * toRadius);
        const endY = to.y - (unitY * toRadius);

        const lineDx = endX - startX;
        const lineDy = endY - startY;
        const length = Math.sqrt((lineDx * lineDx) + (lineDy * lineDy));
        const angle = Math.atan2(lineDy, lineDx) * (180 / Math.PI);

        return {
            width: `${length}px`,
            left: `${startX}px`,
            top: `${startY}px`,
            transform: `translateY(-50%) rotate(${angle}deg)`,
        };
    };

    const handleCanvasMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
        if (isSpacePressed || event.button === 1) {
            setIsPanning(true);
            setDragStart({ x: event.clientX - pan.x, y: event.clientY - pan.y });
            event.preventDefault();
        }
    };

    const handleNodeMouseDown = (event: React.MouseEvent<HTMLDivElement>, key: string) => {
        if (event.button !== 0) {
            return;
        }
        if (isSpacePressed) return;

        const fallbackPoint = key === coreKey
            ? { x: 700, y: 120 }
            : key === targetKey
                ? { x: 1060, y: 120 }
                : { x: 860, y: 120 };
        const point = nodePositions[key] || fallbackPoint;

        event.preventDefault();
        event.stopPropagation();

        if (key === coreKey || key === targetKey) {
            didManualCoreLayoutRef.current = true;
        }

        setDragNode({
            key,
            startX: event.clientX,
            startY: event.clientY,
            initialX: point.x,
            initialY: point.y,
        });
    };

    const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
        if (isPanning) {
            setPan({
                x: event.clientX - dragStart.x,
                y: event.clientY - dragStart.y,
            });
            return;
        }

        if (!dragNode) return;

        const dx = (event.clientX - dragNode.startX) / scale;
        const dy = (event.clientY - dragNode.startY) / scale;

        setNodePositions((current) => ({
            ...current,
            [dragNode.key]: {
                x: dragNode.initialX + dx,
                y: dragNode.initialY + dy,
            },
        }));
    };

    const handleMouseUp = () => {
        setIsPanning(false);
        setDragNode(null);
    };

    useEffect(() => {
        const recenter = () => {
            const container = canvasRef.current;
            if (!container || didManualCoreLayoutRef.current) {
                return;
            }

            const width = container.clientWidth;
            const safePadding = 36;
            const centerX = Math.max(safePadding, (width / 2) - (nodeCardWidth / 2));
            const desiredGap = 320;
            const maxX = Math.max(safePadding, width - nodeCardWidth - safePadding);

            const coreX = Math.min(Math.max(safePadding, centerX - (desiredGap / 2)), maxX);
            const targetX = Math.min(Math.max(safePadding, centerX + (desiredGap / 2)), maxX);

            setNodePositions((current) => ({
                ...current,
                [coreKey]: { x: coreX, y: 120 },
                [targetKey]: { x: targetX, y: 120 },
            }));
        };

        recenter();
        window.addEventListener('resize', recenter);
        return () => window.removeEventListener('resize', recenter);
    }, [visibleAgents.length]);

    useEffect(() => {
        if (!isSplitResizing) {
            return;
        }

        const onMove = (event: MouseEvent) => {
            const container = canvasRef.current?.parentElement;
            if (!container) {
                return;
            }
            const rect = container.getBoundingClientRect();
            const pct = ((event.clientY - rect.top) / rect.height) * 100;
            setTopSectionPercent(clamp(pct, 44, 78));
        };

        const onUp = () => setIsSplitResizing(false);

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
    }, [isSplitResizing]);

    const toggleTopExpansion = () => {
        setTopSectionPercent((current) => (current >= 70 ? 56 : 74));
    };

    // Auto-apertura de panel inferior al recibir pulso
    const prevFramesLength = useRef(rawMCPFrames.length);
    useEffect(() => {
        // Ignora carga inicial. Si crece, y estaba cerrado, lo abrimos.
        if (rawMCPFrames.length > prevFramesLength.current && prevFramesLength.current !== 0) {
            if (!bottomPanelOpen) {
                setBottomPanelOpen(true);
                setTopSectionPercent(56);
            }
        }
        prevFramesLength.current = rawMCPFrames.length;
    }, [rawMCPFrames.length, bottomPanelOpen]);

    const toggleBottomPanel = () => {
        setBottomPanelOpen((current) => {
            if (current) {
                setIsSplitResizing(false);
                setTopSectionPercent(96);
                return false;
            }
            setTopSectionPercent(56);
            return true;
        });
    };

    const pulseNode = (node: ContextNodeType) => {
        setNodePulse((current) => ({ ...current, [node]: true }));
        window.setTimeout(() => {
            setNodePulse((current) => ({ ...current, [node]: false }));
        }, 480);
    };

    const showTransientFeedback = (message: string, tone: BrandedToastTone = 'info', title?: string) => {
        setContextFeedback({ message, tone, title });
        window.setTimeout(() => {
            setContextFeedback(null);
        }, 2200);
    };

    useEffect(() => {
        if (!notice) return;
        const key = `${notice.type}:${notice.message}`;
        if (lastNoticeKeyRef.current === key) return;
        lastNoticeKeyRef.current = key;
        showTransientFeedback(
            notice.message,
            notice.type === 'error' ? 'error' : 'info',
            notice.type === 'error' ? 'Security Watchtower' : 'Control Notice',
        );
        const timer = window.setTimeout(() => {
            clearNotice();
        }, 2800);
        return () => window.clearTimeout(timer);
    }, [notice, clearNotice]);

    const copyToClipboard = async (value: string, node: ContextNodeType, message: string) => {
        const payload = String(value || '').trim();
        if (!payload) {
            showTransientFeedback('No hay valor disponible para copiar.', 'warning', 'Action Required');
            return;
        }

        try {
            await navigator.clipboard.writeText(payload);
            pulseNode(node);
            if (node === 'core') {
                setCoreCopyShake(true);
                window.setTimeout(() => setCoreCopyShake(false), 620);
            }
            showTransientFeedback(message, 'success', 'Action Completed');
            setContextMenu((current) => ({ ...current, isOpen: false }));
        } catch {
            showTransientFeedback('No se pudo copiar al portapapeles.', 'error');
        }
    };

    const openContextMenu = (event: React.MouseEvent<HTMLDivElement>, node: ContextNodeType) => {
        event.preventDefault();
        event.stopPropagation();

        const canvasRect = canvasRef.current?.getBoundingClientRect();
        if (!canvasRect) {
            return;
        }

        const menuWidth = 280;
        const menuHeight = 300;
        const edgePadding = 10;
        const relativeX = event.clientX - canvasRect.left;
        const relativeY = event.clientY - canvasRect.top;

        setContextMenu({
            isOpen: true,
            node,
            x: clamp(relativeX, edgePadding, Math.max(edgePadding, canvasRect.width - menuWidth - edgePadding)),
            y: clamp(relativeY, edgePadding, Math.max(edgePadding, canvasRect.height - menuHeight - edgePadding)),
        });
    };

    const closeContextMenu = React.useCallback(() => {
        setContextMenu((current) => ({ ...current, isOpen: false }));
    }, []);

    useEffect(() => {
        if (!contextMenu.isOpen) {
            return;
        }

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                closeContextMenu();
            }
        };
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) {
                closeContextMenu();
                return;
            }
            if (contextMenuRef.current?.contains(target)) {
                return;
            }
            closeContextMenu();
        };

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('pointerdown', onPointerDown);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('pointerdown', onPointerDown);
        };
    }, [closeContextMenu, contextMenu.isOpen]);

    useEffect(() => {
        if (!semanticPanelOpen) return;

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setSemanticPanelOpen(false);
            }
        };
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) {
                setSemanticPanelOpen(false);
                return;
            }
            if (semanticPanelRef.current?.contains(target)) return;
            setSemanticPanelOpen(false);
        };

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('pointerdown', onPointerDown);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('pointerdown', onPointerDown);
        };
    }, [semanticPanelOpen]);

    const refreshBridgeAction = async () => {
        await refreshBridge();
        pulseNode('core');
        showTransientFeedback('Bridge refrescado: SSE reconectado y memoria L1 limpiada.', 'success', 'Bridge Updated');
        setContextMenu((current) => ({ ...current, isOpen: false }));
    };

    const copyMCPEndpointAction = async () => {
        const endpoint = `${window.location.origin}/api/project/mcp`;
        await copyToClipboard(endpoint, 'core', 'Endpoint MCP copiado.');
    };

    const toggleDebugModeAction = () => {
        setShowDebugConsole((current) => {
            showTransientFeedback(current ? 'Debug JSON-RPC cerrado.' : 'Debug JSON-RPC abierto.', 'info', 'Debug Console');
            return !current;
        });
        pulseNode('core');
        setContextMenu((current) => ({ ...current, isOpen: false }));
    };

    const copyAnonKeyAction = async () => {
        try {
            const summaryRes = await fetchWithAuth('/api/project/keys/essential');
            const summaryPayload = await summaryRes.json().catch(() => null) as { keys?: Array<{ role?: string; prefix?: string }> } | null;
            const anonPrefix = Array.isArray(summaryPayload?.keys)
                ? String(summaryPayload?.keys?.find((key) => key.role === 'anon')?.prefix || '').trim()
                : '';

            let candidate = '';
            const revealRes = await fetchWithAuth('/api/project/keys/essential/anon/reveal', {
                method: 'POST',
                onUnauthorized: 'passthrough',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            if (revealRes.ok) {
                const revealPayload = await revealRes.json().catch(() => null) as { key?: string } | null;
                candidate = String(revealPayload?.key || '').trim();
            }

            await copyToClipboard(candidate || anonPrefix, 'target', candidate ? 'Anon key copiada.' : 'Prefijo anon copiado.');
        } catch {
            showTransientFeedback('No se pudo recuperar la anon key.', 'error');
        }
    };

    const copyPublicURLAction = async () => {
        try {
            const res = await fetchWithAuth('/api/project/connection');
            const payload = await res.json().catch(() => null) as { api_url?: string } | null;
            const publicURL = String(payload?.api_url || `${window.location.origin}/api`).trim();
            await copyToClipboard(publicURL, 'target', 'Public URL copiada.');
        } catch {
            await copyToClipboard(`${window.location.origin}/api`, 'target', 'Public URL copiada.');
        }
    };

    const healthCheckAction = async () => {
        setIsHealthChecking(true);
        const started = performance.now();
        try {
            const res = await fetchWithAuth('/api/health');
            const elapsed = Math.max(1, Math.round(performance.now() - started));
            if (!res.ok) {
                throw new Error('health check failed');
            }
            setForceWarpUntil(Date.now() + 2600);
            pulseNode('target');
            showTransientFeedback(`Health OK en ${elapsed}ms.`, 'success', 'Health Check');
        } catch {
            showTransientFeedback('Health check fallo.', 'error', 'Health Check');
        } finally {
            setIsHealthChecking(false);
            setContextMenu((current) => ({ ...current, isOpen: false }));
        }
    };

    const copyNpxBridgeCommandAction = async () => {
        await copyToClipboard(npxBridgeCommand, 'core', 'Comando npx MCP copiado.');
    };

    const copyMCPEditorConfigAction = async (withLiveSecret = false) => {
        let apiKey = '${OZYBASE_API_KEY}';
        if (withLiveSecret) {
            try {
                const revealRes = await fetchWithAuth('/api/project/keys/essential/service_role/reveal', {
                    method: 'POST',
                    onUnauthorized: 'passthrough',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({}),
                });
                if (revealRes.ok) {
                    const payload = await revealRes.json().catch(() => null) as { key?: string } | null;
                    const candidate = String(payload?.key || '').trim();
                    if (candidate) {
                        apiKey = candidate;
                    }
                }
            } catch {
                // no-op: fallback a placeholder seguro
            }
        }
        const config = buildInstallConfig(installEditor, apiKey);
        const usedLiveSecret = withLiveSecret && apiKey !== '${OZYBASE_API_KEY}';
        await copyToClipboard(
            config,
            'core',
            usedLiveSecret
                ? `${mcpEditorRootKey} (${installEditor}) copiado con secret live.`
                : `${mcpEditorRootKey} (${installEditor}) copiado con placeholder.`,
        );
    };

    return (
        <div className="flex h-full w-full overflow-hidden bg-background font-sans antialiased text-zinc-300 relative">

            {/* UNIFIED SIDEBAR */}
            <aside className="w-[320px] border-r border-border bg-background flex flex-col relative z-50 shrink-0">
                <div className="p-6 border-b border-border bg-zinc-900/40">
                    <h2 className="text-[11px] font-bold text-white uppercase tracking-[0.3em] leading-none">Agent Forge</h2>
                    <p className="mt-2 text-[9px] font-bold text-zinc-600 uppercase tracking-widest leading-none">Nexus_Director</p>
                </div>

                <div className="flex p-4 gap-2 border-b border-border bg-black/20 shrink-0">
                    <button onClick={() => setActiveTab('store')} className={`flex-1 py-3 overflow-hidden rounded-md border transition-all text-[9px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 ${activeTab === 'store' ? 'bg-primary/5 border-primary/30 text-primary' : 'bg-zinc-900/40 border-border text-zinc-500 hover:text-white hover:border-zinc-700'}`}>
                        <Cpu size={14} /> Agentes
                    </button>
                    <button onClick={() => setActiveTab('skills')} className={`flex-1 py-3 overflow-hidden rounded-md border transition-all text-[9px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 ${activeTab === 'skills' ? 'bg-amber-500/10 border-amber-500/30 text-amber-500' : 'bg-zinc-900/40 border-border text-zinc-500 hover:text-white hover:border-zinc-700'}`} title="Gestor de Skills">
                        <Zap size={14} className={activeTab === 'skills' ? 'fill-amber-500' : ''} /> Skills
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                    {activeTab === 'store' && (
                        <div className="space-y-6">
                            {activeAgentCount === 0 ? (
                                <div className="space-y-8 py-4">
                                    <div className="flex flex-col gap-1">
                                        <h3 className="text-[11px] font-bold text-white uppercase tracking-[0.25em]">Get Started</h3>
                                        <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mt-0.5 leading-relaxed">
                                            Run these commands to link your agent and start the neural pipeline.
                                        </p>
                                    </div>

                                    <div className="space-y-10 relative">
                                        <div className="absolute left-3.5 top-6 bottom-4 w-px bg-zinc-800" />

                                        <div className="relative pl-10">
                                            <div className="absolute left-0 top-0 w-7 h-7 rounded-full bg-zinc-950 border border-zinc-800 flex items-center justify-center text-[9px] font-bold text-zinc-500 z-10">1</div>
                                            <h4 className="text-[10px] font-bold text-white mb-2 uppercase tracking-widest leading-none">Build with your Agent</h4>
                                            <button 
                                                onClick={() => void copyNpxBridgeCommandAction()}
                                                className="w-full text-left bg-black/60 border border-zinc-800 rounded-md p-3 group hover:border-zinc-700 transition-all"
                                            >
                                                <code className="block font-mono text-[9px] text-zinc-500 group-hover:text-zinc-300 break-all mb-2">
                                                    $ {npxBridgeCommand}
                                                </code>
                                                <div className="flex items-center gap-1.5 text-[8px] font-bold uppercase tracking-widest text-zinc-600 group-hover:text-primary transition-colors">
                                                    <Copy size={10} /> Copy Command
                                                </div>
                                            </button>
                                        </div>

                                        <div className="relative pl-10">
                                            <div className="absolute left-0 top-0 w-7 h-7 rounded-full bg-zinc-950 border border-zinc-800 flex items-center justify-center text-[9px] font-bold text-zinc-500 z-10">2</div>
                                            <h4 className="text-[10px] font-bold text-white mb-2 uppercase tracking-widest leading-none">Verify Connection</h4>
                                            <div className="bg-black/40 border border-zinc-800/50 rounded-md p-3 flex items-center justify-between">
                                                <span className="text-[9px] font-mono text-emerald-500/60 uppercase tracking-tighter"># esperando conexion mcp...</span>
                                                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                            </div>
                                        </div>

                                        <div className="relative pl-10">
                                            <div className="absolute left-0 top-0 w-7 h-7 rounded-full bg-zinc-950 border border-zinc-800 flex items-center justify-center text-[9px] font-bold text-zinc-500 z-10">3</div>
                                            <h4 className="text-[10px] font-bold text-white mb-1 uppercase tracking-widest leading-none">Forge Intelligence</h4>
                                            <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-800 italic">SYSTEM_READY</div>
                                        </div>
                                    </div>
                                    
                                    <div className="p-4 rounded-md bg-sky-500/5 border border-sky-500/10">
                                        <p className="text-[8px] text-sky-500/60 font-bold uppercase tracking-[0.16em] leading-relaxed">
                                            Pro Tip: Use the --install-skills flag to set up local skill development in your current directory.
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    {/* FLAT STATS BAR - INSFORGE STYLE */}
                                    <div className="flex border-y border-border bg-black/40 divide-x divide-border overflow-hidden rounded-md border-x">
                                        <div className="flex-1 py-4 flex flex-col items-center justify-center bg-zinc-950/50 hover:bg-zinc-900/50 transition-colors group">
                                            <p className="text-[8px] font-bold uppercase tracking-[0.2em] text-zinc-600 group-hover:text-zinc-400 transition-colors text-center">Functions</p>
                                            <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-sky-400">
                                                {connectionMeta?.edge_functions_count ?? 0}
                                            </p>
                                        </div>
                                        <div className="flex-1 py-4 flex flex-col items-center justify-center bg-zinc-950/50 hover:bg-zinc-900/50 transition-colors group">
                                            <p className="text-[8px] font-bold uppercase tracking-[0.2em] text-zinc-600 group-hover:text-zinc-400 transition-colors text-center">Schemas</p>
                                            <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-amber-400">
                                                {connectionMeta?.schemas_count ?? 0}
                                            </p>
                                        </div>
                                        <div className="flex-1 py-4 flex flex-col items-center justify-center bg-zinc-950/50 hover:bg-zinc-900/50 transition-colors group">
                                            <p className="text-[8px] font-bold uppercase tracking-[0.2em] text-zinc-600 group-hover:text-zinc-400 transition-colors text-center">Agents</p>
                                            <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-white">{activeAgentCount}</p>
                                        </div>
                                        <div className="flex-1 py-4 flex flex-col items-center justify-center bg-zinc-950/50 hover:bg-zinc-900/50 transition-colors group">
                                            <p className="text-[8px] font-bold uppercase tracking-[0.2em] text-zinc-600 group-hover:text-zinc-400 transition-colors text-center">Approvals</p>
                                            <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-primary">{totalPendingApprovals}</p>
                                        </div>
                                    </div>

                                    <div className="rounded-lg border border-zinc-800 bg-black/60 p-6 space-y-8 relative overflow-hidden group/mcp">
                                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover/mcp:opacity-20 transition-opacity pointer-events-none">
                                            <Globe size={48} className="text-primary rotate-12" />
                                        </div>

                                        <div className="flex flex-col gap-1 relative z-10">
                                            <div className="flex items-center justify-between">
                                                <h3 className="text-[11px] font-bold text-white uppercase tracking-[0.25em]">MCP_Registry_Bridge</h3>
                                                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-sm bg-emerald-500/10 border border-emerald-500/20">
                                                    <div className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,1)]" />
                                                    <span className="text-[8px] font-bold text-emerald-400/80 uppercase tracking-widest">Auto_Deploy</span>
                                                </div>
                                            </div>
                                            <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mt-0.5 flex items-center gap-2">
                                                <Server size={10} className="text-zinc-700" />
                                                Deployment Framework v2.0
                                            </p>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3 relative z-10">
                                            {[
                                                { id: 'vscode', label: 'VS Code', logo: (
                                                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
                                                        <path d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479l1.322 1.204a1 1 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.86L10.822 12l7.182-5.447v10.894z" />
                                                    </svg>
                                                )},
                                                { id: 'cursor', label: 'Cursor', logo: (
                                                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                        <path d="M15 6l-6 6 6 6" />
                                                        <path d="M9 6v12" />
                                                    </svg>
                                                )},
                                                { id: 'antigravity', label: 'A-Gravity', logo: (
                                                    <Activity size={18} className="text-primary" />
                                                )},
                                                { id: 'windsurf', label: 'Windsurf', logo: (
                                                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
                                                        <path d="M2 12c0-5.523 4.477-10 10-10s10 4.477 10 10-4.477 10-10 10S2 17.523 2 12z" />
                                                        <path d="M12 7l5 5-5 5" />
                                                    </svg>
                                                )}
                                            ].map((target) => (
                                                <button
                                                    key={target.id}
                                                    type="button"
                                                    onClick={() => setInstallEditor(target.id as any)}
                                                    className={`flex flex-col items-center justify-center gap-3 p-4 rounded-md border transition-all duration-300 relative overflow-hidden group/btn ${
                                                        installEditor === target.id
                                                            ? 'bg-primary/10 border-primary text-primary shadow-[0_0_20px_rgba(254,254,0,0.1)]'
                                                            : 'bg-zinc-950/40 border-zinc-800 text-zinc-600 hover:border-zinc-600 hover:text-zinc-300'
                                                    }`}
                                                >
                                                    <div className={`${installEditor === target.id ? 'scale-110 drop-shadow-[0_0_8px_rgba(254,254,0,0.5)]' : 'scale-100 group-hover/btn:scale-105 opacity-60 group-hover/btn:opacity-100'} transition-all duration-300`}>
                                                        {target.logo}
                                                    </div>
                                                    <span className="text-[8px] font-bold uppercase tracking-[0.2em]">{target.label}</span>
                                                </button>
                                            ))}
                                        </div>

                                        <div className="space-y-2.5 relative z-10">
                                            <button
                                                type="button"
                                                onClick={() => void copyNpxBridgeCommandAction()}
                                                className="w-full flex items-center gap-4 px-5 py-3.5 rounded-md border border-zinc-800 bg-zinc-950/80 text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-400 transition-all hover:bg-zinc-900 hover:border-zinc-700 hover:text-white group/copy"
                                            >
                                                <div className="shrink-0 w-8 h-8 rounded-md bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-600 group-hover/copy:text-primary transition-colors">
                                                    <TerminalSquare size={14} />
                                                </div>
                                                <span className="flex-1 text-left">Copy Bridge Command</span>
                                                <span className="text-[7px] font-bold uppercase tracking-widest text-zinc-700 group-hover/copy:text-zinc-500">NPX</span>
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => void copyMCPEditorConfigAction(false)}
                                                className="w-full flex items-center gap-4 px-5 py-3.5 rounded-md border border-zinc-800 bg-zinc-950/80 text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-400 transition-all hover:bg-zinc-900 hover:border-zinc-700 hover:text-white group/copy"
                                            >
                                                <div className="shrink-0 w-8 h-8 rounded-md bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-600 group-hover/copy:text-sky-400 transition-colors">
                                                    <Copy size={14} />
                                                </div>
                                                <span className="flex-1 text-left">Copy Editor Config</span>
                                                <span className="text-[7px] font-bold uppercase tracking-widest text-zinc-700 group-hover/copy:text-zinc-500">JSON</span>
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => void copyMCPEditorConfigAction(true)}
                                                className="w-full flex items-center gap-4 px-5 py-4 rounded-md border border-primary/20 bg-primary shadow-[0_8px_32px_rgba(254,254,0,0.1)] text-[10px] font-bold uppercase tracking-[0.2em] text-black transition-all hover:brightness-110 active:scale-[0.98] group/copy"
                                            >
                                                <div className="shrink-0 w-8 h-8 rounded-md bg-black/20 border border-black/10 flex items-center justify-center text-black/60 group-hover/copy:text-black transition-colors">
                                                    <KeyRound size={14} />
                                                </div>
                                                <span className="flex-1 text-left">Sync Config + Secret</span>
                                                <div className="w-1.5 h-1.5 rounded-full bg-black/40 animate-pulse" />
                                            </button>
                                        </div>

                                        <div className="p-3.5 rounded-md bg-amber-500/5 border border-amber-500/10 flex items-start gap-3">
                                            <AlertTriangle size={12} className="text-amber-500 shrink-0 mt-0.5" />
                                            <p className="text-[8px] text-amber-500/60 font-bold uppercase tracking-[0.16em] leading-relaxed">
                                                Active Encryption: Config payload contains live tokens. Handle with governance.
                                            </p>
                                        </div>
                                    </div>

                                    {selectedAgent && (
                                        <div className="space-y-4 pb-5 mb-5 border-b border-white/5 pt-2">
                                            <div className="flex items-center justify-between">
                                                <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-500 flex items-center gap-2">
                                                    <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse shadow-[0_0_8px_rgba(254,254,0,0.5)]"></span>
                                                    Active Target
                                                </p>
                                                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-200">{selectedAgent.name || selectedAgent.label}</p>
                                            </div>
                                            <div className="flex items-center justify-between text-[10px] font-bold tracking-widest">
                                                <div className="flex items-center gap-3">
                                                    <span className="text-[9px] text-zinc-600 uppercase">Acceso</span>
                                                    <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-sky-400">
                                                        {securityLabelFromLevel(selectedAgent.level)}
                                                    </span>
                                                </div>
                                                <div className="flex gap-4">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[8px] text-zinc-600 uppercase">Skills</span>
                                                        <span className="text-zinc-300">{selectedAgentSkillsCount}</span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[8px] text-zinc-600 uppercase">Global</span>
                                                        <span className="text-zinc-300">{enabledSkillsCount}</span>
                                                    </div>
                                                </div>
                                            </div>
                                            {approvalsLoading && <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-amber-500/80 animate-pulse bg-amber-500/5 px-2 py-1 rounded inline-block">Synchronizing Auth Protocols...</p>}
                                        </div>
                                    )}

                                    <div className="space-y-1 mt-2">
                                    {visibleAgents.map((agent) => {
                                        const isSelected = selectedAgentID === agent.id;
                                        const isExecuting = isAgentExecuting(agent);
                                        const isListening = agent.status === 'idle';
                                        const isDisconnected = agent.status === 'disconnected' || Date.now() - Date.parse(agent.lastActivityAt) > 15 * 60 * 1000;
                                        
                                        let containerClass = 'hover:bg-white/[0.03] active:bg-white/[0.05] border-transparent relative group';
                                        if (isSelected) {
                                            containerClass = 'bg-primary/5 hover:bg-primary/10 active:bg-primary/15 border-transparent backdrop-blur-md relative z-10 shadow-sm transition-all shadow-[inset_2px_0_0_0_rgba(254,254,0,1)]';
                                        } else if (isExecuting) {
                                            containerClass = 'bg-amber-500/5 hover:bg-amber-500/10 border-transparent relative shadow-[inset_2px_0_0_0_rgba(245,158,11,1)]';
                                        } else if (isDisconnected) {
                                            containerClass = 'opacity-60 grayscale hover:grayscale-0 hover:bg-white/[0.02] border-transparent relative shadow-[inset_2px_0_0_0_rgba(113,113,122,1)]';
                                        } else {
                                            containerClass = 'hover:bg-white/[0.03] active:bg-white/[0.05] border-transparent relative group shadow-[inset_2px_0_0_0_rgba(255,255,255,0.05)] hover:shadow-[inset_2px_0_0_0_rgba(255,255,255,0.3)] transition-all';
                                        }

                                        return (
                                            <div
                                                key={agent.id}
                                                onClick={() => setSelectedAgentID(agent.id)}
                                                onContextMenu={(event) => {
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                    openPermissionsModalForAgent(agent.id);
                                                }}
                                                className={`-mx-4 px-5 py-4 border-b border-border cursor-pointer flex flex-col gap-2 ${containerClass}`}
                                            >
                                                <div className="flex items-center justify-between">
                                                    <h3 className={`text-[11px] font-bold uppercase tracking-widest truncate max-w-[140px] ${isSelected || isExecuting ? 'text-primary' : isDisconnected ? 'text-zinc-700' : 'text-zinc-400 hover:text-white'}`}>
                                                        {agent.name || agent.label || agent.id}
                                                    </h3>
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                openPermissionsModalForAgent(agent.id);
                                                            }}
                                                            className="rounded-md bg-black/40 border border-border px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest text-zinc-600 transition hover:border-zinc-400 hover:text-white hover:bg-zinc-900/40"
                                                        >
                                                            Config
                                                        </button>
                                                    </div>
                                                </div>
                                                
                                                <div className="flex items-center justify-between">
                                                    <p className="text-[9px] text-zinc-700 uppercase tracking-widest font-bold line-clamp-1 flex-1">{agent.pendingCount > 0 ? `${agent.pendingCount} actions pending` : isListening ? 'Listening on core' : isDisconnected ? 'Connection lost' : 'Available'}</p>
                                                    <span className={`px-1.5 py-0.5 rounded-md text-[8px] font-bold uppercase tracking-widest ml-2 ${isSelected || isExecuting ? 'bg-primary/10 text-primary' : isListening ? 'bg-emerald-500/10 text-emerald-400' : 'bg-black/40 text-zinc-800'}`}>
                                                        {isExecuting ? 'ACTIVE' : isListening ? 'READY' : isDisconnected ? 'OFF' : 'IDLE'}
                                                    </span>
                                                </div>

                                                {agent.recentTools.length > 0 && (
                                                    <div className="flex flex-wrap gap-1 mt-1 text-[8px] text-zinc-600 font-bold uppercase tracking-widest">
                                                        {agent.recentTools.slice(0, 2).map((tool, idx) => (
                                                            <React.Fragment key={`${agent.id}-${tool}`}>
                                                                {idx > 0 && <span>•</span>}
                                                                <span>{tool}</span>
                                                            </React.Fragment>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {permissionsModalAgent && (
                        <div
                            className="fixed inset-0 z-240 flex items-center justify-center p-4 transition-all duration-300 animate-in fade-in zoom-in-95"
                            onClick={(event) => {
                                if (event.target === event.currentTarget) {
                                    setPermissionsModalAgentID(null);
                                }
                            }}
                        >
                            <div className="absolute inset-0 bg-black/80 backdrop-blur-xl" />
                            <div className="relative z-10 w-full max-w-7xl rounded-lg border border-zinc-800 bg-[#070707] shadow-[0_32px_128px_rgba(0,0,0,0.8)] flex flex-col overflow-hidden h-[85vh] max-h-[960px]">
                                <div className="flex items-center justify-between px-10 py-6 border-b border-white/5 bg-zinc-900/20">
                                    <div className="flex items-center gap-5">
                                        <div className="w-12 h-12 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-[0_0_20px_rgba(254,254,0,0.1)]">
                                            <Cpu size={22} />
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-3">
                                                <h3 className="text-xl font-bold text-white uppercase tracking-tight">{permissionsModalAgent.name || permissionsModalAgent.label || permissionsModalAgent.id}</h3>
                                                <span className="px-2 py-0.5 rounded-sm bg-zinc-800 text-[8px] font-bold text-zinc-500 uppercase tracking-widest">v2.4.0</span>
                                            </div>
                                            <p className="text-[10px] uppercase font-bold tracking-[0.2em] text-zinc-600 mt-1">
                                                Session Governance & Neural Access Control
                                            </p>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setPermissionsModalAgentID(null)}
                                        className="rounded-full w-10 h-10 flex items-center justify-center text-zinc-600 hover:text-white transition-all hover:bg-white/5 border border-transparent hover:border-white/10"
                                    >
                                        <X size={20} />
                                    </button>
                                </div>

                                <div className="flex flex-col lg:flex-row flex-1 overflow-hidden min-h-0">
                                    {/* COLUMNA IZQUIERDA: Identity & Logic */}
                                    <div className="w-full lg:w-[360px] shrink-0 border-r border-white/5 overflow-y-auto custom-scrollbar p-10 flex flex-col gap-12 bg-black/20">
                                        <div>
                                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-6 flex items-center gap-2">
                                                <div className="w-1 h-3 bg-primary/40 rounded-full" />
                                                Session Identity
                                            </p>
                                            <div className="space-y-3">
                                                <div className="relative group">
                                                    <input
                                                        value={permissionsNameDraft}
                                                        onChange={(event) => setPermissionsNameDraft(event.target.value)}
                                                        placeholder="Session Name"
                                                        className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-4 py-4 text-xs font-bold text-white outline-none transition focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                                                    />
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => void savePermissionsAgentName()}
                                                    disabled={permissionsNameSaving || !permissionsNameDraft.trim() || permissionsNameDraft.trim() === (permissionsModalAgent.name || permissionsModalAgent.label || permissionsModalAgent.id)}
                                                    className="w-full rounded-md bg-zinc-900/50 border border-zinc-800 py-3 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 transition hover:bg-zinc-800 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                                                >
                                                    {permissionsNameSaving ? 'Synchronizing...' : 'Apply Identity'}
                                                </button>
                                            </div>
                                        </div>
                                        <div>
                                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-6 flex items-center gap-2">
                                                <div className="w-1 h-3 bg-sky-500/40 rounded-full" />
                                                Governance Mode
                                            </p>
                                            <div className="grid grid-cols-1 gap-3">
                                                {(['restringido', 'medio', 'libre'] as const).map((level) => {
                                                    const selected = String(permissionsModalAgent.level || '').toLowerCase() === level;
                                                    const updating = Boolean(agentLevelUpdating[permissionsModalAgent.id]);
                                                    
                                                    let levelConfig = {
                                                        icon: <ShieldAlert size={16} />,
                                                        color: 'sky',
                                                        label: 'Restricted',
                                                        desc: 'Manual Approval'
                                                    };
                                                    
                                                    if (level === 'medio') {
                                                        levelConfig = {
                                                            icon: <ShieldCheck size={16} />,
                                                            color: 'amber',
                                                            label: 'Balanced',
                                                            desc: 'Heuristic Check'
                                                        };
                                                    } else if (level === 'libre') {
                                                        levelConfig = {
                                                            icon: <Zap size={16} />,
                                                            color: 'emerald',
                                                            label: 'Autonomous',
                                                            desc: 'Auto-Approve'
                                                        };
                                                    }

                                                    return (
                                                        <button
                                                            key={level}
                                                            type="button"
                                                            onClick={() => void updateAgentAccessLevel(permissionsModalAgent.id, level)}
                                                            disabled={updating || selected}
                                                            className={`relative flex items-center gap-4 rounded-md px-5 py-4 border transition-all duration-300 overflow-hidden group ${
                                                                selected
                                                                    ? `bg-${levelConfig.color}-500/10 border-${levelConfig.color}-500/40 text-${levelConfig.color}-400 shadow-[0_0_25px_rgba(0,0,0,0.3)]`
                                                                    : 'bg-zinc-950/40 border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300'
                                                            } disabled:cursor-not-allowed`}
                                                        >
                                                            {selected && (
                                                                <div className={`absolute inset-0 bg-linear-to-r from-${levelConfig.color}-500/5 to-transparent pointer-events-none`} />
                                                            )}
                                                            <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center border ${selected ? `border-${levelConfig.color}-500/30 bg-${levelConfig.color}-500/10` : 'border-zinc-800 bg-black/40'} transition-colors group-hover:border-zinc-600`}>
                                                                {levelConfig.icon}
                                                            </div>
                                                            <div className="flex flex-col items-start relative z-10">
                                                                <span className="text-[10px] font-black uppercase tracking-[0.2em] leading-none">{levelConfig.label}</span>
                                                                <span className={`text-[8px] font-bold mt-1.5 uppercase tracking-widest ${selected ? `text-${levelConfig.color}-400/60` : 'text-zinc-700'} group-hover:text-zinc-500`}>
                                                                    {levelConfig.desc}
                                                                </span>
                                                            </div>
                                                            {selected && (
                                                                <div className={`ml-auto h-1.5 w-1.5 rounded-full bg-${levelConfig.color}-400 shadow-[0_0_8px_${levelConfig.color}-400] animate-pulse`} />
                                                            )}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        <div className="mt-auto pt-6 border-t border-white/5">
                                            <div className="grid grid-cols-2 gap-3">
                                                <button
                                                    type="button"
                                                    onClick={() => void executePermissionsAction('disconnect')}
                                                    disabled={permissionsActionBusy !== ''}
                                                    className="flex flex-col items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950/50 p-4 transition hover:bg-amber-500/5 hover:border-amber-500/30 group"
                                                >
                                                    <LogOut size={16} className="text-zinc-700 group-hover:text-amber-500 transition-colors" />
                                                    <span className="text-[8px] font-bold uppercase tracking-[0.2em] text-zinc-600 group-hover:text-amber-400">Offline</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => void executePermissionsAction('delete')}
                                                    disabled={permissionsActionBusy !== ''}
                                                    className="flex flex-col items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950/50 p-4 transition hover:bg-rose-500/5 hover:border-rose-500/30 group"
                                                >
                                                    <Trash2 size={16} className="text-zinc-700 group-hover:text-rose-500 transition-colors" />
                                                    <span className="text-[8px] font-bold uppercase tracking-[0.2em] text-zinc-600 group-hover:text-rose-400">Flush</span>
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* COLUMNA DERECHA: Pipeline Timeline */}
                                    <div className="flex-1 flex flex-col p-10 min-w-0 bg-[#050505]">
                                        <div className="flex justify-between items-end mb-10">
                                            <div>
                                                <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-primary/60 mb-2">Real-time Pipeline</p>
                                                <h4 className="text-2xl font-bold text-white tracking-tight">Governance Queue</h4>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">Latency: 24ms</span>
                                                <div className="h-8 px-4 flex items-center justify-center rounded-sm bg-zinc-900 border border-zinc-800 text-[10px] font-bold tracking-[0.2em] text-zinc-400">
                                                    {permissionsModalPendingApprovals.length} BLOCKED
                                                </div>
                                            </div>
                                        </div>

                                        {permissionsModalPendingApprovals.length === 0 ? (
                                            <div className="flex-1 flex flex-col items-center justify-center border border-dashed border-zinc-800 rounded-lg bg-zinc-950/20">
                                                <div className="relative mb-6">
                                                    <div className="absolute inset-0 bg-primary/20 blur-2xl rounded-full animate-pulse" />
                                                    <ShieldCheck size={48} className="text-zinc-800 relative z-10" />
                                                </div>
                                                <p className="text-sm font-bold uppercase tracking-[0.2em] text-zinc-500">Secure Protocol Active</p>
                                                <p className="text-[11px] text-zinc-700 font-bold mt-3 max-w-[320px] text-center leading-relaxed tracking-wider uppercase">
                                                    No neural requests currently require manual verification.
                                                </p>
                                            </div>
                                        ) : (
                                            <div ref={governanceQueueRef} className="flex-1 overflow-y-auto pr-4 custom-scrollbar">
                                                <div className="space-y-3">
                                                    {permissionsModalPendingApprovals.map((item) => {
                                                        const isActioning = Boolean(approvalActioningByID[item.id]);
                                                        const risk = (item as any).tool_risk || 'read';
                                                        const args = item.arguments || {};
                                                        
                                                        let riskConfig = { label: 'LOW_RISK', color: 'emerald', icon: <ShieldCheck size={12} /> };
                                                        if (risk === 'dangerous') riskConfig = { label: 'CRITICAL', color: 'rose', icon: <AlertTriangle size={12} /> };
                                                        else if (risk === 'safe_write') riskConfig = { label: 'MODERATE', color: 'amber', icon: <Zap size={12} /> };

                                                        return (
                                                            <div key={item.id} className="relative group bg-zinc-950/80 p-6 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-all shadow-[0_4px_20px_rgba(0,0,0,0.2)]">
                                                                <div className="absolute top-0 right-0 p-4">
                                                                    <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-sm bg-${riskConfig.color}-500/10 border border-${riskConfig.color}-500/20`}>
                                                                        <span className={`text-[7px] font-black text-${riskConfig.color}-500 uppercase tracking-widest`}>{riskConfig.label}</span>
                                                                    </div>
                                                                </div>
                                                                
                                                                <div className="flex items-start gap-6">
                                                                    <div className={`shrink-0 w-12 h-12 rounded-md bg-${riskConfig.color}-500/10 border border-${riskConfig.color}-500/20 flex items-center justify-center text-${riskConfig.color}-500 shadow-[0_0_15px_rgba(0,0,0,0.1)] group-hover:scale-110 transition-transform`}>
                                                                        {riskConfig.icon}
                                                                    </div>
                                                                    
                                                                    <div className="flex-1 min-w-0">
                                                                        <div className="flex items-center gap-3 mb-2">
                                                                            <span className="text-sm font-black text-white uppercase tracking-wider truncate">{item.tool || 'tool_call'}</span>
                                                                            <div className="h-1 w-1 rounded-full bg-zinc-800" />
                                                                            <span className="text-[9px] font-bold text-zinc-600 tracking-widest uppercase italic">
                                                                                {item.created_at ? new Date(item.created_at).toLocaleTimeString() : 'now'}
                                                                            </span>
                                                                        </div>
                                                                        
                                                                        {/* Arguments Preview */}
                                                                        <div className="mb-6 grid grid-cols-2 gap-2">
                                                                            {Object.entries(args).slice(0, 4).map(([key, val]) => (
                                                                                <div key={key} className="flex items-center gap-2 px-2 py-1 rounded bg-black/40 border border-white/5">
                                                                                    <span className="text-[7px] font-bold text-zinc-500 uppercase tracking-widest shrink-0">{key}:</span>
                                                                                    <span className="text-[8px] font-bold text-zinc-400 truncate tracking-tight">{String(val)}</span>
                                                                                </div>
                                                                            ))}
                                                                            {Object.keys(args).length > 4 && (
                                                                                <span className="text-[7px] font-bold text-zinc-600 uppercase tracking-widest pt-1">+{Object.keys(args).length - 4} more...</span>
                                                                            )}
                                                                            {Object.keys(args).length === 0 && (
                                                                                <span className="text-[8px] font-bold text-zinc-700 uppercase tracking-widest italic">No parameters_required</span>
                                                                            )}
                                                                        </div>

                                                                        <div className="flex gap-3">
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => void resolvePendingApproval(item.id, 'reject')}
                                                                                disabled={isActioning}
                                                                                className="flex-1 h-9 rounded-md border border-zinc-800 text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-500 hover:text-rose-400 hover:bg-rose-500/5 hover:border-rose-500/20 transition-all active:scale-[0.98]"
                                                                            >
                                                                                Deny Request
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => void resolvePendingApproval(item.id, 'approve')}
                                                                                disabled={isActioning}
                                                                                className="flex-2 h-9 rounded-md bg-white text-black text-[9px] font-black uppercase tracking-[0.2em] transition-all hover:bg-primary active:scale-[0.98] shadow-lg flex items-center justify-center gap-2"
                                                                            >
                                                                                {isActioning ? (
                                                                                    <RefreshCw size={12} className="animate-spin" />
                                                                                ) : (
                                                                                    <>
                                                                                        <ShieldCheck size={12} />
                                                                                        Authorize
                                                                                    </>
                                                                                )}
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                    {activeTab === 'skills' && (
                        <div className="space-y-6">
                            {activeAgentCount === 0 ? (
                                <div className="space-y-8 py-4">
                                    <div className="flex flex-col gap-1">
                                        <h3 className="text-[11px] font-bold text-white uppercase tracking-[0.25em]">Skills Registry</h3>
                                        <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mt-0.5 leading-relaxed">
                                            The skills registry is locked until an active MCP bridge is established.
                                        </p>
                                    </div>
                                    <div className="p-4 rounded-md bg-amber-500/5 border border-amber-500/10">
                                        <p className="text-[8px] text-amber-500/60 font-bold uppercase tracking-[0.16em] leading-relaxed">
                                            Awaiting link... Please connect an agent via the Agentes tab to unlock skill governance.
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div className="pb-6 border-b border-white/5">
                                        <div className="flex items-center justify-between mb-4">
                                            <div className="flex items-center gap-3">
                                                <div className={`p-2 border ${autoSkillsEnabled ? 'border-amber-500/30 bg-amber-500/10 text-amber-500' : 'border-white/5 bg-white/5 text-zinc-600'}`}>
                                                    <Zap size={14} className={autoSkillsEnabled ? 'fill-amber-500' : ''} />
                                                </div>
                                                <div>
                                                    <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-white italic">Discovery_Protocol</h3>
                                                    <p className="text-[8px] font-bold text-amber-500/60 uppercase tracking-widest mt-0.5">AutoSkills Logic</p>
                                                </div>
                                            </div>
                                            <button 
                                                onClick={() => setAutoSkillsEnabled(!autoSkillsEnabled)}
                                                className={`relative inline-flex h-4 w-9 items-center rounded-full transition-colors ${autoSkillsEnabled ? 'bg-amber-500' : 'bg-zinc-800'}`}
                                            >
                                                <span className={`inline-block w-3 h-3 transform rounded-full bg-white transition-transform ${autoSkillsEnabled ? 'translate-x-[21px]' : 'translate-x-1'}`} />
                                            </button>
                                        </div>
                                        <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest leading-relaxed">
                                            Permite a los agentes descubrir e invocar dinámicamente nuevas herramientas según el contexto y nivel de entropía.
                                        </p>
                                    </div>

                                    <div className="space-y-px">
                                        <h3 className="text-[9px] font-bold uppercase tracking-[0.3em] text-zinc-600 mb-4 px-2">Registry_Permits</h3>
                                        {skillsLoading ? (
                                            <p className="text-zinc-600 font-bold italic text-[9px] text-center pt-4 uppercase tracking-[0.2em] animate-pulse">Loading_Registry...</p>
                                        ) : skillCatalog.length === 0 ? (
                                            <p className="text-zinc-600 font-bold italic text-[9px] text-center pt-4 uppercase tracking-[0.2em] animate-pulse">Scanning_Registry...</p>
                                        ) : (
                                            skillCatalog.map(skill => (
                                                <div key={skill.id} className="group -mx-6 px-6 py-4 border-b border-white/5 hover:bg-white/2 transition-all flex items-center justify-between gap-4">
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-2">
                                                            <h4 className="text-[10px] uppercase font-bold tracking-widest text-zinc-200 truncate">{skill.name}</h4>
                                                            {skill.enabled && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                                                        </div>
                                                        <p className="text-[8px] text-zinc-500 tracking-widest uppercase font-bold truncate mt-1">
                                                            Policy: <span className={skill.enabled ? 'text-primary/70' : 'text-rose-500/50'}>{skill.enabled ? 'ENABLED_GLOBAL' : 'DISABLED'}</span>
                                                        </p>
                                                    </div>
                                                    <button 
                                                        onClick={() => void updateSkillPolicy(skill.id, { enabled: !skill.enabled })}
                                                        disabled={skillUpdatePending[skill.id]}
                                                        className={`relative inline-flex shrink-0 h-3.5 w-8 items-center rounded-full transition-colors ${skill.enabled ? 'bg-primary' : 'bg-zinc-800'} ${skillUpdatePending[skill.id] ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                    >
                                                        <span className={`inline-block w-2.5 h-2.5 transform rounded-full bg-white transition-transform ${skill.enabled ? 'translate-x-4.5' : 'translate-x-1'}`} />
                                                    </button>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </>
                            )}
                            </div>
                        )}
                    </div>
            </aside>

            {/* MAIN AREA */}
            <main className="flex-1 flex flex-col min-w-0 relative z-10 transition-all duration-500">
                <header className="px-8 py-8 border-b border-white/5 flex items-end justify-between gap-8 bg-black/20 relative overflow-visible shrink-0 z-30">
                    <div className="absolute inset-x-0 bottom-0 h-px bg-linear-to-r from-transparent via-primary/20 to-transparent" />
                    
                    <div className="flex items-center gap-6 relative z-10">
                        <div>
                             <div className="flex items-center gap-3">
                                <h1 className="text-2xl font-bold text-white tracking-tight leading-none">OzyBase</h1>
                                <span className="px-2 py-0.5 rounded-sm bg-zinc-800 text-[9px] font-bold text-zinc-500 uppercase tracking-widest">NANO</span>
                                <div className="flex items-center gap-1.5 ml-2">
                                    <div className={`h-1.5 w-1.5 rounded-full ${isBridgeConnected ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]'}`} />
                                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">{isBridgeConnected ? 'Healthy' : 'Disconnected'}</span>
                                </div>
                             </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-4 text-xs relative z-10">
                        <div className="flex items-center border border-white/5 bg-black/40 px-2 py-1.5 shadow-inner">
                            <button type="button" onClick={() => setScale((current) => clamp(current - 0.1, 0.5, 1.8))} className="p-1 text-zinc-600 hover:text-white transition-colors">
                                <ZoomOut size={14} />
                            </button>
                            <span className="w-12 text-center text-[9px] font-bold text-zinc-400 uppercase tracking-widest">{Math.round(scale * 100)}%</span>
                            <button type="button" onClick={() => setScale((current) => clamp(current + 0.1, 0.5, 1.8))} className="p-1 text-zinc-600 hover:text-white transition-colors">
                                <ZoomIn size={14} />
                            </button>
                        </div>

                        <div className="hidden xl:flex items-center gap-3 py-2 px-5 bg-black/40 border border-white/5 shadow-inner">
                            <Activity size={14} className={isBridgeConnected ? 'text-primary animate-pulse' : 'text-zinc-700'} />
                            <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-500">{activeAgentCount} Minds_Linked</span>
                        </div>

                        <div ref={semanticPanelRef} className="relative">
                            <button
                                type="button"
                                onClick={() => setSemanticPanelOpen(!semanticPanelOpen)}
                                className={`flex h-10 px-4 items-center gap-3 border transition-all uppercase tracking-widest font-bold text-[9px] ${
                                    semanticPanelOpen
                                        ? 'bg-primary/20 border-primary/40 text-primary shadow-[0_0_15px_rgba(254,254,0,0.2)]'
                                        : 'bg-black/40 border-white/10 text-zinc-400 hover:text-white hover:border-white/20'
                                }`}
                            >
                                <ShieldCheck size={14} className={semanticPanelOpen ? 'animate-pulse' : ''} />
                                Semantic_Audit
                            </button>
                            {semanticPanelOpen && (
                                <div className="absolute top-[calc(100%+12px)] right-0 w-[420px] ozy-overlay-backdrop backdrop-blur-xl border border-white/10 rounded-md p-6 shadow-[0_20px_50px_rgba(0,0,0,0.5)] z-60 animate-in zoom-in-95 duration-200 origin-top-right">
                                    <div className="flex items-center justify-between mb-6">
                                        <div>
                                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Ozy_Governance</p>
                                            <h4 className="text-[13px] font-bold text-white uppercase tracking-widest mt-0.5">Semantic Health Audit</h4>
                                        </div>
                                        <div className={`px-2 py-1 rounded text-[9px] font-bold tracking-widest ${semanticHealthScore < 80 ? 'bg-rose-500/20 text-rose-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                                            {semanticHealthScore}% HEALTH
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <div className="p-4 bg-black/40 border border-white/5 rounded-md">
                                            <div className="flex justify-between text-[9px] font-bold tracking-widest text-zinc-500 uppercase mb-2">
                                                <span>Semantic_Coverage</span>
                                                <span className={semanticCoveragePercent >= 80 ? 'text-emerald-400' : semanticCoveragePercent >= 50 ? 'text-amber-300' : 'text-rose-400'}>
                                                    {semanticCoverageLabel}
                                                </span>
                                            </div>
                                            <div className="h-1 w-full bg-zinc-800 rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full ${semanticCoveragePercent >= 80 ? 'bg-emerald-500' : semanticCoveragePercent >= 50 ? 'bg-amber-400' : 'bg-rose-500'}`}
                                                    style={{ width: `${Math.max(0, Math.min(100, semanticCoveragePercent))}%` }}
                                                />
                                            </div>
                                        </div>
                                        <div className="p-4 bg-black/40 border border-white/5 rounded-md">
                                            <div className="flex justify-between text-[9px] font-bold tracking-widest text-zinc-500 uppercase mb-2">
                                                <span>MCP_Bridge_Sync</span>
                                                <span className={!isBridgeConnected ? 'text-rose-400' : bridgeSyncPercent >= 80 ? 'text-emerald-400' : 'text-amber-300'}>
                                                    {bridgeSyncLabel}
                                                </span>
                                            </div>
                                            <div className="h-1 w-full bg-zinc-800 rounded-full overflow-hidden">
                                                <div
                                                    className={!isBridgeConnected ? 'h-full bg-rose-500' : bridgeSyncPercent >= 80 ? 'h-full bg-emerald-500' : 'h-full bg-primary'}
                                                    style={{ width: `${Math.max(0, Math.min(100, bridgeSyncPercent))}%` }}
                                                />
                                            </div>
                                        </div>
                                        <div className="pt-2 flex justify-end">
                                            <button 
                                                onClick={() => void healthCheckAction()} 
                                                disabled={isHealthChecking}
                                                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-[9px] font-bold uppercase tracking-widest text-zinc-300 transition-colors border border-white/10"
                                            >
                                                {isHealthChecking ? 'Analyzing...' : 'Force Full Audit'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </header>

                <section
                    ref={canvasRef}
                    data-testid="agent-forge-canvas"
                    onMouseDown={handleCanvasMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    className={`flex-1 relative overflow-hidden bg-[#070707] custom-scrollbar ${isPanning ? 'cursor-grabbing' : isSpacePressed ? 'cursor-grab' : 'cursor-default'}`}
                >
                    <div 
                        data-testid="agent-forge-canvas-transform"
                        className="absolute inset-0 transition-transform duration-75 ease-out origin-center pointer-events-none"
                        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
                    >
                        {canvasMode === 'architecture' && (
                            <div className="absolute left-0 top-0 h-full w-full pointer-events-auto">
                                {!isBridgeConnected || activeAgentCount === 0 ? (
                                    <div className="flex h-full w-full items-center justify-center p-20">
                                        <div className="w-full max-w-2xl bg-zinc-950/50 border border-zinc-800 rounded-lg p-12 shadow-2xl backdrop-blur-md">
                                            <h2 className="text-2xl font-bold text-white mb-2">Get Started</h2>
                                            <p className="text-zinc-500 text-sm mb-12">Run these commands to link your agent and start the neural pipeline.</p>
                                            
                                            <div className="space-y-12 relative">
                                                {/* Connecting Line */}
                                                <div className="absolute left-4 top-8 bottom-4 w-px bg-zinc-800" />

                                                {/* Step 1 */}
                                                <div className={`relative pl-12 transition-all duration-700 ${isBridgeConnected ? 'opacity-40 scale-[0.98]' : 'opacity-100'}`}>
                                                    <div className={`absolute left-0 top-0 w-8 h-8 rounded-full border flex items-center justify-center text-[10px] font-bold z-10 transition-all duration-500 ${isBridgeConnected ? 'bg-emerald-500 border-emerald-400 text-black shadow-[0_0_15px_rgba(16,185,129,0.4)]' : 'bg-zinc-900 border-zinc-800 text-zinc-400'}`}>
                                                        {isBridgeConnected ? <Check size={14} strokeWidth={3} /> : '1'}
                                                    </div>
                                                    <h3 className={`text-sm font-bold mb-1 uppercase tracking-widest ${isBridgeConnected ? 'text-emerald-400' : 'text-white'}`}>Build With Your Agent</h3>
                                                    <p className="text-xs text-zinc-500 mb-4">Connect your agent and start a new workflow with OzyBase pre-configured</p>
                                                    <div className="flex items-center gap-3 bg-black border border-zinc-800 rounded-md p-4 group">
                                                        <code className="flex-1 font-mono text-xs text-zinc-400">$ {npxBridgeCommand}</code>
                                                        <button 
                                                            onClick={() => void copyNpxBridgeCommandAction()}
                                                            className="text-zinc-600 hover:text-white transition-colors flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest"
                                                        >
                                                            <Copy size={12} /> Copy
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* Step 2 */}
                                                <div className={`relative pl-12 transition-all duration-700 ${!isBridgeConnected ? 'opacity-20 grayscale' : activeAgentCount > 0 ? 'opacity-40 scale-[0.98]' : 'opacity-100'}`}>
                                                    <div className={`absolute left-0 top-0 w-8 h-8 rounded-full border flex items-center justify-center text-[10px] font-bold z-10 transition-all duration-500 ${activeAgentCount > 0 ? 'bg-emerald-500 border-emerald-400 text-black shadow-[0_0_15px_rgba(16,185,129,0.4)]' : isBridgeConnected ? 'bg-primary border-primary/50 text-black animate-pulse shadow-[0_0_15px_rgba(254,254,0,0.3)]' : 'bg-zinc-900 border-zinc-800 text-zinc-400'}`}>
                                                        {activeAgentCount > 0 ? <Check size={14} strokeWidth={3} /> : '2'}
                                                    </div>
                                                    <h3 className={`text-sm font-bold mb-1 uppercase tracking-widest ${activeAgentCount > 0 ? 'text-emerald-400' : isBridgeConnected ? 'text-primary' : 'text-zinc-500'}`}>Verify Connection</h3>
                                                    <p className="text-xs text-zinc-500 mb-4">The bridge status in the sidebar will turn green once linked.</p>
                                                    <div className="flex items-center gap-3 bg-black border border-zinc-800 rounded-md p-4 group">
                                                        {isBridgeConnected ? (
                                                            <>
                                                                <code className="flex-1 font-mono text-xs text-emerald-500/80"># Awaiting signal from agent_bridge...</code>
                                                                <div className="animate-pulse h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                                            </>
                                                        ) : (
                                                            <code className="flex-1 font-mono text-xs text-zinc-700 italic">Awaiting Step 1 completion...</code>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Step 3 */}
                                                <div className={`relative pl-12 transition-all duration-700 ${activeAgentCount === 0 ? 'opacity-20 grayscale' : 'opacity-100'}`}>
                                                    <div className={`absolute left-0 top-0 w-8 h-8 rounded-full border flex items-center justify-center text-[10px] font-bold z-10 transition-all duration-500 ${activeAgentCount > 0 ? 'bg-primary border-primary/50 text-black shadow-[0_0_20px_rgba(254,254,0,0.4)]' : 'bg-zinc-900 border-zinc-800 text-zinc-400'}`}>
                                                        3
                                                    </div>
                                                    <h3 className={`text-sm font-bold mb-1 uppercase tracking-widest ${activeAgentCount > 0 ? 'text-primary' : 'text-zinc-500'}`}>Forge Intelligence</h3>
                                                    <p className="text-xs text-zinc-500 mb-4">Your agent will now have semantic access to your storage and schema.</p>
                                                    <div className={`text-[10px] font-bold uppercase tracking-[0.2em] italic transition-colors ${activeAgentCount > 0 ? 'text-primary' : 'text-zinc-800'}`}>
                                                        {activeAgentCount > 0 ? 'NEURAL_LINK_ESTABLISHED' : 'SYSTEM_AWAITING_LINK'}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        {/* Original Canvas Content */}
                                        {(() => {
                                            const fxTheme = fxThemeMap[activePipelineFX || 'pulse'] || fxThemeMap.pulse;
                                            const hasAnyBridgeFlow = visibleAgents.some((a) => isAgentExecuting(a)) && isBridgeConnected;
                                            const cableColor = cableColorByFX(activePipelineFX || 'pulse');
                                            const coreTargetLine = lineStyle(coreCenter, targetCenter, coreRadius, standardRadius);
                                            return (
                                                <>
                                                    {visibleAgents.map((agent) => {
                                                        const agentNodeKey = agentKey(agent.id);
                                                        const pos = nodePositions[agentNodeKey] || { x: 400, y: 120 };
                                                        const isExecuting = isAgentExecuting(agent);
                                                        const isTargeted = selectedAgentID === agent.id;
                                                        const isIdleConnected = agent.status === 'idle' && isBridgeConnected;
                                                        const agentCenter = { x: pos.x + 88, y: pos.y + 45 };
                                                        const agentActiveFlow = isExecuting && isBridgeConnected;
                                                        const agentCoreLine = lineStyle(agentCenter, coreCenter, standardRadius, coreRadius);
                                                        
                                                        return (
                                                            <div key={agent.id}>
                                                                <div className="absolute h-px origin-left bg-zinc-800/40" style={agentCoreLine} />
                                                                {agentActiveFlow && (
                                                                    <>
                                                                        <div
                                                                            className="absolute z-10 h-[2px] origin-left rounded-full"
                                                                            style={{
                                                                                ...agentCoreLine,
                                                                                backgroundImage: `linear-gradient(90deg, transparent 0%, ${cableColor} 28%, ${cableColor} 50%, ${cableColor} 72%, transparent 100%)`,
                                                                                backgroundSize: '220% 100%',
                                                                                animation: 'cable-flow 1.25s ease-in-out infinite alternate',
                                                                                boxShadow: `0 0 12px ${cableColor}`,
                                                                            }}
                                                                        />
                                                                        <div className="absolute z-20 h-[2px] origin-left overflow-visible" style={agentCoreLine}>
                                                                            <span
                                                                                className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full"
                                                                                style={{
                                                                                    left: '0px',
                                                                                    background: cableColor,
                                                                                    boxShadow: `0 0 12px ${cableColor}`,
                                                                                    animation: 'cable-dot 1.25s ease-in-out infinite alternate',
                                                                                    ['--travel' as any]: `calc(${agentCoreLine.width} - 10px)`,
                                                                                }}
                                                                            />
                                                                        </div>
                                                                    </>
                                                                )}
                                                                <div
                                                                    className="absolute z-20 flex w-44 cursor-move flex-col items-center gap-4"
                                                                    style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
                                                                    onMouseDown={(event) => handleNodeMouseDown(event, agentNodeKey)}
                                                                    onContextMenu={(event) => {
                                                                        event.preventDefault();
                                                                        openPermissionsModalForAgent(agent.id);
                                                                    }}
                                                                >
                                                                    <div className={`relative flex h-16 w-16 items-center justify-center rounded-md border transition-all ${isTargeted ? 'bg-primary/5 border-primary shadow-[0_0_20px_rgba(254,254,0,0.2)]' : isExecuting ? 'bg-amber-500/5 border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.15)]' : 'bg-zinc-900 border-zinc-800 group-hover:border-zinc-500'} ${nodePulse[agentNodeKey] ? 'animate-[node-hop_0.45s_ease-out]' : ''}`}>
                                                                        {isIdleConnected && (
                                                                            <span className="pointer-events-none absolute inset-[-5px] rounded-[18px] border border-cyan-300/30 animate-[agent-heartbeat_2.15s_ease-in-out_infinite]" />
                                                                        )}
                                                                        <Cpu size={28} className={isTargeted ? 'text-primary' : isExecuting ? 'text-amber-400' : 'text-zinc-600 group-hover:text-zinc-400'} />
                                                                        {agent.pendingCount > 0 && (
                                                                            <span className="absolute -top-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 border-2 border-[#070707] text-[10px] font-bold text-black shadow-lg animate-pulse">
                                                                                {agent.pendingCount}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <div className="text-center w-full px-2">
                                                                        <h3 className={`text-[11px] font-bold uppercase tracking-widest truncate ${isTargeted ? 'text-primary' : isExecuting ? 'text-amber-400' : 'text-zinc-400 group-hover:text-zinc-200'}`}>
                                                                            {agent.name || agent.label || agent.id}
                                                                        </h3>
                                                                        <p className="mt-1 text-[9px] uppercase tracking-[0.2em] text-zinc-600 font-bold">{isExecuting ? 'BUSY' : 'READY'}</p>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}

                                                    <div
                                                        className="absolute z-20 flex w-44 cursor-move flex-col items-center gap-4"
                                                        style={{ transform: `translate(${(nodePositions[coreKey]?.x || 700)}px, ${(nodePositions[coreKey]?.y || 120)}px)` }}
                                                        onMouseDown={(event) => handleNodeMouseDown(event, coreKey)}
                                                        onContextMenu={(event) => openContextMenu(event, 'core')}
                                                    >
                                                        <div className={`relative flex h-20 w-20 items-center justify-center rounded-md border bg-[#0a0a0a] shadow-[0_0_30px_rgba(0,0,0,0.8)] backdrop-blur-xl ${pipelineState.corePulse ? fxTheme.coreBorder : 'border-white/10'} ${pipelineState.corePulse ? fxTheme.coreAnim : ''} ${nodePulse.core ? 'animate-[node-hop_0.45s_ease-out]' : ''} ${coreCopyShake ? 'animate-[core-copy-shake_0.55s_ease-out]' : ''}`}>
                                                            {nodePulse.core && <span className="pointer-events-none absolute inset-[-8px] rounded-[20px] border border-cyan-300/55 animate-[radial-ring_0.48s_ease-out]" />}
                                                            {hasAnyBridgeFlow && activePipelineFX === 'shield' && (
                                                                <span className={`pointer-events-none absolute inset-[-9px] rounded-[22px] border border-sky-300/45 ${fxTheme.coreRing}`} />
                                                            )}
                                                            <BrainCircuit size={32} className="text-white/80" />
                                                            <div className="pointer-events-none absolute inset-0 rounded-md border border-white/5 bg-linear-to-b from-white/5 to-transparent" />
                                                        </div>
                                                        <div className="text-center">
                                                            <h3 className="text-sm font-semibold text-zinc-200">OzyBase Core</h3>
                                                            <p className="mt-1 text-[10px] uppercase tracking-wider text-zinc-500">Validation & Logic</p>
                                                        </div>
                                                    </div>

                                                    {isBridgeConnected && <div className={`absolute h-px origin-left ${hasAnyBridgeFlow ? fxTheme.line : 'bg-zinc-700/80'}`} style={coreTargetLine} />}
                                                    {hasAnyBridgeFlow && (
                                                        <>
                                                            <div
                                                                className="absolute z-10 h-[2px] origin-left rounded-full"
                                                                style={{
                                                                    ...coreTargetLine,
                                                                    backgroundImage: `linear-gradient(90deg, transparent 0%, ${cableColor} 28%, ${cableColor} 50%, ${cableColor} 72%, transparent 100%)`,
                                                                    backgroundSize: '220% 100%',
                                                                    animation: 'cable-flow 1.25s ease-in-out infinite alternate',
                                                                    boxShadow: `0 0 12px ${cableColor}`,
                                                                }}
                                                            />
                                                            <div className="absolute z-20 h-[2px] origin-left overflow-visible" style={coreTargetLine}>
                                                                <span
                                                                    className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full"
                                                                    style={{
                                                                        left: '0px',
                                                                        background: cableColor,
                                                                        boxShadow: `0 0 14px ${cableColor}`,
                                                                        animation: 'cable-dot 1.25s ease-in-out infinite alternate',
                                                                        ['--travel' as any]: `calc(${coreTargetLine.width} - 12px)`,
                                                                    }}
                                                                />
                                                            </div>
                                                            {operationTag && (
                                                                <div
                                                                    className={`pointer-events-none absolute z-30 -translate-x-1/2 rounded-md border px-2 py-1 text-[10px] font-semibold tracking-wide shadow-[0_0_18px_rgba(0,0,0,0.55)] ${fxTheme.tagTone} ${fxTheme.tagAnim}`}
                                                                    style={{ left: `${(coreCenter.x + targetCenter.x) / 2}px`, top: `${((coreCenter.y + targetCenter.y) / 2) - 24}px` }}
                                                                >
                                                                    {operationTag}
                                                                </div>
                                                            )}
                                                        </>
                                                    )}

                                                    <div
                                                        className="absolute z-20 flex w-44 cursor-move flex-col items-center gap-4"
                                                        style={{ transform: `translate(${(nodePositions[targetKey]?.x || 1060)}px, ${(nodePositions[targetKey]?.y || 120)}px)` }}
                                                        onMouseDown={(event) => handleNodeMouseDown(event, targetKey)}
                                                        onContextMenu={(event) => openContextMenu(event, 'target')}
                                                    >
                                                        <div className={`relative flex h-16 w-16 items-center justify-center rounded-md border shadow-xl ${pipelineState.targetError ? 'animate-[target-alert_1s_ease-in-out_infinite] border-rose-500/50 bg-rose-500/10' : 'border-zinc-800 bg-[#131313]'} ${nodePulse.target ? 'animate-[node-hop_0.45s_ease-out]' : ''}`}>
                                                            {nodePulse.target && <span className="pointer-events-none absolute inset-[-8px] rounded-[20px] border border-cyan-300/55 animate-[radial-ring_0.48s_ease-out]" />}
                                                            <Globe size={28} className={pipelineState.targetError ? 'text-rose-300' : 'text-zinc-600'} />
                                                        </div>
                                                        <div className="text-center">
                                                            <h3 className="text-sm font-semibold text-zinc-200">Target App</h3>
                                                            <p className="mt-1 text-[10px] uppercase tracking-wider text-zinc-500">Database / API</p>
                                                        </div>
                                                    </div>

                                                    {contextMenu.isOpen && (
                                                        <div
                                                            ref={contextMenuRef}
                                                            className="absolute z-40 w-[280px]"
                                                            style={{ left: contextMenu.x, top: contextMenu.y }}
                                                            onPointerDown={(event) => event.stopPropagation()}
                                                        >
                                                            <div className="rounded-md border border-white/10 bg-black/95 p-3 shadow-[0_25px_70px_rgba(0,0,0,0.72)] backdrop-blur-xl">
                                                                <div className="mb-2 flex items-center justify-between">
                                                                    <div>
                                                                        <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Neural Context Menu</p>
                                                                        <p className="text-sm font-semibold text-zinc-100">{contextMenu.node === 'core' ? 'OzyBase Core' : 'Target App'}</p>
                                                                    </div>
                                                                    <button
                                                                        type="button"
                                                                        onClick={closeContextMenu}
                                                                        className="rounded-md border border-white/10 p-1 text-white/80 hover:text-white"
                                                                    >
                                                                        <X size={14} />
                                                                    </button>
                                                                </div>

                                                                {contextMenu.node === 'core' ? (
                                                                    <div className="space-y-2">
                                                                        <button type="button" onClick={() => void refreshBridgeAction()} className="flex w-full items-center gap-2 rounded-md border border-white/10 bg-black/30 px-3 py-2 text-left text-sm text-zinc-200 hover:border-amber-300/55 hover:text-amber-200 hover:shadow-[0_0_0_1px_rgba(251,191,36,0.28)]">
                                                                            <RefreshCw size={14} className="text-white/90" />
                                                                            <span>Refresh Bridge</span>
                                                                        </button>
                                                                        <button type="button" onClick={() => void copyMCPEndpointAction()} className="flex w-full items-center gap-2 rounded-md border border-white/10 bg-black/30 px-3 py-2 text-left text-sm text-zinc-200 hover:border-amber-300/55 hover:text-amber-200 hover:shadow-[0_0_0_1px_rgba(251,191,36,0.28)]">
                                                                            <Copy size={14} className="text-white/90" />
                                                                            <span>Copy MCP Endpoint</span>
                                                                        </button>
                                                                        <button type="button" onClick={toggleDebugModeAction} className="flex w-full items-center gap-2 rounded-md border border-white/10 bg-black/30 px-3 py-2 text-left text-sm text-zinc-200 hover:border-amber-300/55 hover:text-amber-200 hover:shadow-[0_0_0_1px_rgba(251,191,36,0.28)]">
                                                                            <Bug size={14} className="text-white/90" />
                                                                            <span>Debug Mode</span>
                                                                        </button>
                                                                    </div>
                                                                ) : (
                                                                    <div className="space-y-2">
                                                                        <button type="button" onClick={() => void copyAnonKeyAction()} className="flex w-full items-center gap-2 rounded-md border border-white/10 bg-black/30 px-3 py-2 text-left text-sm text-zinc-200 hover:border-amber-300/55 hover:text-amber-200 hover:shadow-[0_0_0_1px_rgba(251,191,36,0.28)]">
                                                                            <KeyRound size={14} className="text-white/90" />
                                                                            <span>Copy Anon Key</span>
                                                                        </button>
                                                                        <button type="button" onClick={() => void copyPublicURLAction()} className="flex w-full items-center gap-2 rounded-md border border-white/10 bg-black/30 px-3 py-2 text-left text-sm text-zinc-200 hover:border-amber-300/55 hover:text-amber-200 hover:shadow-[0_0_0_1px_rgba(251,191,36,0.28)]">
                                                                            <Link2 size={14} className="text-white/90" />
                                                                            <span>Copy Public URL</span>
                                                                        </button>
                                                                        <button type="button" disabled={isHealthChecking} onClick={() => void healthCheckAction()} className="flex w-full items-center gap-2 rounded-md border border-white/10 bg-black/30 px-3 py-2 text-left text-sm text-zinc-200 hover:border-amber-300/55 hover:text-amber-200 hover:shadow-[0_0_0_1px_rgba(251,191,36,0.28)] disabled:cursor-not-allowed disabled:opacity-60">
                                                                            {isHealthChecking ? <RefreshCw size={14} className="animate-spin text-white/90" /> : <ShieldCheck size={14} className="text-white/90" />}
                                                                            <span>Health Check</span>
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                </>
                                            );
                                        })()}
                                    </>
                                )}
                            </div>
                        )}
                        {canvasMode === 'storage' && (
                            <div className="absolute left-0 top-0 h-full w-full p-20 flex flex-wrap gap-8 items-start justify-center overflow-y-auto pointer-events-auto">
                                {registeredCollections.map(table => (
                                    <div key={table} onClick={() => setSelectedTableID(table)} className={`flex w-40 flex-col items-center justify-center p-6 rounded-md border transition-all cursor-pointer ${selectedTableID === table ? 'bg-amber-500/10 border-amber-500/50 shadow-[0_0_20px_rgba(245,158,11,0.2)]' : 'bg-[#131313]/90 border-[#262626] hover:border-amber-500/30 backdrop-blur-md'}`}>
                                        <Database size={32} className={selectedTableID === table ? 'text-amber-400' : 'text-zinc-500'} />
                                        <p className="mt-3 text-center font-mono text-[10px] text-zinc-300 break-all w-full">{table}</p>
                                    </div>
                                ))}
                            </div>
                        )}
                        {canvasMode === 'security' && (
                            <div className="absolute left-0 top-0 h-full w-full p-20 flex flex-wrap gap-8 items-start justify-center overflow-y-auto pointer-events-auto">
                                {registeredCollections.map(table => {
                                    const isVulnerable = shadowTables.includes(table);
                                    return (
                                        <div key={table} onClick={() => setSelectedTableID(table)} className={`flex w-40 flex-col items-center justify-center p-6 rounded-md border transition-all cursor-pointer ${selectedTableID === table ? 'bg-rose-500/10 border-rose-500/50 shadow-[0_0_20px_rgba(244,63,94,0.2)]' : isVulnerable ? 'bg-rose-950/20 border-rose-900/50 hover:border-rose-500/50' : 'bg-[#131313]/90 border-[#262626] hover:border-zinc-500/50 backdrop-blur-md'}`}>
                                            {isVulnerable ? <AlertTriangle size={28} className={selectedTableID === table ? 'text-rose-400' : 'text-rose-600'} /> : <ShieldCheck size={28} className="text-emerald-500/30" />}
                                            <p className={`mt-3 text-center font-mono text-[10px] break-all w-full ${isVulnerable ? 'text-rose-300' : 'text-zinc-500'}`}>{table}</p>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </section>
            </main>
            {contextFeedback && (
                    <BrandedToast
                        message={contextFeedback.message}
                        tone={contextFeedback.tone}
                        title={contextFeedback.title}
                        onClose={() => setContextFeedback(null)}
                        durationMs={2400}
                        position="bottom-right"
                    />
                )}

                {showDebugConsole && (
                    <div className="fixed bottom-5 right-5 z-50 w-[460px] max-w-[92vw] overflow-hidden rounded-md border border-indigo-400/25 bg-[#070b12]/92 shadow-[0_24px_65px_rgba(0,0,0,0.65)] backdrop-blur-xl">
                        <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
                            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-indigo-200">
                                <TerminalSquare size={13} /> Raw JSON-RPC Debug
                            </div>
                            <button type="button" onClick={() => setShowDebugConsole(false)} className="rounded border border-white/10 p-1 text-zinc-500 hover:text-zinc-100">
                                <X size={12} />
                            </button>
                        </div>
                        <div className="custom-scrollbar max-h-[260px] overflow-y-auto p-3 font-mono text-[11px] text-cyan-200">
                            {rawMCPFrames.length === 0 ? (
                                <p className="text-zinc-500">Sin trafico JSON-RPC reciente.</p>
                            ) : (
                                <div className="space-y-1">
                                    {rawMCPFrames.map((line, index) => (
                                        <p key={`${line.slice(0, 24)}-${index}`} className="break-all text-cyan-200/95">{line}</p>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <style
                    dangerouslySetInnerHTML={{
                        __html: `
                            @keyframes slide-right {
                                0% { left: -33%; }
                                100% { left: 100%; }
                            }

                            @keyframes core-pulse-emerald {
                                0% { box-shadow: 0 0 0 rgba(16,185,129,0.0); }
                                50% { box-shadow: 0 0 26px rgba(16,185,129,0.28); }
                                100% { box-shadow: 0 0 0 rgba(16,185,129,0.0); }
                            }

                            @keyframes core-pulse-cyan {
                                0% { box-shadow: 0 0 0 rgba(34,211,238,0.0); }
                                50% { box-shadow: 0 0 28px rgba(34,211,238,0.32); }
                                100% { box-shadow: 0 0 0 rgba(34,211,238,0.0); }
                            }

                            @keyframes core-pulse-warp {
                                0% { box-shadow: 0 0 0 rgba(251,113,133,0.0); }
                                40% { box-shadow: 0 0 22px rgba(251,113,133,0.34); }
                                80% { box-shadow: 0 0 30px rgba(251,191,36,0.3); }
                                100% { box-shadow: 0 0 0 rgba(251,113,133,0.0); }
                            }

                            @keyframes core-pulse-shield {
                                0% { box-shadow: 0 0 0 rgba(56,189,248,0.0); }
                                50% { box-shadow: 0 0 30px rgba(56,189,248,0.35); }
                                100% { box-shadow: 0 0 0 rgba(56,189,248,0.0); }
                            }

                            @keyframes shield-wave {
                                0% { transform: scale(0.9); opacity: 0.8; }
                                100% { transform: scale(1.22); opacity: 0; }
                            }

                            @keyframes warp-cable {
                                0%, 100% { filter: brightness(1); transform: translateY(0); }
                                50% { filter: brightness(1.35); transform: translateY(-0.7px); }
                            }

                            @keyframes slide-tag {
                                0% { left: -20%; opacity: 0; }
                                12% { opacity: 1; }
                                88% { opacity: 1; }
                                100% { left: 95%; opacity: 0; }
                            }

                            @keyframes tag-hover {
                                0%, 100% { transform: translateY(0); }
                                50% { transform: translateY(-2px); }
                            }

                            @keyframes cable-flow {
                                0% { background-position: 0% 50%; opacity: 0.78; }
                                100% { background-position: 100% 50%; opacity: 1; }
                            }

                            @keyframes cable-dot {
                                0% { transform: translateX(0) translateY(-50%) scale(0.95); }
                                100% { transform: translateX(var(--travel, 0px)) translateY(-50%) scale(1.02); }
                            }

                            @keyframes agent-heartbeat {
                                0%, 100% { opacity: 0.22; transform: scale(1); }
                                45% { opacity: 0.55; transform: scale(1.045); }
                                75% { opacity: 0.3; transform: scale(1.015); }
                            }

                            @keyframes target-alert {
                                0%, 100% { opacity: 1; }
                                50% { opacity: 0.45; }
                            }

                            @keyframes node-hop {
                                0% { transform: scale(1); }
                                50% { transform: scale(1.1); }
                                100% { transform: scale(1); }
                            }

                            @keyframes radial-ring {
                                0% { transform: scale(0.82); opacity: 0.9; }
                                100% { transform: scale(1.25); opacity: 0; }
                            }

                            @keyframes core-copy-shake {
                                0%, 100% { transform: translateX(0); }
                                22% { transform: translateX(-2px); }
                                44% { transform: translateX(2px); }
                                66% { transform: translateX(-1px); }
                                88% { transform: translateX(1px); }
                            }

                            @keyframes agent-enter {
                                0% { opacity: 0; transform: translateX(-6px); }
                                100% { opacity: 1; transform: translateX(0); }
                            }
                        `,
                    }}
                />


        </div>
    );
};

export default AgentForge;


