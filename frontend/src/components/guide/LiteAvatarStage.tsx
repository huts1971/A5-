import { useEffect, useRef, useState } from 'react';

import { createAvatarSession, destroyAvatarSession } from '../../api/avatar';
import {
  closeOpenAvatar,
  connectOpenAvatar,
  type OpenAvatarConnection,
} from '../../api/avatarConnection';
import { AVATAR_SERVICE_URL } from '../../api/config';

export type AvatarDisplayStatus =
  | 'disconnected'
  | 'preparing'
  | 'ready'
  | 'listening'
  | 'recognizing'
  | 'thinking'
  | 'speaking';

export interface ActiveAvatarSession {
  sessionId: string;
  connection: OpenAvatarConnection;
}

const statusText: Record<AvatarDisplayStatus, string> = {
  disconnected: '未连接',
  preparing: '准备中',
  ready: '准备中',
  listening: '正在聆听',
  recognizing: '识别中',
  thinking: '思考中',
  speaking: '播报中',
};

interface LiteAvatarStageProps {
  status: AvatarDisplayStatus;
  onSessionChange?: (session: ActiveAvatarSession | null) => void;
  onTranscript?: (text: string) => void;
  onPlaybackStateChange?: (state: 'speaking' | 'ready') => void;
  retryDelayMs?: number;
  maxReconnectAttempts?: number;
  maxRetryDelayMs?: number;
}

export default function LiteAvatarStage({
  status,
  onSessionChange,
  onTranscript,
  onPlaybackStateChange,
  retryDelayMs = 3_000,
  maxReconnectAttempts = 5,
  maxRetryDelayMs = 30_000,
}: LiteAvatarStageProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onSessionChangeRef = useRef(onSessionChange);
  const onTranscriptRef = useRef(onTranscript);
  const onPlaybackStateChangeRef = useRef(onPlaybackStateChange);
  onSessionChangeRef.current = onSessionChange;
  onTranscriptRef.current = onTranscript;
  onPlaybackStateChangeRef.current = onPlaybackStateChange;
  const [connectivity, setConnectivity] = useState<'preparing' | 'connected' | 'disconnected'>(
    'preparing',
  );

  useEffect(() => {
    let disposed = false;
    let sessionId: string | undefined;
    let connection: OpenAvatarConnection | undefined;
    let retryTimer: number | undefined;
    let reconnectAttempts = 0;

    const disconnectAndRetry = () => {
      if (disposed) return;
      const staleConnection = connection;
      const staleSessionId = sessionId;
      connection = undefined;
      sessionId = undefined;
      if (staleConnection) closeOpenAvatar(staleConnection);
      if (staleSessionId) void destroyAvatarSession(staleSessionId);
      setConnectivity('disconnected');
      onSessionChangeRef.current?.(null);
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      if (reconnectAttempts >= maxReconnectAttempts) return;
      const delay = Math.min(
        retryDelayMs * 2 ** reconnectAttempts,
        maxRetryDelayMs,
      );
      reconnectAttempts += 1;
      retryTimer = window.setTimeout(() => void connect(), delay);
    };

    async function connect() {
      try {
        setConnectivity('preparing');
        const session = await createAvatarSession();
        sessionId = session.sessionId;
        if (disposed || !videoRef.current) return;
        connection = await connectOpenAvatar({
          bridgeUrl: AVATAR_SERVICE_URL,
          sessionId,
          videoElement: videoRef.current,
          onTranscript: (text) => onTranscriptRef.current?.(text),
          onPlaybackStateChange: (state) => onPlaybackStateChangeRef.current?.(state),
          onConnectionStateChange: (state) => {
            if (state === 'disconnected' || state === 'failed') {
              disconnectAndRetry();
            }
          },
        });
        if (disposed) {
          closeOpenAvatar(connection);
          return;
        }
        reconnectAttempts = 0;
        setConnectivity('connected');
        onSessionChangeRef.current?.({ sessionId, connection });
      } catch {
        if (!disposed) {
          disconnectAndRetry();
        }
      }
    }

    void connect();
    return () => {
      disposed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      if (connection) closeOpenAvatar(connection);
      onSessionChangeRef.current?.(null);
      if (sessionId) void destroyAvatarSession(sessionId);
    };
  }, []);

  const visibleStatus =
    connectivity === 'connected'
      ? status
      : connectivity === 'disconnected'
        ? 'disconnected'
        : 'preparing';

  return (
    <div className="liteavatar-stage" data-avatar-status={visibleStatus}>
      <div className="liteavatar-stage__media">
        <video
          ref={videoRef}
          className="liteavatar-stage__video"
          data-testid="liteavatar-video"
          autoPlay
          playsInline
        />
      </div>
      <div className="liteavatar-stage__status" role="status" aria-live="polite">
        {statusText[visibleStatus]}
      </div>
    </div>
  );
}
