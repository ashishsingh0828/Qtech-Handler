import { useEffect, useRef, useState } from 'react';
import { Field } from '../ui';

export default function ValidatePopover({ anchor, row, onClose, onSubmit }) {
  const ref = useRef(null);
  const [result, setResult] = useState(row.data?.validated === 'No' ? 'No' : 'Yes');
  const [reason, setReason] = useState(row.data?.rejection_reason || '');
  const [expectedDate, setExpectedDate] = useState(String(row.data?.validation_due || '').slice(0, 10));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose();
    }
    function onDoc(event) {
      if (ref.current && !ref.current.contains(event.target)) onClose();
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDoc);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDoc);
    };
  }, [onClose]);

  const top = Math.min(anchor.bottom + 8, window.innerHeight - 340);
  const left = Math.min(Math.max(12, anchor.left), window.innerWidth - 348);

  async function submit() {
    if (result === 'No') {
      if (reason.trim().length < 5) {
        setError('Enter a reason of at least 5 characters.');
        return;
      }
      if (!expectedDate) {
        setError('Choose the expected date.');
        return;
      }
    }
    setBusy(true);
    setError('');
    try {
      await onSubmit({ result, rejectionReason: reason.trim(), expectedDate });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div
      ref={ref}
      className="fixed z-50 w-[336px] rounded-[12px] border border-hairline bg-surface p-4 shadow-pop"
      style={{ top, left }}
    >
      <div className="text-[13px] font-medium">Validation</div>
      <div className="mt-3 flex gap-2">
        {['Yes', 'No'].map((choice) => (
          <button
            key={choice}
            type="button"
            className={`btn ${result === choice ? 'btn-primary' : 'btn-secondary'} flex-1`}
            onClick={() => setResult(choice)}
          >
            {choice}
          </button>
        ))}
      </div>
      {result === 'No' ? (
        <div className="mt-3 space-y-3">
          <Field label="Rejection reason">
            <textarea className="area" value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
          <Field label="Expected date">
            <input className="field" type="date" value={expectedDate} onChange={(event) => setExpectedDate(event.target.value)} />
          </Field>
        </div>
      ) : null}
      {error ? <p className="mt-3 text-[13px] text-[var(--ruby-txt)]">{error}</p> : null}
      <button type="button" className="btn btn-primary mt-4 w-full" disabled={busy} onClick={submit}>
        {busy ? 'Saving' : 'Confirm decision'}
      </button>
    </div>
  );
}
