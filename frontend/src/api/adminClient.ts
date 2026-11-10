import { clearAdminToken, readAdminToken } from './auth';
import { API_BASE_URL } from './config';
import { createApiError, requestJson, toApiError } from './client';

interface AdminRequestOptions<TBody> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: TBody;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

function redirectToAdminLogin() {
  if (typeof window === 'undefined') {
    return;
  }
  const loginPath = window.location.pathname.startsWith('/admin') ? '/admin/login' : '/login';
  window.location.assign(loginPath);
}

export async function requestAdminJson<TResponse, TBody = unknown>(
  path: string,
  options: AdminRequestOptions<TBody> = {},
): Promise<TResponse> {
  const token = readAdminToken();

  try {
    return await requestJson<TResponse, TBody>(path, {
      ...options,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    const apiError = toApiError(error);
    if (apiError.status === 401 || apiError.status === 403) {
      clearAdminToken();
      redirectToAdminLogin();
    }
    throw apiError;
  }
}

export async function requestAdminFormData<TResponse>(
  path: string,
  body: FormData,
): Promise<TResponse> {
  const token = readAdminToken();
  const normalizedBase = API_BASE_URL.replace(/\/$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  try {
    const response = await fetch(`${normalizedBase}${normalizedPath}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw createApiError(payload.message ?? `请求失败：${response.status}`, {
        status: response.status,
        code: payload.code,
        detail: payload,
      });
    }
    return (await response.json()) as TResponse;
  } catch (error) {
    const apiError = toApiError(error);
    if (apiError.status === 401 || apiError.status === 403) {
      clearAdminToken();
      redirectToAdminLogin();
    }
    throw apiError;
  }
}
