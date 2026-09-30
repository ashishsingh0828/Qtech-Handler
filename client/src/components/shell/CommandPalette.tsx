import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';

interface LinkItem { to: string; label: string }
interface DatasetItem { id: string; name: string }

export default function CommandPalette({ open, onClose, links, datasets, onDataset }: {
  open: boolean;
  onClose: () => void;
  links: LinkItem[];
  datasets: DatasetItem[];
  onDataset: (id: string) => void;
}) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  useEffect(() => { if (open) setQ(''); }, [open]);
  const pages = useMemo(() => links.filter((link) => link.label.toLowerCase().includes(q.toLowerCase())), [links, q]);
  const sets = useMemo(() => datasets.filter((item) => item.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8), [datasets, q]);
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" />
        <Dialog.Content className="dialog-panel" aria-describedby={undefined}>
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <input className="field m-4 w-[calc(100%-32px)]" autoFocus placeholder="Jump to a page or dataset" value={q} onChange={(event) => setQ(event.target.value)} />
          <div className="max-h-80 overflow-auto px-2 pb-3">
            {pages.map((link) => (
              <button key={link.to} type="button" className="flex h-10 w-full items-center rounded-lg px-3 text-left text-[14px] hover:bg-surface2" onClick={() => { navigate(link.to); onClose(); }}>
                <span className="truncate">{link.label}</span>
              </button>
            ))}
            {sets.map((item) => (
              <button key={item.id} type="button" className="flex h-10 w-full items-center rounded-lg px-3 text-left text-[14px] hover:bg-surface2" onClick={() => { onDataset(item.id); navigate('/records'); onClose(); }}>
                <span className="truncate">{item.name}</span>
              </button>
            ))}
            {!pages.length && !sets.length ? <p className="px-3 text-[13px] text-muted">Nothing matches.</p> : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
