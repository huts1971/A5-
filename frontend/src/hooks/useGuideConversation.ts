import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { streamChatWithGuide } from '../api/chat';
import { toApiError } from '../api/client';
import { getTtsJobStatus } from '../api/tts';
import type {
  ChatResponse,
  ChatSource,
  GuideImageAttachment,
  GuideRouteContext,
  GuideStatus,
} from '../types/scenic';
import useGuideAudioPlayback from './useGuideAudioPlayback';
import type { AvatarAudioState } from '../components/guide/AvatarGuide';

const TTS_POLL_INTERVAL_MS = 1_200;
const TTS_POLL_ATTEMPTS = 20;

export interface GuideConversationLatest {
  content: string;
  sources: ChatSource[];
  audioUrl?: string;
  ttsStatus?: ChatResponse['ttsStatus'];
  isFallback: boolean;
  error?: string;
}

export interface GuideConversationSendInput {
  question: string;
  image?: GuideImageAttachment;
  routeContext?: GuideRouteContext;
  spotId?: string;
  currentSpotName?: string;
  fallbackText?: string;
  autoPlay?: boolean;
}

export interface UseGuideConversationOptions {
  initialSessionId?: string;
  initialMuted?: boolean;
}

export interface GuideConversationReplayOptions {
  force?: boolean;
}

export interface UseGuideConversationResult {
  latest: GuideConversationLatest;
  sessionId: string;
  setSessionId: Dispatch<SetStateAction<string>>;
  reset: () => void;
  send: (input: GuideConversationSendInput) => Promise<GuideConversationLatest | undefined>;
  cancel: () => void;
  replay: (options?: GuideConversationReplayOptions) => Promise<boolean>;
  playAndWait: ReturnType<typeof useGuideAudioPlayback>['playAndWait'];
  stopAudio: () => void;
  pending: boolean;
  guideStatus: GuideStatus;
  audioState: AvatarAudioState;
  muted: boolean;
  setMuted: (next: boolean) => void;
  toggleMuted: () => void;
  audioStatus: ReturnType<typeof useGuideAudioPlayback>['status'];
  autoplayBlocked: boolean;
  audioError?: string;
}

const emptyLatest: GuideConversationLatest = {
  content: '',
  sources: [],
  isFallback: false,
};

function createConversationSessionId() {
  const randomId =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `guide-conversation-${randomId}`;
}

function waitForNextPoll(signal: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }

    const handleAbort = () => {
      window.clearTimeout(timer);
      resolve(false);
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', handleAbort);
      resolve(true);
    }, TTS_POLL_INTERVAL_MS);
    signal.addEventListener('abort', handleAbort, { once: true });
  });
}

function normalizeTtsStatus(response: ChatResponse): ChatResponse['ttsStatus'] {
  if (response.ttsStatus) return response.ttsStatus;
  return response.audioUrl ? 'ready' : 'disabled';
}

