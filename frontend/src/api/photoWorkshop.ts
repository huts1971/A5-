import { API_BASE_URL } from './config';
import { readVisitorToken } from './auth';
import { createApiError, isApiError, requestJson, toApiError } from './client';
import type {
  PhotoWorkshopAspectRatio,
  PhotoWorkshopImageResult,
  PhotoWorkshopResolution,
} from '../types/photoWorkshop';

interface BackendGenerateResponse {
  image_base64: string;
  mime_type: string;
  width: number;
  height: number;
}

function visitorHeaders(): Record<string, string> {
  const token = readVisitorToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function polishPhotoWorkshopPrompt(prompt: string): Promise<string> {
  try {
    const response = await requestJson<{ prompt: string }, { prompt: string }>(
      '/api/photo-workshop/polish',
      {
        method: 'POST',
        headers: visitorHeaders(),
        body: { prompt },
      },
    );
    return response.prompt;
  } catch (error) {
    if (isApiError(error) && error.status) throw error;
    throw createApiError('AI 提示词润色暂时不可用，请稍后重试。', {
      code: 'PHOTO_WORKSHOP_POLISH_NETWORK_ERROR',
    });
  }
}

export async function generatePhotoWorkshopImage(payload: {
  image: File;
  prompt: string;
  aspectRatio: PhotoWorkshopAspectRatio;
  resolution: PhotoWorkshopResolution;
}): Promise<PhotoWorkshopImageResult> {
  const formData = new FormData();
  formData.append('image', payload.image);
  formData.append('prompt', payload.prompt);
  formData.append('aspect_ratio', payload.aspectRatio);
  formData.append('resolution', payload.resolution);

  let response: Response;
  try {
    response = await fetch(apiUrl('/api/photo-workshop/generate'), {
      method: 'POST',
      headers: visitorHeaders(),
      body: formData,
    });
  } catch {
    throw createApiError('网络连接异常，图片生成未完成，请稍后重试。', {
      code: 'PHOTO_WORKSHOP_GENERATE_NETWORK_ERROR',
    });
  }
  if (!response.ok) throw await responseError(response);

  const body = (await response.json()) as BackendGenerateResponse;
  return {
    dataUrl: `data:${body.mime_type};base64,${body.image_base64}`,
    mimeType: body.mime_type,
    width: body.width,
    height: body.height,
  };
}

export function downloadPhotoWorkshopImage(result: PhotoWorkshopImageResult) {
  const extension = result.mimeType === 'image/jpeg'
    ? 'jpg'
    : result.mimeType === 'image/webp'
      ? 'webp'
      : 'png';
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  const link = document.createElement('a');
  link.href = result.dataUrl;
  link.download = `灵诗音-相册创意-${stamp}.${extension}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function apiUrl(path: string) {
  return `${API_BASE_URL.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

async function responseError(response: Response) {
  try {
    const body = (await response.json()) as { message?: string; code?: string };
    return toApiError({
      message: body.message ?? `请求失败：${response.status}`,
      status: response.status,
      code: body.code,
    });
  } catch {
    return toApiError(new Error(`请求失败：${response.status}`));
  }
}
