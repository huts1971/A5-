import { SendOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../../types/scenic';
import SourceCard from './SourceCard';
import SpeechInputButton from './SpeechInputButton';

export interface GuideAssistantIdentity {
  name: string;
  subtitle: string;
  avatarSrc: string;
  avatarAlt: string;
}

export interface ChatBoxProps {
  messages?: ChatMessage[];
  loading?: boolean;
  error?: string;
  enableSpeechInput?: boolean;
  speechInput?: {
    onStart: () => Promise<void>;
    onStop: () => Promise<void>;
  };
  assistant?: GuideAssistantIdentity;
  onSend: (question: string) => void;
}

const defaultAssistant: GuideAssistantIdentity = {
  name: '灵山胜境 AI 导游',
  subtitle: '在线智能导览',
  avatarSrc: '/avatar/haru-chat-avatar.jpeg',
  avatarAlt: '灵山胜境 AI 导游头像',
};

export default function ChatBox({
  messages = [],
  loading = false,
  error,
  enableSpeechInput = false,
  speechInput,
  assistant = defaultAssistant,
  onSend,
}: ChatBoxProps) {
  const [draft, setDraft] = useState('');
  const [speechError, setSpeechError] = useState('');
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const messageEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: 'end' });
  }, [expandedSources, messages]);

  const submit = () => {
    const question = draft.trim();
    if (!question || loading) return;
    setDraft('');
    onSend(question);
  };

  const toggleSources = (messageId: string) => {
    setExpandedSources((current) => {
      const next = new Set(current);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    submit();
  };

  return (
    <section className="guide-aichat" data-testid="guide-chat-window" aria-label="AI 导游对话">
      <div className="bg" aria-hidden="true" />
      <div className="chat ai-chat chat-panel">
        <div className="chat-title">
          <h1>{assistant.name}</h1>
          <h2>{assistant.subtitle}</h2>
          <figure className="avatar">
            <img src={assistant.avatarSrc} alt={assistant.avatarAlt} data-testid="guide-chat-avatar" />
          </figure>
        </div>

        <div className="messages">
          <div className="messages-content">
            {messages.map((item, index) => {
              const isAssistant = item.role === 'assistant';
              const isTyping = isAssistant && !item.content;
              const sourceExpanded = expandedSources.has(item.id);

              if (isTyping) {
                return (
                  <div className="message loading new" data-testid="guide-typing-message" key={item.id}>
                    <figure className="avatar" aria-hidden="true">
                      <img src={assistant.avatarSrc} alt="" />
                    </figure>
                    <span />
                  </div>
                );
              }

              return (
                <div className="guide-aichat__message-block" key={item.id}>
                  <article className={`message ${isAssistant ? '' : 'message-personal'} new chat-bubble ${item.role}`}>
                    {isAssistant ? (
                      <figure className="avatar" aria-hidden="true">
                        <img src={assistant.avatarSrc} alt="" />
                      </figure>
                    ) : null}
                    <p>{item.content}</p>
                    {shouldShowTimestamp(messages, index) ? <span className="timestamp">{formatTime(item.createdAt)}</span> : null}
                  </article>

                  {isAssistant && item.sources?.length ? (
                    <div className="guide-aichat__sources">
                      <button
                        type="button"
                        className="guide-aichat__source-toggle"
                        data-testid="guide-source-toggle"
                        aria-expanded={sourceExpanded}
                        onClick={() => toggleSources(item.id)}
                      >
                        资料来源
                      </button>
                      {sourceExpanded ? (
                        <div className="source-list">
                          {item.sources.map((source) => (
                            <SourceCard key={source.id} source={source} />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
            <div ref={messageEndRef} />
          </div>
        </div>

        <form
          className="message-box chat-input-row"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <textarea
            className="message-input"
            value={draft}
            placeholder="……"
            disabled={loading}
            rows={1}
            aria-label="输入问题"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleInputKeyDown}
          />
          <div className="guide-aichat__input-actions">
            {enableSpeechInput ? (
              <SpeechInputButton
                className="message-voice"
                iconOnly
                disabled={loading}
                onTranscript={(text) => {
                  setSpeechError('');
                  setDraft(text);
                }}
                onError={setSpeechError}
                onStartRecording={speechInput?.onStart}
                onStopRecording={speechInput?.onStop}
              />
            ) : null}
            <Button
              className="message-submit"
              data-testid="guide-send"
              type="primary"
              htmlType="submit"
              icon={<SendOutlined />}
              aria-label="发送问题"
              disabled={!draft.trim() || loading}
            />
          </div>
        </form>
      </div>
      <span className="guide-aichat__sr-status" aria-live="polite">
        {speechError || error || ''}
      </span>
    </section>
  );
}

function shouldShowTimestamp(messages: ChatMessage[], index: number) {
  const current = messages[index]?.createdAt;
  if (!current) return false;
  const previous = messages[index - 1]?.createdAt;
  if (!previous) return true;
  return Math.floor(current / 60_000) !== Math.floor(previous / 60_000);
}

function formatTime(timestamp?: number) {
  const date = new Date(timestamp ?? Date.now());
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
}
