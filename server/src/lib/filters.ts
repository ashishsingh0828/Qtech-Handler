import { Prisma } from '@prisma/client';

export function pmsOverdueSql(today: string): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  for (let index = 1; index <= 15; index += 1) {
    const scheduled = `pms_${index}`;
    const done = index === 1 ? 'pm_date' : `pm_date_${index - 1}`;
    parts.push(Prisma.sql`(
      COALESCE(data->>${scheduled}, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      AND (data->>${scheduled}) < ${today}
      AND COALESCE(data->>${done}, '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    )`);
  }
  return Prisma.join(parts, ' OR ');
}

export function chipSql(chip: string, today: string, soon: string): Prisma.Sql {
  const pms = pmsOverdueSql(today);
  switch (chip) {
    case 'needs_validation':
      return Prisma.sql`COALESCE(data->>'validated', '') = ''`;
    case 'validation_overdue':
      return Prisma.sql`data->>'validated' = 'No' AND COALESCE(data->>'validation_due', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND data->>'validation_due' < ${today}`;
    case 'pending_verification':
      return Prisma.sql`data->>'validated' = 'Yes' AND COALESCE(data->>'verified', '') <> 'Verified OK'`;
    case 'amc_due':
      return Prisma.sql`COALESCE(data->>'end_date', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND data->>'end_date' < ${today} AND COALESCE(NULLIF(amc_status, ''), NULLIF(data->>'amc_status', ''), '') NOT IN ('Proposal Sent', 'Acknowledged', 'Declined')`;
    case 'pms_overdue':
      return Prisma.sql`(${pms})`;
    case 'followup_due':
      return Prisma.sql`COALESCE(data->>'next_follow_up', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND data->>'next_follow_up' <= ${today}`;
    case 'expiring_soon':
      return Prisma.sql`COALESCE(data->>'end_date', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND data->>'end_date' >= ${today} AND data->>'end_date' <= ${soon}`;
    case 'duplicates':
      return Prisma.sql`is_duplicate_suspect = TRUE`;
    case 'missing_dates':
      return Prisma.sql`COALESCE(data->>'start_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR COALESCE(data->>'end_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`;
    default:
      return Prisma.sql`TRUE`;
  }
}

export interface MetricCounts {
  all: number;
  needs_validation: number;
  validation_overdue: number;
  pending_verification: number;
  amc_due: number;
  pms_overdue: number;
  followup_due: number;
  expiring_soon: number;
  duplicates: number;
  missing_dates: number;
  open_calls: number;
}

interface CountRow {
  all_rows: number;
  needs_validation: number;
  validation_overdue: number;
  pending_verification: number;
  amc_due: number;
  pms_overdue: number;
  followup_due: number;
  expiring_soon: number;
  duplicates: number;
  missing_dates: number;
}

export function countsFrom(row: CountRow | undefined, openCalls: number): MetricCounts {
  return {
    all: row?.all_rows || 0,
    needs_validation: row?.needs_validation || 0,
    validation_overdue: row?.validation_overdue || 0,
    pending_verification: row?.pending_verification || 0,
    amc_due: row?.amc_due || 0,
    pms_overdue: row?.pms_overdue || 0,
    followup_due: row?.followup_due || 0,
    expiring_soon: row?.expiring_soon || 0,
    duplicates: row?.duplicates || 0,
    missing_dates: row?.missing_dates || 0,
    open_calls: openCalls,
  };
}
