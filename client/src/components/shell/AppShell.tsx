import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useNavigate, useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Bell, Database, LayoutDashboard, LogOut, ScrollText, Search, Table2, Users } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { readPref, writePref } from '../../lib/storage';
import { roleTitle, type Role } from '@shared/permissions.ts';
import { Menu, MenuItem, Modal, SelectField } from '../ui';
import CommandPalette from './CommandPalette';
import NotificationPanel from './NotificationPanel';

interface DatasetCard { id: string; name: string; rowCount: number; columnCount: number }

const ICONS = {
  home: LayoutDashboard,
  records: Table2,
  datasets: Database,
  team: Users,
  schema: ScrollText,
  activity: Activity,
};

function navFor(role: Role) {
  if (role === 'ADMIN') return [
    { to: '/', label: 'Command Center', icon: 'home' as const, end: true },
    { to: '/records', label: 'Records', icon: 'records' as const, end: false },
    { to: '/datasets', label: 'Datasets', icon: 'datasets' as const, end: false },
    { to: '/team', label: 'Team', icon: 'team' as const, end: false },
    { to: '/schema', label: 'Schema', icon: 'schema' as const, end: false },
    { to: '/activity', label: 'Activity', icon: 'activity' as const, end: false },
  ];
  if (role === 'MANAGER') return [
    { to: '/', label: 'Control Room', icon: 'home' as const, end: true },
    { to: '/records', label: 'Records', icon: 'records' as const, end: false },
    { to: '/datasets', label: 'Datasets', icon: 'datasets' as const, end: false },
    { to: '/activity', label: 'Activity', icon: 'activity' as const, end: false },
  ];
  if (role === 'VALIDATOR') return [
    { to: '/', label: 'My Desk', icon: 'home' as const, end: true },
    { to: '/records', label: 'Records', icon: 'records' as const, end: false },
  ];
  return [
    { to: '/', label: 'Service Desk', icon: 'home' as const, end: true },
    { to: '/records', label: 'Records', icon: 'records' as const, end: false },
  ];
}

