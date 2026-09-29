export async function logAudit(client, entry) {
  await client.query(
    `INSERT INTO audit_log (dataset_id, row_id, actor_id, actor_name, action, summary, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      entry.datasetId || null,
      entry.rowId || null,
      entry.actorId || null,
      entry.actorName || null,
      entry.action,
      entry.summary,
      JSON.stringify(entry.detail || {}),
    ],
  );
}

export async function loadDataset(client, id) {
  const result = await client.query(
    `SELECT d.*, u.name AS uploader_name
     FROM datasets d
     LEFT JOIN users u ON u.id = d.uploaded_by
     WHERE d.id = $1`,
    [id],
  );
  return result.rows[0] || null;
}

export async function touchDataset(client, id, rowCount) {
  if (rowCount == null) {
    await client.query('UPDATE datasets SET updated_at = NOW() WHERE id = $1', [id]);
    return;
  }
  await client.query(
    'UPDATE datasets SET updated_at = NOW(), row_count = $2 WHERE id = $1',
    [id, rowCount],
  );
}
