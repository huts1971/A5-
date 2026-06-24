import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { streamChatWithGuide } from '../../api/chat';
import { getTtsJobStatus } from '../../api/tts';
import AvatarGuide from '../../components/guide/AvatarGuide';
import type { AvatarAudioState } from '../../components/guide/AvatarGuide';
import ChatBox from '../../components/guide/ChatBox';
import GuideQuickPrompts from '../../components/guide/GuideQuickPrompts';
import type { GuideQuickPrompt } from '../../components/guide/GuideQuickPrompts';
import { WELCOME_MESSAGE_AUDIO_URL, WELCOME_MESSAGE_TEXT } from '../../components/guide/welcomeMessage';
import type { GuideEmotionCue } from '../../config/live2dGuide';
import { productCopy } from '../../config/product';
import type { ChatMessage, GuideStatus } from '../../types/scenic';
import {
  buildPreferenceGuideQuestion,
  formatVisitorPreference,
  preferenceFromSearchParams,
  saveVisitorPreference,
} from '../../utils/visitorProfile';

const INITIAL_MESSAGE_DELAY_MS = 100;

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

export default function AiGuidePage() {
  const [searchParams] = useSearchParams();
  const profileKey = searchParams.toString();
  const preference = useMemo(() => preferenceFromSearchParams(searchParams), [profileKey]);
  const preferenceText = useMemo(() => formatVisitorPreference(preference), [preference]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<GuideStatus>('idle');
  const [audioState, setAudioState] = useState<AvatarAudioState>('idle');
  const [emotionCue, setEmotionCue] = useState<GuideEmotionCue>('idle');
  const [loading, setLoading] = useState(true);
  const [chatError, setChatError] = useState('');
  const [sessionId, setSessionId] = useState(() => `guide-session-${Date.now()}`);
  const [introReady, setIntroReady] = useState(false);
  const autoAskedRef = useRef(false);

  const spotId = searchParams.get('spotId') ?? undefined;
  const spotName = searchParams.get('spotName') ?? undefined;
  const initialQuestion = searchParams.get('question') ?? undefined;

  useEffect(() => {
    saveVisitorPreference(preference);
  }, [preference]);

  const quickPrompts = useMemo<GuideQuickPrompt[]>(
    () => [
      {
        id: 'spot',
        category: '景点讲解',
        question: spotName ? `请介绍一下${spotName}的主要看点。` : '灵山大佛有什么看点？',
      },
      {
        id: 'route',
        category: '路线规划',
        question: buildPreferenceGuideQuestion(preference),
      },
      {
        id: 'service',
        category: '服务信息',
        question: '带老人来需要注意什么？',
      },
    ],
    [spotName, preference],
  );

  useEffect(() => {
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

  const sendQuestion = async (question: string) => {
    setChatError('');
    setStatus('thinking');
    setAudioState('idle');
    setEmotionCue('thinking');
    setLoading(true);

    const userMessage: ChatMessage = {
      id: createMessageId('user'),
      role: 'user',
      content: question,
      createdAt: Date.now(),
    };
    const typingMessageId = createMessageId('assistant-typing');
    const responsePromise = streamChatWithGuide({
      question,
      sessionId,
      preference: preferenceText,
      spotId,
      currentSpotName: spotName ?? '灵山大佛',
    });

    setMessages((current) => [...current, userMessage]);
    await wait(sourceDelay());
    setMessages((current) => [
      ...current,
      { id: typingMessageId, role: 'assistant', content: '', createdAt: Date.now() },
    ]);

    const [response] = await Promise.all([responsePromise, wait(sourceDelay())]);
    if (response.sessionId) setSessionId(response.sessionId);

    if (response.isFallback) {
      setChatError('AI 服务暂时不可用，已为你保留基础游览建议。');
      setEmotionCue('fallback');
    } else if (response.sources.length > 0) {
      setEmotionCue('success');
    } else {
      setEmotionCue('idle');
    }
    setAudioState(audioStateFromTtsStatus(response.ttsStatus));

    const assistantMessage: ChatMessage = {
      id: createMessageId('assistant'),
      role: 'assistant',
      content: response.answer,
      sources: response.sources,
      audioUrl: response.audioUrl,
      ttsJobId: response.ttsJobId,
      ttsStatus: response.ttsStatus,
      isFallback: response.isFallback,
      metrics: response.metrics,
      createdAt: Date.now(),
    };

    setMessages((current) =>
      current.map((message) => (message.id === typingMessageId ? assistantMessage : message)),
    );
    setStatus('idle');
    setLoading(false);
    window.setTimeout(() => {
      setEmotionCue((current) => (current === 'success' || current === 'fallback' ? 'idle' : current));
    }, 1300);

    if (response.ttsJobId && response.ttsStatus === 'pending') {
      setAudioState('pending');
      void pollTtsJob(response.ttsJobId, assistantMessage.id);
    }
  };

  useEffect(() => {
    if (!initialQuestion || !introReady || autoAskedRef.current) return;
    autoAskedRef.current = true;
    void sendQuestion(initialQuestion);
  }, [initialQuestion, introReady]);

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
      if (ttsStatus.status === 'ready') setEmotionCue('success');
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

  return (
    <div className="ai-guide-page ai-guide-page--chat">
      <div className="ai-guide-workbench" data-testid="ai-guide-workbench">
        <aside className="ai-guide-workbench__avatar luxury-avatar-stage" aria-label="AI 数字人导游">
          <AvatarGuide
            status={status}
            variant="stage"
            presentation="bare"
            showStatus={false}
            audioState={audioState}
            emotionCue={emotionCue}
            stageMode="guide"
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
            avatarSrc: '/avatar/haru-chat-avatar.jpeg',
            avatarAlt: '灵山胜境 AI 导游头像',
          }}
          onSend={(question) => void sendQuestion(question)}
          onSpeakStart={() => {
            setStatus('speaking');
            setAudioState('playing');
            setEmotionCue('speaking');
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
        />

        <GuideQuickPrompts prompts={quickPrompts} disabled={loading || !introReady} onSelect={sendPresetQuestion} />
      </div>
    </div>
  );
}
