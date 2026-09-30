import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { PRESET_USERS } from '@shared/presets.ts';
import { api } from '../../api';
import { useAuth, type SessionUser } from '../../context/AuthContext';

export default function LoginPage() {
  const { user, ready, setUser } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  if (ready && user) return <Navigate to="/" replace />;

  async function signIn(nextEmail: string, nextPassword: string, key: string) {
    setBusy(key);
    setError('');
    try {
      const data = await api<{ user: SessionUser }>('/api/auth/login', {
        method: 'POST',
        body: { email: nextEmail, password: nextPassword },
      });
      setUser(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-canvas px-4 py-8">
      <div className="grid w-full max-w-[920px] gap-4">
        <form
          className="card"
          onSubmit={(event) => {
            event.preventDefault();
            void signIn(email, password, 'form');
          }}
        >
          <h1 className="page-title">QTECH</h1>
          <p className="mt-1 text-[13px] text-muted">Sign in with one of the four role accounts, or type an email and password.</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[13px] text-ink2">Email</span>
              <input className="field" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] text-ink2">Password</span>
              <input className="field" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
            </label>
          </div>
          {error ? <p className="mt-3 text-[13px] text-[#A63A38]">{error}</p> : null}
          <button className="btn btn-primary mt-5" type="submit" disabled={busy !== ''}>Sign in</button>
        </form>
        <div className="grid gap-3 sm:grid-cols-2">
          {PRESET_USERS.map((preset) => (
            <button
              key={preset.role}
              type="button"
              className="card text-left"
              disabled={busy !== ''}
              onClick={() => { void signIn(preset.email, preset.password, preset.role); }}
            >
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{preset.roleLabel}</span>
              <span className="mt-1 block text-[16px] font-medium text-ink">{preset.name}</span>
              <span className="mt-3 block text-[13px] text-ink2">{preset.email}</span>
              <span className="mt-1 block text-[13px] text-ink">{preset.password}</span>
              <span className="btn btn-secondary mt-4">{busy === preset.role ? 'Signing in' : `Open ${preset.roleLabel}`}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
