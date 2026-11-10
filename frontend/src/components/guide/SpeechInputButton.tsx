import { AudioOutlined, SoundOutlined } from '@ant-design/icons';
import { Button, Tooltip } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GuideVoiceMessage } from '../../types/scenic';

type SpeechInputStatus = 'idle' | 'requesting' | 'listening' | 'unsupported' | 'error' | 'recognized';
type SpeechInputMode = 'transcript' | 'voice';

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
  mode?: SpeechInputMode;
  testId?: string;
  onTranscript: (text: string) => void;
  onVoiceMessage?: (voice: GuideVoiceMessage) => void;
  onError?: (message: string) => void;
}

const statusText: Record<SpeechInputMode, Record<SpeechInputStatus, string>> = {
  transcript: {
    idle: '按住说话，松开后转成文字',
    requesting: '正在等待浏览器麦克风授权',
    listening: '正在识别，松开后填入输入框',
    unsupported: '当前浏览器不支持语音转文字，请使用键盘输入',
    error: '语音识别失败，可继续键盘输入',
    recognized: '已识别语音，确认后发送',
  },
  voice: {
    idle: '按住说话，松开后发送语音',
    requesting: '正在等待浏览器麦克风授权',
    listening: '正在录音，松开后发送',
    unsupported: '当前浏览器不支持语音录制，请使用键盘输入',
    error: '语音录制失败，可继续键盘输入',
    recognized: '语音已发送',
  },
};

