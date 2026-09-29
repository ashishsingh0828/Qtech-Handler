import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { hasPermission } from '@shared/permissions.js';
import { api } from '../../api';
import { formatDate, formatDateTime } from '../../lib/format';
import { Field, Pill } from '../ui';

export default function ActivityDrawer({
  datasetId,
  rowId,
  user,
  onClose,
  onChanged,
  onDeleted,
}) {
  const [payload, setPayload] = useState(null);
  const [notes, setNotes] = useState('');
  const [nextFollowUp, setNextFollowUp] = useState('');
  const [error, setError] = useState('');

  function load() {
    return api(`/api/datasets/${datasetId}/rows/${rowId}`)
      .then((data) => {
        setPayload(data);
        setNotes(data.row.data?.amc_notes || '');
        setNextFollowUp(String(data.row.data?.next_follow_up || '').slice(0, 10));
        setError('');
      })
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    setPayload(null);
    load();
  }, [datasetId, rowId]);

  const row = payload?.row;
  const data = row?.data || {};
  const computed = row?.computed || {};
  const state = data.amc_state || '';

  async function act(path, body) {
    try {
      await api(path, { method: 'POST', body });
      await load();
      onChanged();
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <button type="button" className="overlay" aria-label="Close details" onClick={onClose} />
      <aside className="drawer drawer-open">
        <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
          <div className="text-[11px] uppercase tracking-[0.06em] text-muted">Record</div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-5">
          {!row ? <p className="text-[13px] text-muted">{error || 'Loading the record.'}</p> : null}
          {row ? (
            <>
              <h2 className="text-[22px] font-medium leading-tight">{data.customer_name || 'Untitled customer'}</h2>
              <p className="mt-1 text-[13px] text-muted">{[data.city, data.mobile_no].filter(Boolean).join(' · ') || 'No contact on file'}</p>
              <div className="mt-4">
                <Pill tone={computed.warrantyTone || 'stone'}>{computed.warrantyStatus || '—'}</Pill>
                {computed.warrantyDue ? <span className="ml-2 text-[12px] text-muted">Warranty expired</span> : null}
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
                <Detail label="Equipment" value={data.equipment_name} />
                <Detail label="Serial" value={data.serial_no} />
                <Detail label="Contract" value={data.contract_type} />
                <Detail label="Status" value={data.status} />
                <Detail label="Start" value={formatDate(data.start_date)} />
                <Detail label="End" value={formatDate(data.end_date)} />
                <Detail label="Days" value={computed.days ?? '—'} />
                <Detail label="Validated" value={data.validated || '—'} />
                <Detail label="Validated by" value={data.validated_by} />
                <Detail label="Verified" value={data.verified || '—'} />
              </dl>
              {data.rejection_reason ? <p className="mt-4 text-[13px] text-ink2">{data.rejection_reason}</p> : null}

              <section className="mt-8">
                <div className="text-[11px] uppercase tracking-[0.06em] text-muted">AMC</div>
                <ol className="mt-3 space-y-3">
                  <Step title="Warranty" detail={computed.warrantyStatus} done={Boolean(data.end_date)} current={!state} />
                  <Step title="Proposal sent" detail={data.proposal_sent_at ? formatDateTime(data.proposal_sent_at) : 'Waiting'} done={state === 'proposal_sent' || state === 'acknowledged' || state === 'declined'} current={state === 'proposal_sent'} />
                  <Step title={state === 'declined' ? 'Declined' : 'Acknowledged'} detail={data.amc_decided_at ? formatDateTime(data.amc_decided_at) : 'Waiting'} done={state === 'acknowledged' || state === 'declined'} current={false} />
                </ol>
                {hasPermission(user.role, 'amcActions') ? (
                  <div className="mt-4 space-y-3">
                    {computed.warrantyDue && state !== 'proposal_sent' && state !== 'acknowledged' ? (
                      <button type="button" className="btn btn-primary w-full" onClick={() => act(`/api/datasets/${datasetId}/rows/${rowId}/amc`, { action: 'proposal_sent' })}>
                        Send proposal
                      </button>
                    ) : null}
                    {state === 'proposal_sent' ? (
                      <>
                        <Field label="Acknowledgment notes">
                          <textarea className="area" value={notes} onChange={(event) => setNotes(event.target.value)} />
                        </Field>
                        <Field label="Next follow-up">
                          <input className="field" type="date" value={nextFollowUp} onChange={(event) => setNextFollowUp(event.target.value)} />
                        </Field>
                        <div className="flex gap-2">
                          <button type="button" className="btn btn-primary flex-1" onClick={() => act(`/api/datasets/${datasetId}/rows/${rowId}/amc`, { action: 'acknowledge', notes, nextFollowUp })}>Acknowledge</button>
                          <button type="button" className="btn btn-secondary flex-1" onClick={() => act(`/api/datasets/${datasetId}/rows/${rowId}/amc`, { action: 'decline', notes, nextFollowUp })}>Decline</button>
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </section>

              <section className="mt-8 flex flex-wrap gap-2">
                {hasPermission(user.role, 'verifyRecords') ? (
                  data.validated === 'Yes' ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => act(`/api/datasets/${datasetId}/rows/${rowId}/verify`, { verified: data.verified !== 'Verified OK' })}
                    >
                      {data.verified === 'Verified OK' ? 'Reset to Pending' : 'Mark Verified OK'}
                    </button>
                  ) : <span className="text-[13px] text-muted">Validation is required before review.</span>
                ) : null}
                {hasPermission(user.role, 'duplicateRows') ? (
                  <button type="button" className="btn btn-secondary" onClick={() => act(`/api/datasets/${datasetId}/rows/${rowId}/duplicate`, {})}>Duplicate</button>
                ) : null}
                {hasPermission(user.role, 'deleteRows') ? (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={async () => {
                      try {
                        await api(`/api/datasets/${datasetId}/rows/${rowId}`, { method: 'DELETE' });
                        onDeleted();
                      } catch (err) {
                        setError(err.message);
                      }
                    }}
                  >
                    Delete row
                  </button>
                ) : null}
              </section>
              {error ? <p className="mt-3 text-[13px] text-[var(--ruby-txt)]">{error}</p> : null}

              <section className="mt-8">
                <div className="text-[11px] uppercase tracking-[0.06em] text-muted">Activity</div>
                <ul className="mt-3 space-y-3">
                  {(payload?.activity || []).length === 0 ? <li className="text-[13px] text-muted">No activity recorded.</li> : null}
                  {(payload?.activity || []).map((item) => (
                    <li key={item.id} className="border-b border-hairline pb-3">
                      <div className="text-[13px]">{item.summary}</div>
                      <div className="mt-1 text-[12px] text-muted">{item.actorName} · {formatDateTime(item.createdAt)}</div>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          ) : null}
        </div>
      </aside>
    </>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.06em] text-muted">{label}</dt>
      <dd className="mt-1">{value || '—'}</dd>
    </div>
  );
}

function Step({ title, detail, done, current }) {
  return (
    <li className="flex gap-3">
      <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${current ? 'bg-gold' : done ? 'bg-navy' : 'bg-hairlineStrong'}`} />
      <div>
        <div className="text-[13px]">{title}</div>
        <div className="text-[12px] text-muted">{detail}</div>
      </div>
    </li>
  );
}
