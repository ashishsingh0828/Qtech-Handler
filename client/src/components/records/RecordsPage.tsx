import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { api, downloadExcel, uploadWorkbook } from '../../api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useOutletDataset } from '../shell/AppShell';
import { CheckField, EmptyState, PageHeader, StatusPill } from '../ui';
import RecordDrawer from './RecordDrawer';
import { GROUP_CATALOG, canEditColumn, hasPermission } from '@shared/permissions.ts';
import { readPref, writePref } from '../../lib/storage';
import type { Derived, Tone } from '@shared/metrics.ts';

interface Column { id: string; key: string; label: string; groupKey: string; dataType: string; displayOrder: number }
interface RecordRow {
  id: string;
  version: number;
  position: number;
  serialNo: string | null;
  customerName: string | null;
  updatedByName?: string | null;
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
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [cellState, setCellState] = useState<Record<string, 'Pending' | 'Saved'>>({});
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
  const scheduleView = group === 'schedule_services' && !advanced;
  const visible = useMemo(() => {
    if (advanced && (user?.role === 'ADMIN' || user?.role === 'MANAGER')) return columns;
    if (scheduleView) return columns.filter((column) => column.key === 'total_pms');
    return columns
      .filter((column) => column.groupKey === group && !/^pms_\d+$/.test(column.key) && !/^pm_date(_\d+)?$/.test(column.key))
      .slice(0, 8);
  }, [advanced, columns, group, scheduleView, user?.role]);
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
  async function saveCell(row: RecordRow, key: string, value: string) {
    const stamp = `${row.id}:${key}`;
    setCellState((current) => ({ ...current, [stamp]: 'Pending' }));
    try {
      await api(`/api/datasets/${datasetId}/rows/${row.id}`, { method: 'PATCH', body: { version: row.version, updates: { [key]: value } } });
      setCellState((current) => ({ ...current, [stamp]: 'Saved' }));
      queryClient.invalidateQueries({ queryKey: ['rows', datasetId] });
      toast.push(user ? `Saved by ${user.name}` : 'Saved');
    } catch (error) {
      setCellState((current) => {
        const next = { ...current };
        delete next[stamp];
        return next;
      });
      toast.push(error instanceof Error ? error.message : 'Save failed');
    }
  }
  async function markVisit(row: RecordRow, index: number) {
    try {
      await api(`/api/datasets/${datasetId}/rows/${row.id}/pms`, { method: 'POST', body: { version: row.version, action: 'done', index } });
      queryClient.invalidateQueries({ queryKey: ['rows', datasetId] });
      toast.push('Visit marked done');
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Could not mark the visit');
    }
  }
  if (!datasetId) return <div className="page"><EmptyState title="Import a workbook to open the registry." /></div>;
  return (
    <div className="page">
      <PageHeader title={dataset.data?.dataset.name || 'Records'} subtitle={`${rows.data?.total || 0} records`}>
        <input id="page-search" className="field w-[220px] max-w-full" placeholder="Search" value={q} onChange={(event) => setQ(event.target.value)} />
        <button type="button" className="btn btn-secondary" onClick={() => { const next = density === 'compact' ? 'comfortable' : 'compact'; setDensity(next); if (user) writePref(`qtech.density.${user.id}`, next); }}>{density === 'compact' ? 'Comfortable' : 'Compact'}</button>
        {user && hasPermission(user.role, 'uploadExcel') ? <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()}>Import</button> : null}
        <button type="button" className="btn btn-secondary" onClick={() => downloadExcel(`/api/datasets/${datasetId}/export?group=${advanced ? 'all' : group}`, 'records.xlsx').catch((error: Error) => toast.push(error.message))}>Export .xlsx</button>
        <button type="button" className="btn btn-secondary" onClick={() => downloadExcel(`/api/datasets/${datasetId}/export?format=csv&group=${advanced ? 'all' : group}`, 'records.csv').catch((error: Error) => toast.push(error.message))}>Export .csv</button>
        <button type="button" className="btn btn-secondary" onClick={() => setEditing((value) => !value)}>{editing ? 'Done' : 'Edit'}</button>
        {user && (user.role === 'ADMIN' || user.role === 'MANAGER') ? (
          <button type="button" className="btn btn-secondary" onClick={() => setAdvanced((value) => !value)}>{advanced ? 'One group' : 'All columns'}</button>
        ) : null}
      </PageHeader>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        if (file.size > 25 * 1024 * 1024) {
          toast.push('This file is larger than 25 MB.');
          return;
        }
        uploadWorkbook(file, datasetId).then((result) => {
          queryClient.invalidateQueries({ queryKey: ['rows', datasetId] });
          queryClient.invalidateQueries({ queryKey: ['dataset', datasetId] });
          queryClient.invalidateQueries({ queryKey: ['datasets'] });
          toast.push(`Imported ${result.dataset.rowCount} rows x ${result.dataset.columnCount} columns in ${result.dataset.groups} groups.`);
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
                {scheduleView ? <th>Next PMS</th> : null}
                {scheduleView ? <th>Timeline</th> : null}
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
                    <td className="pin clip" style={{ left: 212 }}>
                      <div className="truncate">{row.customerName || '—'}</div>
                      {row.updatedByName ? <div className="truncate text-[11px] text-muted">{row.updatedByName}</div> : null}
                    </td>
                    {visible.map((column) => (
                      <td key={column.id} className="clip">
                        {editing && user && canEditColumn(user.role, column) ? (
                          <input
                            className="field h-8"
                            defaultValue={cellText(row, column.key) === '—' ? '' : cellText(row, column.key)}
                            onBlur={(event) => { void saveCell(row, column.key, event.target.value); }}
                          />
                        ) : <span className={mutedValue(row.data[column.key]) ? 'text-muted' : undefined}>{cellText(row, column.key)}</span>}
                        {cellState[`${row.id}:${column.key}`] ? <span className="ml-1 text-[11px] text-muted">{cellState[`${row.id}:${column.key}`]}</span> : null}
                        {row.version > 1 && !cellState[`${row.id}:${column.key}`] ? <span className="ml-1 text-[11px] text-muted">Modified</span> : null}
                      </td>
                    ))}
                    {scheduleView ? <td><StatusPill tone={row.derived.nextDuePms.tone}>{row.derived.nextDuePms.label}</StatusPill></td> : null}
                    {scheduleView ? (
                      <td>
                        <button type="button" className="btn btn-secondary" onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                          {expanded === row.id ? 'Hide' : 'PMS'}
                        </button>
                        {expanded === row.id ? (
                          <div className="mt-2 space-y-1">
                            {row.derived.visits.map((visit) => (
                              <div key={visit.index} className="flex flex-wrap items-center gap-2 text-[12px]">
                                <span className="tabular-nums">PMS {visit.index}</span>
                                <StatusPill tone={visit.tone}>{visit.status}</StatusPill>
                                <span className="tabular-nums text-muted">{visit.scheduled || '—'}</span>
                                {user && canEditColumn(user.role, { key: 'pms_1', groupKey: 'schedule_services' }) && visit.status !== 'Done' ? (
                                  <button type="button" className="btn btn-secondary" onClick={() => { void markVisit(row, visit.index); }}>Mark done</button>
                                ) : null}
                              </div>
                            ))}
                            {!row.derived.visits.length ? <span className="text-muted">No scheduled visits</span> : null}
                          </div>
                        ) : null}
                      </td>
                    ) : null}
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
          <button type="button" className="btn btn-secondary" onClick={() => {
            Promise.all(list.filter((row) => selected.includes(row.id)).map((row) => api(`/api/datasets/${datasetId}/rows/${row.id}/revert`, { method: 'POST', body: { version: row.version } })))
              .then(() => { setSelected([]); queryClient.invalidateQueries({ queryKey: ['rows', datasetId] }); toast.push('Restored imported values'); })
              .catch((error: Error) => toast.push(error.message));
          }}>Re-edit</button>
          {user && hasPermission(user.role, 'deleteRows') ? <button type="button" className="btn btn-danger" onClick={() => {
            if (!window.confirm(`Delete ${selected.length} rows from this dataset?`)) return;
            Promise.all(list.filter((row) => selected.includes(row.id)).map((row) => api(`/api/datasets/${datasetId}/rows/${row.id}`, { method: 'DELETE' })))
              .then(() => { setSelected([]); queryClient.invalidateQueries({ queryKey: ['rows', datasetId] }); toast.push(user ? `Deleted by ${user.name}` : 'Rows deleted'); })
              .catch((error: Error) => toast.push(error.message));
          }}>Delete</button> : null}
          <button type="button" className="btn btn-secondary" onClick={() => downloadExcel(`/api/datasets/${datasetId}/export?group=${group}`, 'selection.xlsx').catch((error: Error) => toast.push(error.message))}>Export</button>
        </div>
      ) : null}
      <RecordDrawer datasetId={datasetId} rowId={openId} columns={columns} onClose={() => setOpenId(null)} />
    </div>
  );
}

function mutedValue(value: unknown): boolean {
  return typeof value === 'string' && /^(na|n\/a|n\.a\.?|-|—)$/i.test(value.trim());
}

function cellText(row: RecordRow, key: string): string {
  if (key === 'next_due_pms') return row.derived.nextDuePms.label;
  const value = row.data[key];
  if (value == null || value === '') return '—';
  if (key === 'total_pms' && typeof value === 'number') return String(Math.round(value));
  return String(value);
}
