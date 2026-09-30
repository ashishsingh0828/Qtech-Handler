import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../../api';
import { useAuth, type SessionUser } from '../../context/AuthContext';

export default function LoginPage() {
  const { user, ready, setUser } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (ready && user) return <Navigate to="/" replace />;
  return (
    <div className="grid h-screen place-items-center bg-canvas px-4">
      <form
        className="card w-full max-w-[400px]"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            const data = await api<{ user: SessionUser }>('/api/auth/login', { method: 'POST', body: { email, password } });
            setUser(data.user);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Sign in failed');
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1 className="page-title">QTECH</h1>
        <p className="mt-1 text-[13px] text-muted">Sign in to the shared registry.</p>
        <label className="mt-5 block">
          <span className="mb-1.5 block text-[13px] text-ink2">Email</span>
          <input className="field" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" />
        </label>
        <label className="mt-3 block">
          <span className="mb-1.5 block text-[13px] text-ink2">Password</span>
          <input className="field" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
        </label>
        {error ? <p className="mt-3 text-[13px] text-[#A63A38]">{error}</p> : null}
        <button className="btn btn-primary mt-5 w-full" type="submit" disabled={busy}>Sign in</button>
      </form>
    </div>
  );
}