export default function SpeechInputButton({
  disabled = false,
  className,
  iconOnly = false,
  mode = 'transcript',
  testId,
  onTranscript,
  onVoiceMessage,
  onError,
}: SpeechInputButtonProps) {
  const [status, setStatus] = useState<SpeechInputStatus>('idle');
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);
  const transcriptRef = useRef('');
  const recordingStartRef = useRef(0);
  const keepRecognitionAliveRef = useRef(false);
  const stopPendingRef = useRef(false);

  const Recognition = useMemo(
    () =>
      typeof window === 'undefined'
        ? undefined
        : window.SpeechRecognition ?? window.webkitSpeechRecognition,
    [],
  );

  const supported = Boolean(Recognition);
  const listening = status === 'listening' || status === 'requesting';
  const voiceMode = mode === 'voice';

  useEffect(
    () => () => {
      keepRecognitionAliveRef.current = false;
      try {
        recognitionRef.current?.abort();
      } catch {
        // Browser speech engines can already be inactive during component cleanup.
      }
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.onstop = null;
        recorderRef.current.stop();
      }
      cleanupMediaStream(mediaStreamRef.current);
    },
    [],
  );

  const stopListening = () => {
    keepRecognitionAliveRef.current = false;
    stopPendingRef.current = true;
    try {
      recognitionRef.current?.stop();
    } catch {
      // The browser may have ended recognition before the user releases the button.
    }
    if (recorderRef.current?.state === 'recording') {
      window.setTimeout(() => {
        if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      }, 140);
    }
  };

  const startListening = async () => {
    if (disabled || listening) return;
    if (!Recognition) {
      setStatus('unsupported');
      onError?.('当前浏览器不支持语音输入，请使用 Chrome 或 Edge 演示。');
      return;
    }

    if (!voiceMode) {
      startTranscriptOnly();
      return;
    }
    if (!onVoiceMessage || !canRecordVoiceMessage()) {
      setStatus('unsupported');
      onError?.('当前浏览器不支持语音录制，请使用 Chrome 或 Edge 演示。');
      return;
    }

    setStatus('requesting');
    keepRecognitionAliveRef.current = true;
    stopPendingRef.current = false;
    transcriptRef.current = '';
    audioChunksRef.current = [];

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      setStatus('error');
      onError?.(getMicrophoneErrorMessage(error));
      return;
    }

    mediaStreamRef.current = stream;

    try {
      const mimeType = chooseAudioMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const voice = buildVoiceMessage(recorder.mimeType);
        cleanupMediaStream(mediaStreamRef.current);
        mediaStreamRef.current = null;
        recorderRef.current = null;
        recognitionRef.current = null;

        if (!voice) return;
        onVoiceMessage(voice);
        setStatus('recognized');
        window.setTimeout(() => setStatus('idle'), 800);
      };

      const recognition = createRecognition({
        captureVoiceMessage: true,
      });
      recognitionRef.current = recognition;
      recordingStartRef.current = performance.now();
      recorder.start();
      recognition.start();
      if (stopPendingRef.current) stopListening();
    } catch {
      keepRecognitionAliveRef.current = false;
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      if (recorderRef.current?.state === 'recording') {
        recorderRef.current.onstop = null;
        recorderRef.current.stop();
      }
      recorderRef.current = null;
      cleanupMediaStream(stream);
      mediaStreamRef.current = null;
      setStatus('error');
      onError?.('语音录制启动失败，请检查浏览器麦克风权限。');
    }
  };

  const startTranscriptOnly = () => {
    try {
      transcriptRef.current = '';
      keepRecognitionAliveRef.current = true;
      stopPendingRef.current = false;
      const recognition = createRecognition({
        captureVoiceMessage: false,
        onRecognitionEnd: () => {
          const transcript = transcriptRef.current.trim();
          recognitionRef.current = null;
          if (transcript) {
            onTranscript(transcript);
            setStatus('recognized');
            window.setTimeout(() => setStatus('idle'), 800);
            return;
          }
          setStatus('error');
          onError?.('没有识别到清晰语音，请靠近麦克风再试。');
        },
      });
      recognitionRef.current = recognition;
      setStatus('requesting');
      recognition.start();
      if (stopPendingRef.current) stopListening();
    } catch {
      keepRecognitionAliveRef.current = false;
      setStatus('error');
      onError?.('语音输入启动失败，请检查浏览器麦克风权限。');
    }
  };

  const createRecognition = ({
    captureVoiceMessage,
    onRecognitionEnd,
  }: {
    captureVoiceMessage: boolean;
    onRecognitionEnd?: () => void;
  }) => {
    if (!Recognition) throw new Error('Speech recognition is not supported.');
    const recognition = new Recognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setStatus('listening');
    recognition.onend = () => {
      if (keepRecognitionAliveRef.current && recognitionRef.current === recognition) {
        window.setTimeout(() => {
          try {
            if (keepRecognitionAliveRef.current && recognitionRef.current === recognition) recognition.start();
          } catch {
            // Browsers may refuse immediate restart; release still finalizes the best transcript we have.
          }
        }, 90);
        return;
      }
      onRecognitionEnd?.();
      recognitionRef.current = null;
      if (captureVoiceMessage) return;
      setStatus((current) => (current === 'listening' || current === 'requesting' ? 'idle' : current));
    };
    recognition.onerror = (event) => {
      const message =
        event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? '浏览器没有获得麦克风权限，请允许后再试。'
          : event.error === 'no-speech'
            ? '没有识别到清晰语音，请靠近麦克风再试。'
            : '语音识别暂时不可用，请改用键盘输入。';
      onError?.(message);
      if (!captureVoiceMessage) setStatus('error');
    };
    recognition.onresult = (event) => {
      const transcript = readTranscript(event);
      if (!transcript) return;
      transcriptRef.current = transcript;
    };
    return recognition;
  };

  const buildVoiceMessage = (mimeType?: string): GuideVoiceMessage | undefined => {
    const chunks = audioChunksRef.current;
    audioChunksRef.current = [];
    const transcript = transcriptRef.current.trim();
    const durationMs = Math.max(600, Math.round(performance.now() - recordingStartRef.current));

    if (!chunks.length) {
      setStatus('error');
      onError?.('没有录到可播放的语音，请再试一次。');
      return undefined;
    }
    if (!transcript) {
      setStatus('error');
      onError?.('录音已完成，但没有识别到清晰文字，请按住说完整一点再松开。');
      return undefined;
    }

    const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
    return {
      audioUrl: URL.createObjectURL(blob),
      durationMs,
      transcript,
      mimeType: blob.type,
      sizeBytes: blob.size,
    };
  };

  const handlePressStart = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture is a small UX improvement; recording should still start without it.
    }
    void startListening();
  };

  const handlePressEnd = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // Release can fail if the browser already cancelled capture.
    }
    stopListening();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    if (listening) return;
    event.preventDefault();
    void startListening();
  };

  const handleKeyUp = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    if (listening) stopListening();
  };

  const button = (
    <Button
      aria-label={voiceMode ? '按住发送语音' : '按住语音转文字'}
      aria-pressed={listening}
      className={className}
      data-listening={listening}
      data-mode={mode}
      data-testid={testId ?? (voiceMode ? 'guide-voice-message-input' : 'guide-voice-input')}
      icon={voiceMode ? <SoundOutlined /> : <AudioOutlined />}
      disabled={disabled || !supported}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onPointerCancel={handlePressEnd}
      onPointerDown={handlePressStart}
      onPointerLeave={() => {
        if (listening) stopListening();
      }}
      onPointerUp={handlePressEnd}
    >
      {iconOnly ? null : listening ? '松开' : voiceMode ? '按住说话' : '语音转文字'}
    </Button>
  );

  return iconOnly ? button : <Tooltip title={supported ? statusText[mode][status] : statusText[mode].unsupported}>{button}</Tooltip>;
}

function readTranscript(event: SpeechRecognitionEventLike) {
  return Array.from({ length: event.results.length })
    .map((_, index) => event.results[index][0]?.transcript ?? '')
    .join('')
    .trim();
}

function canRecordVoiceMessage() {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof window.MediaRecorder !== 'undefined'
  );
}

function chooseAudioMimeType() {
  if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') return undefined;
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) =>
    window.MediaRecorder.isTypeSupported(type),
  );
}

function cleanupMediaStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function getMicrophoneErrorMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return '浏览器没有获得麦克风权限，请允许后再试。';
  }
  if (name === 'NotFoundError') return '没有检测到可用麦克风，请连接麦克风后再试。';
  return '暂时无法获取麦克风，可继续使用文字输入。';
}
