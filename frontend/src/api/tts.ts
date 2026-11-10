import { requestJson } from './client';
import { API_BASE_URL } from './config';

export interface TtsJobStatus {
  id: string;
  status: 'pending' | 'ready' | 'failed' | 'disabled';
  audioUrl?: string;
}

interface BackendTtsJobStatus {
  id: string;
  status: 'pending' | 'ready' | 'failed' | 'disabled';
  audio_url?: string | null;
}

export async function getTtsJobStatus(
  jobId: string,
  signal?: AbortSignal,
): Promise<TtsJobStatus> {
  const response = await requestJson<BackendTtsJobStatus>(
    `/api/tts/jobs/${jobId}`,
    { signal },
  );
  return {
    id: response.id,
    status: response.status,
    audioUrl: response.audio_url ? `${API_BASE_URL}${response.audio_url}` : undefined,
  };
}
