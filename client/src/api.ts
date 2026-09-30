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
    throw new ApiError(response.status, payload.error || 'Request failed', payload.code || 'ERROR', data as Record<string, unknown>);
  }
  return data as T;
}

export async function uploadWorkbook(file: File, datasetId?: string): Promise<{ dataset: { id: string; inserted: number; updated: number; duplicates: number } }> {
  const query = datasetId ? `?datasetId=${encodeURIComponent(datasetId)}` : '';
  const response = await fetch(`/api/datasets/import${query}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) },
    body: file,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const payload = data as { error?: string; code?: string };
    throw new ApiError(response.status, payload.error || 'Import failed', payload.code || 'IMPORT', data as Record<string, unknown>);
  }
  return data as { dataset: { id: string; inserted: number; updated: number; duplicates: number } };
}

export async function downloadExcel(path: string, filename: string): Promise<void> {
  const response = await fetch(path, { credentials: 'include' });
  if (!response.ok) throw new ApiError(response.status, 'Export failed', 'EXPORT', {});
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
