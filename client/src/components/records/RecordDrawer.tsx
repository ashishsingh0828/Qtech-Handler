import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Accordion from '@radix-ui/react-accordion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { api } from '../../api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { ActionSheet, DateField, StatusPill } from '../ui';
import { GROUP_CATALOG, canEditColumn } from '@shared/permissions.ts';
import type { Derived } from '@shared/metrics.ts';

interface Column { id: string; key: string; label: string; groupKey: string; dataType: string }
interface RecordRow {
  id: string;
  datasetId: string;
  version: number;
  serialNo: string | null;
  customerName: string | null;
  data: Record<string, string | number | null>;
  derived: Derived;
}
interface Call { id: string; type: string; description: string; status: string; reportedAt: string; note: string | null }
interface Activity { id: string; action: string; createdAt: string; userName: string }

export default function RecordDrawer({ datasetId, rowId, columns, onClose }: {
  datasetId: string;
  rowId: string | null;
  columns: Column[];
  onClose: () => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [due, setDue] = useState('');
  const [note, setNote] = useState('');
  const [follow, setFollow] = useState('');
  const [callType, setCallType] = useState('Complaint');
  const [callText, setCallText] = useState('');
  const [reschedule, setReschedule] = useState<{ index: number; date: string } | null>(null);
  const detail = useQuery({
    queryKey: ['record', datasetId, rowId],
    enabled: Boolean(rowId),
    queryFn: () => api<{ row: RecordRow; calls: Call[]; activity: Activity[] }>(`/api/datasets/${datasetId}/rows/${rowId}`),
  });
  const row = detail.data?.row;
  const primary = user?.role === 'VALIDATOR' ? 'data_validation' : user?.role === 'SERVICE' ? 'schedule_services' : 'customer_detail';
  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['record', datasetId, rowId] });
    queryClient.invalidateQueries({ queryKey: ['rows', datasetId] });
    queryClient.invalidateQueries({ queryKey: ['dashboard', datasetId] });
  }
  async function run(path: string, body: Record<string, unknown>) {
    if (!row) return;
    try {
      await api(path, { method: 'POST', body: { version: row.version, ...body } });
      refresh();
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Action failed');
    }
  }
  const phone = String(row?.data.mobile_no || '');
  const email = String(row?.data.email || '');
  return (
    <Dialog.Root open={Boolean(rowId)} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" />
        <Dialog.Content className="drawer-panel" aria-describedby={undefined}>
          <div className="border-b border-hairline px-5 py-4">
            <Dialog.Title className="m-0 truncate text-[18px]">{row?.customerName || 'Record'}</Dialog.Title>
            <p className="mt-1 truncate text-[13px] text-muted">{String(row?.data.equipment_name || 'Equipment')} · {row?.serialNo || 'No serial'}</p>
            {detail.data?.activity[0] ? <p className="mt-1 truncate text-[12px] text-muted">Last change by {detail.data.activity[0].userName}</p> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusPill tone={row?.derived.warrantyTone}>{row?.derived.warrantyStatus || '—'}</StatusPill>
              <StatusPill tone={row?.derived.amcTone}>{row?.derived.amcStatus || '—'}</StatusPill>
              <StatusPill tone={row?.data.validated === 'Yes' ? 'emerald' : row?.data.validated === 'No' ? 'ruby' : 'stone'}>{String(row?.data.validated || 'Unvalidated')}</StatusPill>
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-[13px]">
              {phone ? <a href={`tel:${phone}`}>Call</a> : null}
              {email ? <a href={`mailto:${email}`}>Email</a> : null}
              {phone ? <a href={`https://wa.me/${phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">WhatsApp</a> : null}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
            <Accordion.Root type="multiple" defaultValue={[primary]}>
              {GROUP_CATALOG.map((group) => {
                const fields = columns.filter((column) => column.groupKey === group.key);
                const locked = user ? !canEditColumn(user.role, { key: 'notes', groupKey: group.key }) && user.role !== 'ADMIN' && user.role !== 'MANAGER' : true;
                return (
                  <Accordion.Item key={group.key} value={group.key} className="border-b border-hairline">
                    <Accordion.Header>
                      <Accordion.Trigger className={`flex h-11 w-full items-center justify-between text-left text-[11px] font-semibold uppercase tracking-[0.06em] tint-${group.tint} px-3`}>
                        <span className="truncate">{group.title}</span>
                        {locked ? <Lock size={14} strokeWidth={1.5} /> : null}
                      </Accordion.Trigger>
                    </Accordion.Header>
                    <Accordion.Content className="px-1 py-3">
                      {group.key === 'schedule_services' && row ? (
                        <div className="mb-3">
                          <div className="text-[13px] text-ink2">Total PMS {typeof row.data.total_pms === 'number' ? Math.round(row.data.total_pms) : String(row.data.total_pms || row.derived.pmsProgress.total)} · {row.derived.pmsProgress.done} done</div>
                          <ol className="mt-3 space-y-3">
                            {row.derived.visits.map((visit) => (
                              <li key={visit.index} className="min-w-0 border-l border-hairline pl-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-[13px]">PMS {visit.index}</span>
                                  <StatusPill tone={visit.tone}>{visit.status}</StatusPill>
                                </div>
                                <div className="text-[12px] tabular-nums text-muted">{visit.scheduled} {visit.completed ? `· done ${visit.completed}` : ''}</div>
                                {visit.status !== 'Done' ? (
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    <button type="button" className="btn btn-secondary" onClick={() => run(`/api/datasets/${datasetId}/rows/${row.id}/pms`, { action: 'done', index: visit.index })}>Mark done today</button>
                                    <button type="button" className="btn btn-secondary" onClick={() => setReschedule({ index: visit.index, date: visit.scheduled || '' })}>Reschedule</button>
                                  </div>
                                ) : null}
                              </li>
                            ))}
                          </ol>
                        </div>
                      ) : null}
                      {group.key === 'data_validation' && row ? (
                        <div className="mb-3 flex flex-wrap gap-2">
                          <button type="button" className="btn btn-primary" onClick={() => run(`/api/datasets/${datasetId}/rows/${row.id}/validate`, { decision: 'Yes' })}>Yes</button>
                          <button type="button" className="btn btn-secondary" onClick={() => setRejectOpen(true)}>No</button>
                          {user?.role === 'ADMIN' || user?.role === 'MANAGER' ? (
                            <>
                              <button type="button" className="btn btn-secondary" onClick={() => run(`/api/datasets/${datasetId}/rows/${row.id}/verify`, { action: 'verify' })}>Verify OK</button>
                              <button type="button" className="btn btn-secondary" onClick={() => run(`/api/datasets/${datasetId}/rows/${row.id}/verify`, { action: 'revert' })}>Revert</button>
                            </>
                          ) : null}
                        </div>
                      ) : null}
                      {group.key === 'amc' && row ? (
                        <div className="mb-3">
                          <div className="mb-2 text-[13px]">{row.derived.amcStatus}</div>
                          <div className="flex flex-wrap gap-2">
                            <button type="button" className="btn btn-secondary" onClick={() => run(`/api/datasets/${datasetId}/rows/${row.id}/amc`, { action: 'proposal_sent' })}>Proposal sent</button>
                            <button type="button" className="btn btn-secondary" onClick={() => run(`/api/datasets/${datasetId}/rows/${row.id}/amc`, { action: 'acknowledge', note, nextFollowUp: follow })}>Acknowledge</button>
                            <button type="button" className="btn btn-secondary" onClick={() => run(`/api/datasets/${datasetId}/rows/${row.id}/amc`, { action: 'decline', note })}>Decline</button>
                          </div>
                          <textarea className="field mt-3 h-20 py-2" placeholder="Note" value={note} onChange={(event) => setNote(event.target.value)} />
                          <div className="mt-3"><DateField label="Follow-up" value={follow} onChange={setFollow} /></div>
                        </div>
                      ) : null}
                      {fields.map((column) => (
                        <div key={column.id} className="mb-2 min-w-0">
                          <div className="text-[12px] text-muted">{column.label}</div>
                          <div className="truncate text-[14px] tabular-nums">{row?.data[column.key] == null || row.data[column.key] === '' ? '—' : String(row.data[column.key])}</div>
                        </div>
                      ))}
                    </Accordion.Content>
                  </Accordion.Item>
                );
              })}
            </Accordion.Root>
            <section className="mt-4">
              <h3 className="text-[13px] font-semibold">Service calls</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {['Complaint', 'Breakdown', 'Emergency', 'Courtesy Visit'].map((type) => (
                  <button key={type} type="button" className={`btn ${callType === type ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setCallType(type)}>{type}</button>
                ))}
              </div>
              <textarea className="field mt-2 h-20 py-2" value={callText} onChange={(event) => setCallText(event.target.value)} placeholder="Description" />
              <button type="button" className="btn btn-secondary mt-2" onClick={() => row && run(`/api/datasets/${datasetId}/rows/${row.id}/calls`, { type: callType, description: callText })}>Log call</button>
              <ul className="mt-3 space-y-2">
                {(detail.data?.calls || []).map((call) => (
                  <li key={call.id} className="min-w-0 rounded-lg border border-hairline p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-medium">{call.type}</span>
                      <StatusPill tone={call.status === 'Resolved' ? 'emerald' : 'amber'}>{call.status}</StatusPill>
                    </div>
                    <p className="mt-1 text-[13px] text-ink2">{call.description}</p>
                    {call.status === 'Open' && row ? (
                      <button type="button" className="btn btn-secondary mt-2" onClick={() => run(`/api/datasets/${datasetId}/rows/${row.id}/calls/${call.id}/resolve`, {})}>Resolve</button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
            <section className="mt-4">
              <h3 className="text-[13px] font-semibold">Activity</h3>
              <ol className="mt-2 space-y-2">
                {(detail.data?.activity || []).map((entry) => (
                  <li key={entry.id} className="min-w-0 text-[13px]">
                    <span className="font-medium">{entry.userName}</span> {entry.action}
                    <div className="text-[12px] text-muted">{new Date(entry.createdAt).toLocaleString()}</div>
                  </li>
                ))}
              </ol>
            </section>
          </div>
          <div className="sticky bottom-0 border-t border-hairline bg-canvas px-5 py-3 md:hidden">
            <button type="button" className="btn btn-secondary w-full" onClick={onClose}>Close</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
      <ActionSheet title="Reject validation" open={rejectOpen} onClose={() => setRejectOpen(false)}>
        <textarea className="field h-24 py-2" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason" />
        <div className="mt-3"><DateField label="Expected date" value={due} onChange={setDue} /></div>
        <button type="button" className="btn btn-primary mt-4" onClick={() => { if (row) run(`/api/datasets/${datasetId}/rows/${row.id}/validate`, { decision: 'No', reason, expectedDate: due }); setRejectOpen(false); }}>Save rejection</button>
      </ActionSheet>
      <ActionSheet title="Reschedule PMS" open={Boolean(reschedule)} onClose={() => setReschedule(null)}>
        <DateField label="Next date" value={reschedule?.date || ''} onChange={(date) => setReschedule((current) => current ? { ...current, date } : current)} />
        <button type="button" className="btn btn-primary mt-4" onClick={() => { if (row && reschedule) run(`/api/datasets/${datasetId}/rows/${row.id}/pms`, { action: 'reschedule', index: reschedule.index, date: reschedule.date }); setReschedule(null); }}>Save</button>
      </ActionSheet>
    </Dialog.Root>
  );
}
