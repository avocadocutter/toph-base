const BASE_URL = '';

export class ApiError extends Error {
  readonly details?: unknown;
  constructor(message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.details = details;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.body != null ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string>),
  };

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: { message: 'Request failed' } }));
    throw new ApiError(body.error?.message || `HTTP ${response.status}`, body.error?.details);
  }

  if (response.status === 204) return undefined as T;
  return response.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// Studio admin paths
export function adminPath(path: string): string {
  return `/admin${path}`;
}

// REST API paths (Supabase dialect)
export function restPath(path: string): string {
  return `/rest/v1${path}`;
}

// Legacy helpers — kept for pages not yet migrated
export function projectAdminPath(path: string): string {
  return `/admin${path}`;
}

export function projectRestPath(path: string): string {
  return `/rest/v1${path}`;
}
