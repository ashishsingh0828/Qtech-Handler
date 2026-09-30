import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, downloadExcel, uploadWorkbook } from '../../api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useOutletDataset } from '../shell/AppShell';
import { EmptyState, Modal, PageHeader } from '../ui';
import { hasPermission } from '@shared/permissions.ts';

interface DatasetCard { id: string; name: string; rowCount: number; columnCount: number }

export default function DatasetsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const { setDatasetId } = useOutletDataset();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingDelete, setPendingDelete] = useState<DatasetCard | null>(null);
  const [phrase, setPhrase] = useState('');
  const query = useQuery({ queryKey: ['datasets'], queryFn: () => api<{ datasets: DatasetCard[] }>('/api/datasets') });
  return (
    <div className="page">
      <PageHeader title="Datasets" subtitle="Shared workbooks">
        {user && hasPermission(user.role, 'uploadExcel') ? <button type="button" className="btn btn-primary" onClick={() => fileRef.current?.click()}>Upload</button> : null}
      </PageHeader>
      <input ref={fileRef} hidden type="file" accept=".xlsx,.xls" onChange={(event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        uploadWorkbook(file).then((result) => {
          setDatasetId(result.dataset.id);
          queryClient.invalidateQueries({ queryKey: ['datasets'] });
          toast.push(`Imported ${result.dataset.inserted} new and updated ${result.dataset.updated}.`);
          navigate('/records');
        }).catch((error: Error) => toast.push(error.message));
      }} />
      <div className="grid gap-4 md:grid-cols-2">
        {(query.data?.datasets || []).map((dataset) => (
          <article key={dataset.id} className="card min-w-0">
            <h2 className="m-0 truncate text-[16px] font-medium">{dataset.name}</h2>
            <p className="mt-1 text-[13px] tabular-nums text-muted">{dataset.rowCount} rows · {dataset.columnCount} columns</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => { setDatasetId(dataset.id); navigate('/records'); }}>Open</button>
              <button type="button" className="btn btn-secondary" onClick={() => downloadExcel(`/api/datasets/${dataset.id}/export?group=all`, `${dataset.name}.xlsx`).catch((error: Error) => toast.push(error.message))}>Export</button>
              {user && hasPermission(user.role, 'deleteDatasets') ? (
                <button type="button" className="btn btn-danger" onClick={() => { setPendingDelete(dataset); setPhrase(''); }}>Delete</button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
      {!query.data?.datasets.length ? <EmptyState title="Upload the first workbook to start the registry." /> : null}
      <Modal title="Delete dataset" open={Boolean(pendingDelete)} onClose={() => setPendingDelete(null)}>
        <p className="text-[14px] text-ink2">Type DELETE to remove {pendingDelete?.name}.</p>
        <input className="field mt-3" value={phrase} onChange={(event) => setPhrase(event.target.value)} />
        <button
          type="button"
          className="btn btn-danger mt-4"
          disabled={phrase !== 'DELETE' || !pendingDelete}
          onClick={() => {
            if (!pendingDelete) return;
            api(`/api/datasets/${pendingDelete.id}`, { method: 'DELETE' })
              .then(() => { setPendingDelete(null); queryClient.invalidateQueries({ queryKey: ['datasets'] }); })
              .catch((error: Error) => toast.push(error.message));
          }}
        >Delete dataset</button>
      </Modal>
    </div>
  );
}
