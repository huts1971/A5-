import {
  EnvironmentOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  HistoryOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { Button, Empty } from 'antd';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getRouteDraft } from '../../api/routeDrafts';
import { fallbackSpotImage, resolveSpotImage } from '../../api/spotImages';
import { getSpotDetail, getSpots } from '../../api/spots';
import { getTour, recordTourEvent } from '../../api/tours';
import AvatarGuide from '../../components/guide/AvatarGuide';
import GuideComposer from '../../components/guide/GuideComposer';
import RouteProgressStrip from '../../components/guide/RouteProgressStrip';
import useGuideConversation, {
  type GuideConversationSendInput,
} from '../../hooks/useGuideConversation';
import type {
  GuideImageAttachment,
  GuideRouteContext,
  ScenicSpot,
} from '../../types/scenic';
import {
  buildGuideRouteContextFromDraft,
  buildGuideRouteContextFromTour,
} from '../../utils/guideRouteContext';
import {
  guideContextAtIndex,
  loadCachedSceneGuideContext,
  projectSceneGuideRoute,
} from '../../utils/sceneGuideRoute';
import {
  sentenceIndexAtAudioTime,
  sentenceReadingDelay,
  splitGuideSpeech,
} from '../../utils/guideSpeech';
import {
  createSceneGuideSessionId,
  loadSceneGuideSession,
  saveSceneGuideSession,
  sceneGuideRouteKey,
} from '../../utils/sceneGuideSession';
import { useVisitorAuth } from '../../utils/visitorAuthContext';
import { saveGuideRouteContext } from '../../utils/visitorSessionState';
import styles from './SceneGuidePage.module.css';

type RouteLoadStatus = 'loading' | 'ready' | 'empty' | 'expired' | 'error';

interface RouteLoadState {
  status: RouteLoadStatus;
  context?: GuideRouteContext;
  message?: string;
}

interface BackgroundLayers {
  current: string;
  previous?: string;
}

interface SentenceBubble {
  id: string;
  sentences: string[];
  index: number;
}

const routeLoadPromises = new Map<
  string,
  { expiresAt: number; promise: Promise<RouteLoadState> }
>();

function routeFallbackText(
  routeSpot: GuideRouteContext['orderedSpots'][number] | undefined,
  scenicSpot: ScenicSpot | undefined,
) {
  const sentences = [
    scenicSpot?.story,
    scenicSpot?.summary,
    routeSpot?.reason,
  ]
    .flatMap((value) => (value ? splitGuideSpeech(value, 38) : []))
    .map((value) =>
      value
        .trim()
        .replace(/[，、：,；;]+$/u, '')
        .replace(/([^。！？!?])$/u, '$1。'),
    )
    .filter(
      (value, index, values) =>
        Boolean(value) &&
        values.findIndex(
          (candidate) =>
            candidate.replace(/[。！？!?]/gu, '') ===
            value.replace(/[。！？!?]/gu, ''),
        ) === index,
    )
    .slice(0, 6);

  if (routeSpot) {
    const observationPrompts = [
      `我们已经来到${routeSpot.name}，先看一眼整个场景的轮廓。`,
      '再把视线落到离你最近、最醒目的局部细节。',
      '可以稍微换个角度，比较光线与空间层次的变化。',
      '把远处和近处放在一起看，画面关系会更清楚。',
      '不用急着往前走，停几秒会更容易发现细微之处。',
    ];
    for (const prompt of observationPrompts) {
      if (sentences.length >= 5) break;
      sentences.push(prompt);
    }
  }

  if (sentences.length) return sentences.join('');
  return '当前场景资料暂未加载，请稍后重试。';
}

function narrationPrompt(
  routeSpot: GuideRouteContext['orderedSpots'][number],
) {
  return (
    `请讲解当前景点“${routeSpot.name}”。` +
    '请用五到六句自然口语：第一句引导我看整体形象；' +
    '第二句指出一个具体的局部细节；' +
    '第三句讲一个有依据的事实；' +
    '第四句解释相关故事或文化含义；' +
    '第五句给出一个与眼前景物相关的观看动作；' +
    '资料足够时，第六句补充一个容易忽略的看点。' +
    '每句十八到三十四个汉字，只输出正文并用句号分隔。' +
    '若某类资料不足，就换成能够确认的看点，不要重复相同意思。'
  );
}

