import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useOutletDataset } from '../shell/AppShell';
import { DateField, EmptyState, KpiCard, PageHeader, SelectField, StatusPill, ActionSheet } from '../ui';
import { businessDateLabel } from '@shared/dates.ts';
import type { Derived } from '@shared/metrics.ts';

interface RecordRow {
  id: string;
  version: number;
  customerName: string | null;
  serialNo: string | null;
  data: Record<string, string | number | null>;
  derived: Derived;
}
interface Dashboard {
  today: string;
  timezone: string;
  activeUsers: number;
  openCalls?: number;
  counts: {
    needs_validation: number;
    validation_overdue: number;
    pending_verification: number;
    amc_due: number;
    pms_overdue: number;
    followup_due: number;
    expiring_soon: number;
    validated_today: number;
  } | null;
  activity: { id: string; action: string; rowId: string | null; createdAt: string; userName: string }[];
  workload: { user_id: string; name: string; total: number }[];
  health: { duplicateSerials: { serial_no: string; total: number }[]; missingDates: number; duplicateSuspects: number } | null;
}

export default function HomePage() {
  const { user } = useAuth();
  const { datasetId } = useOutletDataset();
  const dash = useQuery({
    queryKey: ['dashboard', datasetId],
    queryFn: () => api<Dashboard>(`/api/dashboard${datasetId ? `?datasetId=${datasetId}` : ''}`),
  });
  const subtitle = dash.data ? businessDateLabel(dash.data.timezone) : '';
  if (!user) return null;
  if (user.role === 'ADMIN') return <AdminHome subtitle={subtitle} data={dash.data} datasetId={datasetId} />;
  if (user.role === 'MANAGER') return <ManagerHome subtitle={subtitle} data={dash.data} datasetId={datasetId} />;
  if (user.role === 'VALIDATOR') return <ValidatorHome subtitle={subtitle} data={dash.data} datasetId={datasetId} />;
  return <ServiceHome subtitle={subtitle} data={dash.data} datasetId={datasetId} />;
}

