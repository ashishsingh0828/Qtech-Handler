import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LogOut, Search } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../context/AuthContext';
import { hasPermission } from '@shared/permissions.js';
import NotificationBell from './NotificationBell';
import CommandPalette from './CommandPalette';

export default function AppShell() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const searchRef = useRef(null);
  const [query, setQuery] = useState('');
  const [palette, setPalette] = useState(false);
  const onDataset = location.pathname.startsWith('/datasets/');

  useEffect(() => {
    setQuery('');
  }, [location.pathname]);

  useEffect(() => {
    function onKey(event) {
      const typing = event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.isContentEditable;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPalette(true);
      }
      if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === 'Escape') setPalette(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex h-screen flex-col bg-canvas text-ink">
      <header className="flex h-16 shrink-0 items-center gap-6 border-b border-hairline bg-surface px-6">
        <button type="button" className="font-serif text-[28px] leading-none tracking-tight" onClick={() => navigate('/')}>
          QTECH
        </button>
        <nav className="flex items-center gap-4 text-[14px]">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'text-ink' : 'text-muted')}>Registry</NavLink>
          {hasPermission(user?.role, 'manageUsers') ? (
            <NavLink to="/users" className={({ isActive }) => (isActive ? 'text-ink' : 'text-muted')}>Users</NavLink>
          ) : null}
        </nav>
        <label className="relative ml-auto w-full max-w-[360px]">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            ref={searchRef}
            className="field pl-9"
            placeholder={onDataset ? 'Search rows' : 'Search the registry'}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search"
          />
        </label>
        <NotificationBell user={user} />
        <div className="hidden text-right sm:block">
          <div className="text-[13px] leading-tight">{user?.name}</div>
          <div className="text-[11px] uppercase tracking-[0.08em] text-muted">{user?.role}</div>
        </div>
        <button type="button" className="icon-btn" aria-label="Sign out" onClick={logout}>
          <LogOut size={16} />
        </button>
      </header>
      <div className="min-h-0 flex-1">
        <Outlet context={{ query, setQuery, searchRef }} />
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </div>
  );
}
