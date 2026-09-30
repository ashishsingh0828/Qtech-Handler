import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import { useOutletDataset } from '../shell/AppShell';
import { PageHeader } from '../ui';

interface Entry { id: string; action: string; userName: string; datasetName: string; createdAt: string }

export default function ActivityPage() {
  const { datasetId } = useOutletDataset();
  const query = useQuery({
    queryKey: ['activity', datasetId],
    queryFn: () => api<{ activity: Entry[] }>(`/api/activity${datasetId ? `?datasetId=${datasetId}` : ''}`),
  });
  return (
    <div className="page">
      <PageHeader title="Activity" subtitle="Who changed the registry" />
      <ol className="space-y-2">
        {(query.data?.activity || []).map((entry) => (
          <li key={entry.id} className="card min-w-0">
            <div className="truncate text-[14px]"><span className="font-medium">{entry.userName}</span> {entry.action}</div>
            <div className="truncate text-[12px] text-muted">{entry.datasetName} · {new Date(entry.createdAt).toLocaleString()}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}