export default function AppShell() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [palette, setPalette] = useState(false);
  const [bell, setBell] = useState(false);
  const [live, setLive] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const role = user?.role || 'SERVICE';
  const links = navFor(role);
  const datasets = useQuery({
    queryKey: ['datasets'],
    queryFn: () => api<{ datasets: DatasetCard[] }>('/api/datasets'),
  });
  const datasetKey = user ? `qtech.dataset.${user.id}` : '';
  const [datasetId, setDatasetId] = useState('');
  useEffect(() => {
    if (!user) return;
    const stored = readPref(`qtech.dataset.${user.id}`, '');
    const list = datasets.data?.datasets || [];
    const next = list.some((item) => item.id === stored) ? stored : (list[0]?.id || '');
    setDatasetId(next);
  }, [user, datasets.data]);
  useEffect(() => {
    const source = new EventSource('/api/events', { withCredentials: true });
    source.onopen = () => setLive(true);
    source.onerror = () => setLive(false);
    source.onmessage = (event) => {
      const payload = JSON.parse(event.data) as { type?: string; datasetId?: string | null };
      setLive(true);
      if (payload.type === 'hello') return;
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['activity'] });
      queryClient.invalidateQueries({ queryKey: ['record'] });
      queryClient.invalidateQueries({ queryKey: ['datasets'] });
      if (payload.datasetId) queryClient.invalidateQueries({ queryKey: ['rows', payload.datasetId] });
      else queryClient.invalidateQueries({ queryKey: ['rows'] });
    };
    return () => source.close();
  }, [queryClient]);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const typing = event.target instanceof HTMLElement && (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA');
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPalette(true);
      }
      if (event.key === '/' && !typing) {
        event.preventDefault();
        const search = document.getElementById('page-search');
        if (search instanceof HTMLInputElement) search.focus();
        else setPalette(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const options = useMemo(() => (datasets.data?.datasets || []).map((item) => ({ value: item.id, label: item.name })), [datasets.data]);
  if (!user) return null;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button type="button" className="flex h-14 items-center px-4" onClick={() => navigate('/')}>
          <span className="font-serif text-[24px] leading-none">Q</span>
          <span className="ml-2 hidden truncate text-[13px] min-[1280px]:inline">QTECH</span>
        </button>
        <nav className="mt-2 flex flex-1 flex-col gap-1">
          {links.map((link) => {
            const Icon = ICONS[link.icon];
            return (
              <NavLink key={link.to} to={link.to} end={link.end} title={link.label} className={({ isActive }) => `side-link ${isActive ? 'side-link-active' : ''}`}>
                <Icon size={16} strokeWidth={1.5} />
                <span className="hidden min-[1280px]:inline">{link.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </aside>
      {railOpen ? (
        <button type="button" className="scrim min-[1280px]:hidden" aria-label="Close navigation" onClick={() => setRailOpen(false)} />
      ) : null}
      <div className="main-column">
        <header className="topbar">
          <button type="button" className="icon-btn min-[1280px]:hidden max-[767px]:hidden" aria-label="Navigation" onClick={() => setRailOpen(true)}>
            <LayoutDashboard size={16} strokeWidth={1.5} />
          </button>
          <button type="button" className="field flex max-w-[280px] items-center gap-2 text-left text-muted" onClick={() => setPalette(true)}>
            <Search size={14} strokeWidth={1.5} />
            <span className="min-w-0 flex-1 truncate">Search</span>
            <span className="text-[12px]">⌘K</span>
          </button>
          <div className="ml-auto min-w-0 w-[220px] max-w-full">
            {options.length ? (
              <SelectField
                value={datasetId || options[0].value}
                placeholder="Dataset"
                options={options}
                onChange={(id) => {
                  setDatasetId(id);
                  if (datasetKey) writePref(datasetKey, id);
                }}
              />
            ) : <div className="field flex items-center text-muted">No dataset</div>}
          </div>
          <span className={`live-dot ${live ? 'on' : ''}`} title={live ? 'Live' : 'Reconnecting'} />
          <button type="button" className="icon-btn relative" aria-label="Notifications" onClick={() => setBell(true)}>
            <Bell size={16} strokeWidth={1.5} />
          </button>
          <Menu trigger={<button type="button" className="icon-btn" aria-label="Account">{user.name.slice(0, 1)}</button>}>
            <div className="px-2 py-1 text-[12px] text-muted">{roleTitle(user.role)}</div>
            <MenuItem onSelect={() => setPasswordOpen(true)}>Change password</MenuItem>
            <MenuItem danger onSelect={() => {
              api('/api/auth/logout', { method: 'POST' }).catch(() => undefined).finally(() => {
                setUser(null);
                navigate('/login');
              });
            }}><span className="inline-flex items-center gap-2"><LogOut size={14} strokeWidth={1.5} /> Sign out</span></MenuItem>
          </Menu>
        </header>
        <div className="content-scroll">
          <Outlet context={{ datasetId, setDatasetId: (id: string) => { setDatasetId(id); if (datasetKey) writePref(datasetKey, id); } }} />
        </div>
      </div>
      <nav className="bottom-nav">
        {links.slice(0, 5).map((link) => {
          const Icon = ICONS[link.icon];
          return (
            <NavLink key={link.to} to={link.to} end={link.end} className={({ isActive }) => `grid place-items-center text-[11px] ${isActive ? 'text-ink' : 'text-muted'}`}>
              <Icon size={16} strokeWidth={1.5} />
              <span className="clip max-w-full px-1">{link.label.split(' ')[0]}</span>
            </NavLink>
          );
        })}
      </nav>
      <CommandPalette open={palette} onClose={() => setPalette(false)} links={links} datasets={datasets.data?.datasets || []} onDataset={(id) => { setDatasetId(id); if (datasetKey) writePref(datasetKey, id); }} />
      <NotificationPanel open={bell} onClose={() => setBell(false)} />
      <Modal title="Change password" open={passwordOpen} onClose={() => setPasswordOpen(false)}>
        <label className="block">
          <span className="mb-1.5 block text-[13px] text-ink2">Current password</span>
          <input className="field" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
        </label>
        <label className="mt-3 block">
          <span className="mb-1.5 block text-[13px] text-ink2">New password</span>
          <input className="field" type="password" value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} />
        </label>
        <button
          type="button"
          className="btn btn-primary mt-4"
          onClick={() => {
            api('/api/auth/password', { method: 'POST', body: { currentPassword, nextPassword } })
              .then(() => { toast.push('Password updated'); setPasswordOpen(false); })
              .catch((error: Error) => toast.push(error.message));
          }}
        >Save</button>
      </Modal>
      {railOpen ? (
        <aside className="rail-overlay min-[1280px]:hidden max-[767px]:hidden">
          <nav className="mt-4 flex flex-col gap-1">
            {links.map((link) => (
              <NavLink key={link.to} to={link.to} end={link.end} className="side-link text-ink" onClick={() => setRailOpen(false)}>{link.label}</NavLink>
            ))}
          </nav>
        </aside>
      ) : null}
    </div>
  );
}

export function useOutletDataset(): { datasetId: string; setDatasetId: (id: string) => void } {
  return useOutletContext<{ datasetId: string; setDatasetId: (id: string) => void }>();
}
