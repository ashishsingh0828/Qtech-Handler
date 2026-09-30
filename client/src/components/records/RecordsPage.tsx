import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { api, downloadExcel, uploadWorkbook } from '../../api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useOutletDataset } from '../shell/AppShell';
import { CheckField, EmptyState, PageHeader, StatusPill } from '../ui';
import RecordDrawer from './RecordDrawer';
import { GROUP_CATALOG, hasPermission } from '@shared/permissions.ts';
import { readPref, writePref } from '../../lib/storage';
import type { Derived, Tone } from '@shared/metrics.ts';

interface Column { id: string; key: string; label: string; groupKey: string; dataType: string; displayOrder: number }
interface RecordRow {
  id: string;
  version: number;
  position: number;
  serialNo: string | null;
  customerName: string | null;
  data: Record<string, string | number | null>;
  derived: Derived;
}
interface Counts {
  all: number;
  needs_validation: number;
  validation_overdue: number;
  pending_verification: number;
  amc_due: number;
  pms_overdue: number;
  followup_due: number;
  expiring_soon: number;
  duplicates: number;
  missing_dates: number;
}

const CHIPS: { id: string; label: string; count: keyof Counts }[] = [
  { id: 'all', label: 'All', count: 'all' },
  { id: 'needs_validation', label: 'Needs validation', count: 'needs_validation' },
  { id: 'validation_overdue', label: 'Overdue', count: 'validation_overdue' },
  { id: 'pending_verification', label: 'Pending verify', count: 'pending_verification' },
  { id: 'amc_due', label: 'AMC due', count: 'amc_due' },
  { id: 'pms_overdue', label: 'PMS overdue', count: 'pms_overdue' },
  { id: 'followup_due', label: 'Follow-up', count: 'followup_due' },
];

