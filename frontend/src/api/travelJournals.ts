import { readVisitorToken } from './auth';
import { requestJson, toApiError } from './client';
import { API_BASE_URL } from './config';
import type {
  TravelJournal,
  TravelJournalImage,
  TravelJournalList,
  TravelJournalTextSection,
  TravelJournalUploadResult,
} from '../types/travelJournal';

interface BackendTravelJournal {
  id: string;
  status: 'draft' | 'published';
  description: string;
  target_words: number;
  title: string;
  opening: string;
  text_sections: Array<{ id: string; title: string; body: string }>;
  conclusion: string;
  images: Array<{
    id: string;
    display_url: string;
    sort_order: number;
    title: string;
    body: string;
  }>;
  created_at: string;
  updated_at: string;
}

interface BackendTravelJournalList {
  items: BackendTravelJournal[];
  total: number;
  page: number;
  page_size: number;
}

interface BackendUploadResult {
  journal: BackendTravelJournal;
  errors: TravelJournalUploadResult['errors'];
}

function visitorHeaders(): Record<string, string> {
  const token = readVisitorToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function normalizeJournal(item: BackendTravelJournal): TravelJournal {
  return {
    id: item.id,
    status: item.status,
    description: item.description,
    targetWords: item.target_words,
    title: item.title,
    opening: item.opening,
    textSections: item.text_sections,
    conclusion: item.conclusion,
    images: item.images.map((image) => ({
      id: image.id,
      displayUrl: image.display_url,
      sortOrder: image.sort_order,
      title: image.title,
      body: image.body,
    })),
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

export async function createTravelJournal(payload: {
  description: string;
  targetWords: number;
}): Promise<TravelJournal> {
  const response = await requestJson<BackendTravelJournal>(
    '/api/travel-journals',
    {
      method: 'POST',
      headers: visitorHeaders(),
      body: {
        description: payload.description,
        target_words: payload.targetWords,
      },
    },
  );
  return normalizeJournal(response);
}

export async function listTravelJournals(page = 1, pageSize = 12): Promise<TravelJournalList> {
  const response = await requestJson<BackendTravelJournalList>(
    `/api/travel-journals?page=${page}&page_size=${pageSize}`,
    { headers: visitorHeaders() },
  );
  return {
    items: response.items.map(normalizeJournal),
    total: response.total,
    page: response.page,
    pageSize: response.page_size,
  };
}

export async function getTravelJournal(journalId: string): Promise<TravelJournal> {
  const response = await requestJson<BackendTravelJournal>(
    `/api/travel-journals/${journalId}`,
    { headers: visitorHeaders() },
  );
  return normalizeJournal(response);
}

export async function updateTravelJournal(
  journalId: string,
  payload: Partial<{
    description: string;
    targetWords: number;
    title: string;
    opening: string;
    textSections: TravelJournalTextSection[];
    images: Array<Pick<TravelJournalImage, 'id' | 'title' | 'body'>>;
    conclusion: string;
  }>,
): Promise<TravelJournal> {
  const response = await requestJson<BackendTravelJournal>(
    `/api/travel-journals/${journalId}`,
    {
      method: 'PATCH',
      headers: visitorHeaders(),
      body: {
        ...(payload.description === undefined ? {} : { description: payload.description }),
        ...(payload.targetWords === undefined ? {} : { target_words: payload.targetWords }),
        ...(payload.title === undefined ? {} : { title: payload.title }),
        ...(payload.opening === undefined ? {} : { opening: payload.opening }),
        ...(payload.textSections === undefined
          ? {}
          : { text_sections: payload.textSections }),
        ...(payload.images === undefined ? {} : { images: payload.images }),
        ...(payload.conclusion === undefined ? {} : { conclusion: payload.conclusion }),
      },
    },
  );
  return normalizeJournal(response);
}

export async function uploadTravelJournalImages(
  journalId: string,
  files: File[],
): Promise<TravelJournalUploadResult> {
  const formData = new FormData();
  files.forEach((file) => formData.append('files', file));
  const response = await fetch(apiUrl(`/api/travel-journals/${journalId}/images`), {
    method: 'POST',
    headers: visitorHeaders(),
    body: formData,
  });
  if (!response.ok) throw await responseError(response);
  const body = (await response.json()) as BackendUploadResult;
  return { journal: normalizeJournal(body.journal), errors: body.errors };
}

export async function updateTravelJournalImage(
  journalId: string,
  imageId: string,
  payload: Pick<TravelJournalImage, 'title' | 'body'>,
): Promise<TravelJournal> {
  const response = await requestJson<BackendTravelJournal>(
    `/api/travel-journals/${journalId}/images/${imageId}`,
    {
      method: 'PATCH',
      headers: visitorHeaders(),
      body: payload,
    },
  );
  return normalizeJournal(response);
}

export async function reorderTravelJournalImages(
  journalId: string,
  imageIds: string[],
): Promise<TravelJournal> {
  const response = await requestJson<BackendTravelJournal>(
    `/api/travel-journals/${journalId}/images/order`,
    {
      method: 'PUT',
      headers: visitorHeaders(),
      body: { image_ids: imageIds },
    },
  );
  return normalizeJournal(response);
}

export async function deleteTravelJournalImage(
  journalId: string,
  imageId: string,
): Promise<TravelJournal> {
  const response = await requestJson<BackendTravelJournal>(
    `/api/travel-journals/${journalId}/images/${imageId}`,
    {
      method: 'DELETE',
      headers: visitorHeaders(),
    },
  );
  return normalizeJournal(response);
}

export async function generateTravelJournal(
  journalId: string,
  payload: { description: string; targetWords: number },
): Promise<TravelJournal> {
  const response = await requestJson<BackendTravelJournal>(
    `/api/travel-journals/${journalId}/generate`,
    {
      method: 'POST',
      headers: visitorHeaders(),
      body: {
        description: payload.description,
        target_words: payload.targetWords,
      },
    },
  );
  return normalizeJournal(response);
}

export async function copyTravelJournal(
  journalId: string,
  idempotencyKey: string,
): Promise<TravelJournal> {
  const response = await requestJson<BackendTravelJournal>(
    `/api/travel-journals/${journalId}/copy`,
    {
      method: 'POST',
      headers: {
        ...visitorHeaders(),
        'Idempotency-Key': idempotencyKey,
      },
    },
  );
  return normalizeJournal(response);
}

export async function publishTravelJournal(
  journalId: string,
): Promise<{ journal: TravelJournal; postId: number }> {
  const response = await requestJson<{
    journal: BackendTravelJournal;
    post_id: number;
  }>(`/api/travel-journals/${journalId}/publish`, {
    method: 'POST',
    headers: visitorHeaders(),
  });
  return { journal: normalizeJournal(response.journal), postId: response.post_id };
}

export async function deleteTravelJournal(journalId: string): Promise<void> {
  await requestJson(`/api/travel-journals/${journalId}`, {
    method: 'DELETE',
    headers: visitorHeaders(),
  });
}

export async function loadTravelJournalImage(displayUrl: string): Promise<string> {
  const response = await fetch(apiUrl(displayUrl), { headers: visitorHeaders() });
  if (!response.ok) throw await responseError(response);
  return URL.createObjectURL(await response.blob());
}

export async function downloadTravelJournalPdf(
  journalId: string,
  fallbackTitle: string,
): Promise<void> {
  const response = await fetch(apiUrl(`/api/travel-journals/${journalId}/export.pdf`), {
    headers: visitorHeaders(),
  });
  if (!response.ok) throw await responseError(response);
  const blobUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = pdfFilename(response.headers.get('content-disposition'), fallbackTitle);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(blobUrl);
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

function pdfFilename(contentDisposition: string | null, fallbackTitle: string) {
  const encoded = contentDisposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // Fall through to a local safe name.
    }
  }
  const safe = fallbackTitle.replace(/[\\/:*?"<>|\r\n]/g, '').trim() || '旅行手账';
  return `${safe}.pdf`;
}
