import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { Download, Trash2 } from 'lucide-react';
import { hasPermission } from '@shared/permissions.js';
import { api, downloadExcel } from '../../api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { relativeTime } from '../../lib/format';
import { Modal } from '../ui';
import ImportModal from '../dataset/ImportModal';

const CARDS = [
  { key: 'validationOverdue', label: 'Validation Overdue', tab: 'validation_overdue' },
  { key: 'amcDue', label: 'AMC Due', tab: 'amc_due' },
  { key: 'activeAmc', label: 'Active AMCs', tab: 'active_amc' },
  { key: 'pendingReviews', label: 'Pending Reviews', tab: 'pending_verification' },
  { key: 'datasets', label: 'Total Datasets', tab: null },
];

export default function DashboardPage() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { query } = useOutletContext();
  const [params, setParams] = useSearchParams();
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);

  function load() {
    return api('/api/dashboard')
      .then((data) => {
        setPayload(data);
        setError('');
      })
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (params.get('import') === '1') {
      setImportOpen(true);
      const next = new URLSearchParams(params);
      next.delete('import');
      setParams(next, { replace: true });
    }
  }, [params, setParams]);

  const datasets = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = payload?.datasets || [];
    if (!needle) return list;
    return list.filter((dataset) => dataset.name.toLowerCase().includes(needle));
  }, [payload, query]);

  function openMetric(card) {
    if (!card.tab) {
      document.getElementById('registry')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    const target = payload?.metrics?.targets?.[card.tab];
    if (!target) {
      toast('No sheet currently matches that measure.');
      return;
    }
    navigate(`/datasets/${target}?tab=${card.tab}`);
  }

  async function removeDataset() {
    if (!pendingDelete) return;
    try {
      await api(`/api/datasets/${pendingDelete.id}`, { method: 'DELETE' });
      setPendingDelete(null);
      await load();
    } catch (err) {
      toast(err.message);
    }
  }

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1120px] px-8 py-10">
        <div className="mb-8 flex items-end justify-between gap-6">
          <div>
            <h1 className="font-serif text-[44px] leading-none tracking-tight">
              {payload ? `${payload.greeting}, ${user?.name?.split(' ')[0] || ''}` : 'Welcome'}
            </h1>
            <p className="mt-3 text-[14px] text-muted">{payload?.dateLabel}</p>
          </div>
          {hasPermission(user?.role, 'uploadExcel') ? (
            <button type="button" className="btn btn-primary" onClick={() => setImportOpen(true)}>Import workbook</button>
          ) : null}
        </div>

        {error ? <p className="mb-6 text-[13px] text-[var(--ruby-txt)]">{error}</p> : null}

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {CARDS.map((card) => (
            <button key={card.key} type="button" className="card px-4 py-4 text-left hover:bg-surface2" onClick={() => openMetric(card)}>
              <div className="font-serif text-[40px] leading-none">{payload ? payload.metrics[card.key] : '—'}</div>
              <div className="mt-3 text-[11px] uppercase tracking-[0.06em] text-muted">{card.label}</div>
            </button>
          ))}
        </div>

        <section id="registry" className="mt-12">
          <div className="mb-4 text-[11px] uppercase tracking-[0.06em] text-muted">Registry</div>
          {datasets.length === 0 ? <div className="card px-6 py-12 text-center text-muted">No sheets in the registry.</div> : null}
          <div className="grid gap-4">
            {datasets.map((dataset) => (
              <article key={dataset.id} className="card flex items-center gap-4 px-5 py-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy text-[12px] text-canvas">
                  {dataset.uploaderInitials}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-medium">{dataset.name}</div>
                  <div className="mt-1 text-[13px] text-muted">
                    {dataset.rowCount} rows · {dataset.columnCount} columns · {relativeTime(dataset.updatedAt)}
                  </div>
                </div>
                <button type="button" className="btn btn-secondary" onClick={() => navigate(`/datasets/${dataset.id}`)}>Open</button>
                <button type="button" className="icon-btn" aria-label="Export" onClick={() => downloadExcel(dataset.id, dataset.name).catch((err) => toast(err.message))}>
                  <Download size={16} />
                </button>
                {hasPermission(user?.role, 'deleteDatasets') ? (
                  <button type="button" className="icon-btn" aria-label="Delete" onClick={() => setPendingDelete(dataset)}>
                    <Trash2 size={16} />
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      </div>
      {importOpen ? (
        <ImportModal
          onClose={() => setImportOpen(false)}
          onImported={(dataset) => {
            setImportOpen(false);
            navigate(`/datasets/${dataset.id}`);
          }}
        />
      ) : null}
      {pendingDelete ? (
        <Modal title="Delete sheet" onClose={() => setPendingDelete(null)}>
          <p className="text-[14px] text-ink2">Delete {pendingDelete.name} and every row it contains. This cannot be undone.</p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => setPendingDelete(null)}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={removeDataset}>Delete sheet</button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