export default function RecordsPage() {
  const { datasetId } = useOutletDataset();
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const parentRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [group, setGroup] = useState('customer_detail');
  const [chip, setChip] = useState('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('position');
  const [density, setDensity] = useState('comfortable');
  const [advanced, setAdvanced] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  useEffect(() => {
    if (!user) return;
    setGroup(readPref(`qtech.group.${user.id}`, 'customer_detail'));
    setChip(readPref(`qtech.chip.${user.id}`, 'all'));
    setDensity(readPref(`qtech.density.${user.id}`, 'comfortable'));
  }, [user]);
  const dataset = useQuery({
    queryKey: ['dataset', datasetId],
    enabled: Boolean(datasetId),
    queryFn: () => api<{ dataset: { id: string; name: string; columns: Column[] } }>(`/api/datasets/${datasetId}`),
  });
  const rows = useQuery({
    queryKey: ['rows', datasetId, chip, q, sort],
    enabled: Boolean(datasetId),
    queryFn: () => api<{ rows: RecordRow[]; total: number; counts: Counts }>(`/api/datasets/${datasetId}/rows?chip=${chip}&q=${encodeURIComponent(q)}&sort=${sort}&limit=200`),
  });
  const columns = dataset.data?.dataset.columns || [];
  const visible = useMemo(() => {
    if (advanced && (user?.role === 'ADMIN' || user?.role === 'MANAGER')) return columns;
    return columns.filter((column) => column.groupKey === group).slice(0, 10);
  }, [advanced, columns, group, user?.role]);
  const list = rows.data?.rows || [];
  const virtualizer = useVirtualizer({ count: list.length, getScrollElement: () => parentRef.current, estimateSize: () => density === 'compact' ? 36 : 48, overscan: 8 });
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const typing = event.target instanceof HTMLElement && (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA');
      if (typing) return;
      if (event.key === 'j') setCursor((value) => Math.min(list.length - 1, value + 1));
      if (event.key === 'k') setCursor((value) => Math.max(0, value - 1));
      if (event.key === 'Enter' && list[cursor]) setOpenId(list[cursor].id);
      if (event.key === 'Escape') setOpenId(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cursor, list]);
  const counts = rows.data?.counts;
  function toggle(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }
  async function bulk(path: string, body: Record<string, unknown>) {
    const items = list.filter((row) => selected.includes(row.id)).map((row) => ({ rowId: row.id, version: row.version }));
    try {
      await api(path, { method: 'POST', body: { datasetId, items, ...body } });
      setSelected([]);
      queryClient.invalidateQueries({ queryKey: ['rows', datasetId] });
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Bulk action failed');
    }
  }
  if (!datasetId) return <div className="page"><EmptyState title="Import a workbook to open the registry." /></div>;
  return (
    <div className="page">
      <PageHeader title={dataset.data?.dataset.name || 'Records'} subtitle={`${rows.data?.total || 0} records`}>
        <input id="page-search" className="field w-[220px] max-w-full" placeholder="Search" value={q} onChange={(event) => setQ(event.target.value)} />
        <button type="button" className="btn btn-secondary" onClick={() => { const next = density === 'compact' ? 'comfortable' : 'compact'; setDensity(next); if (user) writePref(`qtech.density.${user.id}`, next); }}>{density === 'compact' ? 'Comfortable' : 'Compact'}</button>
        {user && hasPermission(user.role, 'uploadExcel') ? <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()}>Upload</button> : null}
        <button type="button" className="btn btn-secondary" onClick={() => downloadExcel(`/api/datasets/${datasetId}/export?group=${advanced ? 'all' : group}`, 'records.xlsx').catch((error: Error) => toast.push(error.message))}>Export</button>
        {user && (user.role === 'ADMIN' || user.role === 'MANAGER') ? (
          <button type="button" className="btn btn-secondary" onClick={() => setAdvanced((value) => !value)}>{advanced ? 'One group' : 'All columns'}</button>
        ) : null}
      </PageHeader>
      <input ref={fileRef} type="file" accept=".xlsx,.xls" hidden onChange={(event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        uploadWorkbook(file, datasetId).then(() => {
          queryClient.invalidateQueries({ queryKey: ['rows', datasetId] });
          queryClient.invalidateQueries({ queryKey: ['dataset', datasetId] });
        }).catch((error: Error) => toast.push(error.message));
      }} />
      <div className="mb-3 flex gap-2 overflow-x-auto">
        {GROUP_CATALOG.map((item) => (
          <button key={item.key} type="button" className="gold-tab" data-active={group === item.key} onClick={() => { setGroup(item.key); if (user) writePref(`qtech.group.${user.id}`, item.key); }}>
            {item.title} <span className="tabular-nums text-muted">{columns.filter((column) => column.groupKey === item.key).length}</span>
          </button>
        ))}
      </div>
      <div className="mb-3 flex gap-2 overflow-x-auto">
        {CHIPS.map((item) => (
          <button key={item.id} type="button" className={`btn ${chip === item.id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setChip(item.id); if (user) writePref(`qtech.chip.${user.id}`, item.id); }}>
            {item.label} <span className="tabular-nums">{counts ? counts[item.count] : 0}</span>
          </button>
        ))}
        <button type="button" className="btn btn-secondary" onClick={() => setSort(sort === 'customer' ? 'serial' : sort === 'serial' ? 'position' : 'customer')}>Sort</button>
      </div>
      <div className="record-table">
        <div className={`table-scroll ${density === 'compact' ? 'dense' : ''}`} ref={parentRef} style={{ maxHeight: 'calc(100vh - 320px)' }}>
          <table className="grid-table">
            <thead>
              <tr>
                <th className="pin" style={{ left: 0, minWidth: 72 }}>#</th>
                <th className="pin" style={{ left: 72, minWidth: 140 }}>Serial</th>
                <th className="pin" style={{ left: 212, minWidth: 180 }}>Customer</th>
                {visible.map((column) => <th key={column.id}><span className="clip block max-w-[240px]">{column.label}</span></th>)}
              </tr>
            </thead>
            <tbody>
              {virtualizer.getVirtualItems().length ? <tr style={{ height: virtualizer.getVirtualItems()[0].start }} /> : null}
              {virtualizer.getVirtualItems().map((virtual) => {
                const row = list[virtual.index];
                return (
                  <tr key={row.id} data-queue-item>
                    <td className="pin" style={{ left: 0 }}>
                      <div className="flex items-center gap-2">
                        <CheckField checked={selected.includes(row.id)} onChange={() => toggle(row.id)} label="" />
                        <button type="button" className="underline" onDoubleClick={() => setOpenId(row.id)} onClick={() => setCursor(virtual.index)}>{row.position}</button>
                      </div>
                    </td>
                    <td className="pin clip" style={{ left: 72 }}>{row.serialNo || '—'}</td>
                    <td className="pin clip" style={{ left: 212 }}>{row.customerName || '—'}</td>
                    {visible.map((column) => <td key={column.id} className="clip">{cellText(row, column.key)}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!list.length ? <EmptyState title="No records in this view." /> : null}
        </div>
      </div>
      <div className="record-cards">
        {list.map((row) => (
          <button key={row.id} type="button" className="card min-w-0 text-left" onClick={() => setOpenId(row.id)}>
            <div className="truncate text-[15px] font-medium">{row.customerName || 'Unnamed'}</div>
            <div className="truncate text-[13px] text-muted">{row.serialNo || 'No serial'}</div>
            <div className="mt-2"><StatusPill tone={row.derived.nextDuePms.tone as Tone}>{row.derived.nextDuePms.label}</StatusPill></div>
          </button>
        ))}
      </div>
      {selected.length ? (
        <div className="bulk-bar mt-3">
          <span className="tabular-nums">{selected.length} selected</span>
          {user && hasPermission(user.role, 'validateRecords') ? <button type="button" className="btn btn-secondary" onClick={() => bulk('/api/rows/bulk-validate', { decision: 'Yes' })}>Validate yes</button> : null}
          {user && hasPermission(user.role, 'verifyRecords') ? <button type="button" className="btn btn-secondary" onClick={() => bulk('/api/rows/bulk-verify', { action: 'verify' })}>Verify</button> : null}
          <button type="button" className="btn btn-secondary" onClick={() => downloadExcel(`/api/datasets/${datasetId}/export?group=${group}`, 'selection.xlsx')}>Export</button>
        </div>
      ) : null}
      <RecordDrawer datasetId={datasetId} rowId={openId} columns={columns} onClose={() => setOpenId(null)} />
    </div>
  );
}

function cellText(row: RecordRow, key: string): string {
  if (key === 'next_due_pms') return row.derived.nextDuePms.label;
  const value = row.data[key];
  if (value == null || value === '') return '—';
  return String(value);
}
