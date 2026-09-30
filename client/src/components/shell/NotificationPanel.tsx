import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
import { api } from '../../api';

interface Notice {
  id: string;
  message: string;
  priority: string;
  isRead: boolean;
  createdAt: string;
  rowId: string | null;
}

export default function NotificationPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ unread: number; notifications: Notice[] }>('/api/notifications'),
    enabled: open,
  });
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" />
        <Dialog.Content className="drawer-panel" aria-describedby={undefined}>
          <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
            <Dialog.Title className="m-0 text-[15px] font-medium">Notifications</Dialog.Title>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                api('/api/notifications/read-all', { method: 'POST' }).then(() => queryClient.invalidateQueries({ queryKey: ['notifications'] }));
              }}
            >Mark read</button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {(query.data?.notifications || []).map((item) => (
              <button
                key={item.id}
                type="button"
                className="block w-full border-b border-hairline px-5 py-3 text-left"
                onClick={() => api(`/api/notifications/${item.id}/read`, { method: 'POST' }).then(() => queryClient.invalidateQueries({ queryKey: ['notifications'] }))}
              >
                <div className="flex min-w-0 items-center gap-2">
                  {item.priority === 'HIGH' ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold" /> : null}
                  <span className="min-w-0 truncate text-[14px]">{item.message}</span>
                </div>
                <div className="mt-1 text-[12px] text-muted">{new Date(item.createdAt).toLocaleString()}</div>
              </button>
            ))}
            {!query.data?.notifications.length ? <p className="px-5 py-6 text-[13px] text-muted">You are up to date.</p> : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
