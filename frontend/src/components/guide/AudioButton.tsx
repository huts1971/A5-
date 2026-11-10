import { SoundOutlined } from '@ant-design/icons';
import { Button, message } from 'antd';
import { useEffect, useRef, useState } from 'react';

export interface AudioButtonProps {
  text: string;
  audioUrl?: string;
  label?: string;
  variant?: 'default' | 'minimal';
  loading?: boolean;
  disabled?: boolean;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: Error) => void;
}

let activePlayback: { ownerId: string; stop: () => void } | undefined;

export default function AudioButton({
  text,
  audioUrl,
  label = '播放讲解',
  variant = 'default',
  loading = false,
  disabled = false,
  onStart,
  onEnd,
  onError,
}: AudioButtonProps) {
  const ownerIdRef = useRef(`audio-${Math.random().toString(36).slice(2)}`);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const playbackTokenRef = useRef(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const clearActivePlayback = () => {
    if (activePlayback?.ownerId === ownerIdRef.current) {
      activePlayback = undefined;
    }
  };

  const stop = () => {
    playbackTokenRef.current += 1;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audioRef.current = null;
    }
    if (utteranceRef.current && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      utteranceRef.current = null;
    }
    clearActivePlayback();
    setIsPlaying(false);
    onEnd?.();
  };

  useEffect(() => stop, [audioUrl]);

  const handleError = (error: Error, fallbackMessage: string) => {
    clearActivePlayback();
    setIsPlaying(false);
    onError?.(error);
    message.warning(fallbackMessage);
  };

  const speak = () => {
    if (!text.trim() && !audioUrl) {
      message.warning('暂无可播放的讲解内容。');
      return;
    }

    if (activePlayback?.ownerId === ownerIdRef.current) {
      activePlayback.stop();
      return;
    }

    activePlayback?.stop();

    if (audioUrl) {
      const playbackToken = playbackTokenRef.current + 1;
      playbackTokenRef.current = playbackToken;
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      activePlayback = { ownerId: ownerIdRef.current, stop };
      audio.onplay = () => {
        if (playbackTokenRef.current !== playbackToken) {
          return;
        }
        setIsPlaying(true);
        onStart?.();
      };
      audio.onended = () => {
        if (playbackTokenRef.current !== playbackToken) {
          return;
        }
        audioRef.current = null;
        clearActivePlayback();
        setIsPlaying(false);
        onEnd?.();
      };
      audio.onerror = () => {
        if (playbackTokenRef.current !== playbackToken) {
          return;
        }
        handleError(new Error('audio_url_failed'), '音频文件暂时不可播放，已保留文字回答。');
      };
      void audio.play().catch((error: Error) => {
        handleError(error, '浏览器阻止了音频播放，请点击后重试。');
      });
      return;
    }

    if (!('speechSynthesis' in window)) {
      handleError(new Error('speech_synthesis_unavailable'), '当前浏览器不支持语音播报，可继续查看文字回答。');
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    const playbackToken = playbackTokenRef.current + 1;
    playbackTokenRef.current = playbackToken;
    utteranceRef.current = utterance;
    activePlayback = { ownerId: ownerIdRef.current, stop };
    utterance.lang = 'zh-CN';
    utterance.rate = 0.95;
    utterance.onstart = () => {
      if (playbackTokenRef.current !== playbackToken) {
        return;
      }
      setIsPlaying(true);
      onStart?.();
    };
    utterance.onend = () => {
      if (playbackTokenRef.current !== playbackToken) {
        return;
      }
      utteranceRef.current = null;
      clearActivePlayback();
      setIsPlaying(false);
      onEnd?.();
    };
    utterance.onerror = () => {
      if (playbackTokenRef.current !== playbackToken) {
        return;
      }
      handleError(new Error('speech_synthesis_failed'), '语音播报暂时不可用，已保留文字回答。');
    };
    window.speechSynthesis.speak(utterance);
  };

  if (variant === 'minimal') {
    return (
      <button
        type="button"
        className="message-play"
        aria-label={isPlaying ? '停止讲解' : '播放讲解'}
        title={isPlaying ? '停止讲解' : '播放讲解'}
        disabled={loading || disabled || (!text.trim() && !audioUrl)}
        onClick={speak}
        data-playing={isPlaying}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M8 5.5 18 12 8 18.5Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        </svg>
      </button>
    );
  }

  return (
    <Button
      size="small"
      icon={<SoundOutlined />}
      loading={loading}
      disabled={disabled || (!text.trim() && !audioUrl)}
      onClick={speak}
      data-cue={isPlaying ? '[ STOP ]' : '[ PLAY ]'}
    >
      {isPlaying ? '[ STOP ]' : label === '播放讲解' ? '[ PLAY ]' : label}
    </Button>
  );
}
