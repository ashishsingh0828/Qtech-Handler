export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || 'Request failed');
    this.status = status;
    this.body = body || {};
    this.code = body?.code || 'ERROR';
  }
}

function isJsonBody(body) {
  if (body == null || typeof body !== 'object') return false;
  return !(body instanceof Blob) && !(body instanceof FormData) && !(body instanceof ArrayBuffer);
}

export async function api(path, options = {}) {
  const { body, headers, ...rest } = options;
  const json = isJsonBody(body);
  const response = await fetch(path, {
    credentials: 'include',
    ...rest,
    headers: {
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: json ? JSON.stringify(body) : body,
  });
  if (response.status === 204) return null;
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  if (!response.ok) throw new ApiError(response.status, data);
  return data;
}

export function importWorkbook(file, name) {
  const params = new URLSearchParams();
  if (name) params.set('name', name);
  const query = params.toString();
  return api(`/api/datasets/import${query ? `?${query}` : ''}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'X-Filename': encodeURIComponent(file.name),
    },
    body: file,
  });
}

export async function downloadExcel(id, name) {
  const response = await fetch(`/api/datasets/${id}/export-excel`, { credentials: 'include' });
  if (!response.ok) {
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    throw new ApiError(response.status, data);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name || 'dataset'}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
