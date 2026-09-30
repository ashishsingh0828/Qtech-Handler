import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { useOutletDataset } from '../shell/AppShell';
import { EmptyState, PageHeader, SelectField } from '../ui';
import { GROUP_CATALOG } from '@shared/permissions.ts';

interface Column { id: string; key: string; label: string; groupKey: string; dataType: string; isSystem: boolean }

export default function SchemaPage() {
  const { datasetId } = useOutletDataset();
  const queryClient = useQueryClient();
  const [label, setLabel] = useState('');
  const [groupKey, setGroupKey] = useState('customer_detail');
  const query = useQuery({
    queryKey: ['dataset', datasetId],
    enabled: Boolean(datasetId),
    queryFn: () => api<{ dataset: { columns: Column[] } }>(`/api/datasets/${datasetId}`),
  });
  if (!datasetId) return <div className="page"><EmptyState title="Choose a dataset before editing its schema." /></div>;
  const columns = query.data?.dataset.columns || [];
  return (
    <div className="page">
      <PageHeader title="Schema" subtitle="Groups and columns for the active dataset" />
      <form className="card mb-4 flex flex-wrap gap-2" onSubmit={(event) => {
        event.preventDefault();
        api(`/api/datasets/${datasetId}/columns`, { method: 'POST', body: { label, groupKey, dataType: 'text' } })
          .then(() => { setLabel(''); queryClient.invalidateQueries({ queryKey: ['dataset', datasetId] }); });
      }}>
        <input className="field max-w-xs" placeholder="Column label" value={label} onChange={(event) => setLabel(event.target.value)} />
        <SelectField value={groupKey} onChange={setGroupKey} placeholder="Group" options={GROUP_CATALOG.map((group) => ({ value: group.key, label: group.title }))} />
        <button className="btn btn-primary" type="submit">Add column</button>
      </form>
      <div className="space-y-2">
        {columns.map((column) => (
          <article key={column.id} className="card flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-medium">{column.label}</div>
              <div className="truncate text-[12px] uppercase tracking-[0.06em] text-muted">{column.groupKey}</div>
            </div>
            {!column.isSystem ? (
              <button type="button" className="btn btn-danger" onClick={() => api(`/api/datasets/${datasetId}/columns/${column.id}`, { method: 'DELETE' }).then(() => queryClient.invalidateQueries({ queryKey: ['dataset', datasetId] }))}>Remove</button>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}
