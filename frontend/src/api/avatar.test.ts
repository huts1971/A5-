import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createAvatarSession,
  destroyAvatarSession,
  interruptAvatar,
  submitAvatarSpeech,
} from './avatar';

describe('avatar API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a guide avatar session through the A5 bridge', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          session_id: 'a5-guide-123',
          status: 'ready',
          openavatar_url: 'http://127.0.0.1:8282',
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const session = await createAvatarSession();

    expect(session).toEqual({
      sessionId: 'a5-guide-123',
      status: 'ready',
      openAvatarUrl: 'http://127.0.0.1:8282',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8283/api/avatar/sessions',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('destroys the page avatar session when guide leaves', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await destroyAvatarSession('a5-guide-123');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8283/api/avatar/sessions/a5-guide-123',
      expect.objectContaining({ method: 'DELETE', keepalive: true }),
    );
  });

  it('submits an incremental answer chunk for avatar speech', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ accepted: true }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await submitAvatarSpeech('a5-guide-123', {
      streamId: 'answer-123',
      text: '灵山大佛高八十八米，',
      end: false,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8283/api/avatar/sessions/a5-guide-123/speech',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          stream_id: 'answer-123',
          text: '灵山大佛高八十八米，',
          end: false,
        }),
      }),
    );
  });

  it('interrupts the current avatar playback before a new question', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ accepted: true }), { status: 202 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await interruptAvatar('a5-guide-123');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8283/api/avatar/sessions/a5-guide-123/interrupt',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
