import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { BadgeCheck, Briefcase, Shield, Wrench } from 'lucide-react';
import { PRESET_USERS } from '@shared/presets.ts';
import { api } from '../../api';
import { useAuth, type SessionUser } from '../../context/AuthContext';

const ICONS = {
  ADMIN: Shield,
  MANAGER: Briefcase,
  VALIDATOR: BadgeCheck,
  SERVICE: Wrench,
} as const;

export default function LoginPage() {
  const { user, ready, setUser } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  if (ready && user) return <Navigate to="/" replace />;

  async function enter(role: string) {
    setBusy(role);
    setError('');
    try {
      const data = await api<{ user: SessionUser }>('/api/auth/enter', { method: 'POST', body: { role } });
      setUser(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open that workspace');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-canvas px-4 py-8">
      <div className="w-full max-w-[640px]">
        <h1 className="page-title text-center">QTECH</h1>
        <p className="mt-1 text-center text-[13px] text-muted">Choose a workspace.</p>
        <div className="mt-6 grid grid-cols-2 gap-4">
          {PRESET_USERS.map((preset) => {
            const Icon = ICONS[preset.role];
            return (
              <button
                key={preset.role}
                type="button"
                className="card flex flex-col items-center gap-3 py-8 text-ink"
                disabled={busy !== ''}
                onClick={() => { void enter(preset.role); }}
              >
                <Icon size={40} strokeWidth={1.5} />
                <span className="text-[15px] font-medium">{busy === preset.role ? 'Opening' : preset.roleLabel}</span>
              </button>
            );
          })}
        </div>
        {error ? <p className="mt-4 text-center text-[13px] text-[#A63A38]">{error}</p> : null}
      </div>
    </div>
  );
}
