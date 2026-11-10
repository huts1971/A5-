import { requestJson, toApiError } from './client';
import { readVisitorToken } from './auth';
import { API_BASE_URL, USE_MOCK_API } from './config';
import { mockChatAnswers } from './mock/visitorData';
import { toRoutePlan } from './routes';
import type { ChatRequest, ChatResponse } from '../types/scenic';

const wait = (ms = 520, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError(signal));
      return;
    }

    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort);
      resolve();
    }, ms);
    const handleAbort = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', handleAbort);
      reject(createAbortError(signal));
    };
    signal?.addEventListener('abort', handleAbort, { once: true });
  });

function createAbortError(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

function isAbortError(error: unknown): boolean {
  return (
    (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') ||
    (typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      (error as { name?: unknown }).name === 'AbortError')
  );
}

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
  guide_action?: BackendGuideAction | null;
  emotion_cue?: string;
  metrics?: {
    retrieval_ms: number;
    llm_ms: number;
    tts_ms: number;
    total_ms: number;
    cache_hit: boolean;
    degraded: boolean;
    guide_intent?: string;
    evidence_profile?: string;
    route_triggered?: boolean;
    answer_style?: string;
    llm_model?: string;
    embedding_model?: string;
    first_delta_ms?: number;
    retrieval_cache_hit?: boolean;
    answer_cache_hit?: boolean;
    embedding_cache_hit?: boolean;
    warmup_status?: string;
  };
}

interface BackendGuideAction {
  type: string;
  title?: string;
  route?: unknown;
  preference?: {
    map_id?: 'ling-shan' | 'nianhua-bay';
    duration_minutes?: number;
    physical_level?: 'low' | 'medium' | 'high';
    interest_tags?: string[];
    accessible_required?: boolean;
  } | null;
}

export interface StreamChatOptions {
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
}

function toBackendChatRequest(input: ChatRequest) {
  return {
    question: input.question,
    spot_id: input.spotId,
    session_id: input.sessionId,
    image: input.image
      ? {
          mime_type: input.image.mimeType,
          size_bytes: input.image.sizeBytes,
          data_url: input.image.dataUrl,
        }
      : undefined,
    profile: {
      preference: input.preference,
      route_preference: input.routePreference
        ? {
            map_id: input.routePreference.mapId,
            duration_minutes: input.routePreference.durationMinutes,
            physical_level: input.routePreference.physicalLevel,
            interest_tags: input.routePreference.interestTags,
          }
        : undefined,
      route_context: input.routeContext ? toBackendRouteContext(input.routeContext) : undefined,
      current_spot_name: input.currentSpotName,
    },
  };
}

function toBackendRouteContext(context: NonNullable<ChatRequest['routeContext']>) {
  return {
    map_id: context.mapId,
    scenic_name: context.scenicName,
    route_id: context.routeId,
    draft_id: context.draftId,
    tour_id: context.tourId,
    route_name: context.routeName,
    total_minutes: context.totalMinutes,
    current_index: context.currentIndex,
    current_spot: context.currentSpot ? toBackendRouteContextSpot(context.currentSpot) : undefined,
    next_spot: context.nextSpot ? toBackendRouteContextSpot(context.nextSpot) : undefined,
    ordered_spots: context.orderedSpots.map(toBackendRouteContextSpot),
    location_assist: context.locationAssist
      ? {
          mode: context.locationAssist.mode,
          status: context.locationAssist.status,
          accuracy_meters: context.locationAssist.accuracyMeters,
          display_spot_id: context.locationAssist.displaySpotId,
          updated_at: context.locationAssist.updatedAt,
        }
      : undefined,
    preference: context.preference
      ? {
          map_id: context.preference.mapId,
          duration_minutes: context.preference.durationMinutes,
          physical_level: context.preference.physicalLevel,
          interest_tags: context.preference.interestTags,
        }
      : undefined,
    status: context.status,
  };
}

function toBackendRouteContextSpot(spot: NonNullable<ChatRequest['routeContext']>['orderedSpots'][number]) {
  return {
    spot_id: spot.spotId,
    name: spot.name,
    stay_minutes: spot.stayMinutes,
    transition_minutes: spot.transitionMinutes,
    transition_note: spot.transitionNote,
    sequence: spot.sequence,
    status: spot.status,
    reason: spot.reason,
  };
}

function toChatResponse(response: BackendChatResponse): ChatResponse {
  const guideAction = toGuideAction(response.guide_action);
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
    guideAction,
    emotionCue: response.emotion_cue,
    metrics: response.metrics
      ? {
          retrievalMs: response.metrics.retrieval_ms,
          llmMs: response.metrics.llm_ms,
          ttsMs: response.metrics.tts_ms,
          totalMs: response.metrics.total_ms,
          cacheHit: response.metrics.cache_hit,
          degraded: response.metrics.degraded,
          guideIntent: response.metrics.guide_intent,
          evidenceProfile: response.metrics.evidence_profile,
          routeTriggered: response.metrics.route_triggered,
          answerStyle: response.metrics.answer_style,
          firstDeltaMs: response.metrics.first_delta_ms,
          retrievalCacheHit: response.metrics.retrieval_cache_hit,
          answerCacheHit: response.metrics.answer_cache_hit,
          embeddingCacheHit: response.metrics.embedding_cache_hit,
          warmupStatus: response.metrics.warmup_status,
        }
      : undefined,
  };
}

function toGuideAction(action?: BackendGuideAction | null): ChatResponse['guideAction'] {
  if (!action) return undefined;
  const isRouteAction = action.type === 'route_recommendation';
  return {
    type: action.type,
    title: action.title,
    route: isRouteAction && action.route ? toRoutePlan(action.route as any) : undefined,
    preference: isRouteAction && action.preference
      ? {
          mapId: action.preference.map_id ?? 'ling-shan',
          durationMinutes: action.preference.duration_minutes ?? 120,
          physicalLevel: action.preference.physical_level ?? 'medium',
          interestTags: action.preference.interest_tags ?? [],
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

export async function mockChatApi(input: ChatRequest | string, signal?: AbortSignal): Promise<ChatResponse> {
  const request = normalizeQuestion(input);
  await wait(520, signal);

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
  const token = readVisitorToken();
  const response = await requestJson<BackendChatResponse, unknown>('/api/chat', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
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
      const response = await mockChatApi(input, options.signal);
      for (let index = 0; index < response.answer.length; index += 18) {
        if (options.signal?.aborted) {
          throw createAbortError(options.signal);
        }
        options.onDelta?.(response.answer.slice(index, index + 18));
        await wait(80, options.signal);
      }
      return response;
    }

    return await realStreamChatApi(input, options);
  } catch (error) {
    if (options.signal?.aborted || isAbortError(error)) {
      throw error;
    }
    return createFallbackResponse(error);
  }
}

async function realStreamChatApi(
  input: ChatRequest | string,
  options: StreamChatOptions,
): Promise<ChatResponse> {
  const request = normalizeQuestion(input);
  const token = readVisitorToken();
  const response = await fetch(`${API_BASE_URL}/api/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(toBackendChatRequest(request)),
    signal: options.signal,
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
