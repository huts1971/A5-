import { CloseOutlined, PauseCircleFilled, PictureOutlined, PlayCircleFilled, SendOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ChatMessage, GuideImageAttachment, GuideVoiceMessage } from '../../types/scenic';
import AudioButton from './AudioButton';
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
  assistant?: GuideAssistantIdentity;
  headerControl?: ReactNode;
  onSend: (question: string) => void;
  onSendVoice?: (voice: GuideVoiceMessage) => void;
  onSendImage?: (question: string, image: GuideImageAttachment) => void;
  onSpeakStart?: (message: ChatMessage) => void;
  onSpeakEnd?: () => void;
  onSpeakError?: (message: string) => void;
  showRouteActions?: boolean;
  onViewRoute?: (message: ChatMessage) => void;
  onEditRoute?: (message: ChatMessage) => void;
  onStartTour?: (message: ChatMessage) => void;
}

const defaultAssistant: GuideAssistantIdentity = {
  name: '灵诗音',
  subtitle: '在线智能导览',
  avatarSrc: '/avatar/uketsukejou151/avatar-151-head.png',
  avatarAlt: '灵诗音导游头像',
};

const DEFAULT_IMAGE_QUESTION = '请帮我看看这张图里是什么，结合景区导览告诉我有什么看点。';
const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';
const IMAGE_MAX_SOURCE_BYTES = 6 * 1024 * 1024;
const IMAGE_MAX_SEND_BYTES = 1.6 * 1024 * 1024;
const IMAGE_MAX_SIDE = 1280;
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export default function ChatBox({
  messages = [],
  loading = false,
  error,
  enableSpeechInput = false,
  assistant = defaultAssistant,
  headerControl,
  onSend,
  onSendVoice,
  onSendImage,
  onSpeakStart,
  onSpeakEnd,
  onSpeakError,
  showRouteActions = true,
  onViewRoute,
  onEditRoute,
  onStartTour,
}: ChatBoxProps) {
  const [draft, setDraft] = useState('');
  const [speechError, setSpeechError] = useState('');
  const [imageAttachment, setImageAttachment] = useState<GuideImageAttachment | null>(null);
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const chatRootRef = useRef<HTMLElement | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: 'end' });
  }, [expandedSources, messages]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    const nextHeight = Math.min(input.scrollHeight, 72);
    input.style.height = `${nextHeight}px`;
    input.style.overflowY = input.scrollHeight > 72 ? 'auto' : 'hidden';
  }, [draft]);

  useEffect(() => {
    const forwardCoveredAudioClick = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const root = chatRootRef.current;
      if (!root) return;
      const target = event.target;
      if (target instanceof Element && target.closest('.message-play')) return;

      const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('.message-play'));
      const matchedButton = buttons.find((button) => {
        if (button.disabled) return false;
        const rect = button.getBoundingClientRect();
        return (
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom
        );
      });

      if (!matchedButton) return;
      event.preventDefault();
      event.stopPropagation();
      matchedButton.click();
    };

    document.addEventListener('pointerdown', forwardCoveredAudioClick, true);
    return () => document.removeEventListener('pointerdown', forwardCoveredAudioClick, true);
  }, []);

  const submit = () => {
    const question = draft.trim() || (imageAttachment ? DEFAULT_IMAGE_QUESTION : '');
    if ((!question && !imageAttachment) || loading) return;
    setDraft('');
    setImageAttachment(null);
    if (inputRef.current) inputRef.current.style.height = '22px';
    if (imageAttachment && onSendImage) {
      onSendImage(question, imageAttachment);
      return;
    }
    onSend(question);
  };

  const handleImagePick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || loading) return;
    try {
      const prepared = await prepareImageAttachment(file);
      setImageAttachment(prepared);
      setSpeechError('');
    } catch (error) {
      setImageAttachment(null);
      setSpeechError(error instanceof Error ? error.message : '图片处理失败，请换一张再试。');
    }
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
    if (event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };

  return (
    <section ref={chatRootRef} className="guide-aichat" data-testid="guide-chat-window" aria-label="AI 导游对话">
      <div className="bg" aria-hidden="true" />
      <div className="chat ai-chat chat-panel">
        <div className="chat-title">
          <h1>{assistant.name}</h1>
          <h2>{assistant.subtitle}</h2>
          <figure className="avatar">
            <img src={assistant.avatarSrc} alt={assistant.avatarAlt} data-testid="guide-chat-avatar" />
          </figure>
          {headerControl ? <div className="guide-aichat__header-slot">{headerControl}</div> : null}
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
                    {!isAssistant && item.inputMode === 'image' && item.image ? (
                      <UserImageBubble image={item.image} text={item.content} />
                    ) : !isAssistant && item.inputMode === 'voice' && item.voice ? (
                      <UserVoiceBubble voice={item.voice} />
                    ) : (
                      <p>{item.content}</p>
                    )}
                    {isAssistant ? (
                      <AudioButton
                        variant="minimal"
                        text={item.content}
                        audioUrl={item.audioUrl}
                        loading={item.ttsStatus === 'pending'}
                        disabled={item.ttsStatus === 'pending'}
                        onStart={() => onSpeakStart?.(item)}
                        onEnd={onSpeakEnd}
                        onError={() => onSpeakError?.('语音播放暂时不可用，已保留文字回答。')}
                      />
                    ) : null}
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

                  {isAssistant && item.guideAction?.type === 'route_recommendation' && item.routePlan ? (
                    <div className="guide-route-card" data-testid="guide-route-card">
                      <div className="guide-route-card__header">
                        <span>{item.routePlan.mapId === 'nianhua-bay' ? '拈花湾路线' : '灵山胜境路线'}</span>
                        <strong>{item.routePlan.name}</strong>
                      </div>
                      <div className="guide-route-card__meta">
                        <span>总计约 {item.routePlan.durationMinutes} 分钟</span>
                        <span>步行约 {item.routePlan.estimatedWalkMinutes ?? 0} 分钟</span>
                        <span>{item.routePlan.spots.length} 个点位</span>
                      </div>
                      <ol className="guide-route-card__spots">
                        {item.routePlan.spots.slice(0, 7).map((spot) => (
                          <li key={spot.spotId}>{spot.name}</li>
                        ))}
                      </ol>
                      <div className="guide-route-card__actions" hidden={!showRouteActions}>
                        <Button size="small" onClick={() => onViewRoute?.(item)}>
                          查看地图
                        </Button>
                        <Button size="small" onClick={() => onEditRoute?.(item)}>
                          编辑路线
                        </Button>
                        <Button size="small" type="primary" onClick={() => onStartTour?.(item)}>
                          开始游览
                        </Button>
                      </div>
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
          {imageAttachment ? (
            <div className="guide-aichat__image-preview" data-testid="guide-image-preview">
              <img src={imageAttachment.dataUrl} alt={imageAttachment.name} />
              <div className="guide-aichat__image-preview-meta">
                <strong>{imageAttachment.name}</strong>
                <span>{formatBytes(imageAttachment.sizeBytes)}</span>
              </div>
              <button
                type="button"
                aria-label="移除图片"
                className="guide-aichat__image-preview-remove"
                onClick={() => setImageAttachment(null)}
              >
                <CloseOutlined />
              </button>
            </div>
          ) : null}
          <textarea
            ref={inputRef}
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
            <input
              ref={imageInputRef}
              type="file"
              accept={IMAGE_ACCEPT}
              className="guide-aichat__image-input"
              tabIndex={-1}
              onChange={handleImagePick}
            />
            <Button
              className="message-image"
              data-testid="guide-image-input"
              htmlType="button"
              icon={<PictureOutlined />}
              aria-label="上传图片提问"
              disabled={loading}
              onClick={() => imageInputRef.current?.click()}
            />
            {enableSpeechInput ? (
              <>
                <SpeechInputButton
                  className="message-dictate"
                  iconOnly
                  mode="transcript"
                  testId="guide-speech-to-text-input"
                  disabled={loading}
                  onTranscript={(text) => {
                    setSpeechError('');
                    setDraft(text);
                  }}
                  onError={setSpeechError}
                />
                <SpeechInputButton
                  className="message-voice"
                  iconOnly
                  mode="voice"
                  testId="guide-voice-message-input"
                  disabled={loading}
                  onTranscript={() => undefined}
                  onVoiceMessage={(voice) => {
                    setSpeechError('');
                    setDraft('');
                    setImageAttachment(null);
                    onSendVoice?.(voice);
                  }}
                  onError={setSpeechError}
                />
              </>
            ) : null}
            <Button
              className="message-submit"
              data-testid="guide-send"
              type="primary"
              htmlType="submit"
              icon={<SendOutlined />}
              aria-label="发送问题"
              disabled={(!draft.trim() && !imageAttachment) || loading}
            />
          </div>
        </form>
        {speechError ? (
          <div className="guide-aichat__speech-hint" role="status">
            {speechError}
          </div>
        ) : null}
      </div>
      <span className="guide-aichat__sr-status" aria-live="polite">
        {speechError || error || ''}
      </span>
    </section>
  );
}

function UserImageBubble({ image, text }: { image: GuideImageAttachment; text: string }) {
  return (
    <div className="guide-image-message" data-testid="guide-user-image-message">
      <img src={image.dataUrl} alt={image.name || '上传图片'} />
      {text ? <p>{text}</p> : null}
    </div>
  );
}

function UserVoiceBubble({ voice }: { voice: GuideVoiceMessage }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(
    () => () => {
      audioRef.current?.pause();
    },
    [],
  );

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    audio.currentTime = 0;
    audio
      .play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false));
  };

  return (
    <div className="guide-voice-message" data-testid="guide-user-voice-message">
      <button
        type="button"
        className="guide-voice-message__play"
        aria-label={playing ? '暂停录音' : '播放录音'}
        onClick={togglePlayback}
      >
        {playing ? <PauseCircleFilled /> : <PlayCircleFilled />}
      </button>
      <div className="guide-voice-message__body">
        <div className="guide-voice-message__audio-row" aria-hidden="true">
          <span className="guide-voice-message__wave">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
          <span className="guide-voice-message__duration">{formatDuration(voice.durationMs)}</span>
        </div>
      </div>
      <audio
        ref={audioRef}
        src={voice.audioUrl}
        preload="metadata"
        onEnded={() => setPlaying(false)}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
      />
    </div>
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

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

async function prepareImageAttachment(file: File): Promise<GuideImageAttachment> {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
    throw new Error('只支持 JPG、PNG 或 WebP 图片。');
  }
  if (file.size > IMAGE_MAX_SOURCE_BYTES) {
    throw new Error('图片不能超过 6MB，请压缩后再上传。');
  }

  const originalDataUrl = await readFileAsDataUrl(file);
  let dataUrl = originalDataUrl;
  let mimeType = file.type;
  let sizeBytes = file.size;

  if (file.size > IMAGE_MAX_SEND_BYTES) {
    const compressed = await compressImageDataUrl(originalDataUrl, file.type);
    dataUrl = compressed.dataUrl;
    mimeType = compressed.mimeType;
    sizeBytes = dataUrlToBytes(dataUrl);
  }

  if (sizeBytes > IMAGE_MAX_SEND_BYTES) {
    throw new Error('图片仍然偏大，请换一张更小的图片。');
  }

  return {
    id: `image-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: file.name || 'uploaded-image',
    mimeType,
    sizeBytes,
    dataUrl,
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('图片读取失败，请重试。'));
    };
    reader.onerror = () => reject(new Error('图片读取失败，请重试。'));
    reader.readAsDataURL(file);
  });
}

async function compressImageDataUrl(dataUrl: string, sourceType: string): Promise<{ dataUrl: string; mimeType: string }> {
  const image = await loadImage(dataUrl);
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法处理图片，请换一张图片。');

  const mimeType = sourceType === 'image/webp' ? 'image/webp' : 'image/jpeg';
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  for (const quality of [0.82, 0.72, 0.62]) {
    const nextDataUrl = canvas.toDataURL(mimeType, quality);
    if (dataUrlToBytes(nextDataUrl) <= IMAGE_MAX_SEND_BYTES) {
      return { dataUrl: nextDataUrl, mimeType };
    }
  }

  return { dataUrl: canvas.toDataURL(mimeType, 0.56), mimeType };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片解析失败，请换一张图片。'));
    image.src = src;
  });
}

function dataUrlToBytes(dataUrl: string): number {
  const base64 = dataUrl.split(',')[1] ?? '';
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
