import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { importWorkbook } from '../../api';
import { formatBytes } from '../../lib/format';
import { Modal } from '../ui';

export default function ImportModal({ onClose, onImported }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function take(next) {
    if (!next) return;
    const name = next.name.toLowerCase();
    if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
      setError('Choose an Excel workbook.');
      return;
    }
    setError('');
    setFile(next);
  }

  async function confirm() {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const data = await importWorkbook(file);
      onImported(data.dataset);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Import workbook" onClose={onClose}>
      <div
        className={`dropzone ${over ? 'dropzone-over' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          take(event.dataTransfer.files?.[0]);
        }}
      >
        <Upload size={18} className="mb-3 text-ink2" />
        <div className="text-[14px]">Drop a master workbook here</div>
        <div className="mt-1 text-[13px] text-muted">or click to choose a file</div>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(event) => take(event.target.files?.[0])}
        />
      </div>
      {file ? (
        <div className="mt-4 text-[13px] text-ink2">
          <span className="text-ink">{file.name}</span>
          <span className="text-muted"> · {formatBytes(file.size)}</span>
        </div>
      ) : null}
      {error ? <p className="mt-3 text-[13px] text-[var(--ruby-txt)]">{error}</p> : null}
      <button type="button" className="btn btn-primary mt-5 w-full" disabled={!file || busy} onClick={confirm}>
        {busy ? 'Importing' : 'Confirm & Import to Sheet'}
      </button>
    </Modal>
  );
}
