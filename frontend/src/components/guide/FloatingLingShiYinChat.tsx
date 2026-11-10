import { CommentOutlined } from '@ant-design/icons';
import { Button, Modal } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { streamChatWithGuide } from '../../api/chat';
import { toApiError } from '../../api/client';
import { getCachedSpotDetail } from '../../api/spots';
import { getTtsJobStatus } from '../../api/tts';
import { avatar151Guide } from '../../config/avatar151Guide';
import type {
  ChatMessage,
  GuideImageAttachment,
  GuideRouteContext,
  GuideVoiceMessage,
  RoutePreferenceInput,
} from '../../types/scenic';
import {
  buildGuideRouteContextFromRoutePlan,
  guidePreferenceFromContext,
} from '../../utils/guideRouteContext';
import {
  formatVisitorPreference,
  loadVisitorPreference,
} from '../../utils/visitorProfile';
import {
  loadGuideChatSession,
  loadGuideRouteContext,
  loadRouteMapSession,
  loadRouteRecommendationSession,
  saveGuideChatSession,
} from '../../utils/visitorSessionState';
import ChatBox from './ChatBox';
import { WELCOME_MESSAGE_AUDIO_URL, WELCOME_MESSAGE_TEXT } from './welcomeMessage';

const INITIAL_MESSAGE_DELAY_MS = 100;
const FLOATING_GUIDE_NAME = '灵诗音';

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

function getSpotIdFromPath(pathname: string) {
  const match = /^\/spots\/([^/]+)$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

export default function FloatingLingShiYinChat() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [initialGuideSession] = useState(() => loadGuideChatSession());
  const [messages, setMessages] = useState<ChatMessage[]>(() => initialGuideSession?.messages ?? []);
  const [loading, setLoading] = useState(false);
  const [chatError, setChatError] = useState('');
  const [sessionId, setSessionId] = useState(() => initialGuideSession?.sessionId ?? `guide-session-${Date.now()}`);
  const [introReady, setIntroReady] = useState(() => Boolean(initialGuideSession?.introReady));
  const [initialPreference] = useState(() => loadVisitorPreference());
  const voiceAudioUrlsRef = useRef<Set<string>>(new Set());

  const routeContext = useMemo(
    () => loadInitialRouteContext(initialPreference),
    [initialPreference, location.pathname, open],
  );
  const activeRouteContext = routeContext?.status === 'expired' ? undefined : routeContext;
  const routeAwarePreference = useMemo(
    () => (activeRouteContext ? guidePreferenceFromContext(activeRouteContext) : initialPreference),
    [activeRouteContext, initialPreference],
  );
  const preferenceText = useMemo(() => formatVisitorPreference(routeAwarePreference), [routeAwarePreference]);
  const spotId = getSpotIdFromPath(location.pathname);
  const spotName = spotId ? getCachedSpotDetail(spotId)?.name : undefined;

  useEffect(() => {
    saveGuideChatSession({
      messages,
      sessionId,
      introReady,
      handledInitialQuestionKey: initialGuideSession?.handledInitialQuestionKey,
    });
  }, [initialGuideSession?.handledInitialQuestionKey, introReady, messages, sessionId]);

  useEffect(
    () => () => {
      voiceAudioUrlsRef.current.forEach((audioUrl) => URL.revokeObjectURL(audioUrl));
      voiceAudioUrlsRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    if (!open || introReady || messages.length > 0) return undefined;

    let cancelled = false;
    setLoading(true);
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
        setLoading(false);
        setIntroReady(true);
      });
    }, INITIAL_MESSAGE_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [introReady, messages.length, open]);

  const pollTtsJob = async (jobId: string, messageId: string) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await wait(1200);
      try {
        const ttsStatus = await getTtsJobStatus(jobId);
        if (ttsStatus.status === 'pending') continue;
        setMessages((current) =>
          current.map((message) =>
            message.id === messageId ? { ...message, audioUrl: ttsStatus.audioUrl, ttsStatus: ttsStatus.status } : message,
          ),
        );
        return;
      } catch {
        setMessages((current) =>
          current.map((message) => (message.id === messageId ? { ...message, ttsStatus: 'failed' } : message)),
        );
        return;
      }
    }
  };

  const sendQuestion = async (question: string, userMessagePatch?: UserMessagePatch) => {
    setChatError('');
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

    try {
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
      }

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

      setMessages((current) =>
        current.map((message) => (message.id === typingMessageId ? assistantMessage : message)),
      );
      if (response.ttsJobId && response.ttsStatus === 'pending') {
        void pollTtsJob(response.ttsJobId, assistantMessage.id);
      }
    } catch (error) {
      const message = toApiError(error).message;
      setChatError(message);
      setMessages((current) =>
        current.map((item) =>
          item.id === typingMessageId
            ? {
                id: createMessageId('assistant-error'),
                role: 'assistant',
                content: message,
                isFallback: true,
                createdAt: Date.now(),
              }
            : item,
        ),
      );
    } finally {
      setLoading(false);
      setIntroReady(true);
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

  return (
    <>
      <Button
        className="ling-shiyin-chat-fab"
        type="primary"
        icon={<CommentOutlined />}
        onClick={() => setOpen(true)}
      >
        {FLOATING_GUIDE_NAME}
      </Button>
      <Modal
        className="ling-shiyin-chat-modal"
        open={open}
        width={400}
        zIndex={1300}
        title={null}
        footer={null}
        closable={false}
        maskClosable
        styles={{ mask: { backgroundColor: 'transparent' } }}
        destroyOnClose={false}
        onCancel={() => setOpen(false)}
      >
        <ChatBox
          messages={messages}
          loading={loading}
          error={chatError}
          enableSpeechInput
          showRouteActions={false}
          assistant={{
            name: FLOATING_GUIDE_NAME,
            subtitle: '在线智能导览',
            avatarSrc: avatar151Guide.chatAvatarUrl,
            avatarAlt: '灵诗音导游头像',
          }}
          onSend={(question) => void sendQuestion(question)}
          onSendVoice={sendVoiceQuestion}
          onSendImage={sendImageQuestion}
          onSpeakError={(message) => {
            setChatError(message);
          }}
        />
      </Modal>
    </>
  );
}
