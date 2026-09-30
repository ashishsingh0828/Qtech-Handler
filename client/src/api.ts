function readableError(message: string, fallback: string): string {
  const line = message.split('\n').map((part) => part.trim()).find(Boolean) || fallback;
  if (line.startsWith('Invalid `') || line.includes('invocation') || line.length > 180) return fallback;
  return line;
}

export class ApiError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown>;

  constructor(status: number, message: string, code: string, details: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(path, {
    method: init.method || 'GET',
    credentials: 'include',
    headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const payload = data as { error?: string; code?: string };
    throw new ApiError(response.status, readableError(payload.error || '', 'Request failed'), payload.code || 'ERROR', data as Record<string, unknown>);
  }
  return data as T;
}

export interface ImportResult {
  dataset: {
    id: string;
    inserted: number;
    updated: number;
    duplicates: number;
    rowCount: number;
    columnCount: number;
    groups: number;
  };
}

export async function uploadWorkbook(file: File, datasetId?: string): Promise<ImportResult> {
  const query = datasetId ? `?datasetId=${encodeURIComponent(datasetId)}` : '';
  let response: Response;
  try {
    response = await fetch(`/api/datasets/import${query}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) },
      body: file,
    });
  } catch {
    throw new ApiError(0, 'Import could not reach the API on port 5000. Start the server and try again.', 'NETWORK', {});
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const payload = data as { error?: string; code?: string };
    const fallback = response.status === 413 ? 'This file is larger than 25 MB.' : 'Import failed';
    throw new ApiError(response.status, readableError(payload.error || '', fallback), payload.code || 'IMPORT', data as Record<string, unknown>);
  }
  return data as ImportResult;
}

export async function downloadExcel(path: string, filename: string): Promise<void> {
  const response = await fetch(path, { credentials: 'include' });
  if (!response.ok) throw new ApiError(response.status, 'Export failed', 'EXPORT', {});
  const blob = await response.blob();
  const header = response.headers.get('Content-Disposition') || '';
  const named = header.match(/filename="([^"]+)"/);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = named?.[1] || filename;
  link.click();
  URL.revokeObjectURL(url);
}
