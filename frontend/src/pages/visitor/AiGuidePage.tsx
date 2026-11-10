import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { streamChatWithGuide } from '../../api/chat';
import { createRouteDraft } from '../../api/routeDrafts';
import { createTour, getTour } from '../../api/tours';
import { getTtsJobStatus } from '../../api/tts';
import AvatarGuide from '../../components/guide/AvatarGuide';
import type { AvatarAudioState } from '../../components/guide/AvatarGuide';
import ChatBox from '../../components/guide/ChatBox';
import DigitalHumanPersonaControl from '../../components/guide/DigitalHumanPersonaControl';
import GuideFeedbackButton from '../../components/guide/GuideFeedbackButton';
import GuideQuickPrompts from '../../components/guide/GuideQuickPrompts';
import type { GuideQuickPrompt } from '../../components/guide/GuideQuickPrompts';
import GuideRouteDrawer from '../../components/guide/GuideRouteDrawer';
import RouteContextBar from '../../components/guide/RouteContextBar';
import { WELCOME_MESSAGE_AUDIO_URL, WELCOME_MESSAGE_TEXT } from '../../components/guide/welcomeMessage';
import { avatar151Guide } from '../../config/avatar151Guide';
import type { GuideEmotionCue } from '../../config/avatar151Guide';
import { productCopy } from '../../config/product';
import type {
  ChatMessage,
  GuideImageAttachment,
  GuideRouteContext,
  GuideStatus,
  GuideVoiceMessage,
  RoutePreferenceInput,
} from '../../types/scenic';
import {
  buildGuideRouteContextFromDraft,
  buildGuideRouteContextFromRoutePlan,
  buildGuideRouteContextFromTour,
  guidePreferenceFromContext,
} from '../../utils/guideRouteContext';
import {
  formatVisitorPreference,
  preferenceFromSearchParams,
  preferenceToSearchParams,
  saveVisitorPreference,
} from '../../utils/visitorProfile';
import {
  loadGuideChatSession,
  loadGuideRouteDrawerOpen,
  loadGuideRouteContext,
  loadRouteMapSession,
  loadRouteRecommendationSession,
  saveGuideRouteDrawerOpen,
  saveRouteEntrySession,
  saveGuideChatSession,
  saveGuideRouteContext,
  saveRouteMapSession,
  saveRouteRecommendationSession,
} from '../../utils/visitorSessionState';

const INITIAL_MESSAGE_DELAY_MS = 100;

type UserMessagePatch = Partial<Omit<ChatMessage, 'id' | 'role' | 'createdAt'>>;

function createMessageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sourceDelay() {
  return 1_000 + Math.random() * 2_000;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function audioStateFromTtsStatus(status?: ChatMessage['ttsStatus']): AvatarAudioState {
  if (status === 'pending') return 'pending';
  if (status === 'failed') return 'failed';
  if (status === 'ready' || status === 'disabled') return 'ready';
  return 'idle';
}

function audioStateFromMessages(messages?: ChatMessage[]): AvatarAudioState {
  if (!messages?.length) return 'idle';
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'assistant') return audioStateFromTtsStatus(message.ttsStatus);
  }
  return 'idle';
}

function loadInitialRouteContext(preference: RoutePreferenceInput): GuideRouteContext | undefined {
  const storedContext = loadGuideRouteContext();
  if (storedContext) return storedContext;

  const recommendationSession = loadRouteRecommendationSession();
  if (!recommendationSession?.routes.length) return undefined;

  const mapSession = loadRouteMapSession();
  const route =
    recommendationSession.routes.find((item) => item.id === mapSession?.activeRouteId) ??
    recommendationSession.routes.find((item) => item.mapId === preference.mapId) ??
    recommendationSession.routes[0];
  return buildGuideRouteContextFromRoutePlan(
    route,
    recommendationSession.preference ?? preference,
    mapSession?.activeSpotId,
  );
}

