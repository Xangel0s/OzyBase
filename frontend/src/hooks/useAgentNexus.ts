import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { fetchWithAuth, isAbortLikeError } from '../utils/api';
import type { MCPSkillItem } from '../components/SkillStorePanel';

interface MCPPendingApproval {
    id: string;
    token_id?: string;
    token_security_level?: string;
    tool?: string;
    status?: string;
    created_at?: string;
    tool_risk?: string;
    reason?: string;
    arguments?: Record<string, unknown>;
}

interface MCPActiveSession {
    token_id: string;
    name?: string;
    security_level?: string;
    autonomy_level?: string;
    status?: string;
    last_activity_at?: string;
    pending_count?: number;
    is_approved?: boolean;
    icon?: string;
    activity?: string;
    recent_tools?: string[];
    available_skills?: string[];
    available_tools?: string[];
}

interface MCPPendingPayload {
    items?: MCPPendingApproval[];
    approvals?: MCPPendingApproval[];
    active_sessions?: MCPActiveSession[];
    active_sessions_live?: MCPActiveSession[];
    active_count?: number;
    active_count_live?: number;
    published_tools?: number;
    bridge_status?: string;
}

interface MCPSkillsPayload {
    items?: MCPSkillItem[];
}

interface EngramRecentEventPayload {
    created_at?: string;
    agent_name?: string;
    operation_detail?: string;
    target_resource?: string;
    result?: string;
    activity_kind?: string;
    pipeline_fx?: string;
    causal_ref?: string;
}

interface MCPStreamEvent {
    event_type?: string;
    event?: string;
    agent_token_id?: string;
    agent_name?: string;
    user_agent?: string;
    tool?: string;
    result?: string;
    security_level?: string;
    status_msg?: string;
    skill_id?: string;
    skill_name?: string;
    icon?: string;
    enabled?: boolean;
    min_level?: string;
    tool_risk?: string;
    activity_kind?: string;
    pipeline_fx?: string;
    target_resource?: string;
    operation_detail?: string;
    timestamp?: string;
    engram_status?: string;
    engram_total_events?: number;
    engram_window_hours?: number;
    engram_resource_filter?: string;
    engram_recent_events?: EngramRecentEventPayload[];
    engram_entropy_score?: number;
    engram_entropy_state?: string;
    semantic_health?: string;
    semantic_physical_tables?: number;
    semantic_snapshot_tables?: number;
    semantic_recent_security_alert?: boolean;
    semantic_missing_tables?: string[];
    semantic_physical_table_names?: string[];
    semantic_snapshot_table_names?: string[];
    alert_type?: string;
    critical?: boolean;
}

interface SemanticHealthPayload {
    status?: string;
    physical_tables?: number;
    semantic_snapshot_tables?: number;
    compaction_pending?: number;
    recent_security_alert?: boolean;
    last_security_alert_at?: string;
    missing_tables?: string[];
    physical_table_names?: string[];
    semantic_snapshot_table_names?: string[];
}

export interface SemanticHealthState {
    status: 'synchronized' | 'drift' | 'alert' | 'unknown';
    physicalTables: number;
    semanticSnapshots: number;
    compactionPending: number;
    missingTables: string[];
    physicalTableNames: string[];
    semanticSnapshotTableNames: string[];
    recentSecurityAlert: boolean;
    lastSecurityAlertAt: number | null;
}

type ActivityKind = 'read' | 'write' | 'system' | 'auth';
type PipelineFX = 'pulse' | 'flow' | 'warp' | 'shield';
type EngramSource = 'cursor' | 'claude' | 'vscode' | 'python' | 'mcp';

export interface NexusFeedItem {
    id: string;
    tokenID: string;
    line: string;
    timestamp: number;
    kind: ActivityKind;
}

export interface NexusAgent {
    id: string;
    label: string;
    level: string;
    pendingCount: number;
    recentTools: string[];
    availableSkills: string[];
    availableTools: string[];
    lastActivityAt: string;
    name?: string;
    source: 'cursor' | 'claude' | 'vscode' | 'python' | 'mcp';
    isFresh: boolean;
    isApproved: boolean;
    icon?: string;
    activity?: string;
    status: string;
}

export interface EngramFeedItem {
    id: string;
    agentName: string;
    source: EngramSource;
    intention: string;
    resource: string;
    timestamp: number;
    pipelineFX: PipelineFX;
    activityKind: ActivityKind;
    operationDetail?: string;
    causalRef?: string;
}

interface LeadArchitectTrigger {
    id: 'entropy_drift' | 'mutation_spike' | 'agent_dissonance';
    title: string;
    active: boolean;
    severity: 'low' | 'medium' | 'high';
    detail: string;
    metric: string;
}

interface LeadArchitectAudit {
    ready: boolean;
    status: 'pending-sync' | 'nominal' | 'watch' | 'critical';
    generatedAt: number;
    prompt: string;
    triggers: LeadArchitectTrigger[];
}

interface ProjectMemoryLayerInfo {
    hot_limit?: number;
    cold_mode?: string;
    audit_store?: string;
}

interface ProjectEntropyInfo {
    score: number;
    state: 'flow' | 'tension' | 'chaos' | 'debt';
    color: 'green' | 'amber' | 'red' | 'blue';
    contextBudgetRatio: number;
    contextBudgetTokens: number;
}

interface EngramKernelConfig {
    provider: string;
    hasApiKey: boolean;
    apiKeyMasked: string;
    syncState: string;
}

export type EngramAutonomyLevel = 'L1' | 'L2' | 'L3';

interface EngramAutonomyConfig {
    level: EngramAutonomyLevel;
    name: string;
    description: string;
    lastUpdated: string;
    updatedBy: string;
}

interface EngramDiagnosticCheck {
    name: string;
    ok: boolean;
    message: string;
    latency_ms?: number;
}

interface EngramDiagnosticResult {
    status: string;
    synchronized: boolean;
    summary: string;
    checks: EngramDiagnosticCheck[];
    awareness?: {
        total_events?: number;
        [key: string]: unknown;
    };
}

interface NexusNotice {
    type: 'error' | 'info' | 'success';
    message: string;
}

const STREAM_EVENT_LIMIT = 120;
const AGENT_SESSION_TTL_MS = 30 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const TEN_MINUTES_MS = 10 * 60 * 1000;
const MANUAL_GOVERNANCE_SSE_GUARD_MS = 2000;
const DDL_OPERATION_PATTERN = /\b(ALTER|CREATE|DROP|TRUNCATE)\b/i;
const WRITE_OPERATION_PATTERN = /\b(ALTER|CREATE|DROP|TRUNCATE|UPDATE|DELETE|INSERT|UPSERT|MERGE)\b/i;

const securityLevelRank = (level: string) => {
    const normalized = String(level || '').trim().toLowerCase();
    if (normalized === 'restringido') return 1;
    if (normalized === 'medio') return 2;
    if (normalized === 'libre') return 3;
    return 0;
};

const normalizeMCPSecurityLevel = (level: string): 'restringido' | 'medio' | 'libre' => {
    const normalized = String(level || '').trim().toLowerCase();
    if (normalized === 'restringido' || normalized === 'medio' || normalized === 'libre') {
        return normalized;
    }
    return 'restringido';
};

const normalizeTokenID = (value: string) => String(value || '').trim().toLowerCase();
const tokenIDsMatch = (left: string, right: string): boolean => {
    const a = normalizeTokenID(left);
    const b = normalizeTokenID(right);
    if (!a || !b) return false;
    return a === b || a.startsWith(`${b}@`) || b.startsWith(`${a}@`);
};

const normalizeActivityKind = (raw: string, toolRisk: string): ActivityKind => {
    const value = String(raw || '').trim().toLowerCase();
    if (value === 'read' || value === 'write' || value === 'system' || value === 'auth') return value;

    const risk = String(toolRisk || '').trim().toLowerCase();
    if (risk === 'dangerous' || risk === 'safe_write') return 'write';
    if (risk === 'read') return 'read';
    return 'system';
};

const normalizePipelineFX = (raw: string, kind: ActivityKind, toolRisk: string): PipelineFX => {
    const value = String(raw || '').trim().toLowerCase();
    if (value === 'pulse' || value === 'flow' || value === 'warp' || value === 'shield') return value;

    if (kind === 'auth') return 'shield';
    if (kind === 'read') return 'pulse';
    if (kind === 'write') {
        return String(toolRisk || '').trim().toLowerCase() === 'dangerous' ? 'warp' : 'flow';
    }
    return 'flow';
};

const pipelineFXDurationMs = (fx: PipelineFX) => {
    if (fx === 'pulse') return 1400;
    if (fx === 'flow') return 2200;
    if (fx === 'warp') return 2600;
    return 2400;
};

const normalizeOperationDetail = (raw: string, tool: string): string => {
    const value = String(raw || '').trim();
    if (value) return value.toUpperCase();

    const normalizedTool = String(tool || '').trim().replace(/\./g, ' ').replace(/_/g, ' ').toUpperCase();
    return normalizedTool || 'OPERATION';
};

