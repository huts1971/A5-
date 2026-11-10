import { useCallback, useEffect, useRef, useState } from 'react';

export type GuideAudioPlaybackStatus = 'idle' | 'loading' | 'playing' | 'blocked' | 'error';
export type GuideAudioPlaybackMode = 'audio' | 'speech';
export type GuideAudioTimelinePhase =
  | 'loading'
  | 'playing'
  | 'fallback'
  | 'ended';
export type GuideAudioPlaybackEndReason =
  | 'ended'
  | 'stopped'
  | 'muted'
  | 'replaced'
  | 'aborted'
  | 'timeout'
  | 'unmounted';
export type GuideAudioPlaybackCompletionReason =
  | GuideAudioPlaybackEndReason
  | 'blocked'
  | 'error'
  | 'skipped';
export type GuideAudioPlaybackErrorCode =
  | 'autoplay_blocked'
  | 'audio_failed'
  | 'speech_unavailable'
  | 'speech_failed';

export interface GuideAudioPlaybackRequest {
  text: string;
  audioUrl?: string;
}

export interface GuideAudioPlaybackError {
  code: GuideAudioPlaybackErrorCode;
  message: string;
  canRetry: boolean;
  cause?: unknown;
}

export interface GuideAudioPlaybackResult {
  ok: boolean;
  mode?: GuideAudioPlaybackMode;
  blocked?: boolean;
  skipped?: 'muted' | 'empty' | 'cancelled' | 'unavailable';
  error?: GuideAudioPlaybackError;
}

export interface GuideAudioPlayOptions {
  force?: boolean;
}

export interface GuideAudioTimelineSnapshot {
  mode: GuideAudioPlaybackMode;
  phase: GuideAudioTimelinePhase;
  currentTime?: number;
  duration?: number;
}

export interface GuideAudioPlayAndWaitOptions extends GuideAudioPlayOptions {
  signal?: AbortSignal;
  onTimeline?: (snapshot: GuideAudioTimelineSnapshot) => void;
}

export interface GuideAudioPlaybackCompletion {
  completed: boolean;
  reason: GuideAudioPlaybackCompletionReason;
  mode?: GuideAudioPlaybackMode;
}

export interface UseGuideAudioPlaybackOptions {
  initialMuted?: boolean;
  onStart?: (mode: GuideAudioPlaybackMode) => void;
  onEnd?: (reason: GuideAudioPlaybackEndReason) => void;
  onError?: (error: GuideAudioPlaybackError) => void;
}

export interface UseGuideAudioPlaybackResult {
  play: (
    request: GuideAudioPlaybackRequest,
    options?: GuideAudioPlayOptions,
  ) => Promise<boolean>;
  playAndWait: (
    request: GuideAudioPlaybackRequest,
    options?: GuideAudioPlayAndWaitOptions,
  ) => Promise<GuideAudioPlaybackCompletion>;
  replay: (options?: GuideAudioPlayOptions) => Promise<boolean>;
  stop: () => void;
  muted: boolean;
  setMuted: (muted: boolean) => void;
  toggleMuted: () => void;
  status: GuideAudioPlaybackStatus;
  mode: GuideAudioPlaybackMode | null;
  error?: string;
  errorDetail: GuideAudioPlaybackError | null;
  autoplayBlocked: boolean;
}

let activeGuidePlayback:
  | {
      ownerId: string;
      stop: () => void;
    }
  | undefined;