export default function AiGuidePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const profileKey = searchParams.toString();
  const openRouteParam = searchParams.get('openRoute');
  const preference = useMemo(() => preferenceFromSearchParams(searchParams), [profileKey]);
  const [initialRouteContext] = useState(() => loadInitialRouteContext(preference));
  const [routeContext, setRouteContext] = useState<GuideRouteContext | undefined>(initialRouteContext);
  const activeRouteContext = routeContext?.status === 'expired' ? undefined : routeContext;
  const routeAwarePreference = useMemo(
    () => (activeRouteContext ? guidePreferenceFromContext(activeRouteContext) : preference),
    [activeRouteContext, preference],
  );
  const preferenceText = useMemo(() => formatVisitorPreference(routeAwarePreference), [routeAwarePreference]);
  const [initialGuideSession] = useState(() => loadGuideChatSession());
  const [messages, setMessages] = useState<ChatMessage[]>(() => initialGuideSession?.messages ?? []);
  const [status, setStatus] = useState<GuideStatus>('idle');
  const [audioState, setAudioState] = useState<AvatarAudioState>(() =>
    audioStateFromMessages(initialGuideSession?.messages),
  );
  const [emotionCue, setEmotionCue] = useState<GuideEmotionCue>('idle');
  const [avatarSpeechText, setAvatarSpeechText] = useState('');
  const [avatarSpeechNonce, setAvatarSpeechNonce] = useState(0);
  const [loading, setLoading] = useState(() => !initialGuideSession?.introReady);
  const [chatError, setChatError] = useState('');
  const [sessionId, setSessionId] = useState(() => initialGuideSession?.sessionId ?? `guide-session-${Date.now()}`);
  const [introReady, setIntroReady] = useState(() => Boolean(initialGuideSession?.introReady));
  const [routeDrawerOpen, setRouteDrawerOpen] = useState(
    () => openRouteParam === '1' || loadGuideRouteDrawerOpen(),
  );
  const handledInitialQuestionKeyRef = useRef(initialGuideSession?.handledInitialQuestionKey);
  const voiceAudioUrlsRef = useRef<Set<string>>(new Set());

  const spotId = searchParams.get('spotId') ?? undefined;
  const spotName = searchParams.get('spotName') ?? undefined;
  const initialQuestion = searchParams.get('question') ?? undefined;
  const initialQuestionKey = useMemo(
    () => (initialQuestion ? `${profileKey}|${spotId ?? ''}|${spotName ?? ''}|${initialQuestion}` : ''),
    [initialQuestion, profileKey, spotId, spotName],
  );

  useLayoutEffect(() => {
    document.body.classList.add('guide-workbench-active');
    return () => {
      document.body.classList.remove('guide-workbench-active');
    };
  }, []);

  useEffect(() => {
    saveVisitorPreference(preference);
  }, [preference]);

  const updateRouteContext = useCallback((nextContext: GuideRouteContext) => {
    setRouteContext(nextContext);
    saveGuideRouteContext(nextContext);
  }, []);

  const updateRouteDrawerOpen = useCallback((open: boolean) => {
    setRouteDrawerOpen(open);
    saveGuideRouteDrawerOpen(open);
  }, []);

  useEffect(() => {
    if (openRouteParam !== '1') return;
    const [navigation] = window.performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    if (navigation?.type !== 'reload') {
      updateRouteDrawerOpen(true);
    }
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('openRoute');
    setSearchParams(nextParams, { replace: true });
  }, [openRouteParam, searchParams, setSearchParams, updateRouteDrawerOpen]);

  useEffect(() => {
    if (!routeContext?.tourId || routeContext.status !== 'tour') return undefined;
    if (routeContext.orderedSpots.length > 0) return undefined;
    let active = true;
    getTour(routeContext.tourId)
      .then((tour) => {
        if (!active) return;
        updateRouteContext(buildGuideRouteContextFromTour(tour, routeContext.mapId));
      })
      .catch(() => {
        if (!active) return;
        updateRouteContext({
          ...routeContext,
          status: 'expired',
        });
      });
    return () => {
      active = false;
    };
  }, [routeContext?.tourId, updateRouteContext]);

  const quickPrompts = useMemo<GuideQuickPrompt[]>(
    () => {
      if (activeRouteContext?.currentSpot) {
        return [
          {
            id: 'current-spot',
            category: '当前站',
            question: '讲解当前景点',
          },
          {
            id: 'current-photo',
            category: '拍照点',
            question: '当前景点哪里适合拍照？',
          },
          {
            id: 'next-fun',
            category: '下一站',
            question: '下一站有什么好玩的吗？',
          },
        ];
      }
      return [
        {
          id: 'ling-shan-intro',
          category: '景区介绍',
          question: '帮我介绍一下灵山胜境景区。',
        },
        {
          id: 'nianhua-intro',
          category: '景区介绍',
          question: '帮我介绍一下拈花湾景区。',
        },
        {
          id: 'photo-route',
          category: '路线规划',
          question: '我想去灵山胜境，我喜欢拍照，打算走三个小时，帮我生成一条路线。',
        },
        {
          id: 'family-nianhua',
          category: '亲子游玩',
          question: '带小孩适合去拈花湾哪里玩呢？',
        },
      ];
    },
    [activeRouteContext],
  );

  useEffect(() => {
    if (introReady || messages.length > 0) {
      setLoading(false);
      if (!introReady) setIntroReady(true);
      return undefined;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      const typingId = createMessageId('assistant-typing');
      setMessages([{ id: typingId, role: 'assistant', content: '', createdAt: Date.now() }]);
      void wait(sourceDelay()).then(() => {
        if (cancelled) return;
        setMessages([
          {
            id: 'assistant-welcome',
            role: 'assistant',
            content: WELCOME_MESSAGE_TEXT,
            audioUrl: WELCOME_MESSAGE_AUDIO_URL,
            ttsStatus: 'ready',
            createdAt: Date.now(),
          },
        ]);
        setAudioState('ready');
        setLoading(false);
        setIntroReady(true);
      });
    }, INITIAL_MESSAGE_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    saveGuideChatSession({
      messages,
      sessionId,
      introReady,
      handledInitialQuestionKey: handledInitialQuestionKeyRef.current,
    });
  }, [introReady, messages, sessionId]);

  useEffect(
    () => () => {
      voiceAudioUrlsRef.current.forEach((audioUrl) => URL.revokeObjectURL(audioUrl));
      voiceAudioUrlsRef.current.clear();
    },
    [],
  );

  const sendQuestion = async (question: string, userMessagePatch?: UserMessagePatch) => {
    setChatError('');
    setStatus('thinking');
    setAudioState('idle');
    setEmotionCue('thinking');
    setAvatarSpeechText('');
    setLoading(true);

    const userMessage: ChatMessage = {
      id: createMessageId('user'),
      role: 'user',
      content: question,
      createdAt: Date.now(),
      ...userMessagePatch,
    };
    const typingMessageId = createMessageId('assistant-typing');
    let streamedAnswer = '';
    setMessages((current) => [
      ...current,
      userMessage,
      { id: typingMessageId, role: 'assistant', content: '', createdAt: Date.now() },
    ]);

    const response = await streamChatWithGuide({
      question,
      sessionId,
      preference: preferenceText,
      routePreference: routeAwarePreference,
      routeContext: activeRouteContext,
      spotId: activeRouteContext ? undefined : spotId,
      currentSpotName: activeRouteContext?.currentSpot?.name ?? spotName,
      image: userMessagePatch?.image,
    }, {
      onDelta: (text) => {
        if (!text) return;
        streamedAnswer += text;
        setStatus('idle');
        setEmotionCue('idle');
        setAvatarSpeechText('');
        setMessages((current) =>
          current.map((message) =>
            message.id === typingMessageId ? { ...message, content: streamedAnswer } : message,
          ),
        );
      },
    });
    if (response.sessionId) setSessionId(response.sessionId);

    if (response.isFallback) {
      setChatError('AI 服务暂时不可用，已为你保留基础游览建议。');
      setEmotionCue('fallback');
    } else if (response.sources.length > 0 && response.ttsStatus !== 'pending') {
      setEmotionCue('success');
    } else {
      setEmotionCue('idle');
    }
    setAudioState(audioStateFromTtsStatus(response.ttsStatus));

    const assistantMessage: ChatMessage = {
      id: createMessageId('assistant'),
      role: 'assistant',
      content: response.answer || streamedAnswer,
      sources: response.sources,
      audioUrl: response.audioUrl,
      ttsJobId: response.ttsJobId,
      ttsStatus: response.ttsStatus,
      isFallback: response.isFallback,
      metrics: response.metrics,
      guideAction: response.guideAction,
      routePlan: response.guideAction?.type === 'route_recommendation' ? response.guideAction.route : undefined,
      routePreference:
        response.guideAction?.type === 'route_recommendation'
          ? response.guideAction.preference ?? routeAwarePreference
          : routeAwarePreference,
      emotionCue: response.emotionCue,
      createdAt: Date.now(),
    };
    setAvatarSpeechText(assistantMessage.content);

    if (assistantMessage.routePlan) {
      updateRouteContext(
        buildGuideRouteContextFromRoutePlan(
          assistantMessage.routePlan,
          assistantMessage.routePreference ?? routeAwarePreference,
        ),
      );
    }

    setMessages((current) =>
      current.map((message) => (message.id === typingMessageId ? assistantMessage : message)),
    );
    setStatus('idle');
    setLoading(false);
    window.setTimeout(() => {
      setEmotionCue((current) => (current === 'success' || current === 'fallback' ? 'idle' : current));
    }, 2400);

    if (response.ttsJobId && response.ttsStatus === 'pending') {
      setAudioState('pending');
      void pollTtsJob(response.ttsJobId, assistantMessage.id);
    }
  };

  const sendVoiceQuestion = (voice: GuideVoiceMessage) => {
    const question = voice.transcript.trim();
    if (!question) {
      URL.revokeObjectURL(voice.audioUrl);
      setChatError('没有识别到清晰语音，请再说一次或改用文字输入。');
      return;
    }
    voiceAudioUrlsRef.current.add(voice.audioUrl);
    void sendQuestion(question, {
      inputMode: 'voice',
      voice,
      content: question,
    });
  };

  const sendImageQuestion = (question: string, image: GuideImageAttachment) => {
    void sendQuestion(question, {
      inputMode: 'image',
      image,
      content: question,
    });
  };

  useEffect(() => {
    if (!initialQuestion || !introReady || !initialQuestionKey) return;
    if (handledInitialQuestionKeyRef.current === initialQuestionKey) return;
    handledInitialQuestionKeyRef.current = initialQuestionKey;
    void sendQuestion(initialQuestion);
  }, [initialQuestion, initialQuestionKey, introReady]);

  const pollTtsJob = async (jobId: string, messageId: string) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await wait(1200);
      const ttsStatus = await getTtsJobStatus(jobId);
      if (ttsStatus.status === 'pending') {
        setAudioState('pending');
        continue;
      }
      setAudioState(audioStateFromTtsStatus(ttsStatus.status));
      if (ttsStatus.status === 'failed') setEmotionCue('fallback');
      if (ttsStatus.status === 'ready') setEmotionCue('idle');
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId ? { ...message, audioUrl: ttsStatus.audioUrl, ttsStatus: ttsStatus.status } : message,
        ),
      );
      return;
    }
  };

  const sendPresetQuestion = (question: string) => {
    if (!loading && introReady) void sendQuestion(question);
  };

  const viewRouteOnMap = (message: ChatMessage) => {
    const routePreference = message.routePreference ?? routeAwarePreference;
    const nextPreference = {
      ...routePreference,
      mapId: message.routePlan?.mapId ?? routePreference.mapId,
    };
    if (message.routePlan) {
      saveRouteRecommendationSession({
        preference: nextPreference,
        routes: [message.routePlan],
      });
      saveRouteMapSession({
        activeMapId: message.routePlan.mapId,
        activeRouteId: message.routePlan.id,
        activeSpotId: message.routePlan.spots[0]?.spotId,
      });
      updateRouteContext(buildGuideRouteContextFromRoutePlan(message.routePlan, nextPreference));
    }
    const params = preferenceToSearchParams(nextPreference);
    const path = `/routes?${params.toString()}`;
    saveRouteEntrySession({
      mode: 'recommendation',
      path,
      skipHydraLoader: true,
    });
    navigate(path, { state: { skipHydraLoader: true } });
  };

  const editRouteFromMessage = async (message: ChatMessage) => {
    if (!message.routePlan) return;
    setChatError('');
    try {
      const routePreference = message.routePreference ?? routeAwarePreference;
      const draft = await createRouteDraft(message.routePlan, {
        ...routePreference,
        mapId: message.routePlan.mapId,
      });
      updateRouteContext(buildGuideRouteContextFromDraft(draft, message.routePlan.mapId));
      saveRouteEntrySession({
        mode: 'draft',
        path: `/route-drafts/${draft.id}`,
      });
      navigate(`/route-drafts/${draft.id}`);
    } catch {
      setChatError('路线草稿创建失败，请稍后重试。');
      setEmotionCue('fallback');
    }
  };

  const startTourFromMessage = async (message: ChatMessage) => {
    if (!message.routePlan) return;
    setChatError('');
    try {
      const routePreference = message.routePreference ?? routeAwarePreference;
      const draft = await createRouteDraft(message.routePlan, {
        ...routePreference,
        mapId: message.routePlan.mapId,
      });
      const tour = await createTour(draft.id, message.routePlan.mapId);
      updateRouteContext(buildGuideRouteContextFromTour(tour, message.routePlan.mapId));
      saveRouteEntrySession({
        mode: 'recommendation',
        path: '/routes',
        skipHydraLoader: true,
      });
      updateRouteDrawerOpen(true);
    } catch {
      setChatError('开始游览失败，请稍后重试。');
      setEmotionCue('fallback');
    }
  };

  return (
    <>
      <div className="ai-guide-page ai-guide-page--chat">
      <div className="ai-guide-workbench" data-testid="ai-guide-workbench">
        <aside className="ai-guide-workbench__avatar luxury-avatar-stage" aria-label="灵诗音 AI 数字人导游">
          <AvatarGuide
            status={status}
            variant="stage"
            presentation="bare"
            showStatus={false}
            showStateBadge
            audioState={audioState}
            emotionCue={emotionCue}
            stageMode="guide"
            speechText={avatarSpeechText}
            speechNonce={avatarSpeechNonce}
          />
        </aside>

        <ChatBox
          messages={messages}
          loading={loading}
          error={chatError}
          enableSpeechInput
          assistant={{
            name: productCopy.guideName,
            subtitle: '在线智能导览',
            avatarSrc: avatar151Guide.chatAvatarUrl,
            avatarAlt: '灵诗音导游头像',
          }}
          headerControl={<DigitalHumanPersonaControl disabled={!introReady} />}
          onSend={(question) => void sendQuestion(question)}
          onSendVoice={sendVoiceQuestion}
          onSendImage={sendImageQuestion}
          onSpeakStart={(message) => {
            setStatus('speaking');
            setAudioState('playing');
            setEmotionCue('speaking');
            setAvatarSpeechText(message.content);
            setAvatarSpeechNonce((current) => current + 1);
          }}
          onSpeakEnd={() => {
            setStatus('idle');
            setAudioState('ready');
            setEmotionCue('idle');
          }}
          onSpeakError={(message) => {
            setStatus('idle');
            setAudioState('failed');
            setEmotionCue('fallback');
            console.warn('[AiGuidePage] audio playback failed:', message);
          }}
          onViewRoute={viewRouteOnMap}
          onEditRoute={(message) => void editRouteFromMessage(message)}
          onStartTour={(message) => void startTourFromMessage(message)}
        />

        <GuideQuickPrompts
          prompts={quickPrompts}
          disabled={loading || !introReady}
          onSelect={sendPresetQuestion}
        />
      </div>
      </div>
      <RouteContextBar
        context={routeContext}
        disabled={!introReady}
        placement="panel"
        routeOpen={routeDrawerOpen}
        onGenerateRoute={() => navigate('/routes')}
        onOpenRoute={() => updateRouteDrawerOpen(!routeDrawerOpen)}
        onReturnToDraft={
          routeContext?.status === 'draft' && routeContext.draftId
            ? () => navigate(`/route-drafts/${routeContext.draftId}`)
            : undefined
        }
      />

      <GuideRouteDrawer
        context={routeContext}
        open={routeDrawerOpen}
        disabled={loading || !introReady}
        onClose={() => updateRouteDrawerOpen(false)}
        onContextChange={updateRouteContext}
      />
      <GuideFeedbackButton />
    </>
  );
}