const normalizeTargetResource = (raw: string): string => {
    const value = String(raw || '').trim();
    return value || 'system';
};

const getFeedLine = (payload: MCPStreamEvent) => {
    const rawIntention = String(payload.status_msg || '').trim();
    const safeIntention = rawIntention
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, 'resource')
        .replace(/\s+/g, ' ')
        .trim();

    if (safeIntention) {
        return safeIntention;
    }

    const tool = String(payload.tool || 'tool').replace(/_/g, ' ');
    const result = String(payload.result || 'running').replace(/_/g, ' ');
    return `${tool} (${result})`;
};

const normalizeTimestamp = (value?: string) => {
    if (!value) return Date.now();
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? Date.now() : parsed;
};

const nowISO = () => new Date().toISOString();

const inferAgentSource = (userAgent: string, agentName: string): NexusAgent['source'] => {
    const ua = String(userAgent || '').toLowerCase();
    const name = String(agentName || '').toLowerCase();
    const combined = `${ua} ${name}`;

    if (combined.includes('cursor')) return 'cursor';
    if (combined.includes('claude')) return 'claude';
    if (combined.includes('vscode') || combined.includes('visual studio')) return 'vscode';
    if (combined.includes('python')) return 'python';
    return 'mcp';
};

const inferEngramSource = (agentName: string): EngramSource => inferAgentSource('', agentName);

const describeEngramIntent = (event: {
    agentName: string;
    activityKind: ActivityKind;
    pipelineFX: PipelineFX;
    operationDetail: string;
    targetResource: string;
}) => {
    const actor = event.agentName || 'MCP Agent';
    const rawResource = (event.targetResource || 'system').trim();
    const resource = rawResource.toLowerCase() === 'system' ? 'sistema' : rawResource;
    const rawAction = (event.operationDetail || 'OPERACION').trim();
    const action = rawAction.toUpperCase() === 'HEALTH CHECK'
        ? 'verificación automática'
        : rawAction.toLowerCase();

    if (event.pipelineFX === 'shield' || event.activityKind === 'auth') {
        return `🛡️ ${actor} reforzó la seguridad en ${resource} (${action}).`;
    }
    if (event.pipelineFX === 'warp' || event.activityKind === 'write') {
        return `⚙️ ${actor} aplicó cambios en ${resource} (${action}).`;
    }
    if (event.pipelineFX === 'pulse' || event.activityKind === 'read') {
        return `🔎 ${actor} revisó ${resource} para mantener el contexto actualizado (${action}).`;
    }
    return `🔄 ${actor} sincronizó memoria del proyecto en ${resource} (${action}).`;
};

const dedupeEngramFeed = (items: EngramFeedItem[]): EngramFeedItem[] => {
    type Bucket = { item: EngramFeedItem; count: number };
    const buckets = new Map<string, Bucket>();

    items.forEach((item) => {
        // Group by semantic signature + minute bucket to avoid visual spam from repeated pulses.
        const minuteBucket = Math.floor(item.timestamp / 60000);
        const key = [
            item.agentName,
            item.resource,
            item.activityKind,
            item.pipelineFX,
            item.operationDetail,
            minuteBucket,
        ].join('|').toLowerCase();

        const existing = buckets.get(key);
        if (!existing) {
            buckets.set(key, { item: { ...item }, count: 1 });
            return;
        }

        existing.count += 1;
        // Keep latest timestamp in the grouped item.
        if (item.timestamp > existing.item.timestamp) {
            existing.item = { ...item };
        }
    });

    return Array.from(buckets.values())
        .map(({ item, count }) => {
            if (count <= 1) return item;
            const clean = item.intention.trim().replace(/[·\s]+$/, '');
            return {
                ...item,
                intention: `${clean} (x${count})`,
            };
        })
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 80);
};

