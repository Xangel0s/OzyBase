import React, { useState } from 'react';
import { Database, Lock, Mail, Loader2, ArrowRight, ShieldCheck } from 'lucide-react';

const Login = ({ onLoginSuccess }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Login failed');
            }

            localStorage.setItem('ozy_token', data.token);
            localStorage.setItem('ozy_user', JSON.stringify(data.user));
            onLoginSuccess();
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#111111] flex items-center justify-center p-4 font-sans text-zinc-100">
            <div className="w-full max-w-md space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                {/* Logo & Header */}
                <div className="flex flex-col items-center text-center space-y-4">
                    <div className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-[0_0_30px_rgba(254,254,0,0.15)] ring-4 ring-primary/10 overflow-hidden border border-zinc-800">
                        <img src="/logo.jpg" alt="OzyBase" className="w-full h-full object-cover" />
                    </div>
                    <div className="space-y-1">
                        <h1 className="text-3xl font-bold tracking-tighter text-white uppercase italic">OzyBase</h1>
                        <p className="text-zinc-500 text-sm font-medium uppercase tracking-widest flex items-center justify-center gap-2">
                            <ShieldCheck size={14} className="text-primary" />
                            Backend Fortress
                        </p>
                    </div>
                </div>

                {/* Login Card */}
                <div className="bg-[#171717]/80 backdrop-blur-xl border border-[#2e2e2e] rounded-2xl p-8 shadow-2xl ring-1 ring-white/5">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        {error && (
                            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-500 text-xs font-bold uppercase tracking-wide flex items-center gap-3 animate-in shake duration-300">
                                <div className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]" />
                                {error}
                            </div>
                        )}

                        <div className="space-y-2">
                            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] ml-1">Admin Email</label>
                            <div className="relative group">
                                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600 transition-colors group-focus-within:text-primary" size={18} />
                                <input
                                    type="email"
                                    required
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="system@ozybase.local"
                                    className="w-full bg-[#111111] border border-[#2e2e2e] rounded-xl pl-12 pr-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-700 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] ml-1">Access Key</label>
                            <div className="relative group">
                                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600 transition-colors group-focus-within:text-primary" size={18} />
                                <input
                                    type="password"
                                    required
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="Enter your 32-char password"
                                    className="w-full bg-[#111111] border border-[#2e2e2e] rounded-xl pl-12 pr-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-700 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-all"
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-primary text-black py-4 rounded-xl font-black text-sm uppercase tracking-widest shadow-[0_0_20px_rgba(254,254,0,0.1)] hover:shadow-[0_0_30px_rgba(254,254,0,0.2)] hover:scale-[1.01] active:scale-[0.98] transition-all flex items-center justify-center gap-3 group disabled:opacity-50 disabled:scale-100"
                        >
                            {loading ? (
                                <Loader2 className="animate-spin" size={20} />
                            ) : (
                                <>
                                    Establish Link
                                    <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
                                </>
                            )}
                        </button>
                    </form>
                </div>

                {/* Footer Info */}
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