export function useGuideAudioPlayback({
  initialMuted = false,
  onStart,
  onEnd,
  onError,
}: UseGuideAudioPlaybackOptions = {}): UseGuideAudioPlaybackResult {
  const ownerIdRef = useRef(`guide-audio-${Math.random().toString(36).slice(2)}`);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const tokenRef = useRef(0);
  const startedTokenRef = useRef(0);
  const mountedRef = useRef(true);
  const mutedRef = useRef(initialMuted);
  const statusRef = useRef<GuideAudioPlaybackStatus>('idle');
  const modeRef = useRef<GuideAudioPlaybackMode | null>(null);
  const callbacksRef = useRef({ onStart, onEnd, onError });
  const lastRequestRef = useRef<GuideAudioPlaybackRequest | null>(null);
  const completionWaitersRef = useRef(
    new Map<
      number,
      {
        resolve: (completion: GuideAudioPlaybackCompletion) => void;
        cleanup: () => void;
      }
    >(),
  );
  const [muted, setMutedState] = useState(initialMuted);
  const [status, setStatusState] = useState<GuideAudioPlaybackStatus>('idle');
  const [mode, setMode] = useState<GuideAudioPlaybackMode | null>(null);
  const [error, setError] = useState<GuideAudioPlaybackError | null>(null);

  callbacksRef.current = { onStart, onEnd, onError };

  const setPlaybackStatus = useCallback((nextStatus: GuideAudioPlaybackStatus) => {
    statusRef.current = nextStatus;
    if (mountedRef.current) setStatusState(nextStatus);
  }, []);

  const setPlaybackMode = useCallback((nextMode: GuideAudioPlaybackMode | null) => {
    modeRef.current = nextMode;
    if (mountedRef.current) setMode(nextMode);
  }, []);

  const settlePlayback = useCallback(
    (token: number, completion: GuideAudioPlaybackCompletion) => {
      const waiter = completionWaitersRef.current.get(token);
      if (!waiter) return;
      completionWaitersRef.current.delete(token);
      waiter.cleanup();
      waiter.resolve(completion);
    },
    [],
  );

  const clearOwnedGlobalPlayback = useCallback(() => {
    if (activeGuidePlayback?.ownerId === ownerIdRef.current) {
      activeGuidePlayback = undefined;
    }
  }, []);

  const stopInternal = useCallback(
    (
      reason: GuideAudioPlaybackEndReason,
      {
        clearError = true,
        notify = true,
      }: {
        clearError?: boolean;
        notify?: boolean;
      } = {},
    ) => {
      const stoppedToken = tokenRef.current;
      const stoppedMode = modeRef.current ?? undefined;
      tokenRef.current += 1;
      startedTokenRef.current = 0;
      const wasActive =
        Boolean(audioRef.current || utteranceRef.current) ||
        statusRef.current === 'loading' ||
        statusRef.current === 'playing';

      const audio = audioRef.current;
      if (audio) {
        audio.onplay = null;
        audio.onended = null;
        audio.onerror = null;
        audio.onloadedmetadata = null;
        audio.ondurationchange = null;
        audio.ontimeupdate = null;
        audio.pause();
        try {
          audio.currentTime = 0;
        } catch {
          // Some streaming audio sources do not expose a seekable timeline.
        }
        audioRef.current = null;
      }

      if (utteranceRef.current && typeof window !== 'undefined' && 'speechSynthesis' in window) {
        utteranceRef.current.onstart = null;
        utteranceRef.current.onend = null;
        utteranceRef.current.onerror = null;
        window.speechSynthesis.cancel();
        utteranceRef.current = null;
      }

      clearOwnedGlobalPlayback();
      setPlaybackStatus('idle');
      setPlaybackMode(null);
      if (mountedRef.current && clearError) setError(null);
      if (wasActive) {
        settlePlayback(stoppedToken, {
          completed: false,
          reason,
          mode: stoppedMode,
        });
      }
      if (wasActive && notify) callbacksRef.current.onEnd?.(reason);
    },
    [clearOwnedGlobalPlayback, setPlaybackMode, setPlaybackStatus, settlePlayback],
  );

  const reportPlaybackError = useCallback(
    (
      playbackError: GuideAudioPlaybackError,
      nextStatus: 'blocked' | 'error',
      token?: number,
    ) => {
      if (token !== undefined && tokenRef.current !== token) {
        return {
          ok: false,
          skipped: 'cancelled',
        } satisfies GuideAudioPlaybackResult;
      }
      const failedMode = modeRef.current ?? undefined;
      clearOwnedGlobalPlayback();
      setPlaybackStatus(nextStatus);
      setPlaybackMode(null);
      if (mountedRef.current) {
        setError(playbackError);
      }
      if (token !== undefined) {
        settlePlayback(token, {
          completed: false,
          reason: nextStatus,
          mode: failedMode,
        });
      }
      callbacksRef.current.onError?.(playbackError);
      return {
        ok: false,
        blocked: nextStatus === 'blocked',
        error: playbackError,
      } satisfies GuideAudioPlaybackResult;
    },
    [clearOwnedGlobalPlayback, setPlaybackMode, setPlaybackStatus, settlePlayback],
  );

  const finishPlayback = useCallback(
    (token: number, playbackMode: GuideAudioPlaybackMode) => {
      if (tokenRef.current !== token) return;
      audioRef.current = null;
      utteranceRef.current = null;
      clearOwnedGlobalPlayback();
      setPlaybackStatus('idle');
      setPlaybackMode(null);
      if (mountedRef.current) setError(null);
      settlePlayback(token, {
        completed: true,
        reason: 'ended',
        mode: playbackMode,
      });
      callbacksRef.current.onEnd?.('ended');
    },
    [clearOwnedGlobalPlayback, setPlaybackMode, setPlaybackStatus, settlePlayback],
  );

  const markPlaybackStarted = useCallback(
    (token: number, playbackMode: GuideAudioPlaybackMode) => {
      if (tokenRef.current !== token || startedTokenRef.current === token) return;
      startedTokenRef.current = token;
      setPlaybackStatus('playing');
      setPlaybackMode(playbackMode);
      if (mountedRef.current) {
        setError(null);
      }
      callbacksRef.current.onStart?.(playbackMode);
    },
    [setPlaybackMode, setPlaybackStatus],
  );

  const playSpeech = useCallback(
    async (
      text: string,
      token: number,
      onTimeline?: (snapshot: GuideAudioTimelineSnapshot) => void,
    ): Promise<GuideAudioPlaybackResult> => {
      const normalizedText = text.trim();
      if (!normalizedText) {
        return {
          ok: false,
          skipped: 'unavailable',
        };
      }
      if (
        typeof window === 'undefined' ||
        !('speechSynthesis' in window) ||
        typeof window.SpeechSynthesisUtterance === 'undefined'
      ) {
        return reportPlaybackError(
          {
            code: 'speech_unavailable',
            message: '当前浏览器不支持语音播报，文字讲解仍可正常查看。',
            canRetry: false,
          },
          'error',
          token,
        );
      }

      const utterance = new SpeechSynthesisUtterance(normalizedText);
      utterance.lang = 'zh-CN';
      utterance.rate = 0.95;
      utteranceRef.current = utterance;
      setPlaybackStatus('loading');
      setPlaybackMode('speech');
      onTimeline?.({ mode: 'speech', phase: 'loading' });
      activeGuidePlayback = {
        ownerId: ownerIdRef.current,
        stop: () => stopInternal('replaced'),
      };

      utterance.onstart = () => {
        if (tokenRef.current !== token) return;
        onTimeline?.({ mode: 'speech', phase: 'playing' });
        markPlaybackStarted(token, 'speech');
      };
      utterance.onend = () => {
        if (tokenRef.current !== token) return;
        onTimeline?.({ mode: 'speech', phase: 'ended' });
        finishPlayback(token, 'speech');
      };
      utterance.onerror = (event) => {
        if (tokenRef.current !== token) return;
        utterance.onstart = null;
        utterance.onend = null;
        utterance.onerror = null;
        utteranceRef.current = null;
        const blocked = event.error === 'not-allowed';
        reportPlaybackError(
          {
            code: blocked ? 'autoplay_blocked' : 'speech_failed',
            message: blocked
              ? '浏览器暂未允许自动播放，文字讲解会继续显示。'
              : '浏览器语音播报暂时不可用，文字讲解仍可正常查看。',
            canRetry: blocked,
            cause: event,
          },
          blocked ? 'blocked' : 'error',
          token,
        );
      };

      try {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
        return { ok: true, mode: 'speech' };
      } catch (cause) {
        utteranceRef.current = null;
        return reportPlaybackError(
          {
            code: 'speech_failed',
            message: '浏览器语音播报启动失败，文字讲解仍可正常查看。',
            canRetry: true,
            cause,
          },
          'error',
          token,
        );
      }
    },
    [
      finishPlayback,
      markPlaybackStarted,
      reportPlaybackError,
      setPlaybackMode,
      setPlaybackStatus,
      stopInternal,
    ],
  );

  const playDetailed = useCallback(
    async (
      request: GuideAudioPlaybackRequest,
      options: GuideAudioPlayOptions = {},
      onToken?: (token: number) => void,
      onTimeline?: (snapshot: GuideAudioTimelineSnapshot) => void,
    ): Promise<GuideAudioPlaybackResult> => {
      const normalizedRequest = {
        text: request.text ?? '',
        audioUrl: request.audioUrl?.trim() || undefined,
      };
      lastRequestRef.current = normalizedRequest;

      if (mutedRef.current && !options.force) {
        return { ok: false, skipped: 'muted' };
      }
      if (!normalizedRequest.text.trim() && !normalizedRequest.audioUrl) {
        return { ok: false, skipped: 'empty' };
      }

      activeGuidePlayback?.stop();
      stopInternal('replaced', { notify: false });
      const token = tokenRef.current + 1;
      tokenRef.current = token;
      startedTokenRef.current = 0;
      if (mountedRef.current) setError(null);
      setPlaybackMode(normalizedRequest.audioUrl ? 'audio' : 'speech');
      setPlaybackStatus('loading');
      onToken?.(token);
      if (tokenRef.current !== token) {
        return { ok: false, skipped: 'cancelled' };
      }

      if (!normalizedRequest.audioUrl) {
        return playSpeech(normalizedRequest.text, token, onTimeline);
      }
      if (typeof window === 'undefined' || typeof window.Audio === 'undefined') {
        onTimeline?.({ mode: 'speech', phase: 'fallback' });
        return playSpeech(normalizedRequest.text, token, onTimeline);
      }

      const audio = new Audio(normalizedRequest.audioUrl);
      audio.preload = 'auto';
      audioRef.current = audio;
      activeGuidePlayback = {
        ownerId: ownerIdRef.current,
        stop: () => stopInternal('replaced'),
      };

      let fallbackStarted = false;
      let fallbackPromise: Promise<GuideAudioPlaybackResult> | undefined;
      const emitTimeline = (snapshot: GuideAudioTimelineSnapshot) => {
        if (tokenRef.current === token) onTimeline?.(snapshot);
      };
      const emitAudioTimeline = (
        phase: GuideAudioTimelinePhase,
        forceEnded = false,
      ) => {
        const duration =
          Number.isFinite(audio.duration) && audio.duration > 0
            ? audio.duration
            : undefined;
        const currentTime = forceEnded && duration
          ? duration
          : Number.isFinite(audio.currentTime)
            ? Math.max(0, audio.currentTime)
            : undefined;
        emitTimeline({
          mode: 'audio',
          phase,
          currentTime,
          duration,
        });
      };
      const clearAudioHandlers = () => {
        audio.onplay = null;
        audio.onended = null;
        audio.onerror = null;
        audio.onloadedmetadata = null;
        audio.ondurationchange = null;
        audio.ontimeupdate = null;
      };
      const fallbackToSpeech = () => {
        if (fallbackStarted || tokenRef.current !== token) return;
        fallbackStarted = true;
        clearAudioHandlers();
        audio.pause();
        audioRef.current = null;
        if (normalizedRequest.text.trim()) {
          emitTimeline({ mode: 'speech', phase: 'fallback' });
          fallbackPromise = playSpeech(
            normalizedRequest.text,
            token,
            emitTimeline,
          );
          void fallbackPromise;
          return;
        }
        reportPlaybackError(
          {
            code: 'audio_failed',
            message: '讲解音频暂时无法播放，文字讲解仍可正常查看。',
            canRetry: true,
          },
          'error',
          token,
        );
      };

      audio.onloadedmetadata = () => emitAudioTimeline('loading');
      audio.ondurationchange = () => emitAudioTimeline('loading');
      audio.ontimeupdate = () => emitAudioTimeline('playing');
      audio.onplay = () => {
        emitAudioTimeline('playing');
        markPlaybackStarted(token, 'audio');
      };
      audio.onended = () => {
        emitAudioTimeline('ended', true);
        clearAudioHandlers();
        finishPlayback(token, 'audio');
      };
      audio.onerror = fallbackToSpeech;
      emitAudioTimeline('loading');

      try {
        await audio.play();
        if (tokenRef.current !== token) return { ok: false, skipped: 'cancelled' };
        markPlaybackStarted(token, 'audio');
        return { ok: true, mode: 'audio' };
      } catch (cause) {
        if (tokenRef.current !== token) return { ok: false, skipped: 'cancelled' };
        clearAudioHandlers();
        audio.pause();
        audioRef.current = null;

        if (fallbackStarted) {
          return fallbackPromise ?? { ok: false, skipped: 'cancelled' };
        }
        if (isAutoplayBlocked(cause)) {
          return reportPlaybackError(
            {
              code: 'autoplay_blocked',
              message: '浏览器暂未允许自动播放，文字讲解会继续显示。',
              canRetry: true,
              cause,
            },
            'blocked',
            token,
          );
        }

        if (normalizedRequest.text.trim()) {
          emitTimeline({ mode: 'speech', phase: 'fallback' });
          return playSpeech(normalizedRequest.text, token, emitTimeline);
        }

        return reportPlaybackError(
          {
            code: 'audio_failed',
            message: '讲解音频暂时无法播放，文字讲解仍可正常查看。',
            canRetry: true,
            cause,
          },
          'error',
          token,
        );
      }
    },
    [
      finishPlayback,
      markPlaybackStarted,
      playSpeech,
      reportPlaybackError,
      setPlaybackMode,
      setPlaybackStatus,
      stopInternal,
    ],
  );

  const play = useCallback(
    async (request: GuideAudioPlaybackRequest, options?: GuideAudioPlayOptions) =>
      (await playDetailed(request, options)).ok,
    [playDetailed],
  );

  const waitForPlaybackToken = useCallback(
    (token: number, signal: AbortSignal | undefined, timeoutMs: number) =>
      new Promise<GuideAudioPlaybackCompletion>((resolve) => {
        const existingWaiter = completionWaitersRef.current.get(token);
        if (existingWaiter) {
          completionWaitersRef.current.delete(token);
          existingWaiter.cleanup();
          existingWaiter.resolve({
            completed: false,
            reason: 'replaced',
            mode: modeRef.current ?? undefined,
          });
        }

        const handleAbort = () => {
          if (tokenRef.current === token) {
            stopInternal('aborted');
            return;
          }
          settlePlayback(token, {
            completed: false,
            reason: 'aborted',
            mode: modeRef.current ?? undefined,
          });
        };
        const handleTimeout = () => {
          if (tokenRef.current === token) {
            stopInternal('timeout');
            return;
          }
          settlePlayback(token, {
            completed: false,
            reason: 'timeout',
            mode: modeRef.current ?? undefined,
          });
        };
        const timeout = window.setTimeout(handleTimeout, timeoutMs);
        const cleanup = () => {
          window.clearTimeout(timeout);
          signal?.removeEventListener('abort', handleAbort);
        };

        completionWaitersRef.current.set(token, {
          resolve,
          cleanup,
        });
        if (signal) {
          signal.addEventListener('abort', handleAbort, { once: true });
          if (signal.aborted) handleAbort();
        }
      }),
    [settlePlayback, stopInternal],
  );

  const playAndWait = useCallback(
    async (
      request: GuideAudioPlaybackRequest,
      options: GuideAudioPlayAndWaitOptions = {},
    ): Promise<GuideAudioPlaybackCompletion> => {
      const { signal, onTimeline, ...playOptions } = options;
      if (signal?.aborted) {
        return {
          completed: false,
          reason: 'aborted',
        };
      }

      let playbackToken: number | undefined;
      let completionPromise: Promise<GuideAudioPlaybackCompletion> | undefined;
      const timeoutMs = Math.min(
        60_000,
        Math.max(12_000, request.text.trim().length * 750 + 6_000),
      );
      const startPromise = playDetailed(
        request,
        playOptions,
        (token) => {
          playbackToken = token;
          completionPromise = waitForPlaybackToken(token, signal, timeoutMs);
        },
        onTimeline,
      );

      if (completionPromise) {
        void startPromise.catch((cause) => {
          if (playbackToken === undefined) return;
          reportPlaybackError(
            {
              code: 'audio_failed',
              message: '讲解音频启动失败，文字讲解仍可正常查看。',
              canRetry: true,
              cause,
            },
            'error',
            playbackToken,
          );
        });
        return completionPromise;
      }

      const startResult = await startPromise;
      return {
        completed: false,
        reason: startResult.blocked
          ? 'blocked'
          : startResult.error
            ? 'error'
            : startResult.skipped === 'muted'
              ? 'muted'
              : 'skipped',
        mode: startResult.mode,
      };
    },
    [playDetailed, reportPlaybackError, waitForPlaybackToken],
  );

  const replay = useCallback(
    (options?: GuideAudioPlayOptions) => {
      const lastRequest = lastRequestRef.current;
      if (!lastRequest) return Promise.resolve(false);
      return play(lastRequest, options);
    },
    [play],
  );

  const stop = useCallback(() => {
    stopInternal('stopped');
  }, [stopInternal]);

  const setMuted = useCallback((nextMuted: boolean) => {
    mutedRef.current = nextMuted;
    setMutedState(nextMuted);
  }, []);

  const toggleMuted = useCallback(() => {
    setMuted(!mutedRef.current);
  }, [setMuted]);

  useEffect(() => {
    mutedRef.current = muted;
    if (muted) stopInternal('muted');
  }, [muted, stopInternal]);

  useEffect(
    () => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
        stopInternal('unmounted', { notify: false });
      };
    },
    [stopInternal],
  );

  return {
    play,
    playAndWait,
    replay,
    stop,
    muted,
    setMuted,
    toggleMuted,
    status,
    mode,
    error: error?.message,
    errorDetail: error,
    autoplayBlocked: status === 'blocked' && error?.code === 'autoplay_blocked',
  };
}

export default useGuideAudioPlayback;

function isAutoplayBlocked(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return true;
  }
  if (error instanceof Error) {
    return /not[\s-]*allowed|user gesture|play\(\) failed/i.test(error.message);
  }
  return false;
}
