import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Popover from '@radix-ui/react-popover';
import * as Checkbox from '@radix-ui/react-checkbox';
import * as Select from '@radix-ui/react-select';
import { Check, ChevronDown, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { addDays } from '@shared/dates.ts';
import type { Tone } from '@shared/metrics.ts';

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="page-title truncate">{title}</h1>
        {subtitle ? <p className="mt-1 truncate text-[13px] text-muted">{subtitle}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

export function StatusPill({ tone = 'stone', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`pill tone-${tone}`}><span className="clip">{children}</span></span>;
}

export function KpiCard({ label, value, sub, onClick }: { label: string; value: string | number; sub?: string; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className="card min-w-0 text-left" onClick={onClick} type={onClick ? 'button' : undefined}>
      <div className="truncate text-[12px] text-muted">{label}</div>
      <div className="numeral mt-2 text-[36px]">{value}</div>
      {sub ? <div className="mt-2 truncate text-[12px] text-ink2">{sub}</div> : null}
    </Tag>
  );
}

export function EmptyState({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="card grid place-items-center gap-3 py-10 text-center">
      <svg width="72" height="40" viewBox="0 0 72 40" aria-hidden="true">
        <rect x="1" y="1" width="70" height="38" rx="8" fill="none" stroke="#E8E4DD" />
        <path d="M12 26h48M12 16h28" stroke="#B8955A" strokeWidth="1.5" />
      </svg>
      <p className="m-0 max-w-sm text-[14px] text-ink2">{title}</p>
      {action}
    </div>
  );
}

export function Modal({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" />
        <Dialog.Content className="dialog-panel" aria-describedby={undefined}>
          <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
            <Dialog.Title className="m-0 text-[15px] font-medium">{title}</Dialog.Title>
            <Dialog.Close className="icon-btn" aria-label="Close"><X size={16} strokeWidth={1.5} /></Dialog.Close>
          </div>
          <div className="px-5 py-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ActionSheet({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" />
        <Dialog.Content className="dialog-panel sheet-panel" aria-describedby={undefined}>
          <div className="flex items-center justify-between border-b border-hairline px-5 py-4">
            <Dialog.Title className="m-0 text-[15px] font-medium">{title}</Dialog.Title>
            <Dialog.Close className="icon-btn" aria-label="Close"><X size={16} strokeWidth={1.5} /></Dialog.Close>
          </div>
          <div className="px-5 py-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Menu({ trigger, children }: { trigger: ReactNode; children: ReactNode }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="popover-panel min-w-[180px] p-1.5" align="end" sideOffset={8}>
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function MenuItem({ children, onSelect, danger }: { children: ReactNode; onSelect: () => void; danger?: boolean }) {
  return (
    <DropdownMenu.Item
      className={`flex h-9 cursor-pointer items-center rounded-lg px-2 text-[13px] outline-none data-[highlighted]:bg-surface2 ${danger ? 'text-[#A63A38]' : ''}`}
      onSelect={onSelect}
    >
      {children}
    </DropdownMenu.Item>
  );
}

export function CheckField({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="inline-flex min-w-0 items-center gap-2 text-[13px]">
      <Checkbox.Root
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
        className="flex h-4 w-4 items-center justify-center rounded border border-hairline-strong bg-surface data-[state=checked]:border-navy data-[state=checked]:bg-navy"
      >
        <Checkbox.Indicator><Check size={12} strokeWidth={1.5} className="text-canvas" /></Checkbox.Indicator>
      </Checkbox.Root>
      <span className="truncate">{label}</span>
    </label>
  );
}

export function SelectField({ value, onChange, options, placeholder }: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
}) {
  return (
    <Select.Root value={value || undefined} onValueChange={onChange}>
      <Select.Trigger className="field inline-flex items-center justify-between gap-2" aria-label={placeholder}>
        <span className="min-w-0 truncate"><Select.Value placeholder={placeholder} /></span>
        <ChevronDown size={14} strokeWidth={1.5} />
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="popover-panel z-[var(--z-popover)] max-h-64 overflow-auto" position="popper">
          <Select.Viewport className="p-1">
            {options.map((option) => (
              <Select.Item key={option.value} value={option.value} className="flex h-9 cursor-pointer items-center rounded-lg px-2 text-[13px] outline-none data-[highlighted]:bg-surface2">
                <Select.ItemText>{option.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

export function DateField({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const [cursor, setCursor] = useState(() => value || new Date().toISOString().slice(0, 10));
  const cells = useMemo(() => monthCells(cursor), [cursor]);
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-[13px] text-ink2">{label}</span>
      <Popover.Root>
        <Popover.Trigger className="field text-left" type="button">{value || 'Choose a date'}</Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="popover-panel w-[280px] p-3" sideOffset={8}>
            <div className="mb-2 flex items-center justify-between">
              <button type="button" className="icon-btn" onClick={() => setCursor(shiftMonth(cursor, -1))} aria-label="Previous month">‹</button>
              <div className="text-[13px] font-medium">{cursor.slice(0, 7)}</div>
              <button type="button" className="icon-btn" onClick={() => setCursor(shiftMonth(cursor, 1))} aria-label="Next month">›</button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-[12px]">
              {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((day) => <div key={day} className="text-muted">{day}</div>)}
              {cells.map((day) => (
                <button
                  key={day.iso || day.label}
                  type="button"
                  disabled={!day.iso}
                  className={`h-8 rounded-md ${day.iso === value ? 'bg-navy text-canvas' : 'hover:bg-surface2'}`}
                  onClick={() => day.iso && onChange(day.iso)}
                >
                  {day.label}
                </button>
              ))}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </label>
  );
}

function shiftMonth(iso: string, delta: number): string {
  const [year, month] = iso.slice(0, 7).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return date.toISOString().slice(0, 10);
}

function monthCells(iso: string): { iso: string; label: string }[] {
  const [year, month] = iso.slice(0, 7).split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const startPad = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: { iso: string; label: string }[] = [];
  for (let index = 0; index < startPad; index += 1) cells.push({ iso: '', label: '' });
  for (let day = 1; day <= days; day += 1) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    cells.push({ iso: date, label: String(day) });
  }
  return cells;
}

export function daysFrom(iso: string, days: number): string {
  return addDays(iso, days);
}
