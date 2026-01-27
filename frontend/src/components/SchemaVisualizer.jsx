import React, { useEffect, useState, useRef } from 'react';
import { fetchWithAuth } from '../utils/api';
import {
    Database,
    ZoomIn,
    ZoomOut,
    RefreshCw,
    Code,
    Download,
    Layers,
    Key,
    Link,
    Hash,
    Calendar,
    ToggleLeft,
    Type,
    FileJson,
    Loader2
} from 'lucide-react';

const SchemaVisualizer = () => {
    const [schema, setSchema] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [scale, setScale] = useState(1);
    const containerRef = useRef(null);

    // Simple state for drag and drop
    const [nodePositions, setNodePositions] = useState({});
    const [isDragging, setIsDragging] = useState(false);
    const [dragNode, setDragNode] = useState(null);

    const fetchData = async () => {
        setLoading(true);
        try {
            const res = await fetchWithAuth('/api/collections/visualize');
            if (!res.ok) throw new Error('Failed to fetch schema');
            const data = await res.json();

            // Calculate initial positions (grid layout)
            const positions = {};
            const cols = 3;
            const xGap = 350;
            const yGap = 400; // More vertical space for tall tables

            data.tables.forEach((table, i) => {
                const col = i % cols;
                const row = Math.floor(i / cols);
                positions[table.name] = {
                    x: 100 + (col * xGap),
                    y: 100 + (row * yGap)
                };
            });

            setNodePositions(positions);
            setSchema(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const handleWheel = (e) => {
        if (e.ctrlKey) {
            e.preventDefault();
            const delta = e.deltaY * -0.001;
            setScale(prev => Math.min(Math.max(prev + delta, 0.2), 2));
        }
    };

    const handleMouseDown = (e, tableName) => {
        setIsDragging(true);
        setDragNode({
            name: tableName,
            startX: e.clientX,
            startY: e.clientY,
            initialX: nodePositions[tableName].x,
            initialY: nodePositions[tableName].y
        });
    };

    const handleMouseMove = (e) => {
        if (isDragging && dragNode) {
            const dx = (e.clientX - dragNode.startX) / scale;
            const dy = (e.clientY - dragNode.startY) / scale;

            setNodePositions(prev => ({
                ...prev,
                [dragNode.name]: {
                    x: dragNode.initialX + dx,
                    y: dragNode.initialY + dy
                }
            }));
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
        setDragNode(null);
    };

    const getColumnIcon = (type) => {
        const t = (type || '').toLowerCase();
        if (t.includes('uuid')) return <Key size={10} className="text-yellow-500" />;
        if (t.includes('int') || t.includes('num')) return <Hash size={10} className="text-blue-400" />;
        if (t.includes('bool')) return <ToggleLeft size={10} className="text-green-400" />;
        if (t.includes('time') || t.includes('date')) return <Calendar size={10} className="text-purple-400" />;
        if (t.includes('json')) return <FileJson size={10} className="text-orange-400" />;
        return <Type size={10} className="text-zinc-400" />;
    };

    // Calculate path for relationship lines
    const getPath = (rel) => {
        const fromPos = nodePositions[rel.from_table];
        const toPos = nodePositions[rel.to_table];

        if (!fromPos || !toPos) return '';

        // Simple bezier curve
        // We assume connection points are roughly middle of table cards width-wise
        const startX = fromPos.x + 280; // Right side of source
        const startY = fromPos.y + 40;  // Approximate row height
        const endX = toPos.x;           // Left side of target
        const endY = toPos.y + 40;

        const deltaX = Math.abs(endX - startX) * 0.5;

        return `M ${startX} ${startY} C ${startX + deltaX} ${startY}, ${endX - deltaX} ${endY}, ${endX} ${endY}`;
    };

    if (loading) return (
        <div className="flex flex-col items-center justify-center h-full gap-4 text-zinc-500">
            <Loader2 className="animate-spin text-primary" size={32} />
            <span className="text-xs font-bold uppercase tracking-widest">Generating Schema Map...</span>
        </div>
    );

    if (error) return (
        <div className="flex items-center justify-center h-full text-red-500 gap-2">
            <Layers size={20} />
            <span className="text-sm font-medium">{error}</span>
        </div>
    );

    return (
        <div className="flex flex-col h-full bg-[#0c0c0c] overflow-hidden text-zinc-300 font-sans relative">
            {/* Toolbar */}
            <div className="absolute top-4 right-4 z-50 flex items-center gap-2 bg-[#1a1a1a] border border-[#2e2e2e] p-1 rounded-lg shadow-xl">
                <button onClick={fetchData} className="p-2 hover:bg-zinc-800 rounded transition-colors text-zinc-400 hover:text-white" title="Refresh">
                    <RefreshCw size={16} />
                </button>
                <div className="w-[1px] h-4 bg-[#2e2e2e]" />
                <button onClick={() => setScale(s => Math.min(s + 0.1, 2))} className="p-2 hover:bg-zinc-800 rounded transition-colors text-zinc-400 hover:text-white" title="Zoom In">
                    <ZoomIn size={16} />
                </button>
                <span className="text-[10px] w-8 text-center font-mono text-zinc-500">{Math.round(scale * 100)}%</span>
                <button onClick={() => setScale(s => Math.max(s - 0.1, 0.2))} className="p-2 hover:bg-zinc-800 rounded transition-colors text-zinc-400 hover:text-white" title="Zoom Out">
                    <ZoomOut size={16} />
                </button>
                <div className="w-[1px] h-4 bg-[#2e2e2e]" />
                <button className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800 rounded transition-colors text-zinc-400 hover:text-white text-xs font-bold uppercase tracking-widest">
                    <Code size={14} /> SQL
                </button>
                <button className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800 rounded transition-colors text-zinc-400 hover:text-white text-xs font-bold uppercase tracking-widest">
                    <Download size={14} /> Auto layout
                </button>
            </div>

            {/* Canvas */}
            <div
                ref={containerRef}
                className="flex-1 overflow-hidden cursor-grab active:cursor-grabbing relative"
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                style={{
                    backgroundImage: 'radial-gradient(#2e2e2e 1px, transparent 1px)',
                    backgroundSize: `${20 * scale}px ${20 * scale}px`
                }}
            >
                <div
                    className="absolute top-0 left-0 w-full h-full transform-origin-top-left transition-transform duration-75 ease-out"
                    style={{ transform: `scale(${scale})` }}
                >
                    <svg className="absolute top-0 left-0 w-[5000px] h-[5000px] pointer-events-none z-0">
                        {(schema.relationships || []).map((rel, i) => (
                            <path
                                key={i}
                                d={getPath(rel)}
                                stroke="#2e2e2e"
                                strokeWidth="2"
                                fill="none"
                                markerEnd="url(#arrowhead)"
                            />
                        ))}
                        <defs>
                            <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                                <polygon points="0 0, 10 3.5, 0 7" fill="#525252" />
                            </marker>
                        </defs>
                    </svg>

                    {(schema.tables || []).map((table) => {
                        const pos = nodePositions[table.name] || { x: 0, y: 0 };
                        return (
                            <div
                                key={table.name}
                                onMouseDown={(e) => handleMouseDown(e, table.name)}
                                style={{
                                    transform: `translate(${pos.x}px, ${pos.y}px)`,
                                    width: '280px'
                                }}
                                className="absolute bg-[#111111] border border-[#2e2e2e] rounded-lg shadow-2xl z-10 group hover:border-zinc-500 transition-colors"
                            >
                                {/* Header */}
                                <div className="px-3 py-2 border-b border-[#2e2e2e] bg-[#1a1a1a] rounded-t-lg flex items-center justify-between cursor-move">
                                    <div className="flex items-center gap-2">
                                        <Database size={12} className="text-zinc-500" />
                                        <span className="text-xs font-bold text-zinc-100">{table.name}</span>
                                    </div>
                                    <span className="text-[9px] text-zinc-600 font-mono">public</span>
                                </div>

                                {/* Columns */}
                                <div className="p-2 space-y-1">
                                    {(table.columns || []).map((col, i) => (
                                        <div key={i} className="flex items-center justify-between text-[11px] px-2 py-1 rounded hover:bg-zinc-800/50 group/col">
                                            <div className="flex items-center gap-2">
                                                {col.name === 'id' || col.is_primary ? (
                                                    <Key size={10} className="text-primary" />
                                                ) : getColumnIcon(col.type)}
                                                <span className={`font-mono text-zinc-400 ${(col.name === 'id' || col.is_primary) ? 'text-primary font-bold' : ''}`}>
                                                    {col.name}
                                                </span>
                                            </div>
                                            <span className="text-zinc-600 font-mono text-[9px] group-hover/col:text-zinc-500">
                                                {col.type}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Legend Footer */}
            <div className="h-8 bg-[#111111] border-t border-[#2e2e2e] flex items-center justify-center gap-6 text-[10px] font-mono text-zinc-500 z-50">
                <div className="flex items-center gap-2"><Key size={12} className="text-primary" /> Primary Key</div>
                <div className="flex items-center gap-2"><Link size={12} className="text-zinc-500" /> Foreign Key</div>
                <div className="flex items-center gap-2"><Hash size={12} className="text-blue-400" /> Number</div>
                <div className="flex items-center gap-2"><Type size={12} className="text-zinc-400" /> Text</div>
                <div className="flex items-center gap-2"><Calendar size={12} className="text-purple-400" /> Date</div>
            </div>
        </div>
    );
};

export default SchemaVisualizer;
