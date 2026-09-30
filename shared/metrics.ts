import { addDays, calendarDays, parseDate } from './dates.ts';

export type Tone = 'emerald' | 'amber' | 'ruby' | 'stone' | 'sapphire';

export interface CellMap {
  [key: string]: string | number | null | undefined;
}

export interface PmsVisit {
  index: number;
  scheduled: string | null;
  completed: string | null;
  status: 'Done' | 'Upcoming' | 'Due Soon' | 'Overdue' | 'Empty';
  tone: Tone;
}

export interface Derived {
  days: number | null;
  warrantyStatus: string;
  warrantyTone: Tone;
  warrantyExpired: boolean;
  expiringSoon: boolean;
  amcStatus: string;
  amcTone: Tone;
  needsValidation: boolean;
  validationOverdue: boolean;
  pendingVerification: boolean;
  amcDue: boolean;
  pmsOverdue: boolean;
  followupDue: boolean;
  nextDuePms: { label: string; tone: Tone; date: string | null; index: number | null };
  pmsProgress: { done: number; total: number };
  visits: PmsVisit[];
}

function text(data: CellMap, key: string): string {
  const value = data[key];
  if (value == null) return '';
  return String(value).trim();
}

function completionKey(index: number): string {
  return index === 1 ? 'pm_date' : `pm_date_${index - 1}`;
}

export function effectiveAmcStatus(data: CellMap, today: string, stored?: string | null): string {
  const explicit = (stored || text(data, 'amc_status') || text(data, 'amc_state')).trim();
  const normalized = explicit.toLowerCase();
  if (normalized === 'proposal_sent' || normalized === 'proposal sent') return 'Proposal Sent';
  if (normalized === 'acknowledged') return 'Acknowledged';
  if (normalized === 'declined') return 'Declined';
  if (explicit === 'Proposal Sent' || explicit === 'Acknowledged' || explicit === 'Declined' || explicit === 'AMC Due') {
    if (explicit === 'AMC Due') {
      const end = parseDate(data.end_date);
      return end && end < today ? 'AMC Due' : 'Not Due';
    }
    return explicit;
  }
  const end = parseDate(data.end_date);
  if (end && end < today) return 'AMC Due';
  return 'Not Due';
}

export function deriveRecord(data: CellMap, today: string, storedAmc?: string | null): Derived {
  const days = calendarDays(data.start_date, data.end_date);
  const end = parseDate(data.end_date);
  const warrantyExpired = Boolean(end && end < today);
  const expiringSoon = Boolean(end && end >= today && end <= addDays(today, 30));
  let warrantyStatus = '—';
  let warrantyTone: Tone = 'stone';
  if (warrantyExpired) {
    warrantyStatus = 'Expired';
    warrantyTone = 'ruby';
  } else if (expiringSoon) {
    warrantyStatus = 'Expiring in 30 days';
    warrantyTone = 'amber';
  } else if (end) {
    warrantyStatus = 'Active';
    warrantyTone = 'emerald';
  }
  const amcStatus = effectiveAmcStatus(data, today, storedAmc);
  const amcTone: Tone = amcStatus === 'Acknowledged'
    ? 'emerald'
    : amcStatus === 'Declined'
      ? 'ruby'
      : amcStatus === 'Proposal Sent'
        ? 'sapphire'
        : amcStatus === 'AMC Due'
          ? 'amber'
          : 'stone';
  const validated = text(data, 'validated');
  const verified = text(data, 'verified');
  const validationDue = parseDate(data.validation_due);
  const needsValidation = validated === '';
  const validationOverdue = validated === 'No' && Boolean(validationDue && validationDue < today);
  const pendingVerification = validated === 'Yes' && verified !== 'Verified OK';
  const amcDue = warrantyExpired && amcStatus === 'AMC Due';
  const follow = parseDate(data.next_follow_up);
  const followupDue = Boolean(follow && follow <= today);
  const visits: PmsVisit[] = [];
  let done = 0;
  let total = 0;
  let pmsOverdue = false;
  for (let index = 1; index <= 15; index += 1) {
    const rawScheduled = data[`pms_${index}`];
    const scheduled = parseDate(rawScheduled);
    const completed = parseDate(data[completionKey(index)]);
    if (!scheduled) continue;
    total += 1;
    let status: PmsVisit['status'] = 'Upcoming';
    let tone: Tone = 'stone';
    if (completed) {
      status = 'Done';
      tone = 'emerald';
      done += 1;
    } else if (scheduled < today) {
      status = 'Overdue';
      tone = 'ruby';
      pmsOverdue = true;
    } else if (scheduled <= addDays(today, 3)) {
      status = 'Due Soon';
      tone = 'amber';
    }
    visits.push({ index, scheduled, completed, status, tone });
  }
  const open = visits.filter((visit) => !visit.completed).sort((left, right) => (left.scheduled || '').localeCompare(right.scheduled || ''));
  const nextVisit = open[0];
  const nextDuePms = nextVisit?.scheduled
    ? {
      label: nextVisit.scheduled,
      tone: nextVisit.tone,
      date: nextVisit.scheduled,
      index: nextVisit.index,
    }
    : {
      label: total ? 'Complete' : '—',
      tone: 'stone' as Tone,
      date: null,
      index: null,
    };
  return {
    days,
    warrantyStatus,
    warrantyTone,
    warrantyExpired,
    expiringSoon,
    amcStatus,
    amcTone,
    needsValidation,
    validationOverdue,
    pendingVerification,
    amcDue,
    pmsOverdue,
    followupDue,
    nextDuePms,
    pmsProgress: { done, total },
    visits,
  };
}

export function pmsDoneKey(index: number): string {
  return completionKey(index);
}
