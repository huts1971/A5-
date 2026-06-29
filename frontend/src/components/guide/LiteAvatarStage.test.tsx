// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import LiteAvatarStage from './LiteAvatarStage';

const mocks = vi.hoisted(() => ({
  createAvatarSession: vi.fn(),
  destroyAvatarSession: vi.fn(),
  connectOpenAvatar: vi.fn(),
  closeOpenAvatar: vi.fn(),
}));

vi.mock('../../api/avatar', () => ({
  createAvatarSession: mocks.createAvatarSession,
  destroyAvatarSession: mocks.destroyAvatarSession,
}));

vi.mock('../../api/avatarConnection', () => ({
  connectOpenAvatar: mocks.connectOpenAvatar,
  closeOpenAvatar: mocks.closeOpenAvatar,
}));

describe('LiteAvatarStage', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('owns exactly one avatar session for its mounted lifetime', async () => {
    const connection = { peer: {}, dataChannel: {} };
    mocks.createAvatarSession.mockResolvedValue({
      sessionId: 'a5-guide-123',
      status: 'ready',
      openAvatarUrl: 'http://127.0.0.1:8282',
    });
    mocks.connectOpenAvatar.mockResolvedValue(connection);
    mocks.destroyAvatarSession.mockResolvedValue(undefined);
    const view = render(<LiteAvatarStage status="ready" />);

    await waitFor(() => expect(mocks.connectOpenAvatar).toHaveBeenCalledTimes(1));
    expect(mocks.createAvatarSession).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('liteavatar-video')).toBeTruthy();
    expect(screen.getByText('准备中')).toBeTruthy();

    view.unmount();

    await waitFor(() => {
      expect(mocks.closeOpenAvatar).toHaveBeenCalledWith(connection);
      expect(mocks.destroyAvatarSession).toHaveBeenCalledWith('a5-guide-123');
    });
  });

  it('retries gently after avatar connection failure', async () => {
    mocks.createAvatarSession
      .mockResolvedValueOnce({
        sessionId: 'failed-session',
        status: 'ready',
        openAvatarUrl: 'http://127.0.0.1:8282',
      })
      .mockResolvedValueOnce({
        sessionId: 'recovered-session',
        status: 'ready',
        openAvatarUrl: 'http://127.0.0.1:8282',
      });
    mocks.connectOpenAvatar
      .mockRejectedValueOnce(new Error('connection failed'))
      .mockResolvedValueOnce({ peer: {}, dataChannel: {} });
    mocks.destroyAvatarSession.mockResolvedValue(undefined);

    render(<LiteAvatarStage status="ready" retryDelayMs={1} />);

    await waitFor(() => expect(screen.getByText('未连接')).toBeTruthy());
    await waitFor(() => expect(mocks.connectOpenAvatar).toHaveBeenCalledTimes(2));
    expect(mocks.destroyAvatarSession).toHaveBeenCalledWith('failed-session');
  });

  it('stops reconnecting after the configured retry limit', async () => {
    let sessionNumber = 0;
    mocks.createAvatarSession.mockImplementation(async () => ({
      sessionId: `failed-session-${++sessionNumber}`,
      status: 'ready',
      openAvatarUrl: 'http://127.0.0.1:8282',
    }));
    mocks.connectOpenAvatar.mockRejectedValue(new Error('connection failed'));
    mocks.destroyAvatarSession.mockResolvedValue(undefined);

    render(
      <LiteAvatarStage
        status="ready"
        retryDelayMs={1}
        maxReconnectAttempts={2}
      />,
    );

    await waitFor(() => expect(mocks.connectOpenAvatar).toHaveBeenCalledTimes(3));
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(mocks.connectOpenAvatar).toHaveBeenCalledTimes(3);
  });

  it('replaces a session after an established connection drops', async () => {
    const sessions = ['first-session', 'second-session'];
    const states: Array<(state: RTCPeerConnectionState) => void> = [];
    mocks.createAvatarSession.mockImplementation(async () => ({
      sessionId: sessions.shift(),
      status: 'ready',
      openAvatarUrl: 'http://127.0.0.1:8282',
    }));
    mocks.connectOpenAvatar.mockImplementation(async (options) => {
      states.push(options.onConnectionStateChange);
      return { peer: {}, dataChannel: {} };
    });
    mocks.destroyAvatarSession.mockResolvedValue(undefined);

    render(<LiteAvatarStage status="ready" retryDelayMs={1} />);
    await waitFor(() => expect(mocks.connectOpenAvatar).toHaveBeenCalledTimes(1));

    act(() => states[0]('disconnected'));

    await waitFor(() => expect(mocks.connectOpenAvatar).toHaveBeenCalledTimes(2));
    expect(mocks.closeOpenAvatar).toHaveBeenCalledTimes(1);
    expect(mocks.destroyAvatarSession).toHaveBeenCalledWith('first-session');
  });
});
