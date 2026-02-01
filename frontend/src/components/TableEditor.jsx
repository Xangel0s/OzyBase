import React, { useEffect, useState } from 'react';
import {
    Key,
    AtSign,
    Calendar,
    User,
    CheckCircle2,
    Plus,
    Filter,
    ArrowUpDown,
    Columns3,
    Search,
    RefreshCw,
    Code2,
    Download,
    Hash,
    Database,
    Trash2,
    Edit2,
    Upload,
    FileUp,
    ChevronRight,
    ChevronDown,
    ListPlus
} from 'lucide-react';

import AddRowModal from './AddRowModal';
import AddColumnModal from './AddColumnModal';
import { fetchWithAuth } from '../utils/api';

const TableEditor = ({ tableName }) => {
    const [data, setData] = useState([]);
    const [schema, setSchema] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isColumnModalOpen, setIsColumnModalOpen] = useState(false);
    const [isInsertDropdownOpen, setIsInsertDropdownOpen] = useState(false);
    const [editingRow, setEditingRow] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');

    const fetchData = async () => {
        setLoading(true);
        try {
            // Step A: Fetch Schema (Introspection)
            const schemaRes = await fetchWithAuth(`/api/schema/${tableName}`);
            if (!schemaRes.ok) throw new Error(`Table '${tableName}' schema lookup failed`);
            const schemaItems = await schemaRes.json();

            // Step B: Fetch Data
            const dataRes = await fetchWithAuth(`/api/tables/${tableName}`);
            if (!dataRes.ok) throw new Error('Failed to fetch data');
            const result = await dataRes.json();

            setSchema(schemaItems);
            setData(result);
            setError(null);
        } catch (err) {
            console.error(err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleCSVImport = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            const text = event.target.result;
            const lines = text.split('\n');
            const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
            const records = [];

            for (let i = 1; i < lines.length; i++) {
                if (!lines[i].trim()) continue;
                const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
                const record = {};
                headers.forEach((header, index) => {
                    record[header] = values[index];
                });
                records.push(record);
            }

            try {
                setLoading(true);
                const res = await fetchWithAuth(`/api/tables/${tableName}/import`, {
                    method: 'POST',
                    body: JSON.stringify(records)
                });
                if (res.ok) {
                    alert('Imported successfully!');
                    fetchData();
                } else {
                    const err = await res.json();
                    alert(`Error: ${err.error}`);
                }
            } catch (err) {
                alert('Import failed');
            } finally {
                setLoading(false);
                setIsInsertDropdownOpen(false);
            }
        };
        reader.readAsText(file);
    };

    const handleDeleteRow = async (id) => {
        if (!window.confirm('Are you sure you want to delete this row?')) return;

        try {
            const res = await fetchWithAuth(`/api/tables/${tableName}/rows/${id}`, {
                method: 'DELETE'
            });
            if (res.ok) {
                fetchData();
            } else {
                alert('Failed to delete row');
            }
        } catch (err) {
            console.error(err);
        }
    };

    const handleExportCSV = () => {
        if (data.length === 0) return;

        const headers = ['id', ...schema.map(c => c.name), 'created_at'];
        const csvRows = [
            headers.join(','),
            ...data.map(row => headers.map(h => {
                const val = row[h];
                return typeof val === 'string' ? `"${val.replace(/"/g, '""')}"` : val;
            }).join(','))
        ];

        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${tableName}_export.csv`;
        a.click();
    };

    const filteredData = data.filter(row => {
        if (!searchTerm) return true;
        return Object.values(row).some(val =>
            String(val).toLowerCase().includes(searchTerm.toLowerCase())
        );
    });

    const handleEditRow = (row) => {
        setEditingRow(row);
        setIsModalOpen(true);
    };

    useEffect(() => {
        if (tableName) {
            fetchData();
        }
    }, [tableName]);

    const getTypeIcon = (type) => {
        const t = (type || 'text').toLowerCase();
        if (t.includes('uuid')) return <Key size={14} className="text-primary" />;
        if (t.includes('text') || t.includes('char')) return <AtSign size={14} className="text-primary" />;
        if (t.includes('time') || t.includes('date')) return <Calendar size={14} className="text-primary" />;
        if (t.includes('bool')) return <CheckCircle2 size={14} className="text-primary" />;
        if (t.includes('num') || t.includes('int') || t.includes('float')) return <Hash size={14} className="text-primary" />;
        return <Database size={14} className="text-primary" />;
    };

    // Standard columns for display
    const standardColumns = [
        { name: 'id', type: 'uuid' },
        ...schema,
        { name: 'created_at', type: 'datetime' }
    ];

    const SkeletonRow = () => (
        <tr className="border-b border-[#2e2e2e]/50">
            <td className="px-4 py-4 w-10"><div className="w-4 h-4 bg-zinc-800 rounded animate-pulse" /></td>
            {standardColumns.map((_, i) => (
                <td key={i} className="px-4 py-4">
                    <div className="h-4 bg-zinc-800 rounded animate-pulse w-full max-w-[120px]" />
                </td>
            ))}
        </tr>
    );

    return (
        <div className="flex flex-col h-full text-zinc-400 font-sans animate-in fade-in duration-500">
            {/* Table Toolbar */}
            <div className="flex items-center justify-between px-6 py-3 border-b border-[#2e2e2e] bg-[#1a1a1a]">
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <button
                            onClick={() => setIsInsertDropdownOpen(!isInsertDropdownOpen)}
                            className="flex items-center gap-2 bg-primary text-black px-4 py-1.5 rounded-lg font-bold text-xs uppercase tracking-widest hover:bg-[#E6E600] transition-all transform active:scale-95 shadow-[0_0_20px_rgba(254,254,0,0.15)]"
                        >
                            <Plus size={14} strokeWidth={3} />
                            Insert
                            <ChevronDown size={14} className={`transition-transform duration-200 ${isInsertDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {isInsertDropdownOpen && (
                            <>
                                <div
                                    className="fixed inset-0 z-40 outline-none"
                                    onClick={() => setIsInsertDropdownOpen(false)}
                                />
                                <div className="absolute top-full left-0 mt-2 w-56 bg-[#1a1a1a] border border-[#2e2e2e] rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                                    <div className="p-1.5 space-y-0.5">
                                        <button
                                            onClick={() => { setEditingRow(null); setIsModalOpen(true); setIsInsertDropdownOpen(false); }}
                                            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-bold text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all group"
                                        >
                                            <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0 group-hover:border-primary/50 transition-colors">
                                                <ListPlus size={16} className="text-zinc-500 group-hover:text-primary" />
                                            </div>
                                            <div className="flex flex-col text-left">
                                                <span className="uppercase tracking-wide">Insert Row</span>
                                                <span className="text-[9px] text-zinc-600">Add a new record</span>
                                            </div>
                                            <ChevronRight size={14} className="ml-auto text-zinc-700" />
                                        </button>

                                        <button
                                            onClick={() => { setIsColumnModalOpen(true); setIsInsertDropdownOpen(false); }}
                                            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-bold text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all group"
                                        >
                                            <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0 group-hover:border-primary/50 transition-colors">
                                                <Database size={16} className="text-zinc-500 group-hover:text-primary" />
                                            </div>
                                            <div className="flex flex-col text-left">
                                                <span className="uppercase tracking-wide">Insert Column</span>
                                                <span className="text-[9px] text-zinc-600">Add a new field</span>
                                            </div>
                                            <ChevronRight size={14} className="ml-auto text-zinc-700" />
                                        </button>

                                        <div className="h-[1px] bg-[#2e2e2e] my-1 mx-2" />

                                        <label className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-bold text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all group cursor-pointer">
                                            <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0 group-hover:border-primary/50 transition-colors">
                                                <FileUp size={16} className="text-zinc-500 group-hover:text-primary" />
                                            </div>
                                            <div className="flex flex-col text-left text-zinc-400">
                                                <span className="uppercase tracking-wide">Import CSV</span>
                                                <span className="text-[9px] text-zinc-600">Upload bulk data</span>
                                            </div>
                                            <input
                                                type="file"
                                                accept=".csv"
                                                onChange={handleCSVImport}
                                                className="hidden"
                                            />
                                            <ChevronRight size={14} className="ml-auto text-zinc-700" />
                                        </label>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>

                    <div className="h-4 w-[1px] bg-[#2e2e2e] mx-2" />
                    <button className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800/50 rounded-md transition-colors text-[10px] font-bold uppercase tracking-widest text-zinc-500 hover:text-zinc-200">
                        <Filter size={14} />
                        Filter
                    </button>
                    <button className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800 rounded-md transition-colors text-sm text-zinc-500">
                        <ArrowUpDown size={16} />
                        Sort
                    </button>
                    <button
                        onClick={() => setIsColumnModalOpen(true)}
                        className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800 rounded-md transition-colors text-sm text-zinc-300 border border-zinc-800 hover:border-zinc-700 bg-zinc-900/40"
                    >
                        <Columns3 size={16} />
                        Columns
                    </button>
                </div>


                <div className="flex items-center gap-3">
                    <div className="relative group">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 group-focus-within:text-primary transition-colors" size={14} />
                        <input
                            type="text"
                            placeholder="Search records..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="bg-[#111111] border border-[#2e2e2e] rounded-lg pl-9 pr-4 py-1.5 text-xs focus:outline-none focus:border-primary/50 w-64 text-zinc-200 placeholder:text-zinc-700 transition-all focus:ring-1 focus:ring-primary/10"
                        />
                    </div>
                    <button
                        onClick={fetchData}
                        disabled={loading}
                        className="p-2 border border-[#2e2e2e] rounded-lg hover:bg-zinc-800 transition-colors disabled:opacity-50 group"
                    >
                        <RefreshCw size={14} className={`${loading ? "animate-spin text-primary" : "text-zinc-500 group-hover:text-zinc-200"}`} />
                    </button>
                </div>
            </div>

            {/* Table Content */}
            <div className="flex-1 overflow-auto bg-[#171717] custom-scrollbar">
                <table className="w-full border-collapse table-fixed">
                    <thead className="sticky top-0 bg-[#111111] z-10 border-b border-[#2e2e2e]">
                        <tr>
                            <th className="w-10 px-4 py-3 text-left">
                                <input type="checkbox" className="rounded border-border bg-transparent accent-primary" />
                            </th>
                            {standardColumns.map((col) => (
                                <th key={col.name} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.2em] whitespace-nowrap overflow-hidden">
                                    <div className="flex items-center gap-2 text-zinc-600 border-r border-[#2e2e2e]/50 pr-4">
                                        {getTypeIcon(col.type)}
                                        <span className="truncate">{col.name}</span>
                                    </div>
                                </th>
                            ))}
                            <th className="w-24 px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-600">
                                Actions
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#2e2e2e]/50">
                        {loading && data.length === 0 ? (
                            [...Array(10)].map((_, i) => <SkeletonRow key={i} />)
                        ) : error ? (
                            <tr>
                                <td colSpan={standardColumns.length + 2} className="py-32 text-center">
                                    <div className="max-w-xs mx-auto space-y-4">
                                        <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto text-red-500">
                                            <Code2 size={24} />
                                        </div>
                                        <p className="text-red-500/70 uppercase tracking-widest font-black text-[10px]">
                                            API Error: {error}
                                        </p>
                                    </div>
                                </td>
                            </tr>
                        ) : filteredData.length === 0 ? (
                            <tr>
                                <td colSpan={standardColumns.length + 2} className="py-40 text-center">
                                    <div className="max-w-xs mx-auto space-y-6">
                                        <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-[#2e2e2e] flex items-center justify-center mx-auto text-zinc-700 shadow-xl">
                                            <Database size={32} strokeWidth={1.5} />
                                        </div>
                                        <div className="space-y-2">
                                            <h4 className="text-zinc-300 font-bold text-sm uppercase tracking-widest">No records found</h4>
                                            <p className="text-zinc-600 text-xs tracking-tight">Try adjusting your search or add your first row.</p>
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            filteredData.map((row) => (
                                <tr key={row.id} className="hover:bg-zinc-900/30 transition-colors group cursor-cell border-b border-[#2e2e2e]/30">
                                    <td className="px-4 py-3">
                                        <input type="checkbox" className="rounded border-border bg-transparent accent-primary" />
                                    </td>
                                    {standardColumns.map((col) => {
                                        const val = row[col.name];
                                        return (
                                            <td key={col.name} className="px-4 py-3 truncate text-xs">
                                                {col.type === 'uuid' ? (
                                                    <span className="font-mono text-[11px] text-zinc-500 group-hover:text-zinc-300">
                                                        {val}
                                                    </span>
                                                ) : col.type === 'boolean' || col.type === 'bool' ? (
                                                    val ? (
                                                        <span className="px-2 py-0.5 rounded text-[9px] font-black bg-green-500/10 text-green-500 uppercase tracking-widest border border-green-500/20">
                                                            True
                                                        </span>
                                                    ) : (
                                                        <span className="px-2 py-0.5 rounded text-[9px] font-black bg-zinc-800/50 text-zinc-600 uppercase tracking-widest border border-zinc-700/50">
                                                            False
                                                        </span>
                                                    )
                                                ) : (
                                                    <span className={`${col.type === 'datetime' ? 'font-mono text-zinc-500 text-[10px]' : 'text-zinc-400 group-hover:text-zinc-200'} tracking-tight`}>
                                                        {typeof val === 'object' ? JSON.stringify(val) : String(val ?? '')}
                                                    </span>
                                                )}
                                            </td>
                                        );
                                    })}
                                    <td className="px-4 py-3 text-right">
                                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={() => handleEditRow(row)}
                                                className="p-1 hover:text-primary transition-colors hover:bg-zinc-800 rounded"
                                            >
                                                <Edit2 size={12} />
                                            </button>
                                            <button
                                                onClick={() => handleDeleteRow(row.id)}
                                                className="p-1 hover:text-red-500 transition-colors hover:bg-zinc-800 rounded"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Table Footer */}
            <div className="flex items-center justify-between px-6 py-2 border-t border-[#2e2e2e] bg-[#111111] text-[9px] font-black tracking-[0.2em]">
                <div className="flex items-center gap-6">
                    <span className="uppercase text-zinc-600 font-bold">{filteredData.length} ROWS</span>
                    <div className="flex items-center gap-2">
                        <div className={`w-1 h-1 rounded-full ${error ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]' : 'bg-primary shadow-[0_0_6px_rgba(254,254,0,0.4)]'}`} />
                        <span className="uppercase text-zinc-500">
                            {error ? 'DATABASE DISCONNECTED' : 'SYSTEM OPERATIONAL'}
                        </span>
                    </div>
                </div>

                <div className="flex items-center gap-4 text-zinc-600">
                    <button className="flex items-center gap-1.5 hover:text-zinc-200 uppercase transition-colors">
                        <Code2 size={12} /> SQL
                    </button>
                    <button
                        onClick={handleExportCSV}
                        className="flex items-center gap-1.5 hover:text-zinc-200 uppercase transition-colors"
                    >
                        <Download size={12} /> CSV
                    </button>
                </div>
            </div>

            <AddRowModal
                isOpen={isModalOpen}
                onClose={() => { setIsModalOpen(false); setEditingRow(null); }}
                schema={schema}
                tableName={tableName}
                initialData={editingRow}
                onRecordAdded={fetchData}
            />

            <AddColumnModal
                isOpen={isColumnModalOpen}
                onClose={() => setIsColumnModalOpen(false)}
                tableName={tableName}
                onColumnAdded={fetchData}
            />
        </div>
    );
};

export default TableEditor;
