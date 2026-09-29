import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../context/AuthContext';
import { Field } from '../ui';

export default function LoginPage() {
  const { user, ready, setUser } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!ready) return <div className="h-screen bg-canvas" />;
  if (user) return <Navigate to="/" replace />;

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      setUser(data.user);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message || 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <div className="card w-full max-w-[420px] px-8 py-10">
        <div className="mb-8">
          <div className="font-serif text-[52px] leading-none tracking-tight text-ink">QTECH</div>
          <div className="mt-3 text-[11px] uppercase tracking-[0.18em] text-muted">Data Management</div>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Email">
            <input className="field" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </Field>
          <Field label="Password">
            <input className="field" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </Field>
          {error ? <p className="text-[13px] text-[var(--ruby-txt)]">{error}</p> : null}
          <button className="btn btn-primary mt-2 w-full" type="submit" disabled={busy}>
            {busy ? 'Signing in' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
