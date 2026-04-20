import React, { useState, useEffect } from 'react';
import {
  Shield,
  Globe,
  Check,
  X,
  AlertTriangle,
  Loader2,
  Info,
  ShieldCheck,
  ShieldAlert,
  MapPin,
  Lock,
  ArrowRight,
} from 'lucide-react';
import { fetchWithAuth } from '../utils/api';
import ModuleScrollContainer from './ModuleScrollContainer';
import { BrandedToast } from './OverlayPrimitives';

interface GeoFencingPolicy {
  enabled: boolean;
  blocked_countries: string[];
}

interface SecurityPolicies {
  geo_fencing: GeoFencingPolicy;
  [key: string]: unknown;
}

const coerceGeoPolicy = (value: unknown): GeoFencingPolicy => {
  if (typeof value !== 'object' || value === null) {
    return { enabled: false, blocked_countries: [] };
  }

  const raw = value as {
    enabled?: unknown;
    blocked_countries?: unknown;
    allowed_countries?: unknown;
  };
  const blocked = Array.isArray(raw.blocked_countries)
    ? raw.blocked_countries.filter(
        (country): country is string => typeof country === 'string',
      )
    : Array.isArray(raw.allowed_countries)
      ? raw.allowed_countries.filter(
          (country): country is string => typeof country === 'string',
        )
      : [];

  return {
    enabled: Boolean(raw.enabled),
    blocked_countries: blocked,
  };
};

