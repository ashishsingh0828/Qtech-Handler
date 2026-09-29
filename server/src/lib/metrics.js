export function datasetCountSql(todayParam) {
  return `
    COUNT(*)::int AS all_rows,
    COUNT(*) FILTER (WHERE COALESCE(data->>'validated', '') <> 'Yes')::int AS needs_validation,
    COUNT(*) FILTER (
      WHERE COALESCE(data->>'validated', '') <> 'Yes'
        AND COALESCE(data->>'validation_due', '') <> ''
        AND data->>'validation_due' < ${todayParam}
    )::int AS validation_overdue,
    COUNT(*) FILTER (
      WHERE data->>'validated' = 'Yes'
        AND COALESCE(data->>'verified', '') <> 'Verified OK'
    )::int AS pending_verification,
    COUNT(*) FILTER (
      WHERE COALESCE(data->>'end_date', '') <> ''
        AND data->>'end_date' < ${todayParam}
    )::int AS amc_due,
    COUNT(*) FILTER (
      WHERE COALESCE(data->>'end_date', '') <> ''
        AND data->>'end_date' >= ${todayParam}
    )::int AS active_amc
  `;
}

export function mapCounts(row) {
  return {
    all: row?.all_rows || 0,
    needs_validation: row?.needs_validation || 0,
    validation_overdue: row?.validation_overdue || 0,
    pending_verification: row?.pending_verification || 0,
    amc_due: row?.amc_due || 0,
    active_amc: row?.active_amc || 0,
  };
}

export async function fetchDatasetCounts(client, datasetId, today) {
  const result = await client.query(
    `SELECT ${datasetCountSql('$2')} FROM dataset_rows WHERE dataset_id = $1`,
    [datasetId, today],
  );
  return mapCounts(result.rows[0]);
}

export function tabClause(tab, todayParam) {
  switch (tab) {
    case 'needs_validation':
      return `COALESCE(data->>'validated', '') <> 'Yes'`;
    case 'validation_overdue':
      return `COALESCE(data->>'validated', '') <> 'Yes'
        AND COALESCE(data->>'validation_due', '') <> ''
        AND data->>'validation_due' < ${todayParam}`;
    case 'pending_verification':
      return `data->>'validated' = 'Yes' AND COALESCE(data->>'verified', '') <> 'Verified OK'`;
    case 'amc_due':
      return `COALESCE(data->>'end_date', '') <> '' AND data->>'end_date' < ${todayParam}`;
    case 'active_amc':
      return `COALESCE(data->>'end_date', '') <> '' AND data->>'end_date' >= ${todayParam}`;
    default:
      return '';
  }
}
