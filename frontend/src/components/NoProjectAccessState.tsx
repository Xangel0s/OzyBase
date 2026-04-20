import React, { useMemo, useState } from 'react';
import { AlertTriangle, Briefcase, Plus, ShieldCheck } from 'lucide-react';

interface NoProjectAccessStateProps {
    issueMessage: string;
    canCreateProject: boolean;
    creatingProject?: boolean;
    requestingAccess?: boolean;
    accessRequestSubmitted?: boolean;
    onCreateProject?: (name: string) => Promise<void> | void;
    onRequestAccess?: (message: string) => Promise<void> | void;
}

const NoProjectAccessState: React.FC<NoProjectAccessStateProps> = ({
    issueMessage,
    canCreateProject,
    creatingProject = false,
    requestingAccess = false,
    accessRequestSubmitted = false,
    onCreateProject,
    onRequestAccess,
}) => {
    const [projectName, setProjectName] = useState('Primary Project');
    const [accessMessage, setAccessMessage] = useState('');
    const [localError, setLocalError] = useState<string | null>(null);
    const helperText = useMemo(() => (
        canCreateProject
            ? 'This installation already has project-scoped metadata, but your current admin account is not attached to any project. Create a fresh project or request membership to an existing one.'
            : 'Your account is authenticated, but it is not attached to any accessible project yet. Ask a project owner or admin to invite you.'
    ), [canCreateProject]);

    const handleCreateProject = async () => {
        if (!onCreateProject) {
            return;
        }

        const normalizedName = projectName.trim();
        if (!normalizedName) {
            setLocalError('Project name is required');
            return;
        }

        try {
            setLocalError(null);
            await onCreateProject(normalizedName);
        } catch (error) {
            setLocalError(error instanceof Error ? error.message : 'Failed to create project');
        }
    };

    const handleRequestAccess = async () => {
        if (!onRequestAccess || accessRequestSubmitted) {
            return;
        }

        try {
            setLocalError(null);
            await onRequestAccess(accessMessage.trim());
        } catch (error) {
            setLocalError(error instanceof Error ? error.message : 'Failed to submit access request');
        }
    };

    return (
        <div className="min-h-screen bg-background px-6 py-12 text-zinc-100">
            <div className="mx-auto flex min-h-[70vh] max-w-4xl items-center justify-center">
                <div className="w-full rounded-[32px] border border-border bg-background p-8 shadow-[0_24px_80px_-40px_rgba(0,0,0,0.9)] md:p-10">
                    <div className="grid gap-8 md:grid-cols-[minmax(0,1.1fr)_minmax(280px,360px)]">
                        <div className="space-y-6">
                            <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.24em] text-amber-400">
                                <AlertTriangle size={12} />
                                Project access required
                            </div>
                            <div className="space-y-3">
                                <h1 className="text-3xl font-bold uppercase tracking-tight text-white md:text-4xl">
                                    No Project Is Selected
                                </h1>
                                <p className="max-w-2xl text-sm leading-relaxed text-zinc-400">
                                    {helperText}
                                </p>
                            </div>

                            <div className="rounded-md border border-border bg-background p-5">
                                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">Current response</p>
                                <p className="mt-3 text-sm leading-relaxed text-zinc-300">{issueMessage}</p>
                            </div>

                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="rounded-md border border-border bg-background p-5">
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-11 w-11 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
                                            <Briefcase size={20} />
                                        </div>
                                        <div>
                                            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">External term</p>
                                            <p className="text-sm font-bold uppercase tracking-wide text-white">Project</p>
                                        </div>
                                    </div>
                                </div>
                                <div className="rounded-md border border-border bg-background p-5">
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-11 w-11 items-center justify-center rounded-md border border-blue-500/20 bg-blue-500/10 text-blue-400">
                                            <ShieldCheck size={20} />
                                        </div>
                                        <div>
                                            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">Transport term</p>
                                            <p className="text-sm font-bold uppercase tracking-wide text-white">Workspace</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="rounded-md border border-border bg-[linear-gradient(180deg,rgba(254,254,0,0.08),rgba(10,10,10,0.96))] p-6">
                            <div className="space-y-4">
                                <div>
                                    <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-primary">Next step</p>
                                    <h2 className="mt-2 text-xl font-bold uppercase tracking-tight text-white">
                                        {canCreateProject ? 'Create a project' : 'Request access'}
                                    </h2>
                                </div>

                                {canCreateProject ? (
                                    <>
                                        <p className="text-sm leading-relaxed text-zinc-300">
                                            Create a new project scope now. OzyBase will attach the active session to it and continue with the dashboard normally.
                                        </p>
                                        <div className="space-y-3">
                                            <label className="block text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">
                                                Project name
                                            </label>
                                            <input
                                                value={projectName}
                                                onChange={(event) => setProjectName(event.target.value)}
                                                className="w-full rounded-md border border-border bg-background px-4 py-3 text-sm font-bold text-white placeholder:text-zinc-700 focus:border-primary/40 focus:outline-none focus:ring-4 focus:ring-primary/10"
                                                placeholder="Primary Project"
                                            />
                                        </div>
                                        {localError && (
                                            <div className="rounded-md border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs font-bold text-red-300">
                                                {localError}
                                            </div>
                                        )}
                                        <button
                                            onClick={() => { void handleCreateProject(); }}
                                            disabled={creatingProject}
                                            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-xs font-bold uppercase tracking-[0.22em] text-black transition-all hover:bg-[#E6E600] disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            <Plus size={14} />
                                            {creatingProject ? 'Creating Project...' : 'Create Project'}
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <p className="text-sm leading-relaxed text-zinc-300">
                                            Request access to the existing project. An owner/admin will receive your request and can grant membership from Project Settings.
                                        </p>
                                        <div className="space-y-3">
                                            <label className="block text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">
                                                Message (optional)
                                            </label>
                                            <textarea
                                                value={accessMessage}
                                                onChange={(event) => setAccessMessage(event.target.value)}
                                                maxLength={1000}
                                                className="min-h-[110px] w-full rounded-md border border-border bg-background px-4 py-3 text-sm font-medium text-white placeholder:text-zinc-700 focus:border-primary/40 focus:outline-none focus:ring-4 focus:ring-primary/10"
                                                placeholder="Hi, please grant me access to this project."
                                            />
                                        </div>
                                        {localError && (
                                            <div className="rounded-md border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs font-bold text-red-300">
                                                {localError}
                                            </div>
                                        )}
                                        {accessRequestSubmitted && (
                                            <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-xs font-bold text-emerald-300">
                                                Access request submitted. Ask a project owner/admin to approve your membership.
                                            </div>
                                        )}
                                        <button
                                            onClick={() => { void handleRequestAccess(); }}
                                            disabled={requestingAccess || accessRequestSubmitted}
                                            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-xs font-bold uppercase tracking-[0.22em] text-black transition-all hover:bg-[#E6E600] disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            <Plus size={14} />
                                            {requestingAccess ? 'Submitting...' : (accessRequestSubmitted ? 'Request Submitted' : 'Request Access')}
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default NoProjectAccessState;


