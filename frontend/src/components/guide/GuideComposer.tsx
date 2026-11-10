import {
  AudioMutedOutlined,
  CloseOutlined,
  PictureOutlined,
  SendOutlined,
  SoundOutlined,
} from '@ant-design/icons';
import { Button, Tooltip } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, KeyboardEvent } from 'react';
import type { GuideImageAttachment } from '../../types/scenic';
import SpeechInputButton from './SpeechInputButton';
import styles from './GuideComposer.module.css';

export type GuideComposerVariant = 'compact' | 'full';
export type GuideComposerAppearance = 'light' | 'scene';

export interface GuideComposerProps {
  variant?: GuideComposerVariant;
  appearance?: GuideComposerAppearance;
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  enableSpeechInput?: boolean;
  muted?: boolean;
  soundDisabled?: boolean;
  className?: string;
  testIdPrefix?: string;
  onChange?: (value: string) => void;
  onMutedChange?: (muted: boolean) => void;
  onToggleMuted?: () => void;
  onSend: (question: string, image?: GuideImageAttachment) => void | Promise<void>;
  onError?: (message: string) => void;
}

const DEFAULT_IMAGE_QUESTION = '请帮我看看这张图片，并结合当前场景告诉我值得关注的内容。';
const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';
const IMAGE_MAX_SOURCE_BYTES = 6 * 1024 * 1024;
const IMAGE_MAX_SEND_BYTES = 1.6 * 1024 * 1024;
const IMAGE_MAX_SIDE = 1280;
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export default function GuideComposer({
  variant = 'compact',
  appearance = 'light',
  value,
  defaultValue = '',
  placeholder = '问问灵诗音关于当前场景…',
  disabled = false,
  loading = false,
  enableSpeechInput = true,
  muted = false,
  soundDisabled = false,
  className,
  testIdPrefix = 'guide-composer',
  onChange,
  onMutedChange,
  onToggleMuted,
  onSend,
  onError,
}: GuideComposerProps) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [imageAttachment, setImageAttachment] = useState<GuideImageAttachment | null>(null);
  const [localError, setLocalError] = useState('');
  const [internalSubmitting, setInternalSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const draft = value ?? internalValue;
  const busy = disabled || loading || internalSubmitting;
  const canSubmit = Boolean(draft.trim() || imageAttachment) && !busy;

  const updateDraft = (nextValue: string) => {
    if (value === undefined) setInternalValue(nextValue);
    onChange?.(nextValue);
  };

  const reportError = (message: string) => {
    setLocalError(message);
    onError?.(message);
  };

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    const maxHeight = variant === 'compact' ? 64 : 96;
    const nextHeight = Math.min(input.scrollHeight, maxHeight);
    input.style.height = `${Math.max(24, nextHeight)}px`;
    input.style.overflowY = input.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [draft, variant]);

  const submit = async () => {
    const question = draft.trim() || (imageAttachment ? DEFAULT_IMAGE_QUESTION : '');
    if ((!question && !imageAttachment) || busy || submittingRef.current) return;

    const pendingImage = imageAttachment ?? undefined;
    submittingRef.current = true;
    setInternalSubmitting(true);
    setLocalError('');
    updateDraft('');
    setImageAttachment(null);

    try {
      await onSend(question, pendingImage);
    } catch (error) {
      reportError(error instanceof Error ? error.message : '问题发送失败，请稍后重试。');
    } finally {
      submittingRef.current = false;
      setInternalSubmitting(false);
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void submit();
  };

  const handleImagePick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || busy) return;

    try {
      const prepared = await prepareImageAttachment(file);
      setImageAttachment(prepared);
      setLocalError('');
    } catch (error) {
      setImageAttachment(null);
      reportError(error instanceof Error ? error.message : '图片处理失败，请换一张再试。');
    }
  };

  const handleTranscript = (transcript: string) => {
    const normalizedTranscript = transcript.trim();
    if (!normalizedTranscript) return;
    const nextValue = draft.trim()
      ? `${draft.trimEnd()} ${normalizedTranscript}`
      : normalizedTranscript;
    updateDraft(nextValue);
    setLocalError('');
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleToggleMuted = () => {
    if (soundDisabled || disabled) return;
    if (onToggleMuted) {
      onToggleMuted();
      return;
    }
    onMutedChange?.(!muted);
  };

  const rootClassName = [
    styles.composer,
    variant === 'compact' ? styles.compact : styles.full,
    appearance === 'scene' && styles.scene,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section
      className={rootClassName}
      data-testid={testIdPrefix}
      data-variant={variant}
      aria-label="与数字人导游互动"
    >
      {imageAttachment ? (
        <div className={styles.attachment} data-testid={`${testIdPrefix}-attachment`}>
          <img src={imageAttachment.dataUrl} alt={imageAttachment.name || '待发送图片'} />
          <span className={styles.attachmentName}>{imageAttachment.name}</span>
          <span className={styles.attachmentSize}>{formatBytes(imageAttachment.sizeBytes)}</span>
          <button
            type="button"
            className={styles.removeAttachment}
            aria-label="移除待发送图片"
            disabled={busy}
            onClick={() => setImageAttachment(null)}
          >
            <CloseOutlined />
          </button>
        </div>
      ) : null}

      <form className={styles.form} onSubmit={handleSubmit}>
        <textarea
          ref={inputRef}
          className={styles.input}
          rows={1}
          value={draft}
          placeholder={placeholder}
          aria-label="输入导览问题"
          disabled={busy}
          onChange={(event) => {
            updateDraft(event.target.value);
            if (localError) setLocalError('');
          }}
          onKeyDown={handleKeyDown}
        />

        <div className={styles.actions}>
          <input
            ref={imageInputRef}
            className={styles.fileInput}
            type="file"
            accept={IMAGE_ACCEPT}
            tabIndex={-1}
            aria-hidden="true"
            onChange={handleImagePick}
          />
          <Tooltip title="上传图片提问">
            <Button
              className={styles.actionButton}
              data-testid={`${testIdPrefix}-image`}
              htmlType="button"
              shape="circle"
              icon={<PictureOutlined />}
              aria-label="上传图片提问"
              disabled={busy}
              onClick={() => imageInputRef.current?.click()}
            />
          </Tooltip>

          {enableSpeechInput ? (
            <Tooltip title="按住说话，松开后转成文字">
              <span className={styles.speechButton}>
                <SpeechInputButton
                  className={styles.actionButton}
                  iconOnly
                  mode="transcript"
                  testId={`${testIdPrefix}-speech`}
                  disabled={busy}
                  onTranscript={handleTranscript}
                  onError={reportError}
                />
              </span>
            </Tooltip>
          ) : null}

          <Tooltip title={muted ? '开启自动讲解声音' : '关闭自动讲解声音'}>
            <Button
              className={`${styles.actionButton} ${muted ? styles.mutedButton : ''}`}
              data-testid={`${testIdPrefix}-sound`}
              htmlType="button"
              shape="circle"
              icon={muted ? <AudioMutedOutlined /> : <SoundOutlined />}
              aria-label={muted ? '开启自动讲解声音' : '关闭自动讲解声音'}
              aria-pressed={muted}
              disabled={soundDisabled || disabled}
              onClick={handleToggleMuted}
            />
          </Tooltip>

          <Tooltip title="发送">
            <Button
              className={styles.sendButton}
              data-testid={`${testIdPrefix}-send`}
              type="primary"
              htmlType="submit"
              shape="circle"
              icon={<SendOutlined />}
              aria-label="发送问题"
              loading={internalSubmitting || loading}
              disabled={!canSubmit}
            />
          </Tooltip>
        </div>
      </form>

      <span className={styles.hint} role="status" aria-live="polite">
        {localError}
      </span>
    </section>
  );
}

export async function prepareGuideImageAttachment(file: File): Promise<GuideImageAttachment> {
  return prepareImageAttachment(file);
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

async function compressImageDataUrl(
  dataUrl: string,
  sourceType: string,
): Promise<{ dataUrl: string; mimeType: string }> {
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
