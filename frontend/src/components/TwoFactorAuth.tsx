import React, { useEffect, useState } from 'react';
import {
    AlertCircle,
    Check,
    Copy,
    Download,
    Info,
    Loader2,
    Lock,
    Shield,
    ShieldCheck,
    Smartphone,
    RefreshCw,
    MoreVertical,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { fetchWithAuth } from '../utils/api';
import ConfirmModal from './ConfirmModal';
import ModuleScrollContainer from './ModuleScrollContainer';
import { BrandedToast } from './OverlayPrimitives';

interface TwoFactorStatusResponse {
    enabled?: boolean;
    last_used_at?: string | null;
    pending_first_protected_in?: boolean;
    challenge_applies_next_login?: boolean;
}

const TwoFactorAuth = () => {
    const [isEnabled, setIsEnabled] = useState(false);
    const [loading, setLoading] = useState(true);
    const [setupData, setSetupData] = useState<any>(null);
    const [verificationCode, setVerificationCode] = useState('');
    const [toast, setToast] = useState<any>(null);
    const [step, setStep] = useState<'status' | 'setup'>('status');
    const [setupSubStep, setSetupSubStep] = useState<1 | 2 | 3>(1);
    const [copiedIndex, setCopiedIndex] = useState<any>(null);
    const [isDisableConfirmOpen, setIsDisableConfirmOpen] = useState(false);
    const [lastUsedAt, setLastUsedAt] = useState<string | null>(null);
    const [pendingFirstProtectedSignIn, setPendingFirstProtectedSignIn] = useState(false);

    useEffect(() => {
        checkStatus();
    }, []);

    const checkStatus = async () => {
        try {
            const res = await fetchWithAuth('/api/auth/2fa/status');
            const data = await res.json() as TwoFactorStatusResponse;
            setIsEnabled(Boolean(data.enabled));
            setLastUsedAt(typeof data.last_used_at === 'string' && data.last_used_at.trim() ? data.last_used_at : null);
            setPendingFirstProtectedSignIn(Boolean(data.pending_first_protected_in));
        } catch (error) {
            console.error('Failed to check 2FA status', error);
        } finally {
            setLoading(false);
        }
    };

    const showToast = (message: string, type: 'success' | 'error') => {
        setToast({ message, type });
    };

    const startSetup = async () => {
        setLoading(true);
        try {
            const res = await fetchWithAuth('/api/auth/2fa/setup', { method: 'POST' });
            const data = await res.json();
            setSetupData(data);
            setSetupSubStep(1);
            setStep('setup');
        } catch (error) {
            console.error('Failed to setup 2FA', error);
            showToast('Failed to setup 2FA', 'error');
        } finally {
            setLoading(false);
        }
    };

    const enable2FA = async () => {
        if (verificationCode.length !== 6) {
            showToast('Code must be 6 digits', 'error');
            return;
        }

        setLoading(true);
        try {
            const res = await fetchWithAuth('/api/auth/2fa/enable', {
                method: 'POST',
                body: JSON.stringify({ code: verificationCode }),
            });

            if (res.ok) {
                setIsEnabled(true);
                setLastUsedAt(null);
                setPendingFirstProtectedSignIn(true);
                setSetupSubStep(3);
                showToast('2FA enabled successfully!', 'success');
            } else {
                showToast('Invalid verification code', 'error');
            }
        } catch (error) {
            console.error('Failed to enable 2FA', error);
            showToast('Failed to enable 2FA', 'error');
        } finally {
            setLoading(false);
        }
    };

    const disable2FA = async () => {
        setLoading(true);
        try {
            const res = await fetchWithAuth('/api/auth/2fa/disable', { method: 'POST' });
            if (res.ok) {
                setIsEnabled(false);
                setSetupData(null);
                setLastUsedAt(null);
                setPendingFirstProtectedSignIn(false);
                showToast('2FA disabled', 'success');
            } else {
                showToast('Failed to disable 2FA', 'error');
            }
        } catch (error) {
            console.error('Failed to disable 2FA', error);
            showToast('Failed to disable 2FA', 'error');
        } finally {
            setLoading(false);
        }
    };

    const copyToClipboard = (text: any, index: any) => {
        navigator.clipboard.writeText(text);
        setCopiedIndex(index);
        window.setTimeout(() => setCopiedIndex(null), 2000);
    };

    const downloadBackupCodes = () => {
        const content = `OzyBase 2FA Backup Codes\n\nGenerated: ${new Date().toLocaleString()}\n\n${setupData.backup_codes.join('\n')}\n\nKeep these codes in a safe place. Each code can only be used once.`;
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'ozybase-2fa-backup-codes.txt';
        link.click();
    };

    if (loading && step === 'status') {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-zinc-500">
                <Loader2 className="animate-spin text-primary" size={32} />
                <span className="text-[10px] font-medium">Loading 2FA Settings...</span>
            </div>
        );
    }

    return (
        <ModuleScrollContainer width="4xl" innerClassName="animate-in fade-in duration-700">
            <div className="space-y-10 pb-20 relative">
                <div className="absolute inset-x-0 top-0 h-96 bg-linear-to-b from-primary/5 to-transparent pointer-events-none" />
                
                <header className="px-10 py-16 border-b border-white/5 bg-linear-to-b from-zinc-900/50 to-transparent relative z-10 overflow-hidden rounded-[48px]">
                    <div className="absolute inset-0 bg-linear-to-r from-primary/5 to-transparent pointer-events-none" />
                    <div className="flex flex-col gap-10 lg:flex-row lg:items-center lg:justify-between relative z-10">
                    <div className="flex items-center gap-6">
                        <div className={`w-20 h-20 rounded-[32px] flex items-center justify-center border transition-all duration-700 relative z-10 ${isEnabled ? 'bg-emerald-500/10 border-emerald-500/20 shadow-[0_0_50px_rgba(16,185,129,0.1)]' : 'bg-primary/5 border-primary/20 shadow-[0_0_50px_rgba(254,254,0,0.05)]'}`}>
                            {isEnabled ? (
                                <ShieldCheck className="text-emerald-500" size={40} strokeWidth={1} />
                            ) : (
                                <Lock className="text-primary" size={40} strokeWidth={1} />
                            )}
                        </div>
                        <div className="relative z-10">
                            <p className="text-[10px] font-bold tracking-[0.4em] text-zinc-500 uppercase italic mb-3">Ozy_Auth :: Identity_Mesh</p>
                            <h1 className="text-5xl font-bold tracking-tighter text-white uppercase italic leading-none">Identity Guard</h1>
                            <div className="mt-6 flex items-center gap-6">
                                <div className={`flex items-center gap-3 px-4 py-1.5 rounded-full border border-white/5 group bg-black/40`}>
                                   <div className={`w-1.5 h-1.5 rounded-full ${isEnabled ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500'}`} />
                                   <span className="text-[9px] font-bold uppercase tracking-widest italic text-zinc-400">Layer_02_MFA</span>
                                </div>
                                <div className="w-1.5 h-1.5 rounded-full bg-white/10" />
                                <span className={`text-[10px] font-bold uppercase tracking-[0.2em] italic ${isEnabled ? 'text-emerald-500' : 'text-zinc-600'}`}>{isEnabled ? '2FA Enabled' : '2FA Disabled'}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </header>

                {step === 'status' && (
                    <div className="space-y-8 animate-in slide-in-from-bottom-5 duration-700">
                         <div className="group relative overflow-hidden rounded-[40px] border border-white/5 bg-background p-10 shadow-[0_50px_100px_-20px_rgba(0,0,0,0.5)] transition-all hover:border-white/10">
                            <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-primary/1 blur-[100px] rounded-full translate-x-1/2 -translate-y-1/2 pointer-events-none" />
                            
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-8 relative z-10">
                                <div className="space-y-2">
                                    <div className="flex items-center gap-3">
                                        <h2 className="text-3xl font-bold tracking-tighter text-white italic">Core Protection</h2>
                                        <span className={`text-[9px] font-bold px-3 py-1 rounded-full border uppercase tracking-widest ${isEnabled ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
                                            {isEnabled ? 'Active' : 'Disabled'}
                                        </span>
                                    </div>
                                    <p className="text-zinc-500 text-sm font-medium max-w-md">
                                        {isEnabled 
                                            ? 'Your account is currently fortified with cryptographically signed tokens. Unauthorized access attempts are restricted.' 
                                            : 'Your account is currently vulnerable to credential leaks. We recommend immediate fortification using Time-based One-Time Passwords (TOTP).'}
                                    </p>
                                </div>

                                <div className="flex shrink-0">
                                    {!isEnabled ? (
                                        <button
                                            onClick={startSetup}
                                            className="inline-flex items-center gap-4 rounded-md bg-primary px-8 py-5 text-[11px] font-bold text-black uppercase tracking-[0.2em] transition-all hover:scale-105 active:scale-95 shadow-[0_20px_40px_rgba(254,254,0,0.15)] group/btn"
                                        >
                                            <Shield size={18} className="group-hover:rotate-12 transition-transform" />
                                            Initialize Protocol
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => setIsDisableConfirmOpen(true)}
                                            className="inline-flex items-center gap-4 rounded-md border border-red-500/20 bg-red-500/5 px-8 py-5 text-[11px] font-bold text-red-500 uppercase tracking-[0.2em] transition-all hover:bg-red-500/10 hover:border-red-500/40 active:scale-95 shadow-xl group/btn"
                                        >
                                            <AlertCircle size={18} className="group-hover:scale-110 transition-transform" />
                                            Decommission Shield
                                        </button>
                                    )}
                                </div>
                            </div>

                            {isEnabled && (
                                <div className="mt-10 pt-10 border-t border-white/5 grid grid-cols-1 md:grid-cols-2 gap-8 relative z-10">
                                    <div className="p-6 rounded-md bg-white/2 border border-white/5 space-y-2">
                                        <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest italic leading-none">Session Integrity</p>
                                        <p className="text-[11px] text-zinc-400 font-medium">
                                            {pendingFirstProtectedSignIn 
                                                ? 'Pending: Login required to confirm.' 
                                                : `Verified: Last entry verified at ${new Date(lastUsedAt || '').toLocaleString()}`
                                            }
                                        </p>
                                    </div>
                                    <div className="p-6 rounded-md bg-white/2 border border-white/5 space-y-3">
                                        <div className="flex items-center gap-2">
                                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                                            <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest italic leading-none">Identity Compliance</p>
                                        </div>
                                        <p className="text-[11px] text-zinc-400 font-medium">Compliant with NIST 800-63B standards for high-assurance identity verification.</p>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                            <div className="lg:col-span-1 p-8 rounded-4xl border border-white/5 bg-background/50 space-y-4">
                                <div className="w-10 h-10 rounded-md bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                                    <Info className="text-blue-500" size={20} />
                                </div>
                                <h3 className="text-[11px] font-bold text-zinc-300 uppercase tracking-[0.3em] italic">Architecture</h3>
                                <p className="text-[11px] text-zinc-500 font-medium leading-relaxed tracking-wide">
                                    2FA adds an immutable layer of security. In the event of password compromise, our systems require a second, time-sensitive cryptographic proof generated on your personal hardware.
                                </p>
                            </div>
                            <div className="space-y-3 lg:col-span-2">
                                <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-600">Authenticator App</p>
                                <div className="lg:col-span-2 p-10 rounded-[40px] border border-white/5 bg-background flex flex-col justify-center gap-8 relative overflow-hidden group">
                                    <div className="absolute inset-0 bg-white/1 opacity-0 group-hover:opacity-100 transition-opacity" />
                                    <div className="flex items-center gap-3 relative z-10">
                                        <Smartphone className="text-zinc-600" size={18} />
                                        <h3 className="text-[11px] font-bold text-zinc-500 uppercase tracking-[0.3em] italic">Validated Authenticator Nodes</h3>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 relative z-10">
                                        {[
                                            { name: 'Google Meta', desc: 'Secure Enclave' },
                                            { name: 'Microsoft Auth', desc: 'Enterprise Node' },
                                            { name: 'Authy Cloud', desc: 'Multi-Device Sync' },
                                        ].map((app: any) => (
                                            <div key={app.name} className="p-4 rounded-md border border-white/5 bg-black/20 transition-colors hover:bg-black/40">
                                                <p className="text-[11px] font-bold text-white italic truncate">{app.name}</p>
                                                <p className="mt-1 text-[9px] font-bold text-zinc-700 uppercase tracking-tight">{app.desc}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {step === 'setup' && setupData && (
                    <div className="space-y-10 animate-in zoom-in-95 duration-700">
                        <div className="flex items-center justify-center gap-4">
                            {[1, 2, 3].map((s) => (
                                <div key={s} className="flex items-center gap-3">
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold italic transition-all duration-500 ${setupSubStep === s ? 'bg-primary text-black scale-110 shadow-[0_0_15px_rgba(254,254,0,0.3)]' : setupSubStep > s ? 'bg-emerald-500/20 text-emerald-500' : 'bg-white/5 text-zinc-700'}`}>
                                        0{s}
                                    </div>
                                    {s < 3 && <div className={`w-12 h-px transition-all duration-700 ${setupSubStep > s ? 'bg-emerald-500/30' : 'bg-white/5'}`} />}
                                </div>
                            ))}
                        </div>

                        <article className="overflow-hidden rounded-[48px] border border-white/5 bg-background shadow-[0_50px_100px_-20px_rgba(0,0,0,0.5)]">
                            <div className="flex flex-col min-h-[500px]">
                                {setupSubStep === 1 && (
                                    <section className="p-12 space-y-10 animate-in slide-in-from-right-5 duration-500">
                                        <div className="space-y-6 text-center max-w-xl mx-auto">
                                            <div className="flex flex-col items-center gap-4">
                                                <div className="w-12 h-12 rounded-[20px] bg-primary flex items-center justify-center shadow-[0_0_20px_rgba(254,254,0,0.2)]">
                                                    <span className="text-xl font-bold text-black italic">01</span>
                                                </div>
                                                <h3 className="text-3xl font-bold text-white italic tracking-tighter uppercase leading-none">Sync Hardware</h3>
                                            </div>
                                            <p className="text-zinc-500 text-[11px] font-bold uppercase tracking-[0.2em] leading-relaxed">Scan the high-entropy visual token using your preferred authenticator hardware.</p>
                                            
                                            <div className="relative group p-8 rounded-[40px] bg-white/3 border border-white/5 flex flex-col items-center justify-center gap-6">
                                                <div className="absolute inset-0 bg-primary/1 blur-3xl opacity-0 group-hover:opacity-100 transition-opacity" />
                                                <div className="p-6 bg-white rounded-[32px] shadow-2xl relative z-10 group-hover:scale-105 transition-transform duration-500">
                                                    <QRCodeSVG value={setupData.qr_code_url} size={220} />
                                                </div>
                                            </div>

                                            <div className="p-6 rounded-md bg-black/20 border border-white/5 space-y-3 shadow-inner overflow-hidden text-left">
                                                <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-[0.3em] font-mono leading-none">Manual Override Path</p>
                                                <div className="flex items-center justify-between gap-4">
                                                    <code className="text-sm font-bold text-primary tracking-[0.2em] truncate flex-1">{setupData.secret}</code>
                                                    <button
                                                        onClick={() => copyToClipboard(setupData.secret, 'secret')}
                                                        className="shrink-0 p-3 bg-white/3 hover:bg-white/5 border border-white/5 rounded-md transition-all"
                                                    >
                                                        {copiedIndex === 'secret' ? <Check size={16} className="text-emerald-500" /> : <Copy size={16} className="text-zinc-600" />}
                                                    </button>
                                                </div>
                                            </div>

                                            <button
                                                onClick={() => setSetupSubStep(2)}
                                                className="w-full flex items-center justify-center gap-4 rounded-md bg-white/5 hover:bg-white/10 border border-white/5 py-6 text-[11px] font-bold text-white uppercase tracking-[0.3em] transition-all"
                                            >
                                                I have scanned the code
                                            </button>
                                        </div>
                                    </section>
                                )}

                                {setupSubStep === 2 && (
                                    <section className="p-12 flex flex-col gap-12 justify-center bg-black/5 animate-in slide-in-from-right-5 duration-500 min-h-[500px]">
                                        <div className="space-y-8 max-w-xl mx-auto w-full">
                                            <div className="space-y-6 text-center">
                                                <div className="flex flex-col items-center gap-4">
                                                    <div className="w-12 h-12 rounded-[20px] bg-primary flex items-center justify-center shadow-[0_0_20px_rgba(254,254,0,0.2)]">
                                                        <span className="text-xl font-bold text-black italic">02</span>
                                                    </div>
                                                    <h3 className="text-3xl font-bold text-white italic tracking-tighter uppercase leading-none">Verification</h3>
                                                </div>
                                                <p className="text-zinc-500 text-[11px] font-bold uppercase tracking-[0.2em] leading-relaxed">Input the generated temporal token to confirm hardware ownership.</p>
                                                
                                                <div className="space-y-4">
                                                    <input
                                                        type="text"
                                                        maxLength={6}
                                                        placeholder="000 000"
                                                        value={verificationCode}
                                                        autoFocus
                                                        onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, ''))}
                                                        className="w-full rounded-md border border-white/5 bg-black/40 px-8 py-6 text-center text-5xl font-bold italic tracking-[0.25em] text-white outline-none focus:border-primary/20 transition-all placeholder:text-zinc-800 shadow-inner"
                                                    />
                                                    <button
                                                        onClick={enable2FA}
                                                        disabled={loading || verificationCode.length !== 6}
                                                        className="w-full flex items-center justify-center gap-4 rounded-md bg-primary py-6 text-[11px] font-bold text-black uppercase tracking-[0.3em] transition-all hover:scale-105 active:scale-95 shadow-[0_30px_60px_rgba(254,254,0,0.1)] group/verify"
                                                    >
                                                        {loading ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} className="group-hover:scale-110 transition-transform" />}
                                                        Authorize Shield
                                                    </button>
                                                    <button
                                                        onClick={() => setSetupSubStep(1)}
                                                        className="w-full py-4 text-[10px] font-bold text-zinc-600 uppercase tracking-widest hover:text-white transition-colors"
                                                    >
                                                        Back to QR Code
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </section>
                                )}

                                {setupSubStep === 3 && (
                                    <section className="p-12 space-y-10 animate-in slide-in-from-right-5 duration-500">
                                        <div className="space-y-8 max-w-2xl mx-auto w-full">
                                            <div className="space-y-6 text-center">
                                                 <div className="flex flex-col items-center gap-4">
                                                    <div className="w-12 h-12 rounded-[20px] bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 shadow-[0_0_20px_rgba(16,185,129,0.1)]">
                                                        <ShieldCheck size={24} className="text-emerald-500" />
                                                    </div>
                                                    <h3 className="text-3xl font-bold text-white italic tracking-tighter uppercase leading-none">Security Fortified</h3>
                                                </div>
                                                <p className="text-zinc-500 text-[11px] font-bold uppercase tracking-[0.2em] leading-relaxed">Your account is now secured. Store these recovery codes in an immutable offline location.</p>
                                                
                                                <div className="grid grid-cols-2 gap-4">
                                                    {setupData.backup_codes.map((code: any, index: any) => (
                                                        <div key={code} className="group flex items-center justify-between rounded-md border border-white/5 bg-black/40 p-5 transition-all hover:bg-black/60 shadow-inner">
                                                            <code className="text-sm font-bold text-zinc-400 tracking-widest">{code}</code>
                                                            <button
                                                                onClick={() => copyToClipboard(code, index)}
                                                                className="p-2 opacity-40 group-hover:opacity-100 transition-opacity"
                                                            >
                                                                {copiedIndex === index ? <Check size={16} className="text-emerald-500" /> : <Copy size={16} className="text-zinc-600" />}
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>

                                                <div className="flex flex-col gap-4">
                                                    <button
                                                        onClick={downloadBackupCodes}
                                                        className="w-full flex items-center justify-center gap-4 rounded-md bg-white/5 hover:bg-white/10 border border-white/5 py-6 text-[11px] font-bold text-white uppercase tracking-[0.3em] transition-all shadow-xl"
                                                    >
                                                        <Download size={18} /> Download Recovery Deck
                                                    </button>
                                                    <button
                                                        onClick={() => { setStep('status'); setSetupData(null); checkStatus(); }}
                                                        className="w-full flex items-center justify-center gap-4 rounded-md bg-emerald-500 py-6 text-[11px] font-bold text-black uppercase tracking-[0.3em] transition-all hover:scale-105 shadow-[0_20px_40px_rgba(16,185,129,0.2)]"
                                                    >
                                                        Finalize Fortification
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </section>
                                )}
                            </div>
                        </article>

                        <div className="flex justify-center">
                            <button
                                onClick={() => { setStep('status'); setSetupData(null); }}
                                className="text-[10px] font-bold uppercase tracking-[0.4em] text-zinc-700 transition-all hover:text-white hover:tracking-[0.5em] italic"
                            >
                                / Terminate Setup Flow
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <ConfirmModal
                isOpen={isDisableConfirmOpen}
                onClose={() => setIsDisableConfirmOpen(false)}
                onConfirm={disable2FA}
                title="Protocol Decommissioning"
                message="This action will downgrade your security perimeter to single-factor authentication. Are you absolutely certain you wish to proceed?"
                confirmText="Terminate Protection"
                type="danger"
            />

            {toast ? (
                <BrandedToast
                    tone={toast.type === 'success' ? 'success' : 'error'}
                    message={toast.message}
                    onClose={() => setToast(null)}
                />
            ) : null}
        </ModuleScrollContainer>
    );
};

export default TwoFactorAuth;


