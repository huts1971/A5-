import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { interruptAvatar } from '../../api/avatar';
import {
  createAvatarSpeechStream,
  type AvatarSpeechStream,
} from '../../api/avatarSpeechStream';
import {
  startAvatarMicrophone,
  stopAvatarMicrophone,
} from '../../api/avatarConnection';
import { streamChatWithGuide } from '../../api/chat';
import ChatBox from '../../components/guide/ChatBox';
import GuideQuickPrompts from '../../components/guide/GuideQuickPrompts';
import type { GuideQuickPrompt } from '../../components/guide/GuideQuickPrompts';
import LiteAvatarStage from '../../components/guide/LiteAvatarStage';
import type {
  ActiveAvatarSession,
  AvatarDisplayStatus,
} from '../../components/guide/LiteAvatarStage';
import { WELCOME_MESSAGE_TEXT } from '../../components/guide/welcomeMessage';
import { productCopy } from '../../config/product';
import type { ChatMessage } from '../../types/scenic';
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

export default function AiGuidePage() {
  const [searchParams] = useSearchParams();
  const profileKey = searchParams.toString();
  const preference = useMemo(() => preferenceFromSearchParams(searchParams), [profileKey]);
  const preferenceText = useMemo(() => formatVisitorPreference(preference), [preference]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [chatError, setChatError] = useState('');
  const [sessionId, setSessionId] = useState(() => `guide-session-${Date.now()}`);
  const [introReady, setIntroReady] = useState(false);
  const [avatarStatus, setAvatarStatus] = useState<AvatarDisplayStatus>('ready');
  const autoAskedRef = useRef(false);
  const avatarSessionRef = useRef<ActiveAvatarSession | null>(null);
  const activeSpeechStreamRef = useRef<AvatarSpeechStream | null>(null);
  const requestGenerationRef = useRef(0);
  const playbackActiveRef = useRef(false);
  const microphoneRef = useRef<MediaStream | null>(null);
  const recognitionTimeoutRef = useRef<number | null>(null);

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
    const timer = window.setTimeout(() => {
      setMessages([
        {
          id: 'assistant-welcome',
          role: 'assistant',
          content: WELCOME_MESSAGE_TEXT,
          createdAt: Date.now(),
        },
      ]);
      setLoading(false);
      setIntroReady(true);
    }, INITIAL_MESSAGE_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(
    () => () => {
      requestGenerationRef.current += 1;
      void activeSpeechStreamRef.current?.cancel();
      activeSpeechStreamRef.current = null;
      if (recognitionTimeoutRef.current !== null) {
        window.clearTimeout(recognitionTimeoutRef.current);
      }
      microphoneRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  const sendQuestion = async (question: string) => {
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion) {
      setAvatarStatus('ready');
      setChatError('没有识别到语音，请再试一次。');
      return;
    }
    const requestGeneration = ++requestGenerationRef.current;
    const previousSpeechStream = activeSpeechStreamRef.current;
    activeSpeechStreamRef.current = null;
    const cancelPrevious = previousSpeechStream?.cancel();
    const activeAvatar = avatarSessionRef.current;
    const interruptPrevious = activeAvatar
      ? interruptAvatar(activeAvatar.sessionId).catch(() => false)
      : undefined;
    await Promise.all([cancelPrevious, interruptPrevious]);
    if (requestGeneration !== requestGenerationRef.current) return;
    setChatError('');
    setAvatarStatus('thinking');
    setLoading(true);

    const userMessage: ChatMessage = {
      id: createMessageId('user'),
      role: 'user',
      content: normalizedQuestion,
      createdAt: Date.now(),
    };
    const typingMessageId = createMessageId('assistant-typing');
    setMessages((current) => [
      ...current,
      userMessage,
      { id: typingMessageId, role: 'assistant', content: '', createdAt: Date.now() },
    ]);
    const speechStream = avatarSessionRef.current
      ? createAvatarSpeechStream({
          sessionId: avatarSessionRef.current.sessionId,
          streamId: typingMessageId,
        })
      : undefined;
    activeSpeechStreamRef.current = speechStream ?? null;
    let streamedAnswer = '';
    const response = await streamChatWithGuide(
      {
        question: normalizedQuestion,
        sessionId,
        preference: preferenceText,
        spotId,
        currentSpotName: spotName ?? '灵山大佛',
      },
      {
        onDelta: (delta) => {
          if (requestGeneration !== requestGenerationRef.current) return;
          streamedAnswer += delta;
          speechStream?.write(delta);
          setMessages((current) =>
            current.map((message) =>
              message.id === typingMessageId
                ? { ...message, content: streamedAnswer }
                : message,
            ),
          );
        },
      },
    );
    if (requestGeneration !== requestGenerationRef.current) {
      await speechStream?.cancel();
      return;
    }
    if (!streamedAnswer && response.answer) {
      speechStream?.write(response.answer);
    }
    await speechStream?.close();
    if (requestGeneration !== requestGenerationRef.current) return;
    if (activeSpeechStreamRef.current === speechStream) {
      activeSpeechStreamRef.current = null;
    }
    if (response.sessionId) setSessionId(response.sessionId);

    if (response.isFallback) {
      setChatError('AI 服务暂时不可用，已为你保留基础游览建议。');
    }

    const assistantMessage: ChatMessage = {
      id: createMessageId('assistant'),
      role: 'assistant',
      content: response.answer,
      sources: response.sources,
      isFallback: response.isFallback,
      metrics: response.metrics,
      createdAt: Date.now(),
    };

    setMessages((current) =>
      current.map((message) => (message.id === typingMessageId ? assistantMessage : message)),
    );
    if (!playbackActiveRef.current) setAvatarStatus('ready');
    setLoading(false);
  };

  useEffect(() => {
    if (!initialQuestion || !introReady || autoAskedRef.current) return;
    autoAskedRef.current = true;
    void sendQuestion(initialQuestion);
  }, [initialQuestion, introReady]);

  const sendPresetQuestion = (question: string) => {
    if (!loading && introReady) void sendQuestion(question);
  };

  const startVoiceInput = async () => {
    const activeSession = avatarSessionRef.current;
    if (!activeSession) {
      throw new Error('avatar_not_connected');
    }
    setChatError('');
    microphoneRef.current = await startAvatarMicrophone(activeSession.connection);
    setAvatarStatus('listening');
  };

  const stopVoiceInput = async () => {
    const activeSession = avatarSessionRef.current;
    const microphone = microphoneRef.current;
    if (!activeSession || !microphone) {
      throw new Error('avatar_microphone_not_started');
    }
    microphoneRef.current = null;
    await stopAvatarMicrophone(activeSession.connection, microphone);
    setAvatarStatus('recognizing');
    recognitionTimeoutRef.current = window.setTimeout(() => {
      recognitionTimeoutRef.current = null;
      setAvatarStatus('ready');
      setChatError('没有识别到语音，请再试一次。');
    }, 8_000);
  };

  return (
    <div className="ai-guide-page ai-guide-page--chat">
      <div className="ai-guide-workbench" data-testid="ai-guide-workbench">
        <aside className="ai-guide-workbench__avatar luxury-avatar-stage" aria-label="AI 数字人导游">
          <LiteAvatarStage
            status={avatarStatus}
            onSessionChange={(session) => {
              avatarSessionRef.current = session;
              if (!session) playbackActiveRef.current = false;
              setAvatarStatus('ready');
            }}
            onTranscript={(text) => {
              if (recognitionTimeoutRef.current !== null) {
                window.clearTimeout(recognitionTimeoutRef.current);
                recognitionTimeoutRef.current = null;
              }
              const question = text.trim();
              if (!question) {
                setAvatarStatus('ready');
                setChatError('没有识别到语音，请再试一次。');
                return;
              }
              void sendQuestion(question);
            }}
            onPlaybackStateChange={(playbackState) => {
              playbackActiveRef.current = playbackState === 'speaking';
              setAvatarStatus(playbackState);
            }}
          />
        </aside>

        <ChatBox
          messages={messages}
          loading={loading}
          error={chatError}
          enableSpeechInput
          speechInput={{
            onStart: startVoiceInput,
            onStop: stopVoiceInput,
          }}
          assistant={{
            name: productCopy.guideName,
            subtitle: '在线智能导览',
            avatarSrc: '/avatar/haru-chat-avatar.jpeg',
            avatarAlt: '灵山胜境 AI 导游头像',
          }}
          onSend={(question) => void sendQuestion(question)}
        />

        <GuideQuickPrompts prompts={quickPrompts} disabled={loading || !introReady} onSelect={sendPresetQuestion} />
      </div>
    </div>
  );
}
