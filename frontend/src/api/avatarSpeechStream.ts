import { submitAvatarSpeech, type AvatarSpeechChunk } from './avatar';

type SubmitSpeech = (sessionId: string, chunk: AvatarSpeechChunk) => Promise<boolean>;

interface AvatarSpeechStreamOptions {
  sessionId: string;
  streamId: string;
  submit?: SubmitSpeech;
}

export interface AvatarSpeechStream {
  write(text: string): void;
  close(): Promise<void>;
  cancel(): Promise<void>;
}

export function createAvatarSpeechStream({
  sessionId,
  streamId,
  submit = submitAvatarSpeech,
}: AvatarSpeechStreamOptions): AvatarSpeechStream {
  let closed = false;
  let canceled = false;
  let queue = Promise.resolve();

  const enqueue = (chunk: AvatarSpeechChunk) => {
    queue = queue
      .then(() => (canceled ? false : submit(sessionId, chunk)))
      .then(() => undefined)
      .catch(() => undefined);
  };

  return {
    write(text: string) {
      if (closed || !text) return;
      enqueue({ streamId, text, end: false });
    },
    async close() {
      if (!closed) {
        closed = true;
        enqueue({ streamId, text: '', end: true });
      }
      await queue;
    },
    async cancel() {
      closed = true;
      canceled = true;
      await queue;
    },
  };
}
