import { useEffect, useMemo, useRef, useState } from 'react';
import { Lock, Minus, Plus } from 'lucide-react';
import {
  GROUP_CATALOG,
  canEditColumn,
  editableGroupTitles,
  hasPermission,
  isPmsDetailColumn,
  isServerManaged,
  roleLabel,
} from '@shared/permissions.js';
import { displayCell, formatDate } from '../../lib/format';
import { useToast } from '../../context/ToastContext';
import { Pill } from '../ui';
import ValidatePopover from '../dataset/ValidatePopover';

const INDEX_WIDTH = 56;
const ROW_HEIGHT = 36;

export default function SpreadsheetWorkspace({
  datasetId,
  user,
  schema,
  rows,
  loading,
  total,
  onPatch,
  onValidate,
  onOpenRow,
  onNearEnd,
}) {
  const toast = useToast();
  const storageKey = `qtech.pms.${user.id}.${datasetId}`;
  const [expanded, setExpanded] = useState(() => readPreference(storageKey));
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [popover, setPopover] = useState(null);
  const [flash, setFlash] = useState({});
  const [bucket, setBucket] = useState(0);
  const [viewport, setViewport] = useState(480);
  const bodyRef = useRef(null);
  const headerRef = useRef(null);
  const closedEdit = useRef(false);

  const columns = useMemo(
    () => visibleColumns(schema.columns || [], expanded),
    [schema.columns, expanded],
  );
  const spans = useMemo(
    () => groupSpans(columns, schema.groups || []),
    [columns, schema.groups],
  );
  const width = INDEX_WIDTH + columns.reduce((sum, column) => sum + column.width, 0);
  const start = Math.max(0, bucket - 8);
  const end = Math.min(rows.length, bucket + Math.ceil(viewport / ROW_HEIGHT) + 16);
  const slice = rows.slice(start, end);

  useEffect(() => {
    const node = bodyRef.current;
    if (!node) return undefined;
    const measure = () => setViewport(node.clientHeight || 480);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [rows.length]);

  useEffect(() => {
    const node = bodyRef.current;
    if (!node || rows.length >= total) return;
    if (node.scrollHeight <= node.clientHeight + ROW_HEIGHT * 24) onNearEnd?.();
  }, [rows.length, total, viewport]);

  function toggleSchedule() {
    const next = !expanded;
    setExpanded(next);
    try {
      localStorage.setItem(storageKey, next ? 'expanded' : 'collapsed');
    } catch {
      /* preference is optional */
    }
  }

  function onBodyScroll(event) {
    const node = event.currentTarget;
    if (headerRef.current) headerRef.current.scrollLeft = node.scrollLeft;
    const nextBucket = Math.floor(node.scrollTop / ROW_HEIGHT);
    setBucket((current) => (current === nextBucket ? current : nextBucket));
    if (rows.length < total && node.scrollTop + node.clientHeight > node.scrollHeight - ROW_HEIGHT * 24) {
      onNearEnd?.();
    }
  }

  function moveSelection(rowDelta, columnDelta) {
    if (!selected) return;
    const rowIndex = rows.findIndex((row) => row.id === selected.rowId);
    const columnIndex = columns.findIndex((column) => column.key === selected.key);
    const nextRow = rows[Math.min(rows.length - 1, Math.max(0, rowIndex + rowDelta))];
    const nextColumn = columns[Math.min(columns.length - 1, Math.max(0, columnIndex + columnDelta))];
    if (!nextRow || !nextColumn) return;
    setSelected({ rowId: nextRow.id, key: nextColumn.key });
    const node = bodyRef.current;
    if (!node) return;
    const top = rows.findIndex((row) => row.id === nextRow.id) * ROW_HEIGHT;
    if (node.scrollTop > top) node.scrollTop = top;
    else if (node.scrollTop + node.clientHeight < top + ROW_HEIGHT) {
      node.scrollTop = top - node.clientHeight + ROW_HEIGHT;
    }
  }

  function beginEdit(row, column) {
    if (column.synthetic || !canEditColumn(user.role, column, schema)) {
      if (column.synthetic || isServerManaged(column.key)) {
        toast('This field is maintained by the server and cannot be edited.');
      } else {
        const titles = editableGroupTitles(user.role, schema).join(', ');
        toast(`Your role (${roleLabel(user.role)}) can edit ${titles} only.`);
      }
      return;
    }
    closedEdit.current = false;
    setEditing({ rowId: row.id, key: column.key, value: rawValue(row, column), type: column.type });
  }

  function cancelEdit() {
    closedEdit.current = true;
    setEditing(null);
  }

  async function commitEdit(draft) {
    if (!draft || closedEdit.current) return;
    closedEdit.current = true;
    const row = rows.find((item) => item.id === draft.rowId);
    const original = row ? rawValue(row, { key: draft.key, type: draft.type }) : '';
    try {
      if (String(original) !== String(draft.value)) {
        await onPatch(draft.rowId, { [draft.key]: draft.value });
        setFlash((current) => ({ ...current, [`${draft.rowId}:${draft.key}`]: Date.now() }));
      }
      setEditing(null);
    } catch (error) {
      closedEdit.current = false;
      if (error.code === 'FORBIDDEN') {
        const titles = editableGroupTitles(user.role, schema).join(', ');
        toast(`Your role (${roleLabel(user.role)}) can edit ${titles} only.`);
      } else {
        toast(error.message);
      }
    }
  }

  function onGridKeyDown(event) {
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;
    if (!selected) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveSelection(1, 0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveSelection(-1, 0);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      moveSelection(0, 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      moveSelection(0, -1);
    } else if (event.key === 'Enter') {
      const row = rows.find((item) => item.id === selected.rowId);
      const column = columns.find((item) => item.key === selected.key);
      if (row && column) beginEdit(row, column);
    } else if (event.key === 'Escape') {
      cancelEdit();
      setPopover(null);
    }
  }

  return (
    <div className="sheet" tabIndex={0} onKeyDown={onGridKeyDown}>
      <div className="sheet-head" ref={headerRef}>
        <div style={{ width }}>
          <div className="sheet-group-row">
            <div className="sheet-corner" style={{ height: 32 }} />
            {spans.map((span) => {
              const known = GROUP_CATALOG.find((group) => group.key === span.group);
              return (
                <div
                  key={`${span.group}-${span.offset}`}
                  className={`group-cell ${known ? `tint-${known.tint}` : 'bg-surface2'}`}
                  style={{ width: span.width }}
                >
                  <span>{span.title}</span>
                  {span.group === 'schedule_services' ? (
                    <button
                      type="button"
                      className="flex h-5 w-5 items-center justify-center rounded-[6px] border border-hairlineStrong bg-surface text-ink"
                      aria-expanded={expanded}
                      aria-label={expanded ? 'Collapse PMS schedule' : 'Expand PMS schedule'}
                      onClick={toggleSchedule}
                    >
                      {expanded ? <Minus size={12} /> : <Plus size={12} />}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="sheet-col-row">
            <div className="sheet-corner col-cell" style={{ height: 36 }}>#</div>
            {columns.map((column) => (
              <div key={column.key} className="col-cell" style={{ width: column.width }}>
                <span title={column.label}>{column.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="sheet-body" ref={bodyRef} onScroll={onBodyScroll}>
        {rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[13px] text-muted">
            {loading ? 'Loading the sheet' : 'No rows in this view.'}
          </div>
        ) : (
          <div style={{ height: rows.length * ROW_HEIGHT, width }}>
            <div style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}>
              {slice.map((row) => (
                <div className="sheet-row" role="row" key={row.id} style={{ width }}>
                  <button type="button" className="cell-index" onClick={() => onOpenRow(row.id)}>
                    {row.position}
                  </button>
                  {columns.map((column) => {
                    const locked = column.synthetic || !canEditColumn(user.role, column, schema);
                    const active = selected?.rowId === row.id && selected?.key === column.key;
                    const isEditing = editing?.rowId === row.id && editing?.key === column.key;
                    const token = flash[`${row.id}:${column.key}`];
                    return (
                      <div
                        key={column.key}
                        className={`cell ${locked ? 'cell-locked' : ''} ${active ? 'cell-selected' : ''} ${column.key === 'days' && Number(row.computed?.days) < 0 ? 'cell-negative' : ''}`}
                        style={{ width: column.width }}
                        onClick={(event) => {
                          setSelected({ rowId: row.id, key: column.key });
                          if (column.key === 'validated' && hasPermission(user.role, 'validateRecords')) {
                            setPopover({ row, rect: event.currentTarget.getBoundingClientRect() });
                          } else {
                            setPopover(null);
                          }
                        }}
                        onDoubleClick={() => beginEdit(row, column)}
                        title={plainTitle(row, column)}
                      >
                        {isEditing ? (
                          <input
                            autoFocus
                            className="cell-editor"
                            type={column.type === 'date' ? 'date' : 'text'}
                            value={editing.value}
                            onChange={(event) => setEditing({ ...editing, value: event.target.value })}
                            onBlur={() => commitEdit(editing)}
                            onKeyDown={(event) => {
                              event.stopPropagation();
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                commitEdit(editing);
                              } else if (event.key === 'Escape') {
                                event.preventDefault();
                                cancelEdit();
                              }
                            }}
                          />
                        ) : (
                          <CellView row={row} column={column} flashKey={token} />
                        )}
                        {locked && !isEditing ? <Lock size={12} className="lock-icon" /> : null}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {popover ? (
        <ValidatePopover
          anchor={popover.rect}
          row={popover.row}
          onClose={() => setPopover(null)}
          onSubmit={(body) => onValidate(popover.row.id, body).then(() => setPopover(null))}
        />
      ) : null}
    </div>
  );
}

function CellView({ row, column, flashKey }) {
  const body = renderCell(row, column);
  return (
    <>
      {flashKey ? <span key={flashKey} className="cell-flash-overlay" /> : null}
      {body}
    </>
  );
}

function renderCell(row, column) {
  if (column.key === 'next_due_pms') {
    const due = row.computed?.nextDuePms || { label: '—', tone: 'stone' };
    const text = due.date ? formatDate(due.date) : due.label;
    return <Pill tone={due.tone || 'stone'}>{text}</Pill>;
  }
  if (column.key === 'validated') {
    const value = row.data?.validated;
    if (value === 'Yes') return <Pill tone="emerald">Yes</Pill>;
    if (value === 'No') return <Pill tone="ruby">No</Pill>;
    return <Pill tone="stone">—</Pill>;
  }
  if (column.key === 'verified') {
    const value = row.data?.verified;
    if (value === 'Verified OK') return <Pill tone="emerald">Verified OK</Pill>;
    if (value === 'Pending') return <Pill tone="amber">Pending</Pill>;
    return <span className="text-muted">—</span>;
  }
  if (column.key === 'warranty_status') {
    return <Pill tone={row.computed?.warrantyTone || 'stone'}>{row.computed?.warrantyStatus || '—'}</Pill>;
  }
  const value = column.key === 'days' ? row.computed?.days : row.data?.[column.key];
  const text = value == null || value === '' ? '' : displayCell(value, column.type);
  return <span className="min-w-0 flex-1">{text || '—'}</span>;
}

function plainTitle(row, column) {
  if (column.key === 'next_due_pms') return row.computed?.nextDuePms?.label || '';
  if (column.key === 'days') return String(row.computed?.days ?? '');
  const value = row.data?.[column.key];
  return value == null ? '' : String(value);
}

function rawValue(row, column) {
  if (column.key === 'days') return row.computed?.days ?? '';
  const value = row.data?.[column.key];
  if (value == null) return '';
  if (column.type === 'date') return String(value).slice(0, 10);
  return String(value);
}

function visibleColumns(columns, expanded) {
  const next = [];
  let injected = false;
  const hasSchedule = columns.some((column) => column.group === 'schedule_services');
  for (const column of columns) {
    if (!expanded && isPmsDetailColumn(column)) {
      if (!injected) {
        next.push(syntheticColumn());
        injected = true;
      }
      continue;
    }
    next.push({ ...column, width: columnWidth(column) });
  }
  if (hasSchedule && !expanded && !injected) {
    const index = next.findIndex((column) => column.group === 'schedule_services');
    const synthetic = syntheticColumn();
    if (index < 0) next.push(synthetic);
    else next.splice(index, 0, synthetic);
  }
  return next;
}

function syntheticColumn() {
  return {
    key: 'next_due_pms',
    label: 'Next Due PMS',
    group: 'schedule_services',
    type: 'text',
    synthetic: true,
    width: 160,
  };
}

function columnWidth(column) {
  if (column.key === 'sr_no' || column.key === 'days') return 84;
  if (column.key === 'customer_name' || column.key === 'equipment_name') return 200;
  if (column.key === 'next_due_pms') return 160;
  if (column.type === 'date') return 132;
  if (column.type === 'number') return 100;
  return 160;
}

function groupSpans(columns, groups) {
  const spans = [];
  columns.forEach((column, index) => {
    const last = spans[spans.length - 1];
    if (last && last.group === column.group) {
      last.span += 1;
      last.width += column.width;
      return;
    }
    spans.push({
      group: column.group,
      title: groups.find((group) => group.key === column.group)?.title || column.group,
      span: 1,
      width: column.width,
      offset: index,
    });
  });
  return spans;
}

function readPreference(key) {
  try {
    return localStorage.getItem(key) === 'expanded';
  } catch {
    return false;
  }
}
