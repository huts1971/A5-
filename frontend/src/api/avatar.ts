import { AVATAR_SERVICE_URL } from './config';

export type AvatarServiceStatus = 'preparing' | 'ready';

export interface AvatarSession {
  sessionId: string;
  status: AvatarServiceStatus;
  openAvatarUrl: string;
}

interface AvatarSessionResponse {
  session_id: string;
  status: AvatarServiceStatus;
  openavatar_url: string;
}

export async function createAvatarSession(): Promise<AvatarSession> {
  const response = await fetch(`${AVATAR_SERVICE_URL}/api/avatar/sessions`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`avatar_session_create_failed_${response.status}`);
  }
  const session = (await response.json()) as AvatarSessionResponse;
  return {
    sessionId: session.session_id,
    status: session.status,
    openAvatarUrl: session.openavatar_url,
  };
}

export async function destroyAvatarSession(sessionId: string): Promise<void> {
  const response = await fetch(`${AVATAR_SERVICE_URL}/api/avatar/sessions/${sessionId}`, {
    method: 'DELETE',
    keepalive: true,
  });
  if (!response.ok) {
    throw new Error(`avatar_session_destroy_failed_${response.status}`);
  }
}

export interface AvatarSpeechChunk {
  streamId: string;
  text: string;
  end: boolean;
}

export async function submitAvatarSpeech(
  sessionId: string,
  chunk: AvatarSpeechChunk,
): Promise<boolean> {
  const response = await fetch(`${AVATAR_SERVICE_URL}/api/avatar/sessions/${sessionId}/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stream_id: chunk.streamId,
      text: chunk.text,
      end: chunk.end,
    }),
  });
  if (response.status === 409 || response.status === 503) {
    return false;
  }
  if (!response.ok) {
    throw new Error(`avatar_speech_submit_failed_${response.status}`);
  }
  return true;
}

export async function interruptAvatar(sessionId: string): Promise<boolean> {
  const response = await fetch(`${AVATAR_SERVICE_URL}/api/avatar/sessions/${sessionId}/interrupt`, {
    method: 'POST',
  });
  if (response.status === 404 || response.status === 503) {
    return false;
  }
  if (!response.ok) {
    throw new Error(`avatar_interrupt_failed_${response.status}`);
  }
  return true;
}
