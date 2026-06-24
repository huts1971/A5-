import { requestJson, toApiError } from './client';
import { API_BASE_URL, USE_MOCK_API } from './config';
import { mockChatAnswers } from './mock/visitorData';
import type { ChatRequest, ChatResponse } from '../types/scenic';

const wait = (ms = 520) => new Promise((resolve) => window.setTimeout(resolve, ms));

function createFallbackResponse(error: unknown): ChatResponse {
  const apiError = toApiError(error, 'AI 服务暂时不可用，已切换为本地兜底回答。');

  return {
    answer:
      '刚才的 AI 服务暂时没有成功返回。我会先给出稳妥建议：可以从路线推荐页选择亲子游、历史文化游或摄影游，再进入对应景点查看讲解；如果涉及票价、开放时间或安全信息，请以景区现场公告为准。',
    sources: [
      {
        id: 'src-chat-fallback',
        title: '基础游览建议',
        spotName: 'AI 导游',
        snippet: 'AI 服务暂时不可用时，页面会保留基础游览建议，方便游客继续查看景点和路线信息。',
      },
    ],
    isFallback: true,
    error: apiError,
  };
}

function normalizeQuestion(input: ChatRequest | string): ChatRequest {
  return typeof input === 'string' ? { question: input } : input;
}

interface BackendChatSource {
  title: string;
  spot_name?: string | null;
  section?: string;
  snippet: string;
  source_type?: string;
  source_url?: string;
  source_level?: string;
}

interface BackendChatResponse {
  answer: string;
  sources: BackendChatSource[];
  session_id: string;
  audio_url?: string | null;
  tts_job_id?: string | null;
  tts_status: string;
  mode: string;
  degraded: boolean;
  metrics?: {
    retrieval_ms: number;
    llm_ms: number;
    tts_ms: number;
    total_ms: number;
    cache_hit: boolean;
    degraded: boolean;
  };
}

interface StreamChatOptions {
  onDelta?: (text: string) => void;
}

function toBackendChatRequest(input: ChatRequest) {
  return {
    question: input.question,
    spot_id: input.spotId,
    session_id: input.sessionId,
    profile: {
      preference: input.preference,
      current_spot_name: input.currentSpotName,
    },
  };
}

function toChatResponse(response: BackendChatResponse): ChatResponse {
  return {
    answer: response.answer,
    sources: response.sources.map((source, index) => ({
      id: `${response.session_id}-src-${index}`,
      title: source.title,
      spotName: source.spot_name ?? '灵山胜境资料',
      snippet: source.snippet,
      section: source.section,
      sourceType: source.source_type,
      sourceUrl: source.source_url,
      sourceLevel: source.source_level,
    })),
    audioUrl: response.audio_url ? `${API_BASE_URL}${response.audio_url}` : undefined,
    ttsJobId: response.tts_job_id ?? undefined,
    ttsStatus: response.tts_status as ChatResponse['ttsStatus'],
    sessionId: response.session_id,
    isFallback: response.degraded || response.mode === 'fallback',
    metrics: response.metrics
      ? {
          retrievalMs: response.metrics.retrieval_ms,
          llmMs: response.metrics.llm_ms,
          ttsMs: response.metrics.tts_ms,
          totalMs: response.metrics.total_ms,
          cacheHit: response.metrics.cache_hit,
          degraded: response.metrics.degraded,
        }
      : undefined,
  };
}

function matchMockAnswer(question: string): ChatResponse {
  if (question.includes('路线') || question.includes('小时') || question.includes('怎么逛')) {
    return mockChatAnswers.route;
  }

  if (question.includes('远香堂') || question.includes('历史故事')) {
    return mockChatAnswers.yuanxiang;
  }

  if (question.includes('小朋友') || question.includes('亲子') || question.includes('孩子')) {
    return mockChatAnswers.family;
  }

  if (question.includes('拍照') || question.includes('摄影')) {
    return mockChatAnswers.photo;
  }

  return mockChatAnswers.fallback;
}

export async function mockChatApi(input: ChatRequest | string): Promise<ChatResponse> {
  const request = normalizeQuestion(input);
  await wait();

  if (request.question.includes('模拟失败')) {
    throw new Error('mock_chat_api_failed');
  }

  return {
    ...matchMockAnswer(request.question),
    sessionId: request.sessionId ?? 'local-session',
  };
}

export async function realChatApi(input: ChatRequest | string): Promise<ChatResponse> {
  const request = normalizeQuestion(input);
  const response = await requestJson<BackendChatResponse, unknown>('/api/chat', {
    method: 'POST',
    body: toBackendChatRequest(request),
  });
  return toChatResponse(response);
}

export async function streamChatWithGuide(
  input: ChatRequest | string,
  options: StreamChatOptions = {},
): Promise<ChatResponse> {
  try {
    if (USE_MOCK_API) {
      const response = await mockChatApi(input);
      for (let index = 0; index < response.answer.length; index += 18) {
        options.onDelta?.(response.answer.slice(index, index + 18));
        await wait(80);
      }
      return response;
    }

    return await realStreamChatApi(input, options);
  } catch (error) {
    return createFallbackResponse(error);
  }
}

async function realStreamChatApi(
  input: ChatRequest | string,
  options: StreamChatOptions,
): Promise<ChatResponse> {
  const request = normalizeQuestion(input);
  const response = await fetch(`${API_BASE_URL}/api/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(toBackendChatRequest(request)),
  });

  if (!response.ok || !response.body) {
    throw new Error(`stream_chat_failed_${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResponse: ChatResponse | undefined;

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      const event = parseSseEvent(part);
      if (!event) {
        continue;
      }
      if (event.name === 'delta') {
        options.onDelta?.((event.data as { text: string }).text);
      }
      if (event.name === 'final') {
        finalResponse = toChatResponse(event.data as BackendChatResponse);
      }
    }

    if (done) {
      break;
    }
  }

  if (!finalResponse) {
    throw new Error('stream_chat_missing_final');
  }
  return finalResponse;
}

function parseSseEvent(raw: string): { name: string; data: unknown } | null {
  const nameLine = raw.split('\n').find((line) => line.startsWith('event: '));
  const dataLine = raw.split('\n').find((line) => line.startsWith('data: '));
  if (!nameLine || !dataLine) {
    return null;
  }
  return {
    name: nameLine.slice('event: '.length),
    data: JSON.parse(dataLine.slice('data: '.length)),
  };
}

export async function chatWithGuide(input: ChatRequest | string): Promise<ChatResponse> {
  try {
    return USE_MOCK_API ? await mockChatApi(input) : await realChatApi(input);
  } catch (error) {
    return createFallbackResponse(error);
  }
}
