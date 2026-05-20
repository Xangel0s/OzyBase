import React, { useEffect, useState } from 'react';
import { Lock, Mail, Loader2, ArrowRight, ShieldCheck } from 'lucide-react';
import { login, verifyMfa, requestPasswordReset, confirmPasswordReset, getSocialLoginUrl } from '../services/authService';

type AuthFlow = 'login' | 'request' | 'confirm' | 'mfa';

interface LoginProps {
    onLoginSuccess: () => void;
}

const MIN_RUNTIME_PASSWORD_LENGTH = 8;
const MIN_SETUP_PASSWORD_LENGTH = 12;

const decodeWorkspaceIdFromToken = (token: string): string | null => {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        return payload?.app_metadata?.workspace_id || null;
    } catch {
        return null;
    }
};

const GoogleMark = () => (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
        <path fill="#EA4335" d="M12 10.2v3.9h5.4c-.2 1.3-1.5 3.9-5.4 3.9-3.2 0-5.9-2.7-5.9-6s2.7-6 5.9-6c1.8 0 3 .8 3.7 1.4l2.5-2.4C16.5 3.5 14.4 2.6 12 2.6 6.9 2.6 2.8 6.8 2.8 12s4.1 9.4 9.2 9.4c5.3 0 8.8-3.7 8.8-8.9 0-.6-.1-1.1-.1-1.5H12z" />
        <path fill="#34A853" d="M2.8 7.1l3.2 2.3C6.8 7.8 9.2 6 12 6c1.8 0 3 .8 3.7 1.4l2.5-2.4C16.5 3.5 14.4 2.6 12 2.6c-3.6 0-6.8 2.1-8.3 5.2z" />
        <path fill="#FBBC05" d="M12 21.4c2.3 0 4.3-.8 5.8-2.2l-2.7-2.2c-.8.5-1.8.9-3.1.9-3.8 0-5.2-2.6-5.4-3.8l-3.2 2.5c1.5 3.1 4.7 4.8 8.6 4.8z" />
        <path fill="#4285F4" d="M21.8 12.5c0-.6-.1-1.1-.1-1.5H12v3.9h5.4c-.3 1.5-1.2 2.7-2.1 3.5l2.7 2.2c1.6-1.5 2.8-3.8 2.8-6.8z" />
    </svg>
);

