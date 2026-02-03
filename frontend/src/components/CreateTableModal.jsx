import React, { useState } from 'react';
import { X, Check, Plus, Trash2, Shield, Zap, Info, Link as LinkIcon, Settings } from 'lucide-react';
import { fetchWithAuth } from '../utils/api';

const CreateTableModal = ({ isOpen, onClose, onTableCreated, schema = 'public' }) => {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [isRLSEnabled, setIsRLSEnabled] = useState(true);
    const [rlsRule, setRlsRule] = useState('user_id = auth.uid()');
    const [isRealtimeEnabled, setIsRealtimeEnabled] = useState(false);

    // Default columns
    const [columns, setColumns] = useState([
        { name: 'id', type: 'uuid', defaultValue: 'gen_random_uuid()', isPrimary: true, isSystem: true },
        { name: 'user_id', type: 'uuid', defaultValue: '', isPrimary: false, isSystem: false },
        { name: 'created_at', type: 'timestamptz', defaultValue: 'now()', isPrimary: false, isSystem: true },
    ]);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    if (!isOpen) return null;

    const handleAddColumn = () => {
        setColumns([...columns, { name: '', type: 'text', defaultValue: '', isPrimary: false }]);
    };

    const handleRemoveColumn = (index) => {
        const newCols = [...columns];
        newCols.splice(index, 1);
        setColumns(newCols);
    };

    const handleColumnChange = (index, field, value) => {
        const newCols = [...columns];
        newCols[index][field] = value;
        setColumns(newCols);
    };

    const handleSave = async () => {
        setLoading(true);
        setError(null);

        const customColumns = columns.filter(c => !c.isSystem).map(c => ({
            name: c.name,
            type: c.type,
            default: c.defaultValue || null
        }));

        try {
            const res = await fetchWithAuth('/api/collections', {
                method: 'POST',
                body: JSON.stringify({
                    name,
                    schema: customColumns,
                    rls_enabled: isRLSEnabled,
                    rls_rule: isRLSEnabled ? rlsRule : ''
                })
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to create table');
            }

            onTableCreated();
            onClose();
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/50 backdrop-blur-sm">
            <div className="w-full max-w-2xl h-full bg-[#111111] border-l border-[#2e2e2e] shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">

                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-[#2e2e2e]">
                    <h2 className="text-sm font-medium text-zinc-100">
                        Create a new table under <span className="font-mono bg-zinc-800 px-1 py-0.5 rounded textxs text-zinc-300">{schema}</span>
                    </h2>
                    <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-8">

                    {/* Name */}
                    <div className="space-y-4">
                        <div className="space-y-1">
                            <label className="text-sm font-medium text-zinc-300">Name</label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="w-full bg-[#0c0c0c] border border-[#2e2e2e] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50 transition-colors"
                                placeholder="vlaber_table"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-medium text-zinc-300">Description</label>
                            <input
                                type="text"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                className="w-full bg-[#0c0c0c] border border-[#2e2e2e] rounded-md px-3 py-2 text-sm text-zinc-400 focus:outline-none focus:border-primary/50 transition-colors"
                                placeholder="Optional"
                            />
                        </div>
                    </div>

                    {/* RLS */}
                    <div className="bg-[#0c0c0c] border border-[#2e2e2e] rounded-md p-4 space-y-4">
                        <div className="flex items-start gap-3">
                            <input
                                type="checkbox"
                                checked={isRLSEnabled}
                                onChange={(e) => setIsRLSEnabled(e.target.checked)}
                                className="mt-1 accent-primary"
                            />
                            <div>
                                <h4 className="text-sm font-medium text-zinc-200">Enable Row Level Security (RLS) <span className="text-[10px] text-zinc-500 uppercase tracking-wider ml-2 border border-zinc-700 px-1 rounded">Recommended</span></h4>
                                <p className="text-xs text-zinc-500 mt-1">Restrict access to your table by enabling RLS and writing Postgres policies.</p>
                            </div>
                        </div>

                        {isRLSEnabled && (
                            <div className="bg-[#111111] border border-[#2e2e2e] rounded p-3 flex gap-3">
                                <Info size={16} className="text-zinc-400 shrink-0 mt-0.5" />
                                <div className="space-y-2">
                                    <p className="text-xs text-zinc-500">You need to create an access policy before you can query data from this table. Without a policy, querying this table will return an <span className="underline decoration-zinc-600">empty array</span> of results.</p>

                                    <div className="pt-2 space-y-2">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-600">Preset Policy</label>
                                        <select
                                            value={rlsRule}
                                            onChange={(e) => setRlsRule(e.target.value)}
                                            className="w-full bg-[#0c0c0c] border border-[#2e2e2e] rounded px-3 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-primary/50"
                                        >
                                            <option value="user_id = auth.uid()">Only owner can access (user_id = auth.uid())</option>
                                            <option value="public">Public read-only (Everyone)</option>
                                            <option value="">Custom (Experimental)</option>
                                        </select>
                                    </div>

                                    <button className="text-xs text-zinc-300 border border-zinc-700 rounded px-2 py-1 flex items-center gap-2 hover:bg-zinc-800 transition-colors">
                                        <FileText size={12} /> Documentation
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Realtime */}
                    <div className="flex items-start gap-3">
                        <input
                            type="checkbox"
                            checked={isRealtimeEnabled}
                            onChange={(e) => setIsRealtimeEnabled(e.target.checked)}
                            className="mt-1 accent-primary"
                        />
                        <div>
                            <h4 className="text-sm font-medium text-zinc-200">Enable Realtime</h4>
                            <p className="text-xs text-zinc-500 mt-1">Broadcast changes on this table to authorized subscribers</p>
                        </div>
                    </div>

                    {/* Columns */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-bold text-zinc-100">Columns</h3>
                            <div className="flex gap-2">
                                <button className="text-xs bg-[#171717] border border-[#2e2e2e] text-zinc-300 px-3 py-1.5 rounded hover:bg-zinc-800 transition-colors flex items-center gap-2">
                                    <Settings size={12} /> About data types
                                </button>
                                <button className="text-xs bg-[#171717] border border-[#2e2e2e] text-zinc-300 px-3 py-1.5 rounded hover:bg-zinc-800 transition-colors">
                                    Import data from CSV
                                </button>
                            </div>
                        </div>

                        <div className="space-y-2">
                            {/* Header Row */}
                            <div className="grid grid-cols-12 gap-2 px-2 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                                <div className="col-span-1"></div>
                                <div className="col-span-4">Name</div>
                                <div className="col-span-3">Type</div>
                                <div className="col-span-3">Default Value</div>
                                <div className="col-span-1 text-center">Primary</div>
                            </div>

                            {/* Column Rows */}
                            {columns.map((col, idx) => (
                                <div key={idx} className="group grid grid-cols-12 gap-2 items-center bg-[#0c0c0c] border border-[#2e2e2e] rounded px-2 py-2 hover:border-zinc-700 transition-colors">
                                    <div className="col-span-1 flex justify-center cursor-move text-zinc-600 hover:text-zinc-400">
                                        <div className="space-y-0.5">
                                            <div className="w-3 h-0.5 bg-current rounded-full"></div>
                                            <div className="w-3 h-0.5 bg-current rounded-full"></div>
                                        </div>
                                    </div>
                                    <div className="col-span-4 relative">
                                        <input
                                            type="text"
                                            value={col.name}
                                            onChange={(e) => handleColumnChange(idx, 'name', e.target.value)}
                                            disabled={col.isSystem}
                                            className={`w-full bg-transparent text-xs text-white focus:outline-none ${col.isSystem ? 'opacity-50 cursor-not-allowed' : ''}`}
                                            placeholder="column_name"
                                        />
                                        {col.isSystem && <LinkIcon size={10} className="absolute right-0 top-1/2 -translate-y-1/2 text-zinc-600" />}
                                    </div>
                                    <div className="col-span-3">
                                        <select
                                            value={col.type}
                                            onChange={(e) => handleColumnChange(idx, 'type', e.target.value)}
                                            disabled={col.isSystem}
                                            className={`w-full bg-[#111111] border border-[#2e2e2e] rounded px-2 py-1 text-[10px] text-zinc-300 focus:outline-none ${col.isSystem ? 'opacity-50' : ''}`}
                                        >
                                            <option value="uuid">uuid</option>
                                            <option value="text">text</option>
                                            <option value="int8">int8</option>
                                            <option value="number">number</option>
                                            <option value="boolean">boolean</option>
                                            <option value="timestamptz">timestamptz</option>
                                            <option value="json">json</option>
                                        </select>
                                    </div>
                                    <div className="col-span-3">
                                        <input
                                            type="text"
                                            value={col.defaultValue || ''}
                                            onChange={(e) => handleColumnChange(idx, 'defaultValue', e.target.value)}
                                            disabled={col.isSystem}
                                            className={`w-full bg-transparent text-xs text-zinc-400 focus:outline-none placeholder:text-zinc-700 ${col.isSystem ? 'opacity-50' : ''}`}
                                            placeholder="NULL"
                                        />
                                    </div>
                                    <div className="col-span-1 flex justify-center items-center gap-2">
                                        {col.isPrimary ? (
                                            <div className="bg-green-500/20 p-0.5 rounded">
                                                <Check size={12} className="text-green-500" />
                                            </div>
                                        ) : (
                                            !col.isSystem && (
                                                <button onClick={() => handleRemoveColumn(idx)} className="text-zinc-600 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100">
                                                    <X size={12} />
                                                </button>
                                            )
                                        )}
                                        {col.isSystem && <Settings size={12} className="text-zinc-700" />}
                                    </div>
                                </div>
                            ))}

                            <button
                                onClick={handleAddColumn}
                                className="w-full py-2 border border-dashed border-[#2e2e2e] rounded text-xs text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 transition-all flex items-center justify-center gap-2"
                            >
                                <Plus size={14} /> Add column
                            </button>
                        </div>
                    </div>

                    {error && (
                        <div className="bg-red-500/10 border border-red-500/20 text-red-500 p-3 rounded text-xs">
                            {error}
                        </div>
                    )}

                </div>

                {/* Footer */}
                <div className="p-6 border-t border-[#2e2e2e] flex justify-end gap-3 bg-[#0c0c0c]">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-xs font-medium text-zinc-400 hover:text-white transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={loading || !name}
                        className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-green-900/20"
                    >
                        {loading ? 'Saving...' : 'Save'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// Help icon was missing import
import { FileText } from 'lucide-react';

export default CreateTableModal;