const SecurityManager = () => {
  const [policies, setPolicies] = useState<SecurityPolicies | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newCountry, setNewCountry] = useState('');
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

  const fetchPolicies = async () => {
    try {
      const res = await fetchWithAuth('/api/project/security/policies');
      if (!res.ok) throw new Error('Failed to fetch policies');
      const data: unknown = await res.json();
      if (
        data &&
        typeof data === 'object' &&
        'geo_fencing' in data &&
        typeof (data as { geo_fencing?: unknown }).geo_fencing === 'object'
      ) {
        setPolicies({
          ...(data as Record<string, unknown>),
          geo_fencing: coerceGeoPolicy(
            (data as { geo_fencing?: unknown }).geo_fencing,
          ),
        });
      } else {
        setPolicies({ geo_fencing: { enabled: false, blocked_countries: [] } });
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPolicies();
  }, []);

  const savePolicy = async (type: string, config: GeoFencingPolicy) => {
    setSaving(true);
    try {
      const res = await fetchWithAuth('/api/project/security/policies', {
        method: 'POST',
        body: JSON.stringify({ type, config }),
      });
      if (res.ok) {
        setToast({ message: 'Perimeter configuration synchronized', tone: 'success' });
      } else {
        throw new Error('Sync failure');
      }
    } catch (error) {
      console.error('Failed to update security policy', error);
      setToast({ message: 'Critical error during policy sync', tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const toggleGeoFencing = () => {
    if (!policies) return;
    const newPolicy = {
      ...policies.geo_fencing,
      enabled: !policies.geo_fencing.enabled,
    };
    setPolicies({ ...policies, geo_fencing: newPolicy });
    savePolicy('geo_fencing', newPolicy);
  };

  const addCountry = () => {
    if (!policies) return;
    const normalizedCountry = newCountry.trim();
    if (!normalizedCountry) return;
    const alreadyExists = policies.geo_fencing.blocked_countries.some(
      (country: string) =>
        country.trim().toLowerCase() === normalizedCountry.toLowerCase(),
    );
    if (alreadyExists) {
        setToast({ message: 'Vector already exists in blocklist', tone: 'error' });
        return;
    }
    const newPolicy = {
      ...policies.geo_fencing,
      blocked_countries: [
        ...policies.geo_fencing.blocked_countries,
        normalizedCountry,
      ],
    };
    setPolicies({ ...policies, geo_fencing: newPolicy });
    savePolicy('geo_fencing', newPolicy);
    setNewCountry('');
  };

  const removeCountry = (country: string) => {
    if (!policies) return;
    const newPolicy = {
      ...policies.geo_fencing,
      blocked_countries: policies.geo_fencing.blocked_countries.filter(
        (c: any) => c !== country,
      ),
    };
    setPolicies({ ...policies, geo_fencing: newPolicy });
    savePolicy('geo_fencing', newPolicy);
  };

  if (loading)
    return (
      <div className="flex h-full items-center justify-center gap-4 text-zinc-700 font-mono">
        <Loader2 className="animate-spin text-primary" size={24} />
        <span className="text-[10px] font-bold uppercase tracking-[0.3em]">Resolving_Security_Nodes...</span>
      </div>
    );

  if (!policies) return null;

  const geo = coerceGeoPolicy(policies.geo_fencing);

  return (
    <ModuleScrollContainer
      width="5xl"
      innerClassName="animate-in fade-in duration-700 py-12"
    >
      <header className="flex items-center justify-between mb-12 border-b border-white/5 pb-12 relative overflow-hidden group">
        <div className="flex items-center gap-8">
          <div className="w-16 h-16 rounded-md bg-primary/5 border border-primary/20 flex items-center justify-center text-primary shadow-[0_0_40px_rgba(254,254,0,0.05)]">
            <Globe size={32} strokeWidth={1.5} className={geo.enabled ? 'animate-pulse' : ''} />
          </div>
          <div>
            <h1 className="text-4xl font-bold text-white italic tracking-tighter uppercase leading-none">
              Geo-Fencing
            </h1>
            <p className="mt-4 text-[11px] font-bold text-zinc-500 uppercase tracking-wide leading-relaxed max-w-lg">
              Advanced geographic access control matrix. Govern request flow by enforcing regional perimeter boundaries and protocol denylists.
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-3">
             <div className="px-5 py-2 rounded-md bg-black/40 border border-white/5 flex items-center gap-3">
                <div className={`w-1.5 h-1.5 rounded-full ${geo.enabled ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500'}`} />
                <span className="text-[10px] font-bold text-white/60 uppercase tracking-widest">{geo.enabled ? 'PROTECTED' : 'UNRESTRICTED'}</span>
             </div>
             <button
                onClick={toggleGeoFencing}
                disabled={saving}
                className={`h-12 flex items-center gap-3 px-8 rounded-md font-bold text-[10px] uppercase tracking-widest transition-all ${geo.enabled ? 'bg-red-500/10 border border-red-500/20 text-red-500 hover:bg-red-500 hover:text-black' : 'bg-primary text-black hover:scale-105 active:scale-95'}`}
            >
                {saving ? (
                    <Loader2 size={14} className="animate-spin" />
                ) : geo.enabled ? (
                    <X size={14} strokeWidth={3} />
                ) : (
                    <Check size={14} strokeWidth={3} />
                )}
                {saving ? 'SYNCING...' : geo.enabled ? 'Disable_Perimeter' : 'Enlist_Shield'}
            </button>
        </div>
      </header>

      <div className="space-y-10 group/content">
        <div className={`rounded-[48px] border bg-background p-12 transition-all duration-700 shadow-2xl relative overflow-hidden ${geo.enabled ? 'border-primary/10' : 'border-white/5 opacity-50 contrast-75'}`}>
          <div className="absolute inset-0 bg-linear-to-br from-primary/2 to-transparent pointer-events-none" />
          
          <div className="mb-12 flex items-start justify-between relative z-10">
            <div className="space-y-4">
              <h2 className="text-2xl font-bold tracking-tight text-white uppercase italic">
                Denylist Matrix
              </h2>
              <p className="max-w-md text-[11px] font-medium text-zinc-500 leading-relaxed uppercase tracking-wider">
                Specify designated regions to be immediately rejected upon connection attempt.
              </p>
            </div>
            <div className="w-12 h-12 rounded-md bg-white/3 border border-white/5 flex items-center justify-center text-zinc-600">
                <Lock size={20} />
            </div>
          </div>

          <div className="space-y-10 relative z-10">
             <div className="p-2 bg-black/40 rounded-[32px] border border-white/5 shadow-inner flex gap-2">
                <div className="flex-1 flex items-center px-6 gap-4">
                    <MapPin size={18} className="text-zinc-700" />
                    <input
                        type="text"
                        placeholder="ENTER_COUNTRY_VECTOR (e.g. RU, CN, KP)..."
                        value={newCountry}
                        onChange={(e: any) => setNewCountry(e.target.value)}
                        className="w-full bg-transparent border-none text-[11px] font-bold text-white focus:outline-none placeholder:text-zinc-800 uppercase tracking-widest"
                    />
                </div>
                <button
                    onClick={addCountry}
                    disabled={saving || !geo.enabled}
                    className="h-14 px-10 rounded-md bg-white/5 border border-white/10 text-white font-bold text-[10px] uppercase tracking-[0.3em] transition-all hover:bg-white hover:text-black disabled:opacity-20 flex items-center gap-3 active:scale-95"
                >
                    Provision <ArrowRight size={14} />
                </button>
             </div>

             <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {geo.blocked_countries.map((country: any) => (
                  <div
                    key={country}
                    className="group/chip relative flex items-center justify-between gap-4 rounded-md border border-red-500/10 bg-red-500/3 p-5 transition-all hover:border-red-500/30 hover:bg-red-500/5"
                  >
                    <div className="flex items-center gap-4">
                        <div className="w-8 h-8 rounded-md bg-red-500/10 flex items-center justify-center text-red-500 border border-red-500/20">
                            <ShieldAlert size={16} />
                        </div>
                        <span className="text-[11px] font-bold text-white uppercase tracking-widest italic">{country}</span>
                    </div>
                    <button
                      disabled={saving}
                      onClick={() => removeCountry(country)}
                      className="w-8 h-8 rounded-md bg-black/40 border border-white/5 flex items-center justify-center text-zinc-600 hover:text-red-500 transition-all opacity-0 group-hover/chip:opacity-100"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}

                {geo.blocked_countries.length === 0 && (
                  <div className="col-span-full border-2 border-dashed border-white/5 rounded-[32px] p-20 flex flex-col items-center justify-center gap-6 group/placeholder">
                    <div className="w-16 h-16 rounded-[24px] bg-white/2 border border-white/5 flex items-center justify-center text-zinc-800 transition-all group-hover/placeholder:scale-110">
                        <Info size={32} />
                    </div>
                    <div className="text-center">
                        <p className="text-[11px] font-bold text-zinc-700 uppercase tracking-[0.4em] italic leading-none">Global Perimeter Transparent</p>
                        <p className="mt-3 text-[9px] font-medium text-zinc-800 uppercase tracking-widest">No geographic restriction protocols currently synchronized</p>
                    </div>
                  </div>
                )}
             </div>

             <div className="flex items-center gap-6 p-8 rounded-[32px] border border-amber-500/10 bg-amber-500/2 relative overflow-hidden group/alert">
                <div className="absolute inset-0 bg-amber-500/2 opacity-0 group-hover/alert:opacity-100 transition-opacity" />
                <div className="w-10 h-10 rounded-md bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 shrink-0">
                    <AlertTriangle size={20} />
                </div>
                <div>
                   <h4 className="text-[10px] font-bold text-amber-500/80 uppercase tracking-widest italic leading-none">Heuristic Enforcement Monitor</h4>
                   <p className="mt-3 text-[10px] font-medium text-zinc-600 leading-relaxed tracking-wide">
                      Enabling geo-fencing will trigger immediate kernel logging of geographic breaches. All violations are persisted in the [security.alerts] hub for future architectural audit.
                   </p>
                </div>
             </div>
          </div>
        </div>
      </div>

      {toast && (
        <BrandedToast
            tone={toast.tone}
            message={toast.message}
            onClose={() => setToast(null)}
            position="bottom-right"
        />
      )}
    </ModuleScrollContainer>
  );
};

export default SecurityManager;