function AdminHome({ subtitle, data, datasetId }: { subtitle: string; data?: Dashboard; datasetId: string }) {
  const navigate = useNavigate();
  const counts = data?.counts;
  const max = Math.max(1, ...(data?.workload || []).map((item) => item.total));
  return (
    <div className="page">
      <PageHeader title="Command Center" subtitle={subtitle} />
      <div className="kpi-row">
        <KpiCard label="Validation overdue" value={counts?.validation_overdue ?? '—'} onClick={() => navigate('/records')} />
        <KpiCard label="AMC due" value={counts?.amc_due ?? '—'} />
        <KpiCard label="Pending verification" value={counts?.pending_verification ?? '—'} />
        <KpiCard label="Active users" value={data?.activeUsers ?? '—'} sub="Signed-in roster" />
      </div>
      <div className="work-grid mt-4">
        <section className="card min-w-0">
          <h2 className="m-0 text-[15px] font-medium">Team workload</h2>
          <div className="mt-4 space-y-3">
            {(data?.workload || []).map((item) => (
              <div key={item.user_id} className="min-w-0">
                <div className="flex justify-between text-[13px]"><span className="truncate">{item.name}</span><span className="tabular-nums">{item.total}</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-surface2"><div className="h-1.5 rounded-full bg-navy" style={{ width: `${(item.total / max) * 100}%` }} /></div>
              </div>
            ))}
            {!data?.workload.length ? <p className="text-[13px] text-muted">No validator assignments yet.</p> : null}
          </div>
        </section>
        <section className="card min-w-0">
          <h2 className="m-0 text-[15px] font-medium">Live activity</h2>
          <ul className="mt-3 space-y-2">
            {(data?.activity || []).map((entry) => (
              <li key={entry.id}>
                <button type="button" className="w-full min-w-0 text-left text-[13px]" onClick={() => navigate('/records')}>
                  <span className="font-medium">{entry.userName}</span> {entry.action}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <section className="card mt-4 min-w-0">
        <h2 className="m-0 text-[15px] font-medium">Data health</h2>
        <p className="mt-2 text-[13px] text-ink2">{data?.health?.missingDates || 0} records are missing start or end dates. {data?.health?.duplicateSuspects || 0} are marked as possible duplicates.</p>
        <ul className="mt-2 text-[13px]">
          {(data?.health?.duplicateSerials || []).map((item) => <li key={item.serial_no} className="truncate">{item.serial_no} · {item.total}</li>)}
        </ul>
        <button type="button" className="btn btn-secondary mt-3" onClick={() => navigate(`/records`)} disabled={!datasetId}>Review records</button>
      </section>
    </div>
  );
}

function ManagerHome({ subtitle, data, datasetId }: { subtitle: string; data?: Dashboard; datasetId: string }) {
  const [tab, setTab] = useState('verify');
  const rows = useQuery({
    queryKey: ['rows', datasetId, 'workspace'],
    enabled: Boolean(datasetId),
    queryFn: () => api<{ rows: RecordRow[] }>(`/api/datasets/${datasetId}/rows?limit=200`),
  });
  const counts = data?.counts;
  const list = rows.data?.rows || [];
  const [picked, setPicked] = useState<string[]>([]);
  const [validatorId, setValidatorId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const toast = useToast();
  const queryClient = useQueryClient();
  const people = useQuery({
    queryKey: ['assignees'],
    queryFn: () => api<{ users: { id: string; name: string; role: string }[] }>('/api/users/assignees'),
  });
  const columns = ['AMC Due', 'Proposal Sent', 'Acknowledged', 'Declined'];
  return (
    <div className="page">
      <PageHeader title="Control Room" subtitle={subtitle} />
      <div className="kpi-row">
        <KpiCard label="Pending verification" value={counts?.pending_verification ?? '—'} />
        <KpiCard label="Validation overdue" value={counts?.validation_overdue ?? '—'} />
        <KpiCard label="AMC due" value={counts?.amc_due ?? '—'} />
        <KpiCard label="Open service calls" value={data?.openCalls ?? '—'} />
      </div>
      <div className="mt-4 flex gap-2 overflow-x-auto">
        {['verify', 'amc', 'overdue', 'assign'].map((item) => (
          <button key={item} type="button" className="gold-tab capitalize" data-active={tab === item} onClick={() => setTab(item)}>{item}</button>
        ))}
      </div>
      {tab === 'amc' ? (
        <div className="kanban mt-4">
          {columns.map((status) => (
            <section key={status} className="min-w-0">
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">{status}</h3>
              <div className="space-y-2">
                {list.filter((row) => row.derived.amcStatus === status).map((row) => <WorkRow key={row.id} row={row} datasetId={datasetId} />)}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {list.filter((row) => tab === 'verify' ? row.derived.pendingVerification : tab === 'overdue' ? row.derived.validationOverdue || row.derived.pmsOverdue : true).map((row) => (
            <div key={row.id} className="flex items-start gap-2">
              {tab === 'assign' ? (
                <button type="button" className="btn btn-secondary" onClick={() => setPicked((current) => current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id])}>
                  {picked.includes(row.id) ? 'Selected' : 'Select'}
                </button>
              ) : null}
              <div className="min-w-0 flex-1"><WorkRow row={row} datasetId={datasetId} verify={tab === 'verify'} /></div>
            </div>
          ))}
          {!list.length ? <EmptyState title="Nothing is waiting in this queue." /> : null}
          {tab === 'assign' ? (
            <div className="card mt-3 flex flex-wrap gap-2">
              {(people.data?.users || []).some((user) => user.role === 'VALIDATOR') ? (
                <SelectField value={validatorId} onChange={setValidatorId} placeholder="Validator" options={(people.data?.users || []).filter((user) => user.role === 'VALIDATOR').map((user) => ({ value: user.id, label: user.name }))} />
              ) : null}
              {(people.data?.users || []).some((user) => user.role === 'SERVICE') ? (
                <SelectField value={serviceId} onChange={setServiceId} placeholder="Service" options={(people.data?.users || []).filter((user) => user.role === 'SERVICE').map((user) => ({ value: user.id, label: user.name }))} />
              ) : null}
              <button type="button" className="btn btn-primary" onClick={() => {
                const items = list.filter((row) => picked.includes(row.id)).map((row) => ({ rowId: row.id, version: row.version }));
                api('/api/rows/bulk-assign', {
                  method: 'POST',
                  body: {
                    datasetId,
                    items,
                    ...(validatorId ? { validatorId } : {}),
                    ...(serviceId ? { serviceId } : {}),
                  },
                })
                  .then(() => { setPicked([]); queryClient.invalidateQueries({ queryKey: ['rows', datasetId] }); })
                  .catch((error: Error) => toast.push(error.message));
              }}>Assign selected</button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ValidatorHome({ subtitle, data, datasetId }: { subtitle: string; data?: Dashboard; datasetId: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('queue');
  const [reject, setReject] = useState<RecordRow | null>(null);
  const [reason, setReason] = useState('');
  const [due, setDue] = useState('');
  const rows = useQuery({
    queryKey: ['rows', datasetId, 'validator'],
    enabled: Boolean(datasetId),
    queryFn: () => api<{ rows: RecordRow[] }>(`/api/datasets/${datasetId}/rows?chip=needs_validation&limit=200`),
  });
  const rejected = useQuery({
    queryKey: ['rows', datasetId, 'rejected'],
    enabled: Boolean(datasetId) && tab === 'rejected',
    queryFn: () => api<{ rows: RecordRow[] }>(`/api/datasets/${datasetId}/rows?chip=validation_overdue&limit=200`),
  });
  const target = 20;
  const todayCount = data?.counts?.validated_today || 0;
  const list = (tab === 'rejected' ? rejected.data?.rows : rows.data?.rows) || [];
  const ordered = useMemo(() => [...list].sort((left, right) => Number(right.derived.validationOverdue) - Number(left.derived.validationOverdue)), [list]);
  function yes(row: RecordRow) {
    const timer = window.setTimeout(() => {
      api(`/api/datasets/${datasetId}/rows/${row.id}/validate`, { method: 'POST', body: { version: row.version, decision: 'Yes' } })
        .then(() => queryClient.invalidateQueries({ queryKey: ['rows', datasetId] }))
        .catch((error: Error) => toast.push(error.message));
    }, 8000);
    toast.push('Marked valid', { label: 'Undo', onClick: () => window.clearTimeout(timer) }, 8000);
  }
  return (
    <div className="page">
      <PageHeader title="My Desk" subtitle={subtitle} />
      <div className="kpi-row">
        <KpiCard label="To validate" value={data?.counts?.needs_validation ?? '—'} />
        <KpiCard label="Overdue" value={data?.counts?.validation_overdue ?? '—'} />
        <KpiCard label="Validated today" value={todayCount} sub={`${Math.min(100, Math.round((todayCount / target) * 100))}% of ${target}`} />
        <KpiCard label="Sent back" value={data?.counts?.validation_overdue ?? '—'} />
      </div>
      <div className="mt-4 flex gap-2">
        <button type="button" className="gold-tab" data-active={tab === 'queue'} onClick={() => setTab('queue')}>Queue</button>
        <button type="button" className="gold-tab" data-active={tab === 'rejected'} onClick={() => setTab('rejected')}>Follow up on rejected</button>
      </div>
      <div className="mt-4 space-y-2">
        {ordered.map((row) => (
          <article key={row.id} className="card flex flex-wrap items-center justify-between gap-3" data-queue-item>
            <div className="min-w-0">
              <div className="truncate font-medium">{row.customerName || 'Unnamed'}</div>
              <div className="truncate text-[13px] text-muted">{row.serialNo || 'No serial'} · {String(row.data.city || '')}</div>
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn btn-primary" onClick={() => yes(row)}>Yes</button>
              <button type="button" className="btn btn-secondary" onClick={() => setReject(row)}>No</button>
            </div>
          </article>
        ))}
        {!ordered.length ? <EmptyState title="The validation queue is clear." /> : null}
      </div>
      <ActionSheet title="Reject record" open={Boolean(reject)} onClose={() => setReject(null)}>
        <textarea className="field h-24 py-2" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason" />
        <div className="mt-3"><DateField label="Expected date" value={due} onChange={setDue} /></div>
        <button type="button" className="btn btn-primary mt-4" onClick={() => {
          if (!reject) return;
          api(`/api/datasets/${datasetId}/rows/${reject.id}/validate`, { method: 'POST', body: { version: reject.version, decision: 'No', reason, expectedDate: due } })
            .then(() => { setReject(null); queryClient.invalidateQueries({ queryKey: ['rows', datasetId] }); })
            .catch((error: Error) => toast.push(error.message));
        }}>Save</button>
      </ActionSheet>
    </div>
  );
}

function ServiceHome({ subtitle, data, datasetId }: { subtitle: string; data?: Dashboard; datasetId: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('agenda');
  const rows = useQuery({
    queryKey: ['rows', datasetId, 'service'],
    enabled: Boolean(datasetId),
    queryFn: () => api<{ rows: RecordRow[] }>(`/api/datasets/${datasetId}/rows?limit=200`),
  });
  const list = rows.data?.rows || [];
  const counts = data?.counts;
  async function done(row: RecordRow) {
    const visit = row.derived.visits.find((item) => item.status === 'Overdue' || item.status === 'Due Soon' || item.status === 'Upcoming');
    if (!visit) return;
    try {
      await api(`/api/datasets/${datasetId}/rows/${row.id}/pms`, { method: 'POST', body: { version: row.version, action: 'done', index: visit.index } });
      queryClient.invalidateQueries({ queryKey: ['rows', datasetId] });
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Could not mark the visit');
    }
  }
  return (
    <div className="page">
      <PageHeader title="Service Desk" subtitle={subtitle} />
      <div className="kpi-row">
        <KpiCard label="PMS due this week" value={counts?.expiring_soon ?? '—'} />
        <KpiCard label="PMS overdue" value={counts?.pms_overdue ?? '—'} />
        <KpiCard label="AMC due" value={counts?.amc_due ?? '—'} />
        <KpiCard label="Follow-ups today" value={counts?.followup_due ?? '—'} />
      </div>
      <div className="mt-4 flex gap-2 overflow-x-auto">
        {['agenda', 'amc', 'calls', 'follow'].map((item) => (
          <button key={item} type="button" className="gold-tab capitalize" data-active={tab === item} onClick={() => setTab(item)}>{item}</button>
        ))}
      </div>
      <div className="mt-4 space-y-2">
        {list.filter((row) => {
          if (tab === 'agenda') return row.derived.pmsOverdue || row.derived.nextDuePms.tone === 'amber';
          if (tab === 'amc') return row.derived.amcDue || row.derived.amcStatus === 'Proposal Sent';
          if (tab === 'follow') return row.derived.followupDue;
          return true;
        }).map((row) => (
          <article key={row.id} className="card flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-medium">{row.customerName || 'Unnamed'}</div>
              <div className="truncate text-[13px] text-muted">{row.derived.nextDuePms.label}</div>
            </div>
            <div className="flex gap-2">
              <StatusPill tone={row.derived.nextDuePms.tone}>{row.derived.nextDuePms.label}</StatusPill>
              <button type="button" className="btn btn-primary" onClick={() => done(row)}>Mark done</button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function WorkRow({ row, datasetId, verify }: { row: RecordRow; datasetId: string; verify?: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  async function act(action: 'verify' | 'revert') {
    try {
      await api(`/api/datasets/${datasetId}/rows/${row.id}/verify`, { method: 'POST', body: { version: row.version, action } });
      queryClient.invalidateQueries({ queryKey: ['rows', datasetId] });
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Could not update verification');
    }
  }
  return (
    <article className="card flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="truncate font-medium">{row.customerName || 'Unnamed'}</div>
        <div className="truncate text-[13px] text-muted">{row.serialNo || 'No serial'}</div>
      </div>
      {verify ? (
        <div className="flex gap-2">
          <button type="button" className="btn btn-primary" onClick={() => act('verify')}>Verify OK</button>
          <button type="button" className="btn btn-secondary" onClick={() => act('revert')}>Send back</button>
        </div>
      ) : <StatusPill tone={row.derived.amcTone}>{row.derived.amcStatus}</StatusPill>}
    </article>
  );
}
