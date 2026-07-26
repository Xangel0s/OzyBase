import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchWithAuth } from '../utils/api';
import ConfirmModal from './ConfirmModal';
import {
    Database,
    ZoomIn,
    ZoomOut,
    Search,
    Key,
    Link,
    Hash,
    Calendar,
    ToggleLeft,
    Type,
    FileJson,
    Loader2,
    Lock,
    FileSpreadsheet,
    Layers,
    Move,
    RefreshCw,
    LayoutGrid,
    FileCode,
} from 'lucide-react';

const TABLE_WIDTH = 296;
const COLUMN_ROW_HEIGHT = 30;
const TABLE_BASE_HEIGHT = 88;

type TableBounds = {
    left: number;
    top: number;
    right: number;
    bottom: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const getTableHeight = (table: any) => (
    TABLE_BASE_HEIGHT + Math.max((table?.columns || []).length, 1) * COLUMN_ROW_HEIGHT
);

const buildInitialPositions = (tables: any[]) => {
    const positions: Record<string, { x: number; y: number }> = {};
    const cols = 4;
    const xGap = 360;
    const yGap = 320;

    tables.forEach((table: any, index: number) => {
        const col = index % cols;
        const row = Math.floor(index / cols);
        positions[table.name] = {
            x: 100 + (col * xGap),
            y: 100 + (row * yGap),
        };
    });

    return positions;
};

const SchemaVisualizer = ({ viewMode = 'user' }: any) => {
    const [schema, setSchema] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [scale, setScale] = useState(1);
    const [searchTerm, setSearchTerm] = useState('');
    const [hoveredTable, setHoveredTable] = useState<string | null>(null);
    const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>({});
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isSpacePressed, setIsSpacePressed] = useState(false);
    const [hasInteracted, setHasInteracted] = useState(false);
    const [dragState, setDragState] = useState<{
        type: 'none' | 'pan' | 'node';
        startX: number;
        startY: number;
        targetName?: string;
        initialX?: number;
        initialY?: number;
    }>({ type: 'none', startX: 0, startY: 0 });
    const [isExportConfirmOpen, setIsExportConfirmOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement | null>(null);

    // Reset space press on window blur to prevent stuck state
    useEffect(() => {
        const handleBlur = () => setIsSpacePressed(false);
        window.addEventListener('blur', handleBlur);
        return () => window.removeEventListener('blur', handleBlur);
    }, []);

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetchWithAuth('/api/collections/visualize');
            if (!res.ok) throw new Error('Failed to fetch schema');
            const data = await res.json();
            setNodePositions(buildInitialPositions(Array.isArray(data?.tables) ? data.tables : []));
            setSchema(data);
        } catch (err: any) {
            setError(err?.message || 'Failed to fetch schema');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void fetchData();
    }, [fetchData]);

    const allTables = Array.isArray(schema?.tables) ? schema.tables : [];
    const hasUserTables = allTables.some((table: any) => !table?.is_system);
    const hasSystemTables = allTables.some((table: any) => table?.is_system);
    const showSystemFallback = viewMode === 'user' && !hasUserTables && hasSystemTables;
    const effectiveViewMode = showSystemFallback ? 'system' : viewMode;

    const filteredTables = useMemo(() => (
        allTables.filter((table: any) => {
            const matchesSearch = table.name.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesView = effectiveViewMode === 'system' ? table.is_system : !table.is_system;
            return matchesSearch && matchesView;
        })
    ), [allTables, effectiveViewMode, searchTerm]);

    const filteredRelationships = useMemo(() => (
        (Array.isArray(schema?.relationships) ? schema.relationships : []).filter((rel: any) => (
            filteredTables.some((table: any) => table.name === rel.from_table)
            && filteredTables.some((table: any) => table.name === rel.to_table)
        ))
    ), [filteredTables, schema]);
    const tableColumnIndexes = useMemo(() => {
        const next: Record<string, Record<string, number>> = {};
        allTables.forEach((table: any) => {
            next[table.name] = {};
            (table.columns || []).forEach((column: any, index: number) => {
                next[table.name][column.name] = index;
            });
        });
        return next;
    }, [allTables]);
    const relationshipColumns = useMemo(() => {
        const next: Record<string, Record<string, { outgoing: any[]; incoming: any[] }>> = {};

        filteredRelationships.forEach((relationship: any) => {
            next[relationship.from_table] ??= {};
            next[relationship.from_table][relationship.from_col] ??= { outgoing: [], incoming: [] };
            next[relationship.from_table][relationship.from_col].outgoing.push(relationship);

            next[relationship.to_table] ??= {};
            next[relationship.to_table][relationship.to_col] ??= { outgoing: [], incoming: [] };
            next[relationship.to_table][relationship.to_col].incoming.push(relationship);
        });

        return next;
    }, [filteredRelationships]);
    const activeTable = dragState.type === 'node' ? null : hoveredTable;

    const fitSchemaToViewport = useCallback((tablesToFit = filteredTables) => {
        const container = containerRef.current;
        if (!container || tablesToFit.length === 0) {
            return;
        }

        const bounds = tablesToFit.reduce((acc: TableBounds, table: any) => {
            const position = nodePositions[table.name] || { x: 0, y: 0 };
            const tableHeight = getTableHeight(table);
            return {
                left: Math.min(acc.left, position.x),
                top: Math.min(acc.top, position.y),
                right: Math.max(acc.right, position.x + TABLE_WIDTH),
                bottom: Math.max(acc.bottom, position.y + tableHeight),
            };
        }, {
            left: Number.POSITIVE_INFINITY,
            top: Number.POSITIVE_INFINITY,
            right: Number.NEGATIVE_INFINITY,
            bottom: Number.NEGATIVE_INFINITY,
        });

        const contentWidth = Math.max(bounds.right - bounds.left, TABLE_WIDTH);
        const contentHeight = Math.max(bounds.bottom - bounds.top, 220);
        const horizontalPadding = 120;
        const topOverlayPadding = 108;
        const bottomOverlayPadding = 74;
        const availableWidth = Math.max(container.clientWidth - horizontalPadding, 280);
        const availableHeight = Math.max(container.clientHeight - topOverlayPadding - bottomOverlayPadding, 220);
        // Auto-fit can go lower than manual zoom minimum so large schemas still land fully inside viewport.
        const nextScale = clamp(Math.min(availableWidth / contentWidth, availableHeight / contentHeight, 1.05), 0.08, 1.05);

        setScale(nextScale);
        setPan({
            x: ((container.clientWidth - (contentWidth * nextScale)) / 2) - (bounds.left * nextScale),
            y: topOverlayPadding + ((availableHeight - (contentHeight * nextScale)) / 2) - (bounds.top * nextScale),
        });
    }, [filteredTables, nodePositions]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (event.code === 'Space' && !event.repeat && !(target && target.matches('input, textarea'))) {
                setIsSpacePressed(true);
            }

            if (event.ctrlKey || event.metaKey) {
                if (['Equal', 'NumpadAdd', 'Plus'].includes(event.code) || event.key === '+' || event.key === '=') {
                    event.preventDefault();
                    setScale((current) => Math.min(current + 0.1, 2));
                } else if (['Minus', 'NumpadSubtract', 'Hyphen'].includes(event.code) || event.key === '-') {
                    event.preventDefault();
                    setScale((current) => Math.max(current - 0.1, 0.25));
                } else if (['Digit0', 'Numpad0'].includes(event.code) || event.key === '0') {
                    event.preventDefault();
                    fitSchemaToViewport();
                }
            }
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.code === 'Space') {
                setIsSpacePressed(false);
                if (dragState.type === 'pan') {
                    setDragState({ type: 'none', startX: 0, startY: 0 });
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [fitSchemaToViewport, dragState.type]);

    useEffect(() => {
        if (loading) {
            return undefined;
        }
        const container = containerRef.current;
        if (!container) {
            return undefined;
        }

        const handleWheel = (event: WheelEvent) => {
            event.preventDefault();
            event.stopPropagation();

            if (event.ctrlKey || event.metaKey) {
                const delta = event.deltaY * -0.001;
                setScale((current) => clamp(current + delta, 0.25, 2));
                return;
            }

            setPan((current) => ({
                x: current.x - event.deltaX,
                y: current.y - event.deltaY,
            }));
        };

        container.addEventListener('wheel', handleWheel, { passive: false });
        return () => {
            container.removeEventListener('wheel', handleWheel);
        };
    }, [loading]);

    useEffect(() => {
        if (loading || filteredTables.length === 0 || hasInteracted) {
            return undefined;
        }

        const frame = window.requestAnimationFrame(() => fitSchemaToViewport(filteredTables));
        return () => window.cancelAnimationFrame(frame);
    }, [effectiveViewMode, fitSchemaToViewport, filteredTables, loading, searchTerm, showSystemFallback, hasInteracted]);

    const handleCanvasMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
        // If we are already dragging something else, ignore
        if (dragState.type !== 'none') return;

        if (isSpacePressed || event.button === 1) {
            setHasInteracted(true);
            setDragState({
                type: 'pan',
                startX: event.clientX - pan.x,
                startY: event.clientY - pan.y
            });
            event.preventDefault();
        }
    };

    const handleNodeMouseDown = (event: React.MouseEvent<HTMLDivElement>, tableName: string) => {
        // Space + Mouse = Pan, so ignore node drag if space is pressed
        if (isSpacePressed) return;

        event.preventDefault();
        event.stopPropagation();
        
        setHasInteracted(true);
        setDragState({
            type: 'node',
            targetName: tableName,
            startX: event.clientX,
            startY: event.clientY,
            initialX: nodePositions[tableName]?.x || 0,
            initialY: nodePositions[tableName]?.y || 0,
        });
    };

    const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
        if (dragState.type === 'pan') {
            setPan({
                x: event.clientX - dragState.startX,
                y: event.clientY - dragState.startY,
            });
            return;
        }

        if (dragState.type === 'node' && dragState.targetName) {
            const dx = (event.clientX - dragState.startX) / scale;
            const dy = (event.clientY - dragState.startY) / scale;

            setNodePositions((current) => ({
                ...current,
                [dragState.targetName!]: {
                    x: (dragState.initialX || 0) + dx,
                    y: (dragState.initialY || 0) + dy,
                },
            }));
        }
    };

    const handleMouseUp = () => {
        setDragState({ type: 'none', startX: 0, startY: 0 });
        setHoveredTable(null);
    };

    const getColumnIcon = (type: string) => {
        const columnType = String(type || '').toLowerCase();
        if (columnType.includes('uuid')) return <Key size={10} className="text-primary" />;
        if (columnType.includes('int') || columnType.includes('num')) return <Hash size={10} className="text-blue-400" />;
        if (columnType.includes('bool')) return <ToggleLeft size={10} className="text-green-400" />;
        if (columnType.includes('time') || columnType.includes('date')) return <Calendar size={10} className="text-purple-400" />;
        if (columnType.includes('json')) return <FileJson size={10} className="text-orange-400" />;
        return <Type size={10} className="text-zinc-400" />;
    };

    const getColumnAnchorY = useCallback((tableName: string, columnName: string, fallbackOffset: number) => {
        const position = nodePositions[tableName];
        if (!position) {
            return 0;
        }

        const columnIndex = tableColumnIndexes[tableName]?.[columnName];
        if (typeof columnIndex !== 'number') {
            return position.y + fallbackOffset;
        }

        return position.y + TABLE_BASE_HEIGHT + (columnIndex * COLUMN_ROW_HEIGHT) + (COLUMN_ROW_HEIGHT / 2);
    }, [nodePositions, tableColumnIndexes]);

    const getRelationshipEndpoints = useCallback((relationship: any) => {
        const fromPos = nodePositions[relationship.from_table];
        const toPos = nodePositions[relationship.to_table];
        if (!fromPos || !toPos) {
            return null;
        }

        return {
            startX: fromPos.x + TABLE_WIDTH - 8,
            startY: getColumnAnchorY(relationship.from_table, relationship.from_col, 44),
            endX: toPos.x + 8,
            endY: getColumnAnchorY(relationship.to_table, relationship.to_col, 44),
        };
    }, [getColumnAnchorY, nodePositions]);

    const getPath = (relationship: any) => {
        const endpoints = getRelationshipEndpoints(relationship);
        if (!endpoints) {
            return '';
        }

        const { startX, startY, endX, endY } = endpoints;
        const direction = endX >= startX ? 1 : -1;
        const controlOffset = clamp(Math.max(Math.abs(endX - startX) * 0.36, 84), 84, 220) * direction;
        const controlPointX1 = startX + controlOffset;
        const controlPointX2 = endX - controlOffset;
        return `M ${startX} ${startY} C ${controlPointX1} ${startY}, ${controlPointX2} ${endY}, ${endX} ${endY}`;
    };

    const handleExportCSV = () => {
        if (!schema || !schema.tables) return;

        const headers = ['Table', 'Column', 'Type', 'Is Primary', 'Foreign Key Table', 'Foreign Key Column', 'Visual X', 'Visual Y'];
        const rows = [headers.join(',')];

        filteredTables.forEach((table: any) => {
            const position = nodePositions[table.name] || { x: 0, y: 0 };

            if (table.columns && table.columns.length > 0) {
                table.columns.forEach((column: any) => {
                    const relationship = (schema.relationships || []).find((rel: any) => rel.from_table === table.name && rel.from_col === column.name);
                    const row = [
                        table.name,
                        column.name,
                        column.type,
                        column.is_primary ? 'Yes' : 'No',
                        relationship ? relationship.to_table : '',
                        relationship ? relationship.to_col : '',
                        Math.round(position.x),
                        Math.round(position.y),
                    ];
                    rows.push(row.map((cell: any) => `"${String(cell).replace(/"/g, '""')}"`).join(','));
                });
            } else {
                const row = [table.name, '', '', '', '', '', Math.round(position.x), Math.round(position.y)];
                rows.push(row.map((cell: any) => `"${String(cell).replace(/"/g, '""')}"`).join(','));
            }
        });

        const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', 'ozybase_schema_layout.csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    if (loading) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-zinc-500">
                <Loader2 className="animate-spin text-primary" size={32} />
                <span className="text-xs font-bold uppercase tracking-widest">Generating Schema Map...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex h-full items-center justify-center gap-2 text-red-500">
                <Layers size={20} />
                <span className="text-sm font-medium">{error}</span>
            </div>
        );
    }

    return (
        <div className="relative flex h-full flex-col overflow-hidden bg-[#0a0a0a] font-sans text-zinc-300">
            <div className="absolute left-6 top-6 z-50 flex items-center gap-4 rounded-md border border-border bg-background p-2 shadow-2xl">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-700" size={12} />
                    <input
                        type="text"
                        placeholder="Search tables..."
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                        className="w-48 rounded-md border border-border bg-background py-1.5 pl-9 pr-3 text-[10px] text-white focus:border-primary/40 focus:outline-none uppercase font-bold tracking-widest placeholder:text-zinc-800"
                    />
                </div>
                <div className="h-4 w-px bg-border" />
                <div className="flex items-center gap-1">
                    <button onClick={() => setScale((current) => Math.max(current - 0.1, 0.25))} className="rounded-md p-1.5 text-zinc-500 hover:text-white transition-colors">
                        <ZoomOut size={14} />
                    </button>
                    <span className="w-10 text-center text-[9px] font-bold text-zinc-400 uppercase tracking-widest">{Math.round(scale * 100)}%</span>
                    <button onClick={() => setScale((current) => Math.min(current + 0.1, 2))} className="rounded-md p-1.5 text-zinc-500 hover:text-white transition-colors">
                        <ZoomIn size={14} />
                    </button>
                </div>
                <button
                    onClick={() => {
                        if (!schema || !schema.tables) return;
                        const nextPositions: Record<string, { x: number; y: number }> = {};
                        const cols = Math.max(Math.ceil(Math.sqrt(filteredTables.length)), 3);
                        const startX = 120;
                        const startY = 120;
                        const gapX = 360;
                        const gapY = 320;

                        filteredTables.forEach((table: any, index: number) => {
                            const row = Math.floor(index / cols);
                            const col = index % cols;
                            nextPositions[table.name] = {
                                x: startX + col * gapX,
                                y: startY + row * gapY,
                            };
                        });

                        setNodePositions(nextPositions);
                        setHasInteracted(true);
                    }}
                    title="Auto-arrange tables in grid"
                    className="h-8 flex items-center gap-2 rounded-md border border-border bg-zinc-900/40 px-3 text-[9px] font-bold text-zinc-400 uppercase tracking-widest hover:border-zinc-700 hover:text-white transition-all"
                >
                    <LayoutGrid size={12} className="text-primary" />
                    Auto-Layout
                </button>
                <button
                    onClick={() => {
                        setHasInteracted(false);
                        fitSchemaToViewport();
                    }}
                    className="h-8 flex items-center gap-2 rounded-md border border-border bg-zinc-900/40 px-3 text-[9px] font-bold text-zinc-400 uppercase tracking-widest hover:border-zinc-700 hover:text-white transition-all"
                >
                    <RefreshCw size={12} />
                    Fit
                </button>
                <button
                    onClick={() => setIsExportConfirmOpen(true)}
                    className="h-8 flex items-center gap-2 rounded-md border border-border bg-zinc-900/40 px-3 text-[9px] font-bold text-zinc-400 uppercase tracking-widest hover:border-zinc-700 hover:text-white transition-all"
                >
                    <FileSpreadsheet size={12} />
                    CSV
                </button>
                <button
                    onClick={() => {
                        window.open('/api/project/schema/types', '_blank');
                    }}
                    title="Export TypeScript Interfaces"
                    className="h-8 flex items-center gap-2 rounded-md border border-border bg-zinc-900/40 px-3 text-[9px] font-bold text-zinc-400 uppercase tracking-widest hover:border-zinc-700 hover:text-white transition-all"
                >
                    <FileCode size={12} className="text-blue-400" />
                    TS Types
                </button>
                {showSystemFallback && (
                    <span className="px-3 py-1 bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[9px] font-bold uppercase tracking-widest rounded-md">
                        System Schema
                    </span>
                )}
            </div>

            <div
                ref={containerRef}
                data-testid="schema-visualizer-canvas"
                className={`relative flex-1 select-none overflow-hidden transition-colors duration-200 ${isSpacePressed ? (dragState.type === 'pan' ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'}`}
                onMouseDown={handleCanvasMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                style={{
                    backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.05) 1px, transparent 0)',
                    backgroundSize: `${32 * scale}px ${32 * scale}px`,
                    backgroundPosition: `${pan.x}px ${pan.y}px`,
                    userSelect: 'none',
                }}
            >
                <div
                    className={`absolute left-0 top-0 h-full w-full origin-top-left will-change-transform ${
                        dragState.type !== 'none' ? 'transition-none' : 'transition-transform duration-75 ease-out'
                    }`}
                    style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
                >
                    <svg className="pointer-events-none absolute left-0 top-0 z-0 h-1250 w-1250">
                        {filteredRelationships.map((relationship: any, index: number) => {
                            const endpoints = getRelationshipEndpoints(relationship);
                            if (!endpoints) {
                                return null;
                            }

                            const isRelated = activeTable === relationship.from_table || activeTable === relationship.to_table;
                            return (
                                <g
                                    key={`${relationship.from_table}-${relationship.to_table}-${relationship.from_col}-${relationship.to_col}-${index}`}
                                    style={{ opacity: activeTable && !isRelated ? 0.18 : 1 }}
                                >
                                    <path
                                        data-testid="schema-relationship-path"
                                        d={getPath(relationship)}
                                        stroke={isRelated ? '#F2F200' : '#5c6470'}
                                        strokeWidth={isRelated ? '2.8' : '1.9'}
                                        fill="none"
                                        markerEnd={`url(#${isRelated ? 'arrowhead-active' : 'arrowhead-default'})`}
                                        className="transition-all duration-300"
                                    />
                                    <circle cx={endpoints.startX} cy={endpoints.startY} r={isRelated ? '3.4' : '2.6'} fill={isRelated ? '#F2F200' : '#7c8491'} />
                                    <circle cx={endpoints.endX} cy={endpoints.endY} r={isRelated ? '3.4' : '2.6'} fill={isRelated ? '#F2F200' : '#7c8491'} />
                                </g>
                            );
                        })}
                        <defs>
                            <marker id="arrowhead-default" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                                <polygon points="0 0, 10 3.5, 0 7" fill="#5c6470" />
                            </marker>
                            <marker id="arrowhead-active" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                                <polygon points="0 0, 10 3.5, 0 7" fill="#F2F200" />
                            </marker>
                        </defs>
                    </svg>

                    {filteredTables.map((table: any) => {
                        const position = nodePositions[table.name] || { x: 0, y: 0 };
                        const isHovered = activeTable === table.name;
                        const isDraggingCurrent = dragState.type === 'node' && dragState.targetName === table.name;
                        const isMatch = searchTerm && table.name.toLowerCase().includes(searchTerm.toLowerCase());

                        return (
                            <div
                                key={table.name}
                                data-testid={`schema-table-card-${table.name}`}
                                onMouseDown={(event) => handleNodeMouseDown(event, table.name)}
                                onMouseEnter={() => { if (dragState.type === 'none') setHoveredTable(table.name); }}
                                onMouseLeave={() => { if (dragState.type === 'none') setHoveredTable(null); }}
                                onDragStart={(event) => event.preventDefault()}
                                style={{
                                    transform: `translate(${position.x}px, ${position.y}px)`,
                                    width: `${TABLE_WIDTH}px`,
                                    zIndex: isHovered || isMatch ? 100 : 10,
                                }}
                                className={`absolute select-none rounded-md border bg-background shadow-2xl ${
                                    isDraggingCurrent ? 'transition-none' : 'transition-all duration-200'
                                } ${
                                    table.is_system
                                        ? (isDraggingCurrent ? 'border-amber-500/40' : isHovered ? 'border-amber-500/60' : 'border-amber-900/20 opacity-80')
                                        : (isDraggingCurrent ? 'border-primary/40' : isHovered ? 'border-primary' : 'border-border')
                                } ${isMatch ? 'ring-1 ring-primary ring-offset-2 ring-offset-[#0a0a0a]' : ''} ${activeTable && !isHovered ? 'opacity-30' : 'opacity-100'}`}
                            >
                                <div
                                    className={`flex items-center justify-between rounded-t-md border-b px-4 py-2 ${
                                        isDraggingCurrent ? 'cursor-grabbing' : isSpacePressed ? 'cursor-grab' : 'cursor-move'
                                    } ${
                                        table.is_system
                                            ? (isHovered ? 'border-amber-900/40 bg-amber-900/10' : 'border-amber-900/10 bg-amber-950/20')
                                            : (isHovered ? 'border-primary/20 bg-primary/5' : 'border-border bg-zinc-900/20')
                                    }`}
                                >
                                    <div className="flex items-center gap-2">
                                        {table.is_system ? (
                                            <Lock size={10} className="text-amber-700" />
                                        ) : (
                                            <Database size={12} className={isHovered ? 'text-primary' : 'text-zinc-500'} />
                                        )}
                                        <span className={`text-[10px] font-bold uppercase tracking-tight ${isHovered ? 'text-white' : (table.is_system ? 'text-amber-800' : 'text-zinc-400')}`}>
                                            {table.name}
                                        </span>
                                    </div>
                                    <div className={`flex items-center gap-1.5 rounded-md border bg-background px-1.5 py-0.5 ${table.is_system ? 'border-amber-900/20' : 'border-border'}`}>
                                        <div className={`h-1 w-1 rounded-full ${table.is_system ? 'bg-amber-600' : 'bg-emerald-500'}`} />
                                        <span className={`text-[7px] font-bold uppercase tracking-widest ${table.is_system ? 'text-amber-600' : 'text-zinc-600'}`}>
                                            {table.is_system ? 'System' : 'Public'}
                                        </span>
                                    </div>
                                </div>
                                <div className="p-2 space-y-0.5">
                                    {(table.columns || []).map((column: any, index: number) => (
                                         <div key={`${table.name}-${column.name}-${index}`} className={`group/col flex select-none items-center justify-between rounded-md px-2 py-1 text-[9px] transition-colors hover:bg-zinc-900/60 ${
                                             relationshipColumns[table.name]?.[column.name] ? 'bg-zinc-900/20' : ''
                                         }`}>
                                             <div className="flex items-center gap-2">
                                                 <div className="flex w-3 justify-center">
                                                     {column.name === 'id' || column.is_primary ? (
                                                         <Key size={10} className="text-primary" />
                                                     ) : getColumnIcon(column.type)}
                                                 </div>
                                                 <span className={`font-mono font-bold tracking-tight ${column.name === 'id' || column.is_primary ? 'text-primary' : 'text-zinc-500'}`}>
                                                     {column.name}
                                                 </span>
                                             </div>
                                             <div className="flex items-center gap-2">
                                                 {relationshipColumns[table.name]?.[column.name] ? (
                                                     <Link
                                                         size={9}
                                                         className={relationshipColumns[table.name]?.[column.name]?.outgoing?.length ? 'text-primary' : 'text-emerald-600'}
                                                     />
                                                 ) : null}
                                                 <span className="font-mono text-[7px] uppercase text-zinc-700">
                                                     {column.type}
                                                 </span>
                                             </div>
                                         </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="pointer-events-none absolute bottom-6 left-6 z-40 rounded-md border border-border bg-background p-3 text-[9px] font-bold text-zinc-600 uppercase tracking-widest">
                    <div className="flex items-center gap-2">
                        <Move size={12} className="text-primary" />
                        Space + Drag to pan • Drag cards to arrange • Ctrl + Scroll to zoom
                    </div>
                </div>

                {filteredTables.length === 0 ? (
                    <div className="absolute inset-0 z-30 flex items-center justify-center p-6">
                        <div
                            data-testid="schema-visualizer-empty"
                            className="max-w-md rounded-md border border-border bg-background p-8 text-center shadow-2xl"
                        >
                            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md border border-primary/20 bg-primary/5 text-primary">
                                <Layers size={24} />
                            </div>
                            <h3 className="mt-4 text-lg font-bold text-white uppercase tracking-tight">
                                {searchTerm ? 'No matches' : 'Empty Schema'}
                            </h3>
                            <p className="mt-2 text-[10px] font-bold text-zinc-600 uppercase tracking-widest leading-relaxed">
                                {searchTerm ? 'Adjust your search parameters' : 'Create collections in the table editor to visualize them.'}
                            </p>
                        </div>
                    </div>
                ) : null}
            </div>

            <div className="z-50 flex h-9 items-center justify-center gap-6 border-t border-border bg-background text-[9px] font-bold text-zinc-700 uppercase tracking-widest">
                <div className="flex items-center gap-2"><Key size={10} className="text-primary" /> Primary</div>
                <div className="flex items-center gap-2"><Link size={10} className="text-zinc-700" /> Foreign</div>
                <div className="flex items-center gap-2"><Hash size={10} className="text-blue-500" /> Number</div>
                <div className="flex items-center gap-2"><Type size={10} className="text-zinc-600" /> Text</div>
                <div className="flex items-center gap-2"><Calendar size={10} className="text-purple-500" /> Date</div>
            </div>

            <ConfirmModal
                isOpen={isExportConfirmOpen}
                onClose={() => setIsExportConfirmOpen(false)}
                onConfirm={handleExportCSV}
                title="Export Schema Layout"
                message="Download a CSV file containing your current schema structure, including table relationships and visual positions? This can be used for documentation or backups."
                confirmText="Export CSV"
                type="info"
            />
        </div>
    );
};

export default SchemaVisualizer;


