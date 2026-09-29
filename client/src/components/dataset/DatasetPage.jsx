import { useEffect, useRef, useState } from 'react';
import { useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { Download, Plus, Trash2 } from 'lucide-react';
import { hasPermission } from '@shared/permissions.js';
import { api, downloadExcel } from '../../api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Modal, Pill } from '../ui';
import SpreadsheetWorkspace from '../grid/SpreadsheetWorkspace';
import ActivityDrawer from './ActivityDrawer';
import SchemaModal from './SchemaModal';

const TABS = [
  { id: 'all', label: 'All', count: 'all' },
  { id: 'needs_validation', label: 'Needs Validation', count: 'needs_validation' },
  { id: 'validation_overdue', label: 'Validation Overdue', count: 'validation_overdue' },
  { id: 'pending_verification', label: 'Pending Verification', count: 'pending_verification' },
  { id: 'amc_due', label: 'AMC Due', count: 'amc_due' },
  { id: 'active_amc', label: 'Active AMC', count: 'active_amc' },
];

export default function DatasetPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { query } = useOutletContext();
  const [params, setParams] = useSearchParams();
  const [dataset, setDataset] = useState(null);
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [drawerId, setDrawerId] = useState(params.get('row'));
  const [version, setVersion] = useState(0);
  const debounced = useDebounced(query, 250);
  const loaded = useRef(0);
  const request = useRef(0);
  const fetching = useRef(false);
  const exported = useRef(false);
  const tab = params.get('tab') || 'all';

  useEffect(() => {
    setDrawerId(params.get('row'));
  }, [params]);

  useEffect(() => {
    let cancelled = false;
    const requestId = ++request.current;
    setLoading(true);
    setMissing(false);
    loaded.current = 0;
    Promise.all([
      api(`/api/datasets/${id}`),
      api(`/api/datasets/${id}/rows?${queryString(tab, debounced, 0)}`),
    ]).then(([meta, page]) => {
      if (cancelled || requestId !== request.current) return;
      setDataset(meta.dataset);
      setRows(page.rows);
      setCounts(page.counts);
      setTotal(page.total);
      loaded.current = page.rows.length;
    }).catch((error) => {
      if (cancelled || requestId !== request.current) return;
      if (error.status === 404) setMissing(true);
      else toast(error.message);
    }).finally(() => {
      if (!cancelled && requestId === request.current) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [id, tab, debounced, version]);

  useEffect(() => {
    if (params.get('export') !== '1') {
      exported.current = false;
      return;
    }
    if (!dataset || exported.current) return;
    exported.current = true;
    downloadExcel(dataset.id, dataset.name).catch((error) => toast(error.message));
    const next = new URLSearchParams(params);
    next.delete('export');
    setParams(next, { replace: true });
  }, [params, dataset, setParams, toast]);

  async function loadMore() {
    if (fetching.current || loaded.current >= total) return;
    fetching.current = true;
    const requestId = request.current;
    try {
      const page = await api(`/api/datasets/${id}/rows?${queryString(tab, debounced, loaded.current)}`);
      if (requestId !== request.current) return;
      setRows((current) => [...current, ...page.rows]);
      loaded.current += page.rows.length;
      setTotal(page.total);
      setCounts(page.counts);
    } catch (error) {
      toast(error.message);
    } finally {
      fetching.current = false;
    }
  }

  function applyRow(data) {
    setRows((current) => current.map((row) => (row.id === data.row.id ? data.row : row)));
    if (data.counts) setCounts(data.counts);
  }

  async function onPatch(rowId, updates) {
    const data = await api(`/api/datasets/${id}/rows/${rowId}`, {
      method: 'PATCH',
      body: { updates },
    });
    applyRow(data);
  }

  async function onValidate(rowId, body) {
    const data = await api(`/api/datasets/${id}/rows/${rowId}/validate`, {
      method: 'POST',
      body,
    });
    applyRow(data);
  }

  async function insertRow() {
    try {
      await api(`/api/datasets/${id}/rows`, { method: 'POST', body: {} });
      setVersion((value) => value + 1);
    } catch (error) {
      toast(error.message);
    }
  }

  async function deleteDataset() {
    try {
      await api(`/api/datasets/${id}`, { method: 'DELETE' });
      navigate('/');
    } catch (error) {
      toast(error.message);
    }
  }

  function setTab(next) {
    const search = new URLSearchParams(params);
    if (next === 'all') search.delete('tab');
    else search.set('tab', next);
    setParams(search);
  }

  if (missing) {
    return <div className="flex h-full items-center justify-center text-muted">This sheet is no longer available.</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col px-6 py-4">
      <div className="mb-3 flex items-center gap-3">
        <h1 className="min-w-0 flex-1 truncate text-[20px] font-medium">{dataset?.name || 'Sheet'}</h1>
        <div className="text-[13px] text-muted">
          {dataset ? `${dataset.rowCount} rows · ${dataset.columnCount} columns` : ''}
        </div>
        {hasPermission(user.role, 'insertRows') ? (
          <button type="button" className="btn btn-secondary" onClick={insertRow}><Plus size={14} /> Row</button>
        ) : null}
        {hasPermission(user.role, 'alterSchema') ? (
          <button type="button" className="btn btn-secondary" onClick={() => setSchemaOpen(true)}>Structure</button>
        ) : null}
        <button type="button" className="icon-btn" aria-label="Export" onClick={() => dataset && downloadExcel(dataset.id, dataset.name).catch((error) => toast(error.message))}>
          <Download size={16} />
        </button>
        {hasPermission(user.role, 'deleteDatasets') ? (
          <button type="button" className="icon-btn" aria-label="Delete sheet" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={16} />
          </button>
        ) : null}
      </div>
      <div className="mb-3 flex items-end border-b border-hairline">
        {TABS.map((item) => (
          <button key={item.id} type="button" className={`tab ${tab === item.id ? 'tab-active' : ''}`} onClick={() => setTab(item.id)}>
            {item.label}
            <Pill tone="stone">{counts ? counts[item.count] : 0}</Pill>
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {dataset ? (
          <SpreadsheetWorkspace
            datasetId={dataset.id}
            user={user}
            schema={dataset.schema}
            rows={rows}
            loading={loading}
            total={total}
            onPatch={onPatch}
            onValidate={onValidate}
            onOpenRow={setDrawerId}
            onNearEnd={loadMore}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[13px] text-muted">Loading the sheet</div>
        )}
      </div>
      {drawerId ? (
        <ActivityDrawer
          datasetId={id}
          rowId={drawerId}
          user={user}
          onClose={() => setDrawerId(null)}
          onChanged={() => setVersion((value) => value + 1)}
          onDeleted={() => {
            setDrawerId(null);
            setVersion((value) => value + 1);
          }}
        />
      ) : null}
      {schemaOpen && dataset ? (
        <SchemaModal
          dataset={dataset}
          onClose={() => setSchemaOpen(false)}
          onChanged={(next) => {
            setDataset(next);
            setVersion((value) => value + 1);
          }}
        />
      ) : null}
      {confirmDelete ? (
        <Modal title="Delete sheet" onClose={() => setConfirmDelete(false)}>
          <p className="text-[14px] text-ink2">Delete this sheet and every row it contains.</p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => setConfirmDelete(false)}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={deleteDataset}>Delete sheet</button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function queryString(tab, q, offset) {
  const params = new URLSearchParams();
  if (tab && tab !== 'all') params.set('tab', tab);
  if (q) params.set('q', q);
  params.set('offset', String(offset));
  params.set('limit', '150');
  return params.toString();
}

function useDebounced(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
