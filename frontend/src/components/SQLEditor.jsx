import React, { useState } from 'react';
import {
    Terminal,
    Play,
    Save,
    History,
    Database,
    Search,
    ChevronRight,
    Loader2,
    CheckCircle2,
    XCircle,
    Copy,
    Trash2,
    Download,
    Plus
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

const SQLEditor = () => {
    const [query, setQuery] = useState('SELECT * FROM users LIMIT 10;');
    const [results, setResults] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [history, setHistory] = useState([
        'SELECT email FROM users WHERE is_verified = true;',
        'INSERT INTO users (email, username) VALUES (\'test@ozybase.io\', \'ozytest\');',
        'SELECT COUNT(*) FROM information_schema.tables;'
    ]);

    const runQuery = async () => {
        setLoading(true);
        setError(null);
        try {
            // This would call a generic SQL endpoint on the OzyBase backend
            // For now we'll simulate it using the existing table endpoints or throw a mock
            const res = await fetchWithAuth('/api/sql', {
                method: 'POST',
                body: JSON.stringify({ query })
            });

            if (res.status === 404) {
                // Endpoint not yet implemented in backend, return mock
                setTimeout(() => {
                    setResults({
                        columns: ['id', 'email', 'status', 'created_at'],
                        rows: [
                            ['550e8400-e29b...', 'admin@ozybase.local', 'ACTIVE', '2026-01-26 12:00:00'],
                            ['412b1200-c11a...', 'dev@ozybase.local', 'PENDING', '2026-01-26 12:30:00']
                        ],
                        rowCount: 2,
                        executionTime: '24ms'
                    });
                    setLoading(false);
                }, 600);
                return;
            }

            const data = await res.json();
            setResults(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex h-full bg-[#111111] animate-in fade-in duration-500 overflow-hidden">


            {/* Editor Area */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* Toolbar */}
                <div className="h-12 border-b border-[#2e2e2e] bg-[#1a1a1a] flex items-center justify-between px-6">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 px-3 py-1 bg-[#111111] border border-[#2e2e2e] rounded-lg">
                            <Database size={12} className="text-primary" />
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Production DB</span>
                        </div>
                        <button
                            onClick={runQuery}
                            disabled={loading}
                            className="flex items-center gap-2 bg-primary text-black px-5 py-1.5 rounded-lg font-black text-[10px] uppercase tracking-widest hover:bg-[#E6E600] active:scale-95 transition-all shadow-[0_0_20px_rgba(254,254,0,0.1)] py-2"
                        >
                            {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} fill="currentColor" />}
                            Run Query
                        </button>
                    </div>
                    <div className="flex items-center gap-3">
                        <button className="p-2 text-zinc-600 hover:text-zinc-200 transition-colors"><Save size={16} /></button>
                        <div className="h-4 w-[1px] bg-[#2e2e2e]" />
                        <button className="p-2 text-zinc-600 hover:text-zinc-200 transition-colors"><Copy size={16} /></button>
                        <button className="p-2 text-zinc-600 hover:text-red-500 transition-colors"><Trash2 size={16} /></button>
                    </div>
                </div>

                {/* SQL Input (Mock Monaco/Textarea) */}
                <div className="flex-1 relative flex flex-col overflow-hidden">
                    <div className="absolute left-0 top-0 bottom-0 w-12 bg-[#0c0c0c] border-r border-[#2e2e2e] flex flex-col items-center pt-4 select-none">
                        {[...Array(20)].map((_, i) => (
                            <span key={i} className="text-[10px] font-mono text-zinc-800 leading-[1.8]">{i + 1}</span>
                        ))}
                    </div>
                    <textarea
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        spellCheck="false"
                        className="flex-1 bg-[#111111] pl-16 pr-6 pt-4 font-mono text-sm text-primary leading-[1.8] focus:outline-none resize-none selection:bg-zinc-800"
                    />
                </div>

                {/* Results Panel */}
                <div className="h-1/3 border-t border-[#2e2e2e] bg-[#1a1a1a] flex flex-col">
                    <div className="h-10 border-b border-[#2e2e2e] flex items-center justify-between px-6 bg-[#111111]">
                        <div className="flex items-center gap-4">
                            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Query Results</span>
                            {results && (
                                <div className="flex items-center gap-4 border-l border-zinc-800 pl-4">
                                    <span className="text-[9px] font-bold text-green-500 uppercase tracking-widest flex items-center gap-1.5 font-mono">
                                        <CheckCircle2 size={10} />
                                        Success ({results.rowCount} rows)
                                    </span>
                                    <span className="text-[9px] font-bold text-zinc-600 tracking-widest font-mono">EXEC: {results.executionTime}</span>
                                </div>
                            )}
                        </div>
                        <button className="flex items-center gap-2 text-[9px] font-bold text-zinc-500 hover:text-white uppercase tracking-widest">
                            <Download size={12} />
                            Export Data
                        </button>
                    </div>

                    <div className="flex-1 overflow-auto custom-scrollbar">
                        {loading ? (
                            <div className="flex flex-col items-center justify-center h-full gap-4">
                                <Loader2 className="animate-spin text-primary" size={24} />
                                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600 animate-pulse">Consulting the Oracle...</span>
                            </div>
                        ) : error ? (
                            <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
                                <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-500">
                                    <XCircle size={24} />
                                </div>
                                <div>
                                    <p className="text-[10px] font-black text-red-500 uppercase tracking-widest mb-1">Syntax Error or Connection Failure</p>
                                    <p className="text-xs text-zinc-500 font-mono tracking-tight">{error}</p>
                                </div>
                            </div>
                        ) : results ? (
                            <table className="w-full text-left border-collapse">
                                <thead className="sticky top-0 bg-[#0c0c0c] z-10 border-b border-[#2e2e2e]">
                                    <tr>
                                        {results.columns?.map(col => (
                                            <th key={col} className="px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-zinc-500 border-r border-[#2e2e2e]/30">
                                                {col}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#2e2e2e]/50">
                                    {results.rows?.map((row, i) => (
                                        <tr key={i} className="hover:bg-zinc-900 transition-colors">
                                            {row.map((val, cellIdx) => (
                                                <td key={cellIdx} className="px-6 py-3 text-xs font-mono text-zinc-400 border-r border-[#2e2e2e]/30">
                                                    {val}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full gap-2">
                                <Play size={24} className="text-zinc-800" />
                                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600">Run a query to see results</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SQLEditor;
