import { API_BASE_URL } from './config';
import type { ApiError } from '../types/api';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RequestOptions<TBody> {
  method?: HttpMethod;
  body?: TBody;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export function createApiError(message: string, overrides: Partial<ApiError> = {}): ApiError {
  return {
    message,
    ...overrides,
  };
}

export function isApiError(error: unknown): error is ApiError {
  return Boolean(error && typeof error === 'object' && 'message' in error);
}

export function toApiError(error: unknown, fallbackMessage = '请求失败，请稍后重试。'): ApiError {
  if (isApiError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return createApiError(error.message || fallbackMessage, {
      code: error.name,
    });
  }

  return createApiError(fallbackMessage, {
    code: 'UNKNOWN_ERROR',
    detail: error,
  });
}

function joinUrl(path: string) {
  if (/^https?:\/\//.test(path)) {
    return path;
  }

  const normalizedBase = API_BASE_URL.replace(/\/$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

async function parseErrorResponse(response: Response): Promise<ApiError> {
  try {
    const payload = (await response.json()) as Partial<ApiError> & {
      error?: string;
      msg?: string;
    };

    return createApiError(payload.message ?? payload.error ?? payload.msg ?? `请求失败：${response.status}`, {
      status: response.status,
      code: payload.code ?? `HTTP_${response.status}`,
      detail: payload.detail ?? payload,
    });
  } catch {
    return createApiError(`请求失败：${response.status}`, {
      status: response.status,
      code: `HTTP_${response.status}`,
    });
  }
}

export async function requestJson<TResponse, TBody = unknown>(
  path: string,
  options: RequestOptions<TBody> = {},
): Promise<TResponse> {
  const { method = 'GET', body, headers = {}, signal } = options;

  try {
    const response = await fetch(joinUrl(path), {
      method,
      signal,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      throw await parseErrorResponse(response);
    }

    if (response.status === 204) {
      return undefined as TResponse;
    }

    return (await response.json()) as TResponse;
  } catch (error) {
    throw toApiError(error);
  }
}
