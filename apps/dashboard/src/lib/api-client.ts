import { useAuthStore } from '../stores/auth-store';
import { useProjectStore } from '../stores/project-store';

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
  const token = useAuthStore.getState().accessToken;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    useAuthStore.getState().logout();
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

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

export function projectAdminPath(path: string): string {
  const ref = useProjectStore.getState().currentProject?.ref;
  if (!ref) throw new Error('No project selected');
  return `/platform/projects/${ref}/admin${path}`;
}

export function projectRestPath(path: string): string {
  const ref = useProjectStore.getState().currentProject?.ref;
  if (!ref) throw new Error('No project selected');
  return `/project/${ref}/rest/v1${path}`;
}