export const useAgentNexus = (scope: 'all' | 'mcp' | 'engram' = 'all') => {
    const mcpEnabled = scope === 'all' || scope === 'mcp';
    const engramEnabled = scope === 'all' || scope === 'engram';
    const [pendingApprovals, setPendingApprovals] = useState<MCPPendingApproval[]>([]);
    const [activeSessions, setActiveSessions] = useState<MCPActiveSession[]>([]);
    const [transientSessions, setTransientSessions] = useState<Record<string, MCPActiveSession>>({});
    const [approvalsLoading, setApprovalsLoading] = useState(false);
    const [bridgeStatus, setBridgeStatus] = useState('unknown');
    const [streamErrored, setStreamErrored] = useState(false);
    const [streamRestartNonce, setStreamRestartNonce] = useState(0);

    const [nexusFeed, setNexusFeed] = useState<NexusFeedItem[]>([]);
    const [engramFeed, setEngramFeed] = useState<EngramFeedItem[]>([]);
    const [engramStatus, setEngramStatus] = useState('idle');
    const [engramTotalEvents, setEngramTotalEvents] = useState(0);
    const [engramWindowHours, setEngramWindowHours] = useState(24);
    const [engramChronicle, setEngramChronicle] = useState('');
    const [publishedTools, setPublishedTools] = useState(0);
    const [engramMemoryLayers, setEngramMemoryLayers] = useState<ProjectMemoryLayerInfo | null>(null);
    const [engramEntropy, setEngramEntropy] = useState<ProjectEntropyInfo>({
        score: 0,
        state: 'flow',
        color: 'green',
        contextBudgetRatio: 1,
        contextBudgetTokens: 12000,
    });
    const [engramEntropyHistory, setEngramEntropyHistory] = useState<Array<{
        timestamp: number;
        score: number;
        state: ProjectEntropyInfo['state'];
    }>>([]);
    const [rawMCPFrames, setRawMCPFrames] = useState<string[]>([]);
    const [engramKernelConfig, setEngramKernelConfig] = useState<EngramKernelConfig>({
        provider: 'openai',
        hasApiKey: false,
        apiKeyMasked: '',
        syncState: 'DISCONNECTED',
    });
    const [engramAutonomyConfig, setEngramAutonomyConfig] = useState<EngramAutonomyConfig>({
        level: 'L2',
        name: 'Copiloto',
        description: 'Modo seguro con autorización humana para escritura.',
        lastUpdated: '',
        updatedBy: 'system',
    });
    const [engramConfigLoading, setEngramConfigLoading] = useState(false);
    const [engramConfigSaving, setEngramConfigSaving] = useState(false);
    const [engramAutonomyLoading, setEngramAutonomyLoading] = useState(false);
    const [engramAutonomySaving, setEngramAutonomySaving] = useState(false);
    const [engramDiagnosticRunning, setEngramDiagnosticRunning] = useState(false);
    const [engramDiagnostic, setEngramDiagnostic] = useState<EngramDiagnosticResult | null>(null);
    const [pipelineFXUntil, setPipelineFXUntil] = useState(0);
    const [activePipelineFX, setActivePipelineFX] = useState<PipelineFX>('pulse');
    const [activeOperationDetail, setActiveOperationDetail] = useState('');
    const [activeTargetResource, setActiveTargetResource] = useState('');
    const [targetErrorUntil, setTargetErrorUntil] = useState(0);

    const [agentNameByToken, setAgentNameByToken] = useState<Record<string, string>>({});
    const [agentSourceByToken, setAgentSourceByToken] = useState<Record<string, NexusAgent['source']>>({});
    const [liveSkillsByToken, setLiveSkillsByToken] = useState<Record<string, string[]>>({});
    const [freshAgentSeenAt, setFreshAgentSeenAt] = useState<Record<string, number>>({});

    const [skillCatalog, setSkillCatalog] = useState<MCPSkillItem[]>([]);
    const [skillsLoading, setSkillsLoading] = useState(false);
    const [skillUpdatePending, setSkillUpdatePending] = useState<Record<string, boolean>>({});
    const [agentLevelUpdating, setAgentLevelUpdating] = useState<Record<string, boolean>>({});
    const [approvalActioningByID, setApprovalActioningByID] = useState<Record<string, boolean>>({});
    const [sessionSecurityOverrides, setSessionSecurityOverrides] = useState<Record<string, 'libre' | 'medio' | 'restringido'>>({});
    const [notice, setNotice] = useState<NexusNotice | null>(null);
    const [engramCompactionRunning, setEngramCompactionRunning] = useState(false);
    const [semanticHealth, setSemanticHealth] = useState<SemanticHealthState>({
        status: 'unknown',
        physicalTables: 0,
        semanticSnapshots: 0,
        compactionPending: 0,
        missingTables: [],
        physicalTableNames: [],
        semanticSnapshotTableNames: [],
        recentSecurityAlert: false,
        lastSecurityAlertAt: null,
    });

    const appendRawFrame = useCallback((rawData: string) => {
        const normalized = String(rawData || '').replace(/\s+/g, ' ').trim();
        if (!normalized) return;
        const line = `[${new Date().toLocaleTimeString('es-ES', { hour12: false })}] ${normalized}`;
        setRawMCPFrames((current) => [line, ...current].slice(0, 80));
    }, []);

    const appendEntropySnapshot = useCallback((score: number, state: ProjectEntropyInfo['state'], timestamp = Date.now()) => {
        setEngramEntropyHistory((current) => {
            const next = [...current, { timestamp, score, state }]
                .filter((item) => (timestamp - item.timestamp) <= (6 * ONE_HOUR_MS))
                .slice(-64);
            return next;
        });
    }, []);

    useEffect(() => {
        appendEntropySnapshot(engramEntropy.score, engramEntropy.state, Date.now());
    }, [appendEntropySnapshot, engramEntropy.score, engramEntropy.state]);

    const activeSessionsRef = useRef<MCPActiveSession[]>([]);
    const manualGovernanceGuardUntilRef = useRef<Record<string, number>>({});
    const lastSecurityAlertRef = useRef<Record<string, number>>({});
    const applySemanticHealth = useCallback((raw?: SemanticHealthPayload | null) => {
        if (!raw) return;
        const rawStatus = String(raw.status || '').trim().toLowerCase();
        const status: SemanticHealthState['status'] =
            rawStatus === 'synchronized' || rawStatus === 'drift' || rawStatus === 'alert'
                ? rawStatus
                : 'unknown';
        const physicalTables = Math.max(0, Number(raw.physical_tables || 0));
        const semanticSnapshots = Math.max(0, Number(raw.semantic_snapshot_tables || 0));
        const compactionPending = Math.max(0, Number(raw.compaction_pending || 0));
        const missingTables = Array.isArray(raw.missing_tables)
            ? raw.missing_tables.map((item) => String(item || '').trim()).filter(Boolean)
            : [];
        const physicalTableNames = Array.isArray(raw.physical_table_names)
            ? raw.physical_table_names.map((item) => String(item || '').trim()).filter(Boolean)
            : [];
        const semanticSnapshotTableNames = Array.isArray(raw.semantic_snapshot_table_names)
            ? raw.semantic_snapshot_table_names.map((item) => String(item || '').trim()).filter(Boolean)
            : [];
        const recentSecurityAlert = Boolean(raw.recent_security_alert);
        const lastSecurityAlertAt = raw.last_security_alert_at ? normalizeTimestamp(raw.last_security_alert_at) : null;
        setSemanticHealth((current) => ({
            status,
            physicalTables,
            semanticSnapshots,
            compactionPending,
            missingTables,
            physicalTableNames,
            semanticSnapshotTableNames,
            recentSecurityAlert,
            lastSecurityAlertAt: lastSecurityAlertAt ?? current.lastSecurityAlertAt,
        }));
    }, []);
    useEffect(() => {
        activeSessionsRef.current = activeSessions;
    }, [activeSessions]);

    const loadPendingApprovals = useCallback(async (signal?: AbortSignal) => {
        setApprovalsLoading(true);
        try {
            const res = await fetchWithAuth('/api/project/mcp/approvals/pending', { signal });
            if (!res.ok) {
                setPendingApprovals([]);
                setActiveSessions([]);
                return;
            }

            const payload = await res.json().catch(() => null) as MCPPendingPayload | null;
            const approvals = Array.isArray(payload?.items)
                ? payload.items
                : Array.isArray(payload?.approvals)
                    ? payload.approvals
                    : [];

            const applyOverride = (rawID: string, currentLevel: string): string => {
                const id = normalizeTokenID(rawID);
                if (!id) return String(currentLevel || '');
                const direct = sessionSecurityOverrides[id];
                if (direct) return direct;
                const prefixed = Object.entries(sessionSecurityOverrides).find(([overrideID]) => tokenIDsMatch(id, overrideID));
                return prefixed ? prefixed[1] : String(currentLevel || '');
            };

            const mergedApprovals = approvals.map((approval) => ({
                ...approval,
                token_security_level: applyOverride(String(approval.token_id || ''), String(approval.token_security_level || '')),
            }));
            const incomingSessions = Array.isArray(payload?.active_sessions_live)
                ? payload.active_sessions_live
                : Array.isArray(payload?.active_sessions)
                    ? payload.active_sessions
                    : [];
            const mergedSessions = incomingSessions.map((session) => ({
                ...session,
                security_level: applyOverride(String(session.token_id || ''), String(session.security_level || '')),
            }));

            setPendingApprovals(mergedApprovals);
            setActiveSessions(mergedSessions);
            setPublishedTools(Number(payload?.published_tools || 0));
            setBridgeStatus(String(payload?.bridge_status || 'unknown').trim() || 'unknown');
        } catch (err) {
            if (!isAbortLikeError(err, signal)) {
                setPendingApprovals([]);
                setActiveSessions([]);
            }
        } finally {
            setApprovalsLoading(false);
        }
    }, [sessionSecurityOverrides]);

    useEffect(() => {
        if (!mcpEnabled) return;
        const controller = new AbortController();
        void loadPendingApprovals(controller.signal);
        const interval = window.setInterval(() => {
            void loadPendingApprovals();
        }, 20000);

        return () => {
            controller.abort();
            window.clearInterval(interval);
        };
    }, [loadPendingApprovals, mcpEnabled]);

    useEffect(() => {
        const prune = () => {
            const now = Date.now();
            setTransientSessions((current) => {
                let changed = false;
                const next: Record<string, MCPActiveSession> = {};

                Object.entries(current).forEach(([tokenID, session]) => {
                    const lastSeen = Date.parse(String(session.last_activity_at || ''));
                    if (!Number.isNaN(lastSeen) && (now - lastSeen) > AGENT_SESSION_TTL_MS) {
                        changed = true;
                        return;
                    }
                    next[tokenID] = session;
                });

                return changed ? next : current;
            });
        };

        prune();
        const interval = window.setInterval(prune, 60000);
        return () => window.clearInterval(interval);
    }, []);

    const loadSkillCatalog = useCallback(async (signal?: AbortSignal) => {
        setSkillsLoading(true);
        try {
            const res = await fetchWithAuth('/api/project/mcp/skills', { signal });
            if (!res.ok) {
                setSkillCatalog([]);
                return;
            }

            const payload = await res.json().catch(() => null) as MCPSkillsPayload | null;
            setSkillCatalog(Array.isArray(payload?.items) ? payload.items : []);
        } catch (err) {
            if (!isAbortLikeError(err, signal)) {
                setSkillCatalog([]);
            }
        } finally {
            setSkillsLoading(false);
        }
    }, []);

    const loadEngramKernelConfig = useCallback(async (signal?: AbortSignal) => {
        setEngramConfigLoading(true);
        try {
            const res = await fetchWithAuth('/api/project/engram/config', { signal });
            if (!res.ok) {
                throw new Error(`engram config failed: ${res.status}`);
            }

            const payload = await res.json().catch(() => null) as {
                provider?: string;
                has_api_key?: boolean;
                api_key_masked?: string;
                sync_state?: string;
            } | null;

            setEngramKernelConfig({
                provider: String(payload?.provider || 'openai'),
                hasApiKey: Boolean(payload?.has_api_key),
                apiKeyMasked: String(payload?.api_key_masked || ''),
                syncState: String(payload?.sync_state || 'DISCONNECTED'),
            });
        } catch (err) {
            if (!isAbortLikeError(err, signal)) {
                setEngramKernelConfig((current) => ({
                    ...current,
                    syncState: 'DISCONNECTED',
                }));
            }
        } finally {
            setEngramConfigLoading(false);
        }
    }, []);

    const saveEngramKernelConfig = useCallback(async (apiKey: string) => {
        setEngramConfigSaving(true);
        setNotice(null);
        try {
            const res = await fetchWithAuth('/api/project/engram/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ llm_api_key: String(apiKey || '').trim() }),
            });

            if (!res.ok) {
                throw new Error(`save engram config failed: ${res.status}`);
            }

            await loadEngramKernelConfig();
            setNotice({
                type: 'info',
                message: 'Portal de Sincronia actualizado.',
            });
            return true;
        } catch {
            setNotice({
                type: 'error',
                message: 'No se pudo guardar la API key del Portal de Sincronia.',
            });
            return false;
        } finally {
            setEngramConfigSaving(false);
        }
    }, [loadEngramKernelConfig]);

    const loadEngramAutonomyConfig = useCallback(async (signal?: AbortSignal) => {
        setEngramAutonomyLoading(true);
        try {
            const res = await fetchWithAuth('/api/project/engram/autonomy', { signal });
            if (!res.ok) {
                throw new Error(`engram autonomy config failed: ${res.status}`);
            }

            const payload = await res.json().catch(() => null) as {
                autonomy_level?: string;
                autonomy_name?: string;
                description?: string;
                last_updated?: string;
                updated_by?: string;
            } | null;

            const rawLevel = String(payload?.autonomy_level || 'L2').toUpperCase();
            const level: EngramAutonomyLevel = rawLevel === 'L1' || rawLevel === 'L3' ? rawLevel : 'L2';
            setEngramAutonomyConfig({
                level,
                name: String(payload?.autonomy_name || (level === 'L1' ? 'Observador' : level === 'L3' ? 'Soberano' : 'Copiloto')),
                description: String(payload?.description || ''),
                lastUpdated: String(payload?.last_updated || ''),
                updatedBy: String(payload?.updated_by || 'system'),
            });
        } catch (err) {
            if (!isAbortLikeError(err, signal)) {
                setEngramAutonomyConfig((current) => ({
                    ...current,
                    level: 'L2',
                }));
            }
        } finally {
            setEngramAutonomyLoading(false);
        }
    }, []);

    const saveEngramAutonomyLevel = useCallback(async (level: EngramAutonomyLevel, acknowledgeRisk = false) => {
        setEngramAutonomySaving(true);
        setNotice(null);
        try {
            const res = await fetchWithAuth('/api/project/engram/autonomy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ autonomy_level: level, acknowledge_risk: acknowledgeRisk }),
            });
            if (!res.ok) {
                throw new Error(`save engram autonomy failed: ${res.status}`);
            }

            await loadEngramAutonomyConfig();
            setNotice({
                type: 'success',
                message: `Autonomía actualizada a ${level}.`,
            });
            return true;
        } catch {
            setNotice({
                type: 'error',
                message: 'No se pudo actualizar el nivel de autonomía.',
            });
            return false;
        } finally {
            setEngramAutonomySaving(false);
        }
    }, [loadEngramAutonomyConfig]);

    const runEngramDiagnostic = useCallback(async () => {
        setEngramDiagnosticRunning(true);
        setNotice(null);
        try {
            const res = await fetchWithAuth('/api/project/engram/config/test', {
                method: 'POST',
            });
            if (!res.ok) {
                throw new Error(`engram diagnostic failed: ${res.status}`);
            }

            const payload = await res.json().catch(() => null) as EngramDiagnosticResult | null;
            const result: EngramDiagnosticResult = {
                status: String(payload?.status || 'MCP_DISCONNECTED'),
                synchronized: Boolean(payload?.synchronized),
                summary: String(payload?.summary || ''),
                checks: Array.isArray(payload?.checks) ? payload!.checks : [],
                awareness: payload?.awareness,
            };

            setEngramDiagnostic(result);
            setEngramKernelConfig((current) => ({
                ...current,
                syncState: result.synchronized ? 'SYNCHRONIZED' : result.status,
            }));
            return result;
        } catch {
            const failed: EngramDiagnosticResult = {
                status: 'MCP_DISCONNECTED',
                synchronized: false,
                summary: 'No se pudo ejecutar el diagnostico del Portal de Sincronia.',
                checks: [{
                    name: 'diagnostic',
                    ok: false,
                    message: 'Fallo de red o servidor.',
                }],
            };
            setEngramDiagnostic(failed);
            return failed;
        } finally {
            setEngramDiagnosticRunning(false);
        }
    }, []);

    useEffect(() => {
        if (!mcpEnabled) return;
        const controller = new AbortController();
        void loadSkillCatalog(controller.signal);
        const interval = window.setInterval(() => {
            void loadSkillCatalog();
        }, 25000);

        return () => {
            controller.abort();
            window.clearInterval(interval);
        };
    }, [loadSkillCatalog, mcpEnabled]);

    useEffect(() => {
        if (!engramEnabled) return;
        const controller = new AbortController();
        void loadEngramKernelConfig(controller.signal);
        void loadEngramAutonomyConfig(controller.signal);
        return () => controller.abort();
    }, [loadEngramAutonomyConfig, loadEngramKernelConfig, engramEnabled]);

    const updateSkillPolicy = useCallback(async (skillID: string, patch: { enabled?: boolean; min_level?: string }) => {
        let previousSkill: MCPSkillItem | null = null;

        setSkillCatalog((current) => current.map((item) => {
            if (item.id !== skillID) return item;
            previousSkill = item;
            return {
                ...item,
                enabled: typeof patch.enabled === 'boolean' ? patch.enabled : item.enabled,
                min_level: typeof patch.min_level === 'string' ? patch.min_level : item.min_level,
            };
        }));
        setSkillUpdatePending((current) => ({ ...current, [skillID]: true }));
        setNotice(null);

        const body: Record<string, unknown> = { skill_id: skillID };
        if (typeof patch.enabled === 'boolean') body.enabled = patch.enabled;
        if (typeof patch.min_level === 'string') body.min_level = patch.min_level;

        try {
            const res = await fetchWithAuth('/api/project/mcp/skills/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                throw new Error(`skill action failed: ${res.status}`);
            }

            const payload = await res.json().catch(() => null) as { skill?: MCPSkillItem } | null;
            if (payload?.skill) {
                setSkillCatalog((current) => {
                    let replaced = false;
                    const next = current.map((item) => {
                        if (item.id !== payload.skill!.id) return item;
                        replaced = true;
                        return payload.skill!;
                    });
                    return replaced ? next : [...next, payload.skill!];
                });
            }
        } catch {
            if (previousSkill) {
                setSkillCatalog((current) => current.map((item) => (item.id === previousSkill!.id ? previousSkill! : item)));
            }
            setNotice({
                type: 'error',
                message: 'No se pudo aplicar la politica. El cambio local fue revertido.',
            });
        } finally {
            setSkillUpdatePending((current) => {
                const next = { ...current };
                delete next[skillID];
                return next;
            });
        }
    }, []);

    const updateAgentAccessLevel = useCallback(async (tokenID: string, nextLevel: 'libre' | 'medio' | 'restringido') => {
        const idRaw = String(tokenID || '').trim();
        const id = normalizeTokenID(idRaw);
        if (!idRaw) return;

        const previousSessions = activeSessionsRef.current;
        const previousTransient = transientSessions;
        const previousApprovals = pendingApprovals;
        const previousOverrides = sessionSecurityOverrides;

        setAgentLevelUpdating((current) => ({ ...current, [id]: true, [idRaw]: true }));
        setNotice(null);
        manualGovernanceGuardUntilRef.current[id] = Date.now() + MANUAL_GOVERNANCE_SSE_GUARD_MS;
        setSessionSecurityOverrides((current) => ({ ...current, [id]: nextLevel }));

        setActiveSessions((current) => current.map((session) =>
            tokenIDsMatch(String(session.token_id || ''), id)
                ? { ...session, security_level: nextLevel }
                : session
        ));
        setTransientSessions((current) => {
            const matchedKey = Object.keys(current).find((key) => tokenIDsMatch(key, id));
            if (!matchedKey) return current;
            const entry = current[matchedKey];
            return {
                ...current,
                [matchedKey]: {
                    ...entry,
                    security_level: nextLevel,
                },
            };
        });
        setPendingApprovals((current) => current.map((approval) =>
            tokenIDsMatch(String(approval.token_id || ''), id)
                ? { ...approval, token_security_level: nextLevel }
                : approval
        ));

        try {
            const res = await fetchWithAuth(`/api/project/mcp/agents/${encodeURIComponent(idRaw)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    security_level: nextLevel,
                    friendly_name: '', 
                    policies: [],
                    autonomy_level: '',
                    action: ''
                }),
            });

            if (!res.ok) {
                throw new Error(`update agent access failed: ${res.status}`);
            }

            const payload = await res.json().catch(() => null) as {
                persisted_security_level?: boolean;
                security_level?: string;
                guardrail_source?: string;
            } | null;

            const effectiveLevel = normalizeMCPSecurityLevel(payload?.security_level || nextLevel);
            setSessionSecurityOverrides((current) => ({ ...current, [id]: effectiveLevel }));
            setActiveSessions((current) => current.map((session) =>
                tokenIDsMatch(String(session.token_id || ''), id)
                    ? { ...session, security_level: effectiveLevel }
                    : session
            ));
            setTransientSessions((current) => {
                const matchedKey = Object.keys(current).find((key) => tokenIDsMatch(key, id));
                if (!matchedKey) return current;
                const entry = current[matchedKey];
                return {
                    ...current,
                    [matchedKey]: {
                        ...entry,
                        security_level: effectiveLevel,
                    },
                };
            });
            setPendingApprovals((current) => current.map((approval) =>
                tokenIDsMatch(String(approval.token_id || ''), id)
                    ? { ...approval, token_security_level: effectiveLevel }
                    : approval
            ));

            const persisted = Boolean(payload?.persisted_security_level);
            if (!persisted) {
                setNotice({
                    type: 'info',
                    message: `Nivel efectivo ${effectiveLevel} aplicado en sesion activa (${String(payload?.guardrail_source || 'live').toLowerCase()}).`,
                });
            }

            await loadPendingApprovals();
        } catch {
            setActiveSessions(previousSessions);
            setTransientSessions(previousTransient);
            setPendingApprovals(previousApprovals);
            setSessionSecurityOverrides(previousOverrides);
            setNotice({
                type: 'error',
                message: 'No se pudo actualizar el nivel de acceso del agente. Cambio revertido.',
            });
        } finally {
            setAgentLevelUpdating((current) => {
                const next = { ...current };
                delete next[id];
                delete next[idRaw];
                return next;
            });
        }
    }, [loadPendingApprovals, pendingApprovals, sessionSecurityOverrides, transientSessions]);

    const resolvePendingApproval = useCallback(async (requestID: string, action: 'approve' | 'reject') => {
        const id = String(requestID || '').trim();
        if (!id) return false;

        setApprovalActioningByID((current) => ({ ...current, [id]: true }));
        setNotice(null);

        try {
            const res = await fetchWithAuth('/api/project/mcp/approvals/action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    request_id: id,
                    action,
                    note: `agent_forge_${action}`,
                }),
            });

            const payload = await res.json().catch(() => null) as { error?: string; tool?: string } | null;
            if (!res.ok) {
                throw new Error(String(payload?.error || 'approval action failed'));
            }

            setNotice({
                type: 'success',
                message: action === 'approve'
                    ? `Aprobado y ejecutado: ${String(payload?.tool || 'request')}.`
                    : `Solicitud rechazada: ${String(payload?.tool || 'request')}.`,
            });

            await loadPendingApprovals();
            return true;
        } catch (error) {
            setNotice({
                type: 'error',
                message: error instanceof Error ? error.message : 'No se pudo resolver la aprobación MCP.',
            });
            return false;
        } finally {
            setApprovalActioningByID((current) => {
                const next = { ...current };
                delete next[id];
                return next;
            });
        }
    }, [loadPendingApprovals]);

    const refreshEngramContext = useCallback(async () => {
        try {
            const res = await fetchWithAuth('/api/project/mcp/invoke', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tool: 'get_project_awareness',
                    arguments: { limit: 12, window_hours: 24 },
                }),
            });
            if (!res.ok) {
                setEngramStatus('degraded');
                return;
            }
            const payload = await res.json().catch(() => null) as {
                result?: {
                    status?: string;
                    total_events?: number;
                    window_hours?: number;
                    chronicle_markdown?: string;
                    memory_layers?: ProjectMemoryLayerInfo;
                    entropy_score?: number;
                    entropy_state?: string;
                    entropy_color?: string;
                    context_budget?: {
                        ratio?: number;
                        tokens?: number;
                    };
                    recent_events?: EngramRecentEventPayload[];
                    semantic_health?: SemanticHealthPayload;
                }
            } | null;
            const result = payload?.result;
            if (!result) {
                return;
            }
            setEngramStatus(String(result.status || 'ok'));
            applySemanticHealth(result.semantic_health);
            setEngramTotalEvents(Number(result.total_events || 0));
            setEngramWindowHours(Number(result.window_hours || 24));
            setEngramChronicle(String(result.chronicle_markdown || '').trim());
            setEngramMemoryLayers(result.memory_layers || null);
            const rawEntropyState = String(result.entropy_state || 'flow').trim().toLowerCase();
            const entropyState: ProjectEntropyInfo['state'] =
                rawEntropyState === 'tension' || rawEntropyState === 'chaos' || rawEntropyState === 'debt'
                    ? rawEntropyState
                    : 'flow';
            const rawEntropyColor = String(result.entropy_color || 'green').trim().toLowerCase();
            const entropyColor: ProjectEntropyInfo['color'] =
                rawEntropyColor === 'amber' || rawEntropyColor === 'red' || rawEntropyColor === 'blue'
                    ? rawEntropyColor
                    : 'green';
            const entropyScore = Math.max(0, Math.min(1, Number(result.entropy_score || 0)));
            const contextBudgetRatio = Math.max(0.2, Math.min(1, Number(result.context_budget?.ratio || 1)));
            const contextBudgetTokens = Math.max(512, Number(result.context_budget?.tokens || Math.round(12000 * contextBudgetRatio)));
            setEngramEntropy({
                score: entropyScore,
                state: entropyState,
                color: entropyColor,
                contextBudgetRatio,
                contextBudgetTokens,
            });

            const rows = Array.isArray(result.recent_events) ? result.recent_events : [];
            const mapped = rows.map((row, index) => {
                const agent = String(row.agent_name || 'MCP Agent');
                const kind = normalizeActivityKind(String(row.activity_kind || ''), '');
                const fx = normalizePipelineFX(String(row.pipeline_fx || ''), kind, '');
                const operationDetail = normalizeOperationDetail(String(row.operation_detail || ''), '');
                const resource = normalizeTargetResource(String(row.target_resource || 'system'));
                const timestamp = normalizeTimestamp(row.created_at);

                return {
                    id: `engram-refresh-${timestamp}-${agent}-${operationDetail}-${resource}-${index}`,
                    agentName: agent,
                    source: inferEngramSource(agent),
                    intention: describeEngramIntent({
                        agentName: agent,
                        activityKind: kind,
                        pipelineFX: fx,
                        operationDetail,
                        targetResource: resource,
                    }),
                    resource,
                    timestamp,
                    pipelineFX: fx,
                    activityKind: kind,
                    operationDetail,
                    causalRef: String(row.causal_ref || ''),
                } satisfies EngramFeedItem;
            });

            // Sync does a hard refresh of context buffer to avoid duplicate growth.
            setEngramFeed(dedupeEngramFeed(mapped));
        } catch {
            setEngramStatus('degraded');
        }
    }, [applySemanticHealth]);

    const compactEngramNow = useCallback(async (forceLLM = false) => {
        if (engramCompactionRunning) return false;
        setEngramCompactionRunning(true);
        try {
            const query = forceLLM ? '?force_llm=true' : '';
            const res = await fetchWithAuth(`/api/project/engram/compact-now${query}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ force_llm: forceLLM }),
            });
            const payload = await res.json().catch(() => null) as {
                status?: string;
                error?: string;
                result?: {
                    compacted?: boolean;
                    reason?: string;
                    events_compacted?: number;
                    batch_id?: string;
                    uncompacted_count?: number;
                };
            } | null;

            if (!res.ok || payload?.status !== 'ok') {
                throw new Error(payload?.error || 'No se pudo ejecutar la compactación.');
            }

            const compacted = Boolean(payload?.result?.compacted);
            const eventsCompacted = Number(payload?.result?.events_compacted || 0);
            const reason = String(payload?.result?.reason || '').trim() || 'unknown';
            const batchID = String(payload?.result?.batch_id || '').trim();
            const pending = Number(payload?.result?.uncompacted_count || 0);

            if (compacted) {
                setNotice({
                    type: 'success',
                    message: `Memoria compactada: ${eventsCompacted} eventos procesados${batchID ? ` (${batchID})` : ''}.`,
                });
            } else {
                const queueLabel = reason === 'nothing_to_compact'
                    ? `No había eventos nuevos para compactar (cola: ${pending}).`
                    : `Compactación omitida (${reason}). Cola pendiente: ${pending}.`;
                setNotice({
                    type: 'info',
                    message: queueLabel,
                });
            }

            await refreshEngramContext();
            return compacted;
        } catch (err) {
            setNotice({
                type: 'error',
                message: `No se pudo compactar memoria: ${err instanceof Error ? err.message : 'error desconocido'}`,
            });
            return false;
        } finally {
            setEngramCompactionRunning(false);
        }
    }, [engramCompactionRunning, refreshEngramContext]);

    const refreshBridge = useCallback(async () => {
        setBridgeStatus('reconnecting');
        setStreamErrored(false);
        setNexusFeed([]);
        setEngramFeed([]);
        setEngramChronicle('');
        setEngramEntropy({
            score: 0,
            state: 'flow',
            color: 'green',
            contextBudgetRatio: 1,
            contextBudgetTokens: 12000,
        });
        setSemanticHealth({
            status: 'unknown',
            physicalTables: 0,
            semanticSnapshots: 0,
            compactionPending: 0,
            missingTables: [],
            physicalTableNames: [],
            semanticSnapshotTableNames: [],
            recentSecurityAlert: false,
            lastSecurityAlertAt: null,
        });
        setRawMCPFrames([]);
        setTransientSessions({});
        setPipelineFXUntil(0);
        setActiveOperationDetail('');
        setActiveTargetResource('');
        setTargetErrorUntil(0);

        const tasks: Array<Promise<unknown>> = [loadPendingApprovals()];
        if (engramEnabled) {
            tasks.push(refreshEngramContext());
        }
        await Promise.allSettled(tasks);

        setStreamRestartNonce((current) => current + 1);
    }, [engramEnabled, loadPendingApprovals, refreshEngramContext]);

    useEffect(() => {
        if (!engramEnabled) return;
        void refreshEngramContext();
        const interval = window.setInterval(() => {
            void refreshEngramContext();
        }, 25000);
        return () => window.clearInterval(interval);
    }, [refreshEngramContext, engramEnabled]);

    useEffect(() => {
        let disposed = false;
        let source: EventSource | null = null;

        const handleEvent = (rawData: string) => {
            appendRawFrame(rawData);
            let payload: MCPStreamEvent | null = null;
            try {
                payload = JSON.parse(rawData) as MCPStreamEvent;
            } catch {
                return;
            }
            if (!payload) return;

            const eventType = String(payload.event_type || payload.event || '').trim();
            const tokenID = String(payload.agent_token_id || '').trim();
            const agentName = String(payload.agent_name || '').trim();
            const userAgent = String(payload.user_agent || '').trim();
            const eventTime = normalizeTimestamp(payload.timestamp);

            if (tokenID) {
                const tokenKey = normalizeTokenID(tokenID);
                setFreshAgentSeenAt((current) => {
                    if (current[tokenKey]) return current;
                    return { ...current, [tokenKey]: Date.now() };
                });
                setTransientSessions((current) => {
                    const existing = current[tokenID];
                    const incomingLevel = String(payload.security_level || '').trim().toLowerCase();
                    const currentLevel = String(existing?.security_level || 'libre').trim().toLowerCase();
                    const guardUntil = manualGovernanceGuardUntilRef.current[tokenKey] || 0;
                    const guardActive = guardUntil > Date.now();
                    const nextLevel = (incomingLevel === 'libre' || incomingLevel === 'medio' || incomingLevel === 'restringido')
                        ? incomingLevel
                        : currentLevel;
                    const resolvedLevel = guardActive ? currentLevel : nextLevel;
                    const nextStatus = String((payload as MCPStreamEvent & { status?: string }).status || payload.result || existing?.status || 'idle').toLowerCase();
                    const incomingTool = payload.tool ? String(payload.tool) : '';
                    const recentTools = incomingTool
                        ? Array.from(new Set([incomingTool, ...(Array.isArray(existing?.recent_tools) ? existing!.recent_tools! : [])])).slice(0, 6)
                        : (Array.isArray(existing?.recent_tools) ? existing!.recent_tools! : []);

                    return {
                        ...current,
                        [tokenID]: {
                            token_id: tokenID,
                            name: agentName || existing?.name || '',
                            security_level: resolvedLevel,
                            status: nextStatus,
                            last_activity_at: nowISO(),
                            pending_count: Number(existing?.pending_count || 0),
                            recent_tools: recentTools,
                        },
                    };
                });
            }

            if (agentName && tokenID) {
                setAgentNameByToken((current) => ({ ...current, [normalizeTokenID(tokenID)]: agentName }));
            }
            if (tokenID) {
                const source = inferAgentSource(userAgent, agentName);
                setAgentSourceByToken((current) => ({ ...current, [normalizeTokenID(tokenID)]: source }));
            }

            if (eventType === 'mcp_activity') {
                const kind = normalizeActivityKind(String(payload.activity_kind || ''), String(payload.tool_risk || ''));
                const pipelineFX = normalizePipelineFX(String(payload.pipeline_fx || ''), kind, String(payload.tool_risk || ''));
                const operationDetail = normalizeOperationDetail(String(payload.operation_detail || ''), String(payload.tool || ''));
                const targetResource = normalizeTargetResource(String(payload.target_resource || ''));
                const pulseStart = Date.now();
                setActivePipelineFX(pipelineFX);
                setActiveOperationDetail(operationDetail);
                setActiveTargetResource(targetResource);
                setPipelineFXUntil(pulseStart + pipelineFXDurationMs(pipelineFX));
                if (String(payload.result || '').toLowerCase().includes('error') || String(payload.result || '').toLowerCase().includes('denied')) {
                    setTargetErrorUntil(Date.now() + 3000);
                }

                const actorName = agentName || (tokenID ? tokenID.slice(0, 8) : 'Agent');
                const line = `[${new Date(eventTime).toLocaleTimeString('es-ES', { hour12: false })}] ${actorName}: ${getFeedLine(payload)}`;

                setNexusFeed((current) => [
                    {
                        id: `${eventTime}-${Math.random()}`,
                        tokenID,
                        line,
                        timestamp: eventTime,
                        kind,
                    },
                    ...current,
                ].slice(0, STREAM_EVENT_LIMIT));

                const engramSource = inferAgentSource(userAgent, agentName);
                const intention = String(payload.status_msg || '').trim() || describeEngramIntent({
                    agentName: actorName,
                    activityKind: kind,
                    pipelineFX,
                    operationDetail,
                    targetResource,
                });
                setEngramFeed((current) => dedupeEngramFeed([{
                    id: `live-${eventTime}-${tokenID || actorName}-${operationDetail}-${targetResource}`,
                    agentName: actorName,
                    source: engramSource,
                    intention,
                    resource: targetResource,
                    timestamp: eventTime,
                    pipelineFX,
                    activityKind: kind,
                    operationDetail,
                }, ...current]));
            }

            if (eventType === 'engram_update') {
                const status = String(payload.engram_status || '').trim();
                if (status) {
                    setEngramStatus(status);
                }
                if (typeof payload.engram_total_events === 'number') {
                    setEngramTotalEvents(payload.engram_total_events);
                }
                const hasSemanticFields = (
                    typeof payload.semantic_health === 'string'
                    || typeof payload.semantic_physical_tables === 'number'
                    || typeof payload.semantic_snapshot_tables === 'number'
                    || typeof payload.semantic_recent_security_alert === 'boolean'
                );
                if (hasSemanticFields) {
                    applySemanticHealth({
                        status: payload.semantic_health,
                        physical_tables: payload.semantic_physical_tables,
                        semantic_snapshot_tables: payload.semantic_snapshot_tables,
                        recent_security_alert: payload.semantic_recent_security_alert,
                        missing_tables: payload.semantic_missing_tables,
                        physical_table_names: payload.semantic_physical_table_names,
                        semantic_snapshot_table_names: payload.semantic_snapshot_table_names,
                    });
                }
                if (typeof payload.engram_window_hours === 'number') {
                    setEngramWindowHours(payload.engram_window_hours);
                }
                if (typeof payload.engram_entropy_score === 'number' || typeof payload.engram_entropy_state === 'string') {
                    setEngramEntropy((current) => {
                        const nextScore = typeof payload.engram_entropy_score === 'number'
                            ? Math.max(0, Math.min(1, payload.engram_entropy_score))
                            : current.score;
                        const rawState = String(payload.engram_entropy_state || current.state).trim().toLowerCase();
                        const nextState: ProjectEntropyInfo['state'] =
                            rawState === 'tension' || rawState === 'chaos' || rawState === 'debt' ? rawState : 'flow';
                        const nextColor: ProjectEntropyInfo['color'] =
                            nextState === 'flow' ? 'green' : nextState === 'tension' ? 'amber' : nextState === 'chaos' ? 'red' : 'blue';
                        const nextBudgetRatio = nextState === 'flow' ? 1 : nextState === 'tension' ? 0.75 : nextState === 'chaos' ? 0.45 : 0.35;
                        return {
                            score: nextScore,
                            state: nextState,
                            color: nextColor,
                            contextBudgetRatio: nextBudgetRatio,
                            contextBudgetTokens: Math.round(12000 * nextBudgetRatio),
                        };
                    });
                }

                const chronicle = String((payload as MCPStreamEvent & { engram_chronicle_markdown?: string }).engram_chronicle_markdown || '').trim();
                if (chronicle) {
                    setEngramChronicle(chronicle);
                }

                const recentRows = Array.isArray(payload.engram_recent_events) ? payload.engram_recent_events : [];
                if (recentRows.length > 0) {
                    const mapped = recentRows.map((row, index) => {
                        const agent = String(row.agent_name || 'MCP Agent');
                        const kind = normalizeActivityKind(String(row.activity_kind || ''), '');
                        const fx = normalizePipelineFX(String(row.pipeline_fx || ''), kind, '');
                        const operationDetail = normalizeOperationDetail(String(row.operation_detail || ''), '');
                        const resource = normalizeTargetResource(String(row.target_resource || 'system'));
                        const timestamp = normalizeTimestamp(row.created_at);

                        return {
                            id: `engram-${timestamp}-${agent}-${operationDetail}-${resource}-${index}`,
                            agentName: agent,
                            source: inferEngramSource(agent),
                            intention: describeEngramIntent({
                                agentName: agent,
                                activityKind: kind,
                                pipelineFX: fx,
                                operationDetail,
                                targetResource: resource,
                            }),
                            resource,
                            timestamp,
                            pipelineFX: fx,
                            activityKind: kind,
                            operationDetail,
                            causalRef: String(row.causal_ref || ''),
                        } satisfies EngramFeedItem;
                    });
                    setEngramFeed(dedupeEngramFeed(mapped));
                }
            }

            if (eventType === 'skill_installed') {
                const skillName = String(payload.skill_name || '').trim();
                if (!tokenID || !skillName) return;

                setLiveSkillsByToken((current) => {
                    const existing = Array.isArray(current[tokenID]) ? current[tokenID] : [];
                    if (existing.includes(skillName)) return current;
                    return { ...current, [tokenID]: [...existing, skillName] };
                });

                const line = `[${new Date(eventTime).toLocaleTimeString('es-ES', { hour12: false })}] ${agentName || tokenID.slice(0, 8)} desbloqueo skill: ${skillName}`;
                setNexusFeed((current) => [{
                    id: `${eventTime}-${Math.random()}`,
                    tokenID,
                    line,
                    timestamp: eventTime,
                    kind: 'system' as ActivityKind,
                }, ...current].slice(0, STREAM_EVENT_LIMIT));
            }

            if (eventType === 'skill_status_changed') {
                const skillID = String(payload.skill_id || '').trim();
                if (!skillID) return;

                setSkillCatalog((current) => current.map((item) => {
                    if (item.id !== skillID) return item;
                    return {
                        ...item,
                        enabled: typeof payload.enabled === 'boolean' ? payload.enabled : item.enabled,
                        min_level: payload.min_level ? String(payload.min_level) : item.min_level,
                    };
                }));

                const line = `[${new Date(eventTime).toLocaleTimeString('es-ES', { hour12: false })}] Gobernanza actualizada: ${payload.skill_name || skillID}`;
                setNexusFeed((current) => [{
                    id: `${eventTime}-${Math.random()}`,
                    tokenID: '',
                    line,
                    timestamp: eventTime,
                    kind: 'system' as ActivityKind,
                }, ...current].slice(0, STREAM_EVENT_LIMIT));
            }

            if (eventType === 'agent_config_updated' && tokenID) {
                const level = String(payload.security_level || '').trim().toLowerCase();
                const nextName = String(payload.agent_name || '').trim();
                const normalizedTokenID = normalizeTokenID(tokenID);
                delete manualGovernanceGuardUntilRef.current[normalizedTokenID];
                if (level === 'libre' || level === 'medio' || level === 'restringido') {
                    setActiveSessions((current) => current.map((session) =>
                        tokenIDsMatch(String(session.token_id || ''), tokenID)
                            ? { ...session, security_level: level }
                            : session
                    ));
                    setTransientSessions((current) => {
                        const matchedKey = Object.keys(current).find((key) => tokenIDsMatch(key, tokenID));
                        if (!matchedKey) return current;
                        const existing = current[matchedKey];
                        return {
                            ...current,
                            [matchedKey]: {
                                ...existing,
                                security_level: level,
                            },
                        };
                    });
                }
                if (nextName) {
                    setAgentNameByToken((current) => ({ ...current, [normalizeTokenID(tokenID)]: nextName }));
                    setActiveSessions((current) => current.map((session) =>
                        tokenIDsMatch(String(session.token_id || ''), tokenID)
                            ? { ...session, name: nextName }
                            : session
                    ));
                    setTransientSessions((current) => {
                        const matchedKey = Object.keys(current).find((key) => tokenIDsMatch(key, tokenID));
                        if (!matchedKey) return current;
                        return {
                            ...current,
                            [matchedKey]: {
                                ...current[matchedKey],
                                name: nextName,
                            },
                        };
                    });
                }
            }

            if (eventType === 'security_alert') {
                const resultCode = String(payload.result || '').trim().toLowerCase();
                const alertType = String(payload.alert_type || '').trim().toLowerCase();
                const hardLock = resultCode === 'hard_lock_active' || alertType === 'hard_lock';
                const baseMessage = String(payload.status_msg || '').trim()
                    || (hardLock
                        ? 'BLOQUEO DE NODO RAÍZ detectado por gobernanza.'
                        : 'Intento de mutación no autorizado detectado por guardrails.');
                const resource = normalizeTargetResource(String(payload.target_resource || 'system'));
                const tokenSuffix = tokenID ? tokenID.slice(0, 8) : 'agent';
                const dedupeKey = `${hardLock ? 'hard_lock' : 'blocked'}:${tokenSuffix}:${resource}:${String(payload.tool || '').trim().toLowerCase()}`;
                const now = Date.now();
                const lastShownAt = lastSecurityAlertRef.current[dedupeKey] || 0;
                if ((now - lastShownAt) > 6000) {
                    lastSecurityAlertRef.current[dedupeKey] = now;
                    setNotice({
                        type: 'error',
                        message: hardLock
                            ? `[SECURITY] Hard-Lock activo en ${resource}. ${baseMessage}`
                            : `[SECURITY] Intento bloqueado en ${resource}. ${baseMessage}`,
                    });
                }
                setTargetErrorUntil(Date.now() + (hardLock ? 6000 : 4000));
                setSemanticHealth((current) => ({
                    ...current,
                    status: 'alert',
                    recentSecurityAlert: true,
                    lastSecurityAlertAt: now,
                }));
            }
        };

        const openStream = async () => {
            try {
                const sessionRes = await fetchWithAuth('/api/project/mcp/stream/session', { method: 'POST' });
                if (!sessionRes.ok || disposed) {
                    setStreamErrored(true);
                    return;
                }

                const sessionPayload = await sessionRes.json().catch(() => null) as { token?: string } | null;
                const token = String(sessionPayload?.token || '').trim();
                if (!token || disposed) {
                    setStreamErrored(true);
                    return;
                }

                source = new EventSource(`/api/project/mcp/stream?token=${encodeURIComponent(token)}`);
                source.onopen = () => setStreamErrored(false);
                source.onmessage = (event) => handleEvent(event.data);
                source.onerror = () => {
                    setStreamErrored(true);
                    setTargetErrorUntil(Date.now() + 5000);
                };
                source.addEventListener('mcp_activity', (event: MessageEvent) => handleEvent(event.data));
                source.addEventListener('skill_installed', (event: MessageEvent) => handleEvent(event.data));
                source.addEventListener('skill_status_changed', (event: MessageEvent) => handleEvent(event.data));
                source.addEventListener('engram_update', (event: MessageEvent) => handleEvent(event.data));
                source.addEventListener('security_alert', (event: MessageEvent) => handleEvent(event.data));
            } catch {
                setStreamErrored(true);
                setTargetErrorUntil(Date.now() + 5000);
            }
        };

        void openStream();

        return () => {
            disposed = true;
            source?.close();
        };
    }, [appendRawFrame, applySemanticHealth, streamRestartNonce]);

    const isBridgeConnected = useMemo(() => {
        const normalized = String(bridgeStatus || '').toLowerCase();
        return !streamErrored && (normalized === 'healthy' || normalized === 'connected' || normalized === 'ok');
    }, [bridgeStatus, streamErrored]);

    const pipelineState = useMemo(() => {
        const now = Date.now();
        const isFlowing = now < pipelineFXUntil;
        const targetError = now < targetErrorUntil || !isBridgeConnected;
        const pipelineFX = isFlowing ? activePipelineFX : null;
        const operationDetail = isFlowing ? activeOperationDetail : '';
        const targetResource = isFlowing ? activeTargetResource : '';
        const operationTag = (operationDetail && targetResource)
            ? `[${operationDetail}] ${targetResource}`
            : (operationDetail || targetResource || '');

        return {
            isFlowing,
            corePulse: isBridgeConnected,
            targetError,
            streamErrored,
            pipelineFX,
            operationDetail,
            targetResource,
            operationTag,
        };
    }, [activeOperationDetail, activePipelineFX, activeTargetResource, isBridgeConnected, pipelineFXUntil, streamErrored, targetErrorUntil]);

    const leadArchitectAudit = useMemo<LeadArchitectAudit>(() => {
        const syncState = String(engramKernelConfig.syncState || '').toUpperCase();
        const ready = syncState === 'SYNCHRONIZED' || syncState === 'SYNC_COMPLETE';
        const now = Date.now();
        const windowStart = now - ONE_HOUR_MS;

        const entropyWindow = engramEntropyHistory
            .filter((item) => item.timestamp >= windowStart)
            .sort((a, b) => a.timestamp - b.timestamp);
        const entropyStart = entropyWindow[0] || null;
        const entropyEnd = entropyWindow.length > 0 ? entropyWindow[entropyWindow.length - 1] : null;
        const entropyDelta = entropyStart && entropyEnd ? entropyEnd.score - entropyStart.score : 0;
        const escalatedFromFlow = Boolean(
            entropyStart
            && entropyEnd
            && entropyStart.state === 'flow'
            && (entropyEnd.state === 'tension' || entropyEnd.state === 'chaos' || entropyEnd.state === 'debt'),
        );

        const entropyTrigger: LeadArchitectTrigger = {
            id: 'entropy_drift',
            title: 'Entropy Drift',
            active: entropyDelta > 0.2 && escalatedFromFlow,
            severity: entropyDelta > 0.35 ? 'high' : 'medium',
            detail: entropyDelta > 0
                ? `Drift de ${entropyDelta.toFixed(2)} en la ultima hora (${entropyStart?.state || 'flow'} -> ${entropyEnd?.state || engramEntropy.state}).`
                : 'Sin drift relevante en la ultima hora.',
            metric: `dE=${entropyDelta.toFixed(2)}`,
        };

        const recentEvents = engramFeed.filter((item) => item.timestamp >= windowStart);
        const mutationCount = recentEvents.filter((item) => (
            DDL_OPERATION_PATTERN.test(String(item.operationDetail || ''))
            || DDL_OPERATION_PATTERN.test(String(item.intention || ''))
        )).length;
        const mutationTrigger: LeadArchitectTrigger = {
            id: 'mutation_spike',
            title: 'Mutation Spikes',
            active: mutationCount > 5,
            severity: mutationCount > 9 ? 'high' : 'medium',
            detail: mutationCount > 0
                ? `${mutationCount} mutaciones DDL detectadas en la ultima hora.`
                : 'No hay picos de mutacion DDL.',
            metric: `ddl/h=${mutationCount}`,
        };

        const writeEvents = recentEvents
            .filter((item) => item.activityKind === 'write' || WRITE_OPERATION_PATTERN.test(String(item.operationDetail || '')) || WRITE_OPERATION_PATTERN.test(String(item.intention || '')))
            .sort((a, b) => b.timestamp - a.timestamp);
        let dissonanceHits = 0;
        for (let i = 0; i < writeEvents.length; i += 1) {
            const latest = writeEvents[i];
            for (let j = i + 1; j < writeEvents.length; j += 1) {
                const previous = writeEvents[j];
                if (latest.resource !== previous.resource) continue;
                if (latest.agentName === previous.agentName) continue;
                if ((latest.timestamp - previous.timestamp) > TEN_MINUTES_MS) continue;
                dissonanceHits += 1;
                break;
            }
        }

        const dissonanceTrigger: LeadArchitectTrigger = {
            id: 'agent_dissonance',
            title: 'Agent Dissonance',
            active: dissonanceHits > 0,
            severity: dissonanceHits > 2 ? 'high' : 'medium',
            detail: dissonanceHits > 0
                ? `${dissonanceHits} colisiones de agentes sobre el mismo recurso en <=10m.`
                : 'Sin colisiones recientes entre agentes.',
            metric: `hits=${dissonanceHits}`,
        };

        const triggers = [entropyTrigger, mutationTrigger, dissonanceTrigger];
        const activeTriggers = triggers.filter((item) => item.active);
        const hasHigh = activeTriggers.some((item) => item.severity === 'high');
        const status: LeadArchitectAudit['status'] = !ready
            ? 'pending-sync'
            : activeTriggers.length === 0
                ? 'nominal'
                : hasHigh
                    ? 'critical'
                    : 'watch';

        const prompt = `Ozy, analiza los ${engramTotalEvents} eventos. ¿Que patron de errores detectas en la construccion del CRM y que tan cerca estamos del Perfect Order? Considera: dE=${entropyDelta.toFixed(2)}, DDL/h=${mutationCount}, disonancia=${dissonanceHits}.`;

        return {
            ready,
            status,
            generatedAt: now,
            prompt,
            triggers,
        };
    }, [engramEntropy.state, engramEntropyHistory, engramFeed, engramKernelConfig.syncState, engramTotalEvents]);

    const agents = useMemo<NexusAgent[]>(() => {
        const isSkillAllowedForLevel = (skillName: string, level: string) => {
            const catalogSkill = skillCatalog.find((item) => String(item.name || '').toLowerCase() === String(skillName || '').toLowerCase());
            if (!catalogSkill) return true;
            if (!catalogSkill.enabled) return false;
            return securityLevelRank(level) >= securityLevelRank(catalogSkill.min_level);
        };

        const grouped = new Map<string, NexusAgent>();
        const now = Date.now();

        activeSessions.forEach((session, index) => {
            const id = String(session.token_id || `session_${index}`);
            const idKey = normalizeTokenID(id);
            const level = String(session.security_level || 'libre').toLowerCase();
            grouped.set(id, {
                id,
                label: id.slice(0, 8),
                level,
                pendingCount: Number(session.pending_count || 0),
                recentTools: Array.isArray(session.recent_tools) ? session.recent_tools : [],
                availableSkills: Array.from(new Set([
                    ...(Array.isArray(session.available_skills) ? session.available_skills : []),
                    ...((liveSkillsByToken[id] || [])),
                ])).filter((skillName) => isSkillAllowedForLevel(skillName, level)),
                availableTools: Array.isArray(session.available_tools) ? session.available_tools : [],
                lastActivityAt: String(session.last_activity_at || ''),
                name: session.name || agentNameByToken[idKey],
                source: agentSourceByToken[idKey] || 'mcp',
                isFresh: Boolean(freshAgentSeenAt[idKey] && (now - freshAgentSeenAt[idKey]) < 6000),
                isApproved: Boolean(session.is_approved),
                icon: session.icon,
                activity: session.activity,
                status: String(session.status || 'idle'),
            });
        });

        Object.entries(transientSessions).forEach(([id, session]) => {
            const idKey = normalizeTokenID(id);
            if (grouped.has(id)) return;
            const lastSeen = Date.parse(String(session.last_activity_at || ''));
            if (!Number.isNaN(lastSeen) && (now - lastSeen) > AGENT_SESSION_TTL_MS) {
                return;
            }
            const level = String(session.security_level || 'libre').toLowerCase();
            grouped.set(id, {
                id,
                label: id.slice(0, 8),
                level,
                pendingCount: Number(session.pending_count || 0),
                recentTools: Array.isArray(session.recent_tools) ? session.recent_tools : [],
                availableSkills: Array.from(new Set(liveSkillsByToken[id] || [])).filter((skillName) => isSkillAllowedForLevel(skillName, level)),
                availableTools: Array.isArray(session.available_tools) ? session.available_tools : [],
                lastActivityAt: String(session.last_activity_at || ''),
                name: session.name || agentNameByToken[idKey],
                source: agentSourceByToken[idKey] || 'mcp',
                isFresh: Boolean(freshAgentSeenAt[idKey] && (now - freshAgentSeenAt[idKey]) < 6000),
                isApproved: Boolean(session.is_approved),
                icon: session.icon,
                activity: session.activity,
                status: String(session.status || 'idle'),
            });
        });

        pendingApprovals.forEach((item, index) => {
            const id = String(item.token_id || item.id || `pending_${index}`).trim();
            const idKey = normalizeTokenID(id);
            if (!id) return;

            const level = String(item.token_security_level || 'libre').toLowerCase();
            const existing = grouped.get(id);
            if (existing) {
                existing.pendingCount += 1;
                if (item.tool && existing.recentTools.length < 6) {
                    existing.recentTools = Array.from(new Set([String(item.tool), ...existing.recentTools]));
                }
                return;
            }
            grouped.set(id, {
                id,
                label: id.slice(0, 8),
                level,
                pendingCount: 1,
                recentTools: item.tool ? [String(item.tool)] : [],
                availableSkills: Array.from(new Set(liveSkillsByToken[id] || [])).filter((skillName) => isSkillAllowedForLevel(skillName, level)),
                availableTools: [],
                lastActivityAt: String(item.created_at || ''),
                name: agentNameByToken[idKey],
                source: agentSourceByToken[idKey] || 'mcp',
                isFresh: Boolean(freshAgentSeenAt[idKey] && (now - freshAgentSeenAt[idKey]) < 6000),
                isApproved: false, // Items in pendingApprovals are not yet approved
                status: 'active',
            });
        });

        return Array.from(grouped.values()).sort((a, b) => {
            const ta = Date.parse(a.lastActivityAt || '') || 0;
            const tb = Date.parse(b.lastActivityAt || '') || 0;
            return tb - ta;
        });
    }, [activeSessions, agentNameByToken, agentSourceByToken, freshAgentSeenAt, liveSkillsByToken, pendingApprovals, sessionSecurityOverrides, skillCatalog, transientSessions]);

    const approveAgent = useCallback(async (agentID: string) => {
        setNotice(null);
        try {
            const res = await fetchWithAuth(`/api/project/mcp/agents/${encodeURIComponent(agentID)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'approve' }),
            });
            if (!res.ok) throw new Error('approval failed');
            await loadPendingApprovals();
            setNotice({ type: 'success', message: 'Agent connection approved.' });
            return true;
        } catch {
            setNotice({ type: 'error', message: 'Failed to approve agent connection.' });
            return false;
        }
    }, [loadPendingApprovals]);

    const rejectAgent = useCallback(async (agentID: string) => {
        setNotice(null);
        try {
            const res = await fetchWithAuth(`/api/project/mcp/agents/${encodeURIComponent(agentID)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'reject' }),
            });
            if (!res.ok) throw new Error('rejection failed');
            await loadPendingApprovals();
            setNotice({ type: 'info', message: 'Agent connection rejected.' });
            return true;
        } catch {
            setNotice({ type: 'error', message: 'Failed to reject agent connection.' });
            return false;
        }
    }, [loadPendingApprovals]);

    return {
        agents,
        approvalsLoading,
        bridgeStatus,
        isBridgeConnected,
        nexusFeed,
        engramFeed,
        engramStatus,
        engramTotalEvents,
        engramWindowHours,
        engramChronicle,
        engramMemoryLayers,
        engramEntropy,
        semanticHealth,
        leadArchitectAudit,
        engramKernelConfig,
        engramAutonomyConfig,
        engramConfigLoading,
        engramConfigSaving,
        engramAutonomyLoading,
        engramAutonomySaving,
        engramDiagnosticRunning,
        engramDiagnostic,
        rawMCPFrames,
        publishedToolsCount: publishedTools,
        approveAgent,
        rejectAgent,
        refreshEngramContext,
        loadEngramKernelConfig,
        loadEngramAutonomyConfig,
        saveEngramKernelConfig,
        saveEngramAutonomyLevel,
        runEngramDiagnostic,
        refreshBridge,
        pipelineState,
        notice,
        clearNotice: () => setNotice(null),
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
    };
};