function isAbortError(error: unknown) {
  return (
    (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') ||
    (typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      (error as { name?: unknown }).name === 'AbortError')
  );
}

export default function useGuideConversation(
  options: UseGuideConversationOptions = {},
): UseGuideConversationResult {
  const [latest, setLatest] = useState<GuideConversationLatest>(emptyLatest);
  const [sessionId, setSessionId] = useState(
    () => options.initialSessionId || createConversationSessionId(),
  );
  const [pending, setPending] = useState(false);
  const requestSequenceRef = useRef(0);
  const abortControllerRef = useRef<AbortController>();
  const mountedRef = useRef(true);
  const audio = useGuideAudioPlayback({ initialMuted: options.initialMuted });
  const stopAudioRef = useRef(audio.stop);

  useEffect(() => {
    stopAudioRef.current = audio.stop;
  }, [audio.stop]);

  const isCurrentRequest = useCallback(
    (sequence: number) => mountedRef.current && requestSequenceRef.current === sequence,
    [],
  );

  const cancel = useCallback(() => {
    requestSequenceRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = undefined;
    stopAudioRef.current();
    if (mountedRef.current) setPending(false);
  }, []);

  const playIfCurrent = useCallback(
    async (
      sequence: number,
      content: string,
      audioUrl: string | undefined,
      autoPlay: boolean,
    ) => {
      if (!autoPlay || !isCurrentRequest(sequence)) return;
      await audio.play({ text: content, audioUrl });
    },
    [audio, isCurrentRequest],
  );

  const pollTtsJob = useCallback(
    async (
      jobId: string,
      sequence: number,
      controller: AbortController,
      content: string,
      autoPlay: boolean,
      initialLatest: GuideConversationLatest,
    ) => {
      for (let attempt = 0; attempt < TTS_POLL_ATTEMPTS; attempt += 1) {
        if (!(await waitForNextPoll(controller.signal)) || !isCurrentRequest(sequence)) {
          return undefined;
        }

        try {
          const result = await getTtsJobStatus(jobId, controller.signal);
          if (!isCurrentRequest(sequence)) return undefined;
          if (result.status === 'pending') continue;

          const resolvedLatest: GuideConversationLatest = {
            ...initialLatest,
            audioUrl: result.audioUrl,
            ttsStatus: result.status,
          };
          setLatest(resolvedLatest);
          if (result.status === 'ready') {
            await playIfCurrent(sequence, content, result.audioUrl, autoPlay);
          } else {
            await playIfCurrent(sequence, content, undefined, autoPlay);
          }
          if (abortControllerRef.current === controller) {
            abortControllerRef.current = undefined;
          }
          return resolvedLatest;
        } catch {
          if (controller.signal.aborted || !isCurrentRequest(sequence)) {
            return undefined;
          }
          if (attempt < TTS_POLL_ATTEMPTS - 1) continue;
          const failedLatest: GuideConversationLatest = {
            ...initialLatest,
            audioUrl: undefined,
            ttsStatus: 'failed',
          };
          setLatest(failedLatest);
          await playIfCurrent(sequence, content, undefined, autoPlay);
          if (abortControllerRef.current === controller) {
            abortControllerRef.current = undefined;
          }
          return failedLatest;
        }
      }

      if (!isCurrentRequest(sequence)) return undefined;
      const failedLatest: GuideConversationLatest = {
        ...initialLatest,
        audioUrl: undefined,
        ttsStatus: 'failed',
      };
      setLatest(failedLatest);
      await playIfCurrent(sequence, content, undefined, autoPlay);
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = undefined;
      }
      return failedLatest;
    },
    [isCurrentRequest, playIfCurrent],
  );

  const send = useCallback(
    async (input: GuideConversationSendInput) => {
      const question = input.question.trim();
      const fallbackText = input.fallbackText?.trim();
      if (!question && !input.image) return undefined;

      abortControllerRef.current?.abort();
      stopAudioRef.current();
      const controller = new AbortController();
      const sequence = requestSequenceRef.current + 1;
      requestSequenceRef.current = sequence;
      abortControllerRef.current = controller;
      setPending(true);
      setLatest(emptyLatest);

      let streamedContent = '';
      try {
        const response = await streamChatWithGuide(
          {
            question,
            image: input.image,
            routeContext: input.routeContext,
            spotId: input.spotId,
            currentSpotName: input.currentSpotName,
            sessionId,
          },
          {
            signal: controller.signal,
            onDelta: (delta) => {
              if (!delta || !isCurrentRequest(sequence)) return;
              streamedContent += delta;
              setLatest({
                content: streamedContent,
                sources: [],
                isFallback: false,
              });
            },
          },
        );

        if (!isCurrentRequest(sequence)) return undefined;
        if (response.sessionId) setSessionId(response.sessionId);

        const responseContent = response.answer.trim() || streamedContent.trim();
        const shouldUseLocalFallback = Boolean(fallbackText && (response.isFallback || !responseContent));
        const content = shouldUseLocalFallback
          ? fallbackText!
          : responseContent || fallbackText || '讲解暂时不可用，请稍后再试。';
        const autoPlay = input.autoPlay !== false;
        const ttsStatus = shouldUseLocalFallback ? 'disabled' : normalizeTtsStatus(response);
        const nextLatest: GuideConversationLatest = {
          content,
          sources: shouldUseLocalFallback ? [] : response.sources,
          audioUrl: shouldUseLocalFallback ? undefined : response.audioUrl,
          ttsStatus,
          isFallback: Boolean(response.isFallback || shouldUseLocalFallback || !responseContent),
          error: response.error?.message,
        };
        setLatest(nextLatest);

        if (!shouldUseLocalFallback && response.ttsJobId && ttsStatus === 'pending') {
          const resolvedLatest = await pollTtsJob(
            response.ttsJobId,
            sequence,
            controller,
            content,
            autoPlay,
            nextLatest,
          );
          return resolvedLatest;
        } else if (ttsStatus === 'pending') {
          const pendingFallback: GuideConversationLatest = {
            ...nextLatest,
            audioUrl: undefined,
            ttsStatus: 'failed',
          };
          setLatest(pendingFallback);
          await playIfCurrent(sequence, content, undefined, autoPlay);
          if (abortControllerRef.current === controller) abortControllerRef.current = undefined;
          return pendingFallback;
        } else {
          await playIfCurrent(
            sequence,
            content,
            ttsStatus === 'ready' ? nextLatest.audioUrl : undefined,
            autoPlay,
          );
          if (abortControllerRef.current === controller) abortControllerRef.current = undefined;
        }

        return nextLatest;
      } catch (error) {
        if (controller.signal.aborted || !isCurrentRequest(sequence) || isAbortError(error)) {
          return undefined;
        }

        const message = toApiError(error, 'AI 讲解暂时不可用，请稍后再试。').message;
        const content = fallbackText || message;
        const fallbackLatest: GuideConversationLatest = {
          content,
          sources: [],
          ttsStatus: 'failed',
          isFallback: true,
          error: message,
        };
        setLatest(fallbackLatest);
        await playIfCurrent(sequence, content, undefined, input.autoPlay !== false);
        if (abortControllerRef.current === controller) abortControllerRef.current = undefined;
        return fallbackLatest;
      } finally {
        if (isCurrentRequest(sequence)) setPending(false);
      }
    },
    [isCurrentRequest, playIfCurrent, pollTtsJob, sessionId],
  );

  const replay = useCallback(async (replayOptions?: GuideConversationReplayOptions) => {
    if (!latest.content) return false;
    return audio.play(
      { text: latest.content, audioUrl: latest.audioUrl },
      replayOptions,
    );
  }, [audio, latest.audioUrl, latest.content]);

  const reset = useCallback(() => {
    cancel();
    setSessionId(createConversationSessionId());
    setLatest(emptyLatest);
  }, [cancel]);

  useEffect(
    () => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
        requestSequenceRef.current += 1;
        abortControllerRef.current?.abort();
        stopAudioRef.current();
      };
    },
    [],
  );

  const guideStatus = useMemo<GuideStatus>(() => {
    if (pending) return 'thinking';
    if (audio.status === 'playing') return 'speaking';
    return 'idle';
  }, [audio.status, pending]);

  const audioState = useMemo<AvatarAudioState>(() => {
    if (audio.status === 'playing') return 'playing';
    if (audio.status === 'loading' || pending || latest.ttsStatus === 'pending') return 'pending';
    if (audio.status === 'blocked' || audio.status === 'error') return 'failed';
    if (latest.ttsStatus === 'ready') return 'ready';
    if (latest.ttsStatus === 'failed' || latest.ttsStatus === 'disabled') return 'failed';
    return 'idle';
  }, [audio.status, latest.ttsStatus, pending]);

  return {
    latest,
    sessionId,
    setSessionId,
    reset,
    send,
    cancel,
    replay,
    playAndWait: audio.playAndWait,
    stopAudio: audio.stop,
    pending,
    guideStatus,
    audioState,
    muted: audio.muted,
    setMuted: audio.setMuted,
    toggleMuted: audio.toggleMuted,
    audioStatus: audio.status,
    autoplayBlocked: audio.autoplayBlocked,
    audioError: audio.error,
  };
}
