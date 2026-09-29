import { useState } from 'react';
import { api } from '../../api';
import { useToast } from '../../context/ToastContext';
import { Field, Modal } from '../ui';

export default function SchemaModal({ dataset, onClose, onChanged }) {
  const toast = useToast();
  const [groupTitle, setGroupTitle] = useState('');
  const [column, setColumn] = useState({ label: '', group: dataset.schema.groups[0]?.key || '', type: 'text' });

  async function run(path, options) {
    try {
      const data = await api(path, options);
      onChanged(data.dataset);
    } catch (err) {
      toast(err.message);
    }
  }

  return (
    <Modal title="Sheet structure" onClose={onClose} width={680}>
      <div className="space-y-6">
        <section>
          <div className="mb-2 text-[11px] uppercase tracking-[0.06em] text-muted">Groups</div>
          <div className="space-y-2">
            {dataset.schema.groups.map((group) => (
              <GroupRow
                key={group.key}
                group={group}
                onRename={(title) => run(`/api/datasets/${dataset.id}/groups/${group.key}`, { method: 'PATCH', body: { title } })}
                onDelete={() => run(`/api/datasets/${dataset.id}/groups/${group.key}`, { method: 'DELETE' })}
              />
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input className="field" placeholder="New group title" value={groupTitle} onChange={(event) => setGroupTitle(event.target.value)} />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                if (!groupTitle.trim()) return;
                run(`/api/datasets/${dataset.id}/groups`, { method: 'POST', body: { title: groupTitle.trim() } });
                setGroupTitle('');
              }}
            >
              Add group
            </button>
          </div>
        </section>
        <section>
          <div className="mb-2 text-[11px] uppercase tracking-[0.06em] text-muted">Columns</div>
          <div className="max-h-64 space-y-2 overflow-auto pr-1">
            {dataset.schema.columns.map((item) => (
              <div key={item.key} className="grid grid-cols-[1fr_160px_auto] gap-2">
                <input
                  className="field"
                  defaultValue={item.label}
                  onBlur={(event) => {
                    if (event.target.value.trim() && event.target.value.trim() !== item.label) {
                      run(`/api/datasets/${dataset.id}/columns/${item.key}`, {
                        method: 'PATCH',
                        body: { label: event.target.value.trim() },
                      });
                    }
                  }}
                />
                <select
                  className="field"
                  value={item.group}
                  onChange={(event) => run(`/api/datasets/${dataset.id}/columns/${item.key}`, {
                    method: 'PATCH',
                    body: { label: item.label, group: event.target.value },
                  })}
                >
                  {dataset.schema.groups.map((group) => <option key={group.key} value={group.key}>{group.title}</option>)}
                </select>
                <button type="button" className="btn btn-secondary" onClick={() => run(`/api/datasets/${dataset.id}/columns/${item.key}`, { method: 'DELETE' })}>Remove</button>
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-[1fr_160px_120px_auto] gap-2">
            <Field label="Label">
              <input className="field" value={column.label} onChange={(event) => setColumn({ ...column, label: event.target.value })} />
            </Field>
            <Field label="Group">
              <select className="field" value={column.group} onChange={(event) => setColumn({ ...column, group: event.target.value })}>
                {dataset.schema.groups.map((group) => <option key={group.key} value={group.key}>{group.title}</option>)}
              </select>
            </Field>
            <Field label="Type">
              <select className="field" value={column.type} onChange={(event) => setColumn({ ...column, type: event.target.value })}>
                <option value="text">Text</option>
                <option value="date">Date</option>
                <option value="number">Number</option>
              </select>
            </Field>
            <div className="flex items-end">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  if (!column.label.trim() || !column.group) return;
                  run(`/api/datasets/${dataset.id}/columns`, { method: 'POST', body: column });
                  setColumn({ ...column, label: '' });
                }}
              >
                Add
              </button>
            </div>
          </div>
        </section>
      </div>
    </Modal>
  );
}

function GroupRow({ group, onRename, onDelete }) {
  const [title, setTitle] = useState(group.title);
  return (
    <div className="flex gap-2">
      <input className="field" value={title} onChange={(event) => setTitle(event.target.value)} />
      <button type="button" className="btn btn-secondary" onClick={() => onRename(title.trim())}>Rename</button>
      <button type="button" className="btn btn-secondary" onClick={onDelete}>Remove</button>
    </div>
  );
}