function mapIdFromSearchParams(params: URLSearchParams) {
  return params.get('mapId') === 'nianhua-bay'
    ? ('nianhua-bay' as const)
    : params.get('mapId') === 'ling-shan'
      ? ('ling-shan' as const)
      : undefined;
}

function waitForSentenceTurn(duration: number, signal: AbortSignal) {
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
    }, duration);
    signal.addEventListener('abort', handleAbort, { once: true });
  });
}

async function resolveRouteContext(search: string): Promise<RouteLoadState> {
  const params = new URLSearchParams(search);
  const tourId = params.get('tourId')?.trim();
  const draftId = params.get('draftId')?.trim();
  const mapId = mapIdFromSearchParams(params);

  if (tourId) {
    try {
      const tour = await getTour(tourId);
      const context = buildGuideRouteContextFromTour(tour, mapId);
      if (context.status === 'expired' && tour.status !== 'finished') {
        return {
          status: 'expired',
          context,
          message: '这段正式行程已经结束或不可继续，请重新生成路线后再进入场景导览。',
        };
      }
      return { status: 'ready', context };
    } catch {
      return {
        status: 'expired',
        message: '无法恢复这段正式行程，它可能已过期或被删除。',
      };
    }
  }

  if (draftId) {
    try {
      const draft = await getRouteDraft(draftId);
      return {
        status: draft.spots.length ? 'ready' : 'error',
        context: buildGuideRouteContextFromDraft(draft, mapId),
        message: draft.spots.length ? undefined : '这份路线草稿还没有可导览的点位。',
      };
    } catch {
      return {
        status: 'expired',
        message: '无法恢复这份路线草稿，它可能已过期或被删除。',
      };
    }
  }

  const cached = loadCachedSceneGuideContext();
  if (!cached) return { status: 'empty' };
  if (cached.status === 'expired' && !cached.tourId) {
    return {
      status: 'expired',
      context: cached,
      message: '保存的路线已经过期，请重新生成后再进入场景导览。',
    };
  }

  if (cached.tourId) {
    try {
      const tour = await getTour(cached.tourId);
      const context = buildGuideRouteContextFromTour(tour, cached.mapId);
      return context.status === 'expired' && tour.status !== 'finished'
        ? {
            status: 'expired',
            context,
            message: '保存的正式行程已经结束，请重新生成路线。',
          }
        : { status: 'ready', context };
    } catch {
      return {
        status: 'expired',
        context: cached,
        message: '保存的正式行程无法恢复，请重新生成路线。',
      };
    }
  }

  if (cached.orderedSpots.length === 0) {
    return {
      status: 'error',
      context: cached,
      message: '当前路线没有可导览的点位，请返回路线页重新生成。',
    };
  }
  return { status: 'ready', context: cached };
}

function resolveRouteContextOnce(search: string, revision: number) {
  const key = `${revision}:${search}`;
  const cached = routeLoadPromises.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.promise;
  }
  const promise = resolveRouteContext(search);
  routeLoadPromises.set(key, {
    expiresAt: Date.now() + 1_000,
    promise,
  });
  window.setTimeout(() => {
    const current = routeLoadPromises.get(key);
    if (current?.promise === promise) routeLoadPromises.delete(key);
  }, 1_050);
  return promise;
}

function SceneLoading() {
  return (
    <main
      className={styles.page}
      data-testid="scene-guide-page"
      aria-label="正在加载场景式导览"
      aria-busy="true"
    >
      <div className={styles.loadingBackdrop} />
      <div className={styles.loadingRoute} />
      <div className={styles.loadingBubble} />
    </main>
  );
}

interface SceneStateProps {
  status: Exclude<RouteLoadStatus, 'loading' | 'ready'>;
  message?: string;
  onRetry: () => void;
}

