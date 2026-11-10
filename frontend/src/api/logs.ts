import { requestAdminJson } from './adminClient';
import { USE_MOCK_API } from './config';
import type { ChatLogDeleteResult, ChatLogItem, ChatLogQuery } from '../types/api';

interface BackendChatLogSource {
  title?: string;
  spot_name?: string;
  spotName?: string;
  section?: string;
  snippet?: string;
  source_type?: string;
  sourceType?: string;
  source_url?: string;
  sourceUrl?: string;
  source_level?: string;
  sourceLevel?: string;
}

const wait = (ms = 220) => new Promise((resolve) => window.setTimeout(resolve, ms));

let mockChatLogs: ChatLogItem[] = [
  {
    id: 'log-001',
    sessionId: 'mock-session-p0',
    question: '远香堂有什么历史故事？',
    answer: '远香堂适合从荷文化和园林空间两个角度理解。',
    sources: [{ title: '远香堂景点资料', spotName: '远香堂' }],
    visitorType: '历史文化游',
    metrics: {
      retrievalMs: 12,
      llmMs: 120,
      ttsMs: 0,
      totalMs: 140,
      cacheHit: false,
      degraded: false,
    },
    createdAt: '2026-05-30 10:12:00',
  },
  {
    id: 'log-002',
    sessionId: 'mock-session-p0',
    question: '带小朋友来适合先看哪里？',
    answer: '建议先去荷风四面亭，再到远香堂，中途到游客服务中心休息。',
    sources: [{ title: '亲子轻松讲解线', spotName: '路线推荐资料' }],
    visitorType: '亲子游',
    metrics: {
      retrievalMs: 10,
      llmMs: 110,
      ttsMs: 0,
      totalMs: 130,
      cacheHit: false,
      degraded: false,
    },
    createdAt: '2026-05-30 10:18:00',
  },
];

export async function getChatLogs(query: ChatLogQuery = {}): Promise<ChatLogItem[]> {
  if (!USE_MOCK_API) {
    const params = new URLSearchParams();
    if (query.keyword) {
      params.set('keyword', query.keyword);
    }
    if (query.limit) {
      params.set('limit', String(query.limit));
    }

    const queryString = params.toString();
    const response = await requestAdminJson<{
      items: Array<{
        id: number;
        session_id: string;
        question: string;
        answer: string;
        sources?: BackendChatLogSource[];
        source_count: number;
        visitor_type?: string;
        preference?: string;
        metrics?: {
          retrieval_ms: number;
          llm_ms: number;
          tts_ms: number;
          total_ms: number;
          cache_hit: boolean;
          degraded: boolean;
        };
        created_at: string;
      }>;
      total: number;
    }>(`/api/logs/chats${queryString ? `?${queryString}` : ''}`);
    return response.items.map((item) => ({
      id: String(item.id),
      sessionId: item.session_id,
      question: item.question,
      answer: item.answer,
      sources: mapChatLogSources(item.sources, item.source_count),
      visitorType: item.visitor_type,
      preference: item.preference,
      metrics: item.metrics
        ? {
            retrievalMs: item.metrics.retrieval_ms,
            llmMs: item.metrics.llm_ms,
            ttsMs: item.metrics.tts_ms,
            totalMs: item.metrics.total_ms,
            cacheHit: item.metrics.cache_hit,
            degraded: item.metrics.degraded,
          }
        : undefined,
      createdAt: item.created_at,
    }));
  }

  await wait();

  const keyword = query.keyword?.trim();
  const filtered = keyword
    ? mockChatLogs.filter((log) => `${log.question}${log.answer}`.includes(keyword))
    : mockChatLogs;

  return filtered.slice(0, query.limit ?? filtered.length);
}

function mapChatLogSources(sources: BackendChatLogSource[] | undefined, sourceCount: number) {
  if (sources?.length) {
    return sources.map((source, index) => ({
      id: `${source.title ?? 'source'}-${index}`,
      title: source.title ?? `资料来源 ${index + 1}`,
      spotName: source.spot_name ?? source.spotName ?? '通用资料',
      section: source.section,
      snippet: source.snippet,
      sourceType: source.source_type ?? source.sourceType,
      sourceUrl: source.source_url ?? source.sourceUrl,
      sourceLevel: source.source_level ?? source.sourceLevel,
    }));
  }

  if (sourceCount > 0) {
    return [{ title: `资料来源 ${sourceCount}`, spotName: '灵山胜境资料' }];
  }

  return [];
}

function mapDeleteResult(payload: { status: 'deleted'; deleted_count: number }): ChatLogDeleteResult {
  return {
    status: payload.status,
    deletedCount: payload.deleted_count,
  };
}

export async function deleteChatLog(id: string): Promise<ChatLogDeleteResult> {
  if (!USE_MOCK_API) {
    const response = await requestAdminJson<{ status: 'deleted'; deleted_count: number }>(
      `/api/logs/chats/${id}`,
      { method: 'DELETE' },
    );
    return mapDeleteResult(response);
  }

  await wait();
  const before = mockChatLogs.length;
  mockChatLogs = mockChatLogs.filter((log) => log.id !== id);
  return {
    status: 'deleted',
    deletedCount: before - mockChatLogs.length,
  };
}

export async function deleteChatLogs(ids: string[]): Promise<ChatLogDeleteResult> {
  if (!USE_MOCK_API) {
    const response = await requestAdminJson<{ status: 'deleted'; deleted_count: number }>(
      '/api/logs/chats/delete',
      {
        method: 'POST',
        body: { ids: ids.map((id) => Number(id)) },
      },
    );
    return mapDeleteResult(response);
  }

  await wait();
  const selectedIds = new Set(ids);
  const before = mockChatLogs.length;
  mockChatLogs = mockChatLogs.filter((log) => !selectedIds.has(log.id));
  return {
    status: 'deleted',
    deletedCount: before - mockChatLogs.length,
  };
}

export async function clearChatLogs(): Promise<ChatLogDeleteResult> {
  if (!USE_MOCK_API) {
    const response = await requestAdminJson<{ status: 'deleted'; deleted_count: number }>(
      '/api/logs/chats/delete',
      {
        method: 'POST',
        body: { delete_all: true },
      },
    );
    return mapDeleteResult(response);
  }

  await wait();
  const deletedCount = mockChatLogs.length;
  mockChatLogs = [];
  return {
    status: 'deleted',
    deletedCount,
  };
}
