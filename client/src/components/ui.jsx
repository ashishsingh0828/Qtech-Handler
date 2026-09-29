import { useEffect } from 'react';
import { X } from 'lucide-react';

export function Modal({ title, children, onClose, width = 520 }) {
  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-root">
      <button type="button" className="overlay" aria-label="Close dialog" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={{ width: `min(${width}px, calc(100vw - 32px))` }}>
        <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
          <h2 className="text-[15px] font-medium">{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function Pill({ tone = 'stone', children }) {
  return <span className={`pill tone-${tone}`}>{children}</span>;
}

export function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] text-ink2">{label}</span>
      {children}
    </label>
  );
}