const Login = ({ onLoginSuccess }: LoginProps) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [flow, setFlow] = useState<AuthFlow>('login');
    const [token, setToken] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [message, setMessage] = useState<string | null>(null);
    const [mfaCode, setMfaCode] = useState('');
    const [mfaUser, setMfaUser] = useState<string | null>(null);

    useEffect(() => {
        const resetToken = sessionStorage.getItem('ozy_reset_token');
        if (!resetToken) return;

        setToken(resetToken);
        setFlow('confirm');
        setMessage('Recovery token loaded. Set a new password.');
        sessionStorage.removeItem('ozy_reset_token');
    }, []);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setMessage(null);

        try {
            if (flow === 'login') {
                const data = await login(email, password);
                if (data.mfa_required) {
                    setMfaUser(data.mfa_store || null);
                    setFlow('mfa');
                    return;
                }

                if (data.error) throw new Error(data.error);

                if (data.token) {
                    localStorage.setItem('ozy_token', data.token);
                    const wsId = decodeWorkspaceIdFromToken(data.token);
                    if (wsId) localStorage.setItem('ozy_workspace_id', wsId);
                }
                localStorage.removeItem('ozy_api_key');
                if (data.user) localStorage.setItem('ozy_user', JSON.stringify(data.user));
                onLoginSuccess();
            } else if (flow === 'mfa') {
                if (!mfaUser) throw new Error('Missing MFA context');
                const data = await verifyMfa(mfaUser, mfaCode);
                if (data.error) throw new Error(data.error);

                if (data.token) {
                    localStorage.setItem('ozy_token', data.token);
                    const wsId = decodeWorkspaceIdFromToken(data.token);
                    if (wsId) localStorage.setItem('ozy_workspace_id', wsId);
                }
                localStorage.removeItem('ozy_api_key');
                localStorage.setItem('ozy_user', JSON.stringify(data.user ?? null));
                onLoginSuccess();
            } else if (flow === 'request') {
                const data = await requestPasswordReset(email);
                if (data.error) throw new Error(data.error);

                if (data.token) {
                    setToken(data.token);
                    setMessage('Recovery token prepared for this local environment. It is already loaded below.');
                } else {
                    setMessage('Recovery initiated. Use the token from your delivery channel to finish the reset.');
                }
                setFlow('confirm');
            } else if (flow === 'confirm') {
                const data = await confirmPasswordReset(token, newPassword);
                if (data.error) throw new Error(data.error);

                setMessage('Password reset successful. Sign in with the new password.');
                setFlow('login');
            }
        } catch (err: any) {
            setError(err.message || 'Unexpected error');
        } finally {
            setLoading(false);
        }
    };

    const handleSocialLogin = async (provider: 'google' | 'github') => {
        try {
            const url = await getSocialLoginUrl(provider);
            window.location.href = url;
        } catch (err: any) {
            setError(err.message || 'OAuth initialization failed');
        }
    };

    return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4 font-sans text-zinc-100">
            <div className="w-full max-w-md space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                <div className="flex flex-col items-center text-center space-y-4">
                    <div className="w-16 h-16 rounded-md flex items-center justify-center shadow-[0_0_30px_rgba(254,254,0,0.15)] ring-4 ring-primary/10 overflow-hidden border border-zinc-800">
                        <img src="/branding/logo.jpg" alt="OzyBase" className="w-full h-full object-cover" />
                    </div>
                    <div className="space-y-1">
                        <h1 className="text-3xl font-bold tracking-tighter text-white uppercase italic">
                            {flow === 'login' ? 'OzyBase' : 'Reset Access'}
                        </h1>
                        <p className="text-zinc-500 text-sm font-bold uppercase tracking-widest flex items-center justify-center gap-2">
                            <ShieldCheck size={14} className="text-primary" />
                            {flow === 'login' ? 'Single-Project Local' : 'Identity Recovery'}
                        </p>
                    </div>
                </div>

                <div className="bg-background/80 backdrop-blur-xl border border-border rounded-md p-8 shadow-2xl ring-1 ring-white/5">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        {error && (
                            <div className="bg-red-500/10 border border-red-500/20 rounded-md p-4 text-red-500 text-xs font-bold uppercase tracking-wide flex items-center gap-3 animate-in shake duration-300">
                                <div className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]" />
                                {error}
                            </div>
                        )}

                        {message && (
                            <div className="bg-green-500/10 border border-green-500/20 rounded-md p-4 text-green-500 text-xs font-bold uppercase tracking-wide flex items-center gap-3 animate-in fade-in">
                                <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.6)]" />
                                {message}
                            </div>
                        )}

                        {flow === 'login' && (
                            <>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] ml-1">BaaS Email</label>
                                    <div className="relative group">
                                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600 transition-colors group-focus-within:text-primary" size={18} />
                                        <input
                                            type="email"
                                            required
                                            value={email}
                                            onChange={(e: any) => setEmail(e.target.value)}
                                            placeholder="system@ozybase.local"
                                            className="w-full bg-background border border-border rounded-md pl-12 pr-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-700 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all font-mono"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <div className="flex justify-between items-center ml-1">
                                        <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em]">BaaS Password</label>
                                        <button
                                            type="button"
                                            onClick={() => setFlow('request')}
                                            className="text-[9px] font-bold text-zinc-600 hover:text-primary transition-colors uppercase"
                                        >
                                            Forgot access?
                                        </button>
                                    </div>
                                    <div className="relative group">
                                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600 transition-colors group-focus-within:text-primary" size={18} />
                                        <input
                                            type="password"
                                            required
                                            value={password}
                                            onChange={(e: any) => setPassword(e.target.value)}
                                            placeholder="Enter your admin password"
                                            className="w-full bg-background border border-border rounded-md pl-12 pr-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-700 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                                        />
                                    </div>
                                    <p className="ml-1 text-[10px] text-zinc-600">
                                        Runtime accounts use {MIN_RUNTIME_PASSWORD_LENGTH}+ characters. The first-run bootstrap remains stricter at {MIN_SETUP_PASSWORD_LENGTH}+ characters.
                                    </p>
                                </div>
                            </>
                        )}

                        {flow === 'request' && (
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] ml-1">Account Email</label>
                                <div className="relative group">
                                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600 transition-colors group-focus-within:text-primary" size={18} />
                                    <input
                                        type="email"
                                        required
                                        value={email}
                                        onChange={(e: any) => setEmail(e.target.value)}
                                        placeholder="system@ozybase.local"
                                        className="w-full bg-background border border-border rounded-md pl-12 pr-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-700 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                                    />
                                </div>
                                <p className="ml-1 text-[10px] text-zinc-600">
                                    Local mode prints the recovery token in server logs. Production should deliver it through your configured recovery channel.
                                </p>
                                <button
                                    type="button"
                                    onClick={() => setFlow('login')}
                                    className="text-[9px] font-bold text-zinc-600 hover:text-primary transition-colors uppercase ml-1"
                                >
                                    Back to login
                                </button>
                            </div>
                        )}

                        {flow === 'confirm' && (
                            <>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] ml-1">Recovery Token</label>
                                    <input
                                        type="text"
                                        required
                                        value={token}
                                        onChange={(e: any) => setToken(e.target.value)}
                                        placeholder="Paste token here"
                                        className="w-full bg-background border border-border rounded-md px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-700 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all font-mono"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] ml-1">New Password</label>
                                    <input
                                        type="password"
                                        required
                                        value={newPassword}
                                        onChange={(e: any) => setNewPassword(e.target.value)}
                                        minLength={MIN_RUNTIME_PASSWORD_LENGTH}
                                        placeholder={`Use ${MIN_RUNTIME_PASSWORD_LENGTH}+ characters`}
                                        className="w-full bg-background border border-border rounded-md px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-700 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                                    />
                                </div>
                                <p className="ml-1 text-[10px] text-zinc-600">
                                    Everyday authentication currently enforces {MIN_RUNTIME_PASSWORD_LENGTH}+ characters after setup is completed.
                                </p>
                                <button
                                    type="button"
                                    onClick={() => setFlow('login')}
                                    className="text-[9px] font-bold text-zinc-600 hover:text-primary transition-colors uppercase ml-1"
                                >
                                    Cancel
                                </button>
                            </>
                        )}

                        {flow === 'mfa' && (
                            <div className="space-y-4">
                                <div className="text-center space-y-2">
                                    <h3 className="text-sm font-bold text-white uppercase tracking-widest">Multi-Factor Authentication</h3>
                                    <p className="text-[10px] text-zinc-500 font-medium">Please enter the 6-digit code from your authenticator app.</p>
                                </div>
                                <div className="relative group">
                                    <ShieldCheck className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600 transition-colors group-focus-within:text-primary" size={18} />
                                    <input
                                        type="text"
                                        required
                                        maxLength={6}
                                        value={mfaCode}
                                        onChange={(e: any) => setMfaCode(e.target.value)}
                                        placeholder="000000"
                                        className="w-full bg-background border border-border rounded-md pl-12 pr-4 py-3 text-lg font-bold tracking-[0.5em] text-center text-primary placeholder:text-zinc-700 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all font-mono"
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setFlow('login')}
                                    className="w-full text-[9px] font-bold text-zinc-600 hover:text-primary transition-colors uppercase text-center"
                                >
                                    Cancel & Return
                                </button>
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-primary text-black py-4 rounded-md font-bold text-sm uppercase tracking-widest shadow-[0_0_20px_rgba(254,254,0,0.1)] hover:shadow-[0_0_30px_rgba(254,254,0,0.2)] hover:scale-[1.01] active:scale-[0.98] transition-all flex items-center justify-center gap-3 group disabled:opacity-50 disabled:scale-100"
                        >
                            {loading ? (
                                <Loader2 className="animate-spin" size={20} />
                            ) : (
                                <>
                                    {flow === 'login' ? 'Establish Link' : flow === 'mfa' ? 'Verify Identity' : flow === 'request' ? 'Request Recovery' : 'Reset Identity'}
                                    <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
                                </>
                            )}
                        </button>

                        {flow === 'login' && (
                            <div className="space-y-3">
                                <div className="relative flex items-center py-2">
                                    <div className="grow border-t border-zinc-800"></div>
                                    <span className="shrink mx-4 text-[10px] font-bold text-zinc-600 uppercase tracking-widest">or continue with</span>
                                    <div className="grow border-t border-zinc-800"></div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <button
                                        type="button"
                                        onClick={() => handleSocialLogin('google')}
                                        className="flex items-center justify-center gap-2 bg-sidebar border border-zinc-800 py-3 rounded-md hover:bg-zinc-800 transition-colors text-xs font-bold text-zinc-300"
                                    >
                                        <GoogleMark />
                                        Google
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleSocialLogin('github')}
                                        className="flex items-center justify-center gap-2 bg-sidebar border border-zinc-800 py-3 rounded-md hover:bg-zinc-800 transition-colors text-xs font-bold text-zinc-300"
                                    >
                                        <img src="/auth/providers/github.png" alt="" className="h-4 w-4 rounded-sm object-cover" />
                                        GitHub
                                    </button>
                                </div>
                            </div>
                        )}
                    </form>
                </div>

                <div className="text-center space-y-4">
                    <p className="text-zinc-600 text-[10px] font-bold uppercase tracking-widest">
                        OzyBase Engine v1.0.0-Ready
                    </p>
                </div>
            </div>
        </div>
    );
};

export default Login;


