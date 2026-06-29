import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  connectOpenAvatar,
  startAvatarMicrophone,
  stopAvatarMicrophone,
} from './avatarConnection';

describe('OpenAvatar connection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('negotiates LiteAvatar media with the guide session id', async () => {
    const dataChannelListeners: Record<string, (event: MessageEvent) => void> = {};
    const dataChannel = {
      close: vi.fn(),
      addEventListener: vi.fn((name: string, listener: (event: MessageEvent) => void) => {
        dataChannelListeners[name] = listener;
      }),
    };
    const onTranscript = vi.fn();
    const onConnectionStateChange = vi.fn();
    const onPlaybackStateChange = vi.fn();
    const peerListeners: Record<string, (event?: unknown) => void> = {};
    const addTransceiver = vi.fn().mockImplementation(() => ({
      sender: { replaceTrack: vi.fn() },
    }));
    const setRemoteDescription = vi.fn().mockResolvedValue(undefined);
    const peer = {
      connectionState: 'new',
      addEventListener: vi.fn((name: string, listener: () => void) => {
        peerListeners[name] = listener;
      }),
      addTransceiver,
      createDataChannel: vi.fn().mockReturnValue(dataChannel),
      createOffer: vi.fn().mockResolvedValue({ sdp: 'local-offer', type: 'offer' }),
      setLocalDescription: vi.fn().mockResolvedValue(undefined),
      localDescription: { sdp: 'local-offer', type: 'offer' },
      setRemoteDescription,
      getTransceivers: vi.fn().mockReturnValue([]),
      getSenders: vi.fn().mockReturnValue([]),
      close: vi.fn(),
      onicecandidate: null as ((event: { candidate: { toJSON: () => object } | null }) => void) | null,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ sdp: 'server-answer', type: 'answer' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('RTCPeerConnection', vi.fn().mockReturnValue(peer));
    vi.stubGlobal('fetch', fetchMock);
    const fallbackStream = { id: 'stream-from-track' };
    const MediaStreamMock = vi.fn().mockReturnValue(fallbackStream);
    vi.stubGlobal('MediaStream', MediaStreamMock);
    const videoElement = {
      srcObject: null,
      muted: false,
      play: vi.fn().mockResolvedValue(undefined),
    };
    peer.setLocalDescription.mockImplementation(async () => {
      peer.onicecandidate?.({
        candidate: { toJSON: () => ({ candidate: 'local-candidate' }) },
      });
    });

    await connectOpenAvatar({
      bridgeUrl: 'http://127.0.0.1:8283',
      sessionId: 'a5-guide-123',
      videoElement: videoElement as unknown as HTMLVideoElement,
      onTranscript,
      onConnectionStateChange,
      onPlaybackStateChange,
    });

    expect(addTransceiver).toHaveBeenCalledWith('audio', { direction: 'sendrecv' });
    expect(addTransceiver).toHaveBeenCalledWith('video', { direction: 'sendrecv' });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:8283/api/avatar/webrtc/offer',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          sdp: 'local-offer',
          type: 'offer',
          webrtc_id: 'a5-guide-123',
        }),
      }),
    );
    expect(setRemoteDescription).toHaveBeenCalledWith({
      sdp: 'server-answer',
      type: 'answer',
    });

    const remoteTrack = { kind: 'video' };
    peerListeners.track({ streams: [], track: remoteTrack });
    expect(MediaStreamMock).toHaveBeenCalledWith([remoteTrack]);
    expect(videoElement.srcObject).toBe(fallbackStream);
    expect(videoElement.muted).toBe(true);
    expect(videoElement.play).toHaveBeenCalled();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://127.0.0.1:8283/api/avatar/webrtc/offer',
      expect.objectContaining({
        body: JSON.stringify({
          candidate: { candidate: 'local-candidate' },
          webrtc_id: 'a5-guide-123',
          type: 'ice-candidate',
        }),
      }),
    );

    dataChannelListeners.message(
      new MessageEvent('message', {
        data: JSON.stringify({
          header: { name: 'EchoHumanText' },
          payload: { text: '请介绍灵山大佛', end_of_speech: true },
        }),
      }),
    );
    expect(onTranscript).toHaveBeenCalledWith('请介绍灵山大佛');

    peer.connectionState = 'disconnected';
    peerListeners.connectionstatechange();
    expect(onConnectionStateChange).toHaveBeenCalledWith('disconnected');

    dataChannelListeners.message(
      new MessageEvent('message', {
        data: JSON.stringify({
          header: { name: 'ChatSignal' },
          payload: { type: 'stream_begin', stream_type: 'client_playback' },
        }),
      }),
    );
    expect(videoElement.muted).toBe(false);
    expect(videoElement.play).toHaveBeenCalledTimes(2);
    dataChannelListeners.message(
      new MessageEvent('message', {
        data: JSON.stringify({
          header: { name: 'ChatSignal' },
          payload: { type: 'stream_end', stream_type: 'client_playback' },
        }),
      }),
    );
    expect(onPlaybackStateChange.mock.calls).toEqual([['speaking'], ['ready']]);
  });

  it('attaches microphone audio only between explicit start and stop clicks', async () => {
    const track = { stop: vi.fn() };
    const stream = {
      getAudioTracks: vi.fn().mockReturnValue([track]),
      getTracks: vi.fn().mockReturnValue([track]),
    };
    const replaceTrack = vi.fn().mockResolvedValue(undefined);
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const connection = {
      peer: {},
      dataChannel: {},
      audioSender: { replaceTrack },
    };

    const microphone = await startAvatarMicrophone(connection as never);
    await stopAvatarMicrophone(connection as never, microphone);

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        autoGainControl: false,
        noiseSuppression: false,
        echoCancellation: true,
      },
    });
    expect(replaceTrack.mock.calls).toEqual([[track], [null]]);
    expect(track.stop).toHaveBeenCalledTimes(1);
  });
});
