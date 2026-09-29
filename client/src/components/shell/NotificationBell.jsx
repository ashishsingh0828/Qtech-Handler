import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { api } from '../../api';
import { formatDateTime } from '../../lib/format';

export default function NotificationBell({ user }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const rootRef = useRef(null);

  async function load() {
    const data = await api('/api/notifications');
    setItems(data.items);
    setUnread(data.unread);
  }

  useEffect(() => {
    if (!user || (user.role !== 'admin' && user.role !== 'manager')) return undefined;
    load().catch(() => {});
    const source = new EventSource('/api/notifications/stream', { withCredentials: true });
    const onNotice = () => {
      load().catch(() => {});
    };
    source.addEventListener('notice', onNotice);
    return () => {
      source.removeEventListener('notice', onNotice);
      source.close();
    };
  }, [user]);

  useEffect(() => {
    function onDoc(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  if (!user || (user.role !== 'admin' && user.role !== 'manager')) return null;

  async function openItem(item) {
    if (!item.read) {
      await api(`/api/notifications/${item.id}/read`, { method: 'POST' }).catch(() => {});
    }
    setOpen(false);
    if (item.datasetId) {
      const params = new URLSearchParams();
      if (item.rowId) params.set('row', item.rowId);
      navigate(`/datasets/${item.datasetId}${params.toString() ? `?${params}` : ''}`);
    }
    load().catch(() => {});
  }

  async function markAll() {
    await api('/api/notifications/read-all', { method: 'POST' });
    load().catch(() => {});
  }

  return (
    <div className="relative" ref={rootRef}>
      <button type="button" className="icon-btn relative" aria-label="Notifications" onClick={() => setOpen((value) => !value)}>
        <Bell size={16} />
        {unread > 0 ? <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-gold" /> : null}
      </button>
      {open ? (
        <div className="flyout">
          <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
            <div className="text-[13px] font-medium">Notifications</div>
            <button type="button" className="text-[12px] text-muted" onClick={markAll}>Mark all read</button>
          </div>
          <div>
            {items.length === 0 ? <div className="px-4 py-8 text-center text-[13px] text-muted">No alerts yet.</div> : null}
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="block w-full border-b border-hairline px-4 py-3 text-left last:border-b-0 hover:bg-surface2"
                onClick={() => openItem(item)}
              >
                <div className="flex items-start gap-2">
                  {!item.read ? <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" /> : <span className="mt-1.5 h-1.5 w-1.5 shrink-0" />}
                  <div>
                    <div className="text-[13px] text-ink">{item.message}</div>
                    <div className="mt-1 text-[12px] text-muted">{formatDateTime(item.createdAt)}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
