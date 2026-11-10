import type { UserFeedbackCreate, UserFeedbackItem } from '../types/api';
import { requestAdminJson } from './adminClient';
import { requestJson } from './client';

interface BackendUserFeedbackItem {
  id: number;
  rating: number;
  content: string;
  created_at: string;
}

interface FeedbackListResponse {
  items: BackendUserFeedbackItem[];
  total: number;
}

interface FeedbackCreatePayload {
  rating: number;
  content: string;
  page_path: string;
}

export async function submitUserFeedback(payload: UserFeedbackCreate): Promise<UserFeedbackItem> {
  const response = await requestJson<BackendUserFeedbackItem, FeedbackCreatePayload>('/api/feedback', {
    method: 'POST',
    body: {
      rating: payload.rating,
      content: payload.content,
      page_path: payload.pagePath ?? '',
    },
  });
  return normalizeFeedback(response);
}

export async function getUserFeedback(): Promise<UserFeedbackItem[]> {
  const response = await requestAdminJson<FeedbackListResponse>('/api/feedback');
  return response.items.map(normalizeFeedback);
}

function normalizeFeedback(item: BackendUserFeedbackItem): UserFeedbackItem {
  return {
    id: String(item.id),
    rating: item.rating,
    content: item.content,
    createdAt: item.created_at,
  };
}
