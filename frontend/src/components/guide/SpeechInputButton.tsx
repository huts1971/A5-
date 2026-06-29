import { AudioOutlined } from '@ant-design/icons';
import { Button, Tooltip } from 'antd';
import { useMemo, useRef, useState } from 'react';

type SpeechInputStatus = 'idle' | 'requesting' | 'listening' | 'unsupported' | 'error' | 'recognized';

interface SpeechRecognitionEventLike extends Event {
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      length: number;
      [index: number]: {
        transcript: string;
      };
    };
  };
}

interface SpeechRecognitionErrorEventLike extends Event {
  error?: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export interface SpeechInputButtonProps {
  disabled?: boolean;
  className?: string;
  iconOnly?: boolean;
  onTranscript: (text: string) => void;
  onError?: (message: string) => void;
  onStartRecording?: () => Promise<void>;
  onStopRecording?: () => Promise<void>;
}

const statusText: Record<SpeechInputStatus, string> = {
  idle: '点击后开始语音输入',
  requesting: '正在等待浏览器麦克风授权',
  listening: '正在识别，请说出你的问题',
  unsupported: '当前浏览器不支持语音输入，请使用键盘输入',
  error: '语音识别失败，可继续键盘输入',
  recognized: '已识别语音，确认后发送',
};

export default function SpeechInputButton({
  disabled = false,
  className,
  iconOnly = false,
  onTranscript,
  onError,
  onStartRecording,
  onStopRecording,
}: SpeechInputButtonProps) {
  const [status, setStatus] = useState<SpeechInputStatus>('idle');
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const Recognition = useMemo(
    () =>
      typeof window === 'undefined'
        ? undefined
        : window.SpeechRecognition ?? window.webkitSpeechRecognition,
    [],
  );

  const usesAvatarMicrophone = Boolean(onStartRecording && onStopRecording);
  const supported = usesAvatarMicrophone || Boolean(Recognition);
  const listening = status === 'listening' || status === 'requesting';

  const stopListening = async () => {
    if (usesAvatarMicrophone) {
      try {
        setStatus('recognized');
        await onStopRecording?.();
      } catch {
        setStatus('error');
        onError?.('语音输入结束失败，请改用键盘输入。');
      }
      return;
    }
    recognitionRef.current?.stop();
  };

  const startListening = async () => {
    if (usesAvatarMicrophone) {
      try {
        setStatus('requesting');
        await onStartRecording?.();
        setStatus('listening');
      } catch {
        setStatus('error');
        onError?.('麦克风启动失败，请检查浏览器权限。');
      }
      return;
    }
    if (!Recognition) {
      setStatus('unsupported');
      onError?.('当前浏览器不支持语音输入，请使用 Chrome 或 Edge 演示。');
      return;
    }

    try {
      const recognition = new Recognition();
      recognition.lang = 'zh-CN';
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onstart = () => setStatus('listening');
      recognition.onend = () => {
        setStatus((current) => (current === 'listening' || current === 'requesting' ? 'idle' : current));
      };
      recognition.onerror = (event) => {
        setStatus('error');
        const message =
          event.error === 'not-allowed'
            ? '浏览器没有获得麦克风权限，请允许后再试。'
            : '语音识别暂时不可用，请改用键盘输入。';
        onError?.(message);
      };
      recognition.onresult = (event) => {
        const transcript = Array.from({ length: event.results.length })
          .map((_, index) => event.results[index][0]?.transcript ?? '')
          .join('')
          .trim();
        if (transcript) {
          onTranscript(transcript);
          setStatus('recognized');
        }
      };
      recognitionRef.current = recognition;
      setStatus('requesting');
      recognition.start();
    } catch {
      setStatus('error');
      onError?.('语音输入启动失败，请检查浏览器麦克风权限。');
    }
  };

  const button = (
    <Button
      aria-label={listening ? '停止语音输入' : '语音输入'}
      aria-pressed={listening}
      className={className}
      data-listening={listening}
      data-testid="guide-voice-input"
      icon={<AudioOutlined />}
      disabled={disabled || !supported}
      loading={status === 'requesting'}
      onClick={() => void (listening ? stopListening() : startListening())}
    >
      {iconOnly ? null : listening ? '停止' : '语音输入'}
    </Button>
  );

  return iconOnly ? button : <Tooltip title={supported ? statusText[status] : statusText.unsupported}>{button}</Tooltip>;
}
