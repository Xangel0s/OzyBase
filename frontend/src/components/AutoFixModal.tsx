import React, { useState } from 'react';
import {
  Shield,
  AlertTriangle,
  X,
  Check,
  Loader2,
  ArrowRight,
  RefreshCw,
  Zap,
} from 'lucide-react';
import type { HealthFixIssue } from '../utils/healthFix';

interface AutoFixModalProps {
  isOpen: boolean;
  onClose: () => void;
  issue: HealthFixIssue | null;
  onConfirm: (issue: HealthFixIssue) => Promise<void> | void;
}

const AutoFixModal = ({
  isOpen,
  onClose,
  issue,
  onConfirm,
}: AutoFixModalProps) => {
  const [loading, setLoading] = useState(false);

  if (!isOpen || !issue) return null;
  const issueTitle = issue.title ?? '';
  const isFixable = issue.fixable !== false;

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm(issue);
      onClose();
    } catch (error) {
      console.error('AutoFix failed', error);
    } finally {
      setLoading(false);
    }
  };

    return (
        <div
            className="fixed inset-0 z-100 flex items-center justify-center p-4"
            onClick={(e: React.MouseEvent<HTMLDivElement>) => e.target === e.currentTarget && onClose()}
        >
            <div className="absolute inset-0 bg-zinc-950/80 backdrop-blur-md" />
            <div className="relative w-full max-w-xl overflow-hidden rounded-md border border-border bg-zinc-900 shadow-2xl transition-all">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-border bg-zinc-950/50 px-6 py-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-zinc-900 shadow-inner">
                            <Shield className="text-primary" size={18} />
                        </div>
                        <div>
                            <h3 className="text-[11px] font-bold uppercase tracking-widest text-white italic">Security_Shield_Engine</h3>
                            <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-600 italic">Auto_Hardening_Cycle</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="rounded-md p-2 text-zinc-600 hover:bg-zinc-800 hover:text-white transition-all">
                        <X size={18} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-8 space-y-6 bg-zinc-900">
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 text-amber-500 text-[10px] font-bold uppercase tracking-[0.2em]">
                            <AlertTriangle size={14} />
                            <span>{issue.type === 'performance' ? 'Optimization_Matrix_Warning' : 'Structural_Impact_Alert'}</span>
                        </div>

                        <div className="space-y-4 rounded-md border border-border bg-zinc-950/50 p-6">
                            <p className="text-[11px] font-bold uppercase tracking-tight text-zinc-400 leading-relaxed">
                                Executing {issue.type} fix on node: <br />
                                <span className="font-mono text-[10px] text-white bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800 inline-block mt-1">
                                    {issueTitle}
                                </span>
                            </p>

                            <div className="space-y-4 pt-2">
                                {issue.type === 'security' && issueTitle.includes('Row Level Security') && (
                                    <>
                                        <div className="flex gap-3 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                                            <Check size={14} className="text-emerald-500 shrink-0" />
                                            <span>ENABLE_RLS: Enforce_Isolation_Layer</span>
                                        </div>
                                        <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-[10px] leading-tight text-zinc-600">
                                            <span className="text-primary italic">ALTER TABLE</span> {issueTitle.split('`')[1] || 'table'} <span className="text-primary italic">ENABLE ROW LEVEL SECURITY</span>;
                                        </div>
                                    </>
                                )}

                                {issue.type === 'security' && issueTitle.includes('public list rules') && (
                                    <>
                                        <div className="flex gap-3 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                                            <Check size={14} className="text-emerald-500 shrink-0" />
                                            <span>RESTRICT_ACCESS: Public {'>'} Auth_Vector</span>
                                        </div>
                                        <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-[10px] leading-tight text-zinc-600">
                                            <span className="text-primary italic">UPDATE</span> _v_collections <span className="text-primary italic">SET</span> list_rule = 'auth' <span className="text-primary italic">WHERE</span> list_rule = 'public';
                                        </div>
                                    </>
                                )}

                                {issue.type === 'performance' && issueTitle.includes('missing an index') && (
                                    <>
                                        <div className="flex gap-3 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                                            <Check size={14} className="text-emerald-500 shrink-0" />
                                            <span>GENERATE_INDEX: B_Tree_Optimization</span>
                                        </div>
                                        <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3 font-mono text-[10px] leading-tight text-zinc-600">
                                            <span className="text-primary italic">CREATE INDEX</span> idx_{issueTitle.split('`')[3]}_{issueTitle.split('`')[1]} <span className="text-primary italic">ON</span> {issueTitle.split('`')[3]} ({issueTitle.split('`')[1]});
                                        </div>
                                    </>
                                )}

                                <div className="flex gap-3 text-[9px] font-bold uppercase tracking-widest text-zinc-700 italic">
                                    {isFixable ? (
                                        <>
                                            <Zap size={12} className="text-primary shrink-0" />
                                            <span>Audit_Log: Fix_Trace_Will_Be_Persisted</span>
                                        </>
                                    ) : (
                                        <>
                                            <AlertTriangle size={12} className="text-amber-500 shrink-0" />
                                            <span>Manual_Action_Required: High_Risk_Vector</span>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>

                        <p className="px-4 text-center text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-700 italic leading-relaxed">
                            {issue.type === 'security'
                                ? '"Kernel will execute SQL mutations to harden schema isolation instantly."'
                                : '"Kernel will execute diagnostic optimizations on database engine without interruption."'}
                        </p>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 border-t border-border bg-zinc-950/50 px-6 py-4">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-600 transition-all hover:text-zinc-300"
                    >
                        Abort_Hardening
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={loading || !isFixable}
                        className="flex items-center gap-2 rounded-md bg-primary px-8 py-2.5 text-[10px] font-bold uppercase tracking-widest text-black shadow-[0_0_20px_rgba(254,254,0,0.1)] transition-all hover:bg-primary/90 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? (
                            <Loader2 size={14} className="animate-spin" />
                        ) : (
                            <>
                                <span>{isFixable ? 'Execute_Fix' : 'Manual_Review'}</span>
                                <ArrowRight size={14} strokeWidth={2.5} />
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AutoFixModal;


