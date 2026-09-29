import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { hasPermission } from '@shared/permissions.js';
import { api } from '../../api';
import { useAuth } from '../../context/AuthContext';

export default function CommandPalette({ open, onClose }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [datasets, setDatasets] = useState([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!open) return undefined;
    setQuery('');
    setActive(0);
    let cancelled = false;
    api('/api/datasets')
      .then((data) => {
        if (!cancelled) setDatasets(data.datasets);
      })
      .catch(() => {
        if (!cancelled) setDatasets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const items = useMemo(() => {
    const actions = [
      { id: 'registry', label: 'Open registry', run: () => navigate('/') },
    ];
    if (hasPermission(user?.role, 'uploadExcel')) {
      actions.push({ id: 'import', label: 'Import workbook', run: () => navigate('/?import=1') });
    }
    if (hasPermission(user?.role, 'manageUsers')) {
      actions.push({ id: 'users', label: 'Manage users', run: () => navigate('/users') });
    }
    const datasetId = location.pathname.match(/^\/datasets\/([^/]+)/)?.[1];
    if (datasetId) {
      actions.push({
        id: 'export',
        label: 'Export current sheet',
        run: () => navigate(`/datasets/${datasetId}?export=1`),
      });
    }
    const needle = query.trim().toLowerCase();
    const sheets = datasets
      .filter((dataset) => !needle || dataset.name.toLowerCase().includes(needle))
      .map((dataset) => ({
        id: dataset.id,
        label: dataset.name,
        hint: 'Sheet',
        run: () => navigate(`/datasets/${dataset.id}`),
      }));
    const filteredActions = actions.filter((action) => !needle || action.label.toLowerCase().includes(needle));
    return [...filteredActions, ...sheets];
  }, [datasets, location.pathname, navigate, query, user?.role]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  if (!open) return null;

  function choose(item) {
    onClose();
    item.run();
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(items.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter' && items[active]) {
      event.preventDefault();
      choose(items[active]);
    }
  }

  return (
    <div className="modal-root">
      <button type="button" className="overlay" aria-label="Close command palette" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-label="Command palette" style={{ width: 'min(560px, calc(100vw - 32px))' }}>
        <div className="border-b border-hairline px-4 py-3">
          <input
            autoFocus
            className="field"
            placeholder="Search sheets and actions"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="max-h-[360px] overflow-auto py-2">
          {items.length === 0 ? <div className="px-4 py-8 text-center text-[13px] text-muted">Nothing matches.</div> : null}
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-[14px] ${index === active ? 'bg-surface2' : ''}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(item)}
            >
              <span>{item.label}</span>
              {item.hint ? <span className="text-[12px] text-muted">{item.hint}</span> : null}
            </button>
          ))}
        </div>
        <div className="border-t border-hairline px-4 py-2 text-[12px] text-muted">Esc to close</div>
      </div>
    </div>
  );
}
