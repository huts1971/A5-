import { requestAdminJson } from './adminClient';
import { readVisitorToken } from './auth';
import { requestJson } from './client';
import type {
  CommunityPost,
  CommunityPostList,
  CommunityPostType,
  CommunityPostScope,
  CommunityPostSort,
  CommunityPostStatus,
} from '../types/community';

interface BackendCommunityPost {
  id: number;
  author_id: string;
  author_name: string;
  content: string;
  post_type: CommunityPostType;
  travel_journal: {
    id: string;
    title: string;
    opening: string;
    text_sections: Array<{ id: string; title: string; body: string }>;
    conclusion: string;
    images: Array<{
      id: string;
      display_url: string;
      title: string;
      body: string;
      sort_order: number;
    }>;
  } | null;
  spot: {
    id: string;
    name: string;
  } | null;
  status: CommunityPostStatus;
  like_count: number;
  liked_by_me: boolean;
  is_mine: boolean;
  created_at: string;
  updated_at: string;
}

interface BackendCommunityPostList {
  items: BackendCommunityPost[];
  total: number;
  page: number;
  page_size: number;
}

interface CommunityPostCreatePayload {
  content: string;
  spot_id: string | null;
}

interface CommunityLikeResponse {
  post_id: number;
  liked: boolean;
  like_count: number;
}

interface CommunityModerateResponse {
  id: number;
  status: CommunityPostStatus;
}

function visitorHeaders(): Record<string, string> {
  const token = readVisitorToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function normalizePost(item: BackendCommunityPost): CommunityPost {
  return {
    id: item.id,
    authorId: item.author_id,
    authorName: item.author_name,
    content: item.content,
    postType: item.post_type ?? 'comment',
    travelJournal: item.travel_journal
      ? {
          id: item.travel_journal.id,
          title: item.travel_journal.title,
          opening: item.travel_journal.opening,
          textSections: item.travel_journal.text_sections,
          conclusion: item.travel_journal.conclusion,
          images: item.travel_journal.images.map((image) => ({
            id: image.id,
            displayUrl: image.display_url,
            title: image.title,
            body: image.body,
            sortOrder: image.sort_order,
          })),
        }
      : null,
    spot: item.spot,
    status: item.status,
    likeCount: item.like_count,
    likedByMe: item.liked_by_me,
    isMine: item.is_mine,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

function normalizeList(response: BackendCommunityPostList): CommunityPostList {
  return {
    items: response.items.map(normalizePost),
    total: response.total,
    page: response.page,
    pageSize: response.page_size,
  };
}

export async function getCommunityPosts(options: {
  scope: CommunityPostScope;
  sort: CommunityPostSort;
  page: number;
  pageSize?: number;
}): Promise<CommunityPostList> {
  const params = new URLSearchParams({
    scope: options.scope,
    sort: options.sort,
    page: String(options.page),
    page_size: String(options.pageSize ?? 10),
  });
  const response = await requestJson<BackendCommunityPostList>(
    `/api/community/posts?${params.toString()}`,
    { headers: visitorHeaders() },
  );
  return normalizeList(response);
}

export async function createCommunityPost(payload: {
  content: string;
  spotId?: string;
}): Promise<CommunityPost> {
  const response = await requestJson<BackendCommunityPost, CommunityPostCreatePayload>(
    '/api/community/posts',
    {
      method: 'POST',
      headers: visitorHeaders(),
      body: {
        content: payload.content,
        spot_id: payload.spotId ?? null,
      },
    },
  );
  return normalizePost(response);
}

export async function deleteCommunityPost(postId: number): Promise<void> {
  await requestJson(`/api/community/posts/${postId}`, {
    method: 'DELETE',
    headers: visitorHeaders(),
  });
}

export async function setCommunityPostLiked(
  postId: number,
  liked: boolean,
): Promise<CommunityLikeResponse> {
  return requestJson<CommunityLikeResponse>(
    `/api/community/posts/${postId}/like`,
    {
      method: liked ? 'POST' : 'DELETE',
      headers: visitorHeaders(),
    },
  );
}

export async function getAdminCommunityPosts(options: {
  status: 'all' | CommunityPostStatus;
  page: number;
  pageSize?: number;
}): Promise<CommunityPostList> {
  const params = new URLSearchParams({
    status: options.status,
    page: String(options.page),
    page_size: String(options.pageSize ?? 20),
  });
  const response = await requestAdminJson<BackendCommunityPostList>(
    `/api/community/admin/posts?${params.toString()}`,
  );
  return normalizeList(response);
}

export async function moderateCommunityPost(
  postId: number,
  status: Extract<CommunityPostStatus, 'published' | 'hidden'>,
): Promise<CommunityModerateResponse> {
  return requestAdminJson<
    CommunityModerateResponse,
    { status: Extract<CommunityPostStatus, 'published' | 'hidden'> }
  >(`/api/community/admin/posts/${postId}`, {
    method: 'PATCH',
    body: { status },
  });
}