function SceneState({
  status,
  message,
  onRetry,
}: SceneStateProps) {
  const isEmpty = status === 'empty';
  const title = isEmpty
    ? '还没有可导览的路线'
    : status === 'expired'
      ? '路线已经无法恢复'
      : '场景路线加载失败';
  const description =
    message ||
    (isEmpty
      ? '先生成一条路线，场景式导览会按照点位顺序带你逐站游览。'
      : '请重试，或者返回路线页重新生成一条路线。');

  return (
    <main
      className={styles.statePage}
      data-testid="scene-guide-page"
      data-scene-state={status}
    >
      <section className={styles.statePanel} aria-labelledby="scene-state-title">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={false}
        />
        <h1 id="scene-state-title">{title}</h1>
        <p>{description}</p>
        <div className={styles.statePanelActions}>
          {!isEmpty ? (
            <Button icon={<ReloadOutlined />} onClick={onRetry}>
              重新加载
            </Button>
          ) : null}
          <Button
            type="primary"
            className={styles.statePrimary}
            icon={<EnvironmentOutlined />}
            href="/routes"
          >
            前往路线规划
          </Button>
        </div>
      </section>
    </main>
  );
}

export default function SceneGuidePage() {
  const { loading: authLoading, user } = useVisitorAuth();
  const [searchParams] = useSearchParams();
  const searchKey = searchParams.toString();
  const restoredSceneSessionRef = useRef(loadSceneGuideSession());
  const fallbackSessionIdRef = useRef<string>();
  if (!fallbackSessionIdRef.current) {
    fallbackSessionIdRef.current =
      restoredSceneSessionRef.current?.sessionId ??
      createSceneGuideSessionId();
  }
  const [loadRevision, setLoadRevision] = useState(0);
  const [routeState, setRouteState] = useState<RouteLoadState>({
    status: 'loading',
  });
  const [spotsById, setSpotsById] = useState<Record<string, ScenicSpot>>({});
  const [spotsReady, setSpotsReady] = useState(false);
  const [displayIndex, setDisplayIndex] = useState(0);
  const [failedSpotImages, setFailedSpotImages] = useState<Set<string>>(
    () => new Set(),
  );
  const [backgroundLayers, setBackgroundLayers] = useState<BackgroundLayers>({
    current: fallbackSpotImage,
  });
  const [sceneStarted, setSceneStarted] = useState(false);
  const [narrationRevision, setNarrationRevision] = useState(0);
  const [sentenceBubble, setSentenceBubble] = useState<SentenceBubble>();
  const [completing, setCompleting] = useState(false);
  const [tourNotice, setTourNotice] = useState('');
  const [completedTourId, setCompletedTourId] = useState('');
  const [speechNonce, setSpeechNonce] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const scenePageRef = useRef<HTMLElement | null>(null);
  const initializedRouteKeyRef = useRef('');
  const lastNarratedKeyRef = useRef('');
  const previousAudioStatusRef = useRef('');
  const loadRequestRef = useRef(0);
  const sentenceTurnRef = useRef(0);
  const sentenceControllerRef = useRef<AbortController>();

  const conversation = useGuideConversation({
    initialSessionId: fallbackSessionIdRef.current,
    initialMuted: restoredSceneSessionRef.current?.muted ?? false,
  });

  const context = routeState.context;
  const sceneRoute = useMemo(
    () => (context ? projectSceneGuideRoute(context) : undefined),
    [context],
  );
  const sceneContext = sceneRoute?.context;
  const routeKey = useMemo(
    () => (context ? sceneGuideRouteKey(context) : ''),
    [context],
  );
  const displayContext = useMemo(
    () =>
      sceneContext
        ? guideContextAtIndex(sceneContext, displayIndex)
        : undefined,
    [displayIndex, sceneContext],
  );
  const routeSpot = displayContext?.currentSpot;
  const scenicSpot = routeSpot ? spotsById[routeSpot.spotId] : undefined;
  const fallbackText = useMemo(
    () => routeFallbackText(routeSpot, scenicSpot),
    [routeSpot, scenicSpot],
  );
  const desiredImageUrl = routeSpot
    ? failedSpotImages.has(routeSpot.spotId)
      ? fallbackSpotImage
      : scenicSpot?.imageUrl || resolveSpotImage(routeSpot.spotId)
    : fallbackSpotImage;

  useEffect(() => {
    if (!context?.tourId) {
      setCompletedTourId('');
      return;
    }
    setCompletedTourId(context.status === 'expired' ? context.tourId : '');
  }, [context?.status, context?.tourId]);

  useLayoutEffect(() => {
    document.body.classList.add('scene-guide-workbench-active');
    return () => {
      document.body.classList.remove('scene-guide-workbench-active');
    };
  }, []);

  useEffect(() => {
    const syncFullscreenState = () => {
      setIsFullscreen(
        Boolean(
          scenePageRef.current &&
            document.fullscreenElement === scenePageRef.current,
        ),
      );
    };

    syncFullscreenState();
    document.addEventListener('fullscreenchange', syncFullscreenState);
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenState);
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const scenePage = scenePageRef.current;
    if (!scenePage) return;

    try {
      if (document.fullscreenElement === scenePage) {
        await document.exitFullscreen();
        return;
      }
      await scenePage.requestFullscreen();
    } catch {
      setIsFullscreen(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || !user) {
      setRouteState({ status: 'loading' });
      return undefined;
    }
    const requestId = ++loadRequestRef.current;
    setRouteState({ status: 'loading' });
    setSpotsById({});
    setSpotsReady(false);
    setTourNotice('');

    void resolveRouteContextOnce(searchKey, loadRevision).then(async (nextState) => {
      if (requestId !== loadRequestRef.current) return;
      setRouteState(nextState);
      if (nextState.status !== 'ready' || !nextState.context) return;

      saveGuideRouteContext(nextState.context);
      let listedSpots: ScenicSpot[] = [];
      try {
        listedSpots = await getSpots();
      } catch {
        listedSpots = [];
      }
      if (requestId !== loadRequestRef.current) return;

      const resolvedSpots = new Map(
        listedSpots.map((spot) => [spot.id, spot]),
      );
      const projectedContext = projectSceneGuideRoute(nextState.context).context;
      const missingIds = projectedContext.orderedSpots
        .map((spot) => spot.spotId)
        .filter((spotId) => !resolvedSpots.has(spotId));
      const missingResults = await Promise.allSettled(
        missingIds.map((spotId) => getSpotDetail(spotId)),
      );
      if (requestId !== loadRequestRef.current) return;
      missingResults.forEach((result) => {
        if (result.status === 'fulfilled' && result.value) {
          resolvedSpots.set(result.value.id, result.value);
        }
      });
      setSpotsById(Object.fromEntries(resolvedSpots));
      setSpotsReady(true);
    });

    return () => {
      if (loadRequestRef.current === requestId) {
        loadRequestRef.current += 1;
      }
    };
  }, [authLoading, loadRevision, searchKey, user]);

  useEffect(() => {
    if (
      !sceneContext ||
      !sceneRoute ||
      !routeKey ||
      initializedRouteKeyRef.current === routeKey
    ) {
      return;
    }
    initializedRouteKeyRef.current = routeKey;
    const restored = restoredSceneSessionRef.current;
    const restoredIndex =
      restored?.routeKey === routeKey && restored.displaySpotId
        ? sceneContext.orderedSpots.findIndex(
            (spot) => spot.spotId === restored.displaySpotId,
          )
        : -1;
    setDisplayIndex(
      restoredIndex >= 0
        ? restoredIndex
        : sceneRoute.defaultDisplayIndex,
    );
    if (restored?.routeKey !== routeKey) {
      conversation.setSessionId(createSceneGuideSessionId());
    }
  }, [
    conversation.setSessionId,
    routeKey,
    sceneContext,
    sceneRoute,
  ]);

  useEffect(() => {
    if (!routeKey || !routeSpot) return;
    saveSceneGuideSession({
      routeKey,
      displaySpotId: routeSpot.spotId,
      sessionId: conversation.sessionId ?? fallbackSessionIdRef.current,
      muted: conversation.muted,
    });
  }, [
    conversation.muted,
    conversation.sessionId,
    routeKey,
    routeSpot,
  ]);

  useEffect(() => {
    setBackgroundLayers((current) =>
      current.current === desiredImageUrl
        ? current
        : { current: desiredImageUrl, previous: current.current },
    );
    const timer = window.setTimeout(() => {
      setBackgroundLayers((current) =>
        current.current === desiredImageUrl
          ? { current: current.current }
          : current,
      );
    }, 560);
    return () => window.clearTimeout(timer);
  }, [desiredImageUrl]);

  useEffect(() => {
    if (!sceneContext) return undefined;
    const nextSpot = sceneContext.orderedSpots[displayIndex + 1];
    if (!nextSpot) return undefined;
    const nextScenicSpot = spotsById[nextSpot.spotId];
    const imageUrl =
      nextScenicSpot?.imageUrl || resolveSpotImage(nextSpot.spotId);
    const image = new Image();
    image.decoding = 'async';
    image.src = imageUrl;
    return () => {
      image.src = '';
    };
  }, [displayIndex, sceneContext, spotsById]);

  useEffect(() => {
    if (
      conversation.audioStatus === 'playing' &&
      previousAudioStatusRef.current !== 'playing'
    ) {
      setSpeechNonce((value) => value + 1);
    }
    previousAudioStatusRef.current = conversation.audioStatus;
  }, [conversation.audioStatus]);

  const beginSentenceTurn = useCallback(() => {
    const nextTurn = sentenceTurnRef.current + 1;
    sentenceTurnRef.current = nextTurn;
    sentenceControllerRef.current?.abort();
    sentenceControllerRef.current = undefined;
    conversation.stopAudio();
    setSentenceBubble(undefined);
    return nextTurn;
  }, [conversation.stopAudio]);

  const playSentenceAnswer = useCallback(
    async (content: string, audioUrl: string | undefined, turn: number) => {
      const sentences = splitGuideSpeech(content);
      if (!sentences.length || sentenceTurnRef.current !== turn) return;

      const controller = new AbortController();
      sentenceControllerRef.current?.abort();
      sentenceControllerRef.current = controller;
      const bubbleId = `sentence-turn-${turn}`;

      if (audioUrl) {
        let displayedIndex = -1;
        let fallbackTimeline: Promise<void> | undefined;

        const showSentence = (index: number, allowRewind = false) => {
          if (
            controller.signal.aborted ||
            sentenceTurnRef.current !== turn
          ) {
            return;
          }
          const nextIndex = Math.min(
            sentences.length - 1,
            Math.max(0, index),
          );
          if (!allowRewind && nextIndex <= displayedIndex) return;
          displayedIndex = nextIndex;
          setSentenceBubble({
            id: bubbleId,
            sentences,
            index: nextIndex,
          });
        };

        const runFallbackTimeline = async () => {
          displayedIndex = -1;
          for (let index = 0; index < sentences.length; index += 1) {
            if (
              controller.signal.aborted ||
              sentenceTurnRef.current !== turn
            ) {
              return;
            }
            showSentence(index, index === 0);
            if (
              index < sentences.length - 1 &&
              !(await waitForSentenceTurn(
                sentenceReadingDelay(sentences[index]),
                controller.signal,
              ))
            ) {
              return;
            }
          }
        };

        showSentence(0);
        const completion = await conversation.playAndWait(
          { text: content, audioUrl },
          {
            signal: controller.signal,
            onTimeline: (timeline) => {
              if (
                controller.signal.aborted ||
                sentenceTurnRef.current !== turn
              ) {
                return;
              }
              if (
                timeline.mode === 'audio' &&
                timeline.currentTime !== undefined &&
                timeline.duration !== undefined
              ) {
                showSentence(
                  timeline.phase === 'ended'
                    ? sentences.length - 1
                    : sentenceIndexAtAudioTime(
                        sentences,
                        timeline.currentTime,
                        timeline.duration,
                      ),
                );
                return;
              }
              if (
                timeline.mode === 'speech' &&
                timeline.phase === 'fallback' &&
                !fallbackTimeline
              ) {
                fallbackTimeline = runFallbackTimeline();
              }
            },
          },
        );
        if (completion.completed && completion.mode === 'audio') {
          showSentence(sentences.length - 1);
        }
        if (fallbackTimeline) await fallbackTimeline;
        if (sentenceControllerRef.current === controller) {
          sentenceControllerRef.current = undefined;
        }
        return;
      }

      for (let index = 0; index < sentences.length; index += 1) {
        if (
          controller.signal.aborted ||
          sentenceTurnRef.current !== turn
        ) {
          return;
        }

        const sentence = sentences[index];
        setSentenceBubble({
          id: bubbleId,
          sentences,
          index,
        });

        const completion = await conversation.playAndWait(
          { text: sentence },
          { signal: controller.signal },
        );
        if (
          controller.signal.aborted ||
          sentenceTurnRef.current !== turn
        ) {
          return;
        }

        if (
          !completion.completed &&
          ['stopped', 'replaced', 'aborted', 'unmounted'].includes(
            completion.reason,
          )
        ) {
          return;
        }

        if (index < sentences.length - 1) {
          const delay = completion.completed
            ? 180
            : sentenceReadingDelay(sentence);
          if (!(await waitForSentenceTurn(delay, controller.signal))) return;
        }
      }

      if (sentenceControllerRef.current === controller) {
        sentenceControllerRef.current = undefined;
      }
    },
    [conversation.playAndWait],
  );

  const requestNarratedAnswer = useCallback(
    async (input: Omit<GuideConversationSendInput, 'autoPlay'>) => {
      const turn = beginSentenceTurn();
      conversation.cancel();
      const response = await conversation.send({
        ...input,
        autoPlay: false,
      });
      if (!response || sentenceTurnRef.current !== turn) return;
      await playSentenceAnswer(response.content, response.audioUrl, turn);
    },
    [
      beginSentenceTurn,
      conversation.cancel,
      conversation.send,
      playSentenceAnswer,
    ],
  );

  useEffect(
    () => () => {
      sentenceTurnRef.current += 1;
      sentenceControllerRef.current?.abort();
      sentenceControllerRef.current = undefined;
    },
    [],
  );

  useEffect(() => {
    if (
      !sceneStarted ||
      !spotsReady ||
      !routeSpot ||
      !displayContext
    ) {
      return undefined;
    }
    const narrationKey = `${routeKey}:${routeSpot.spotId}`;
    const timer = window.setTimeout(() => {
      if (lastNarratedKeyRef.current === narrationKey) return;
      lastNarratedKeyRef.current = narrationKey;
      void requestNarratedAnswer({
        question: narrationPrompt(routeSpot),
        spotId: routeSpot.spotId,
        currentSpotName: routeSpot.name,
        routeContext: displayContext,
        fallbackText,
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    displayContext,
    fallbackText,
    requestNarratedAnswer,
    routeKey,
    routeSpot,
    narrationRevision,
    sceneStarted,
    scenicSpot,
    spotsReady,
  ]);

  const selectDisplayIndex = useCallback(
    (nextIndex: number) => {
      if (!sceneContext) return;
      const clamped = Math.min(
        Math.max(nextIndex, 0),
        sceneContext.orderedSpots.length - 1,
      );

      lastNarratedKeyRef.current = '';
      beginSentenceTurn();
      conversation.cancel();
      if (!sceneStarted) {
        setSceneStarted(true);
      }
      setTourNotice('');
      setNarrationRevision((value) => value + 1);
      if (clamped !== displayIndex) {
        setDisplayIndex(clamped);
      }
    },
    [
      beginSentenceTurn,
      conversation.cancel,
      displayIndex,
      sceneContext,
      sceneStarted,
    ],
  );

  const handleManualQuestion = useCallback(
    async (question: string, image?: GuideImageAttachment) => {
      if (!displayContext || !routeSpot) return;
      await requestNarratedAnswer({
        question,
        image,
        routeContext: displayContext,
        currentSpotName: routeSpot.name,
        fallbackText,
      });
    },
    [displayContext, fallbackText, requestNarratedAnswer, routeSpot],
  );

  const completeCurrentTourSpot = useCallback(async () => {
    if (
      !context?.tourId ||
      context.status !== 'tour' ||
      !sceneRoute ||
      displayIndex !== sceneRoute.realCurrentIndex
    ) {
      return;
    }
    const realSpot = context.orderedSpots[context.currentIndex];
    if (!realSpot) return;

    setCompleting(true);
    setTourNotice('');
    try {
      beginSentenceTurn();
      conversation.cancel();
      const tour = await recordTourEvent(
        context.tourId,
        'spot_completed',
        realSpot.spotId,
      );
      const nextContext = buildGuideRouteContextFromTour(tour, context.mapId);
      const nextSceneRoute = projectSceneGuideRoute(nextContext);
      saveGuideRouteContext(nextContext);
      setRouteState({ status: 'ready', context: nextContext });
      setDisplayIndex(nextSceneRoute.defaultDisplayIndex);
      if (tour.status === 'finished') {
        setCompletedTourId(tour.id);
        setTourNotice('本次路线圆满完成，我已经为你整理好这段旅程。');
      } else {
        setTourNotice(`已完成${realSpot.name}，真实行程已前往下一站。`);
      }
    } catch {
      setTourNotice('暂时无法推进真实行程，请检查网络后重试。');
    } finally {
      setCompleting(false);
    }
  }, [
    beginSentenceTurn,
    context,
    conversation.cancel,
    displayIndex,
    sceneRoute,
  ]);

  const retry = useCallback(() => {
    initializedRouteKeyRef.current = '';
    setLoadRevision((value) => value + 1);
  }, []);

  if (routeState.status === 'loading') {
    return <SceneLoading />;
  }

  if (routeState.status !== 'ready' || !context) {
    const unavailableStatus =
      routeState.status === 'ready' ? 'error' : routeState.status;
    return (
      <SceneState
        status={unavailableStatus}
        message={routeState.message}
        onRetry={retry}
      />
    );
  }

  if (!sceneContext || sceneContext.orderedSpots.length === 0) {
    return (
      <SceneState
        status="error"
        message="这条路线只有入口起点，还没有可讲解的真实景点。请返回路线页重新选择景点。"
        onRetry={retry}
      />
    );
  }

  const activeSentence = sentenceBubble
    ? sentenceBubble.sentences[sentenceBubble.index]
    : '';
  const bubbleContent =
    activeSentence ||
    (conversation.pending
      ? ''
      : sceneStarted
        ? '正在准备当前场景的第一句讲解。'
        : '点击上方任一景点，我会立即开始自动讲解。');

  return (
    <main
      ref={scenePageRef}
      className={styles.page}
      data-testid="scene-guide-page"
      data-avatar-runtime-scope
      data-fullscreen={isFullscreen ? 'true' : 'false'}
      aria-label={`${context.routeName}场景式导览`}
    >
      <div className={styles.backgroundStage} aria-hidden="true">
        {backgroundLayers.previous ? (
          <img
            className={`${styles.backgroundImage} ${styles.backgroundPrevious}`}
            src={backgroundLayers.previous}
            alt=""
          />
        ) : null}
        <img
          key={`${routeSpot?.spotId ?? 'fallback'}-${backgroundLayers.current}`}
          className={`${styles.backgroundImage} ${styles.backgroundCurrent}`}
          src={backgroundLayers.current}
          alt=""
          data-testid="scene-guide-background"
          data-spot-id={routeSpot?.spotId}
          onError={() => {
            if (
              routeSpot &&
              backgroundLayers.current !== fallbackSpotImage
            ) {
              setFailedSpotImages((current) => {
                const next = new Set(current);
                next.add(routeSpot.spotId);
                return next;
              });
            }
          }}
        />
      </div>

      <div className={styles.routeDock}>
        <RouteProgressStrip
          context={sceneContext}
          displayIndex={displayIndex}
          realCurrentIndex={sceneRoute?.realCurrentIndex ?? -1}
          disabled={completing}
          completing={completing}
          onSelectSpot={(index) => selectDisplayIndex(index)}
          onPrevious={() => selectDisplayIndex(displayIndex - 1)}
          onNext={() => selectDisplayIndex(displayIndex + 1)}
          onCompleteCurrent={completeCurrentTourSpot}
        />
        <Button
          className={styles.fullscreenButton}
          type="text"
          shape="circle"
          icon={
            isFullscreen ? (
              <FullscreenExitOutlined />
            ) : (
              <FullscreenOutlined />
            )
          }
          aria-label={isFullscreen ? '退出全屏' : '进入全屏'}
          aria-pressed={isFullscreen}
          title={isFullscreen ? '退出全屏（Esc）' : '进入全屏'}
          data-testid="scene-guide-fullscreen-toggle"
          onClick={() => void toggleFullscreen()}
        />
      </div>

      {tourNotice || completedTourId ? (
        <div className={styles.tourNotice} role="status">
          <span>
            {tourNotice ||
              '本次路线已经完成，你仍可以自由预览各个场景。'}
          </span>
          {completedTourId ? (
            <Link
              to={`/tour/${encodeURIComponent(completedTourId)}/recap`}
              data-testid="scene-guide-view-recap"
            >
              <Button
                type="primary"
                size="small"
                icon={<HistoryOutlined />}
              >
                查看本次回顾
              </Button>
            </Link>
          ) : null}
        </div>
      ) : null}

      <aside className={styles.petDock} aria-label="灵诗音场景讲解与互动">
        <section
          className={styles.bubble}
          data-testid="scene-guide-bubble"
          data-sentence-index={sentenceBubble?.index}
          data-sentence-count={sentenceBubble?.sentences.length}
          aria-busy={conversation.pending}
        >
          {conversation.pending && !bubbleContent ? (
            <span className={styles.typing} aria-label="正在生成讲解">
              <span />
              <span />
              <span />
            </span>
          ) : (
            <p
              className={styles.bubbleText}
              data-testid="scene-guide-bubble-text"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <span
                key={`${sentenceBubble?.id ?? 'idle'}-${sentenceBubble?.index ?? 0}`}
                className={styles.bubbleSentence}
              >
                {bubbleContent}
              </span>
            </p>
          )}
          {conversation.latest?.error ? (
            <p className={styles.bubbleError}>
              AI 服务暂时不可用，已显示当前景点的本地介绍。
            </p>
          ) : null}
        </section>

        <div
          className={styles.avatarWrap}
          data-testid="scene-guide-avatar"
          data-layout="large"
        >
          <AvatarGuide
            status={conversation.guideStatus}
            audioState={conversation.audioState}
            emotionCue={
              conversation.latest?.isFallback ? 'fallback' : undefined
            }
            variant="pet"
            presentation="bare"
            fallbackImageUrl="/avatar/ling-shiyin-pet.png"
            showStatus={false}
            showStateBadge={false}
            suppressInitialFallbackImage
            speechText={activeSentence}
            speechNonce={speechNonce}
          />
        </div>

        <div className={styles.composerWrap}>
          <GuideComposer
            variant="compact"
            appearance="scene"
            loading={conversation.pending}
            disabled={!sceneStarted}
            muted={conversation.muted}
            onToggleMuted={conversation.toggleMuted}
            onSend={handleManualQuestion}
            placeholder={
              sceneStarted
                ? `问问灵诗音关于${routeSpot?.name ?? '当前场景'}的问题`
                : '点击上方景点开始讲解'
            }
          />
        </div>
      </aside>
    </main>
  );
}
