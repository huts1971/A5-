export interface OpenAvatarConnectionOptions {
  bridgeUrl: string;
  sessionId: string;
  videoElement: HTMLVideoElement;
  onTranscript?: (text: string) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
  onPlaybackStateChange?: (state: 'speaking' | 'ready') => void;
}

export interface OpenAvatarConnection {
  peer: RTCPeerConnection;
  dataChannel: RTCDataChannel;
  audioSender: RTCRtpSender;
}

export async function connectOpenAvatar({
  bridgeUrl,
  sessionId,
  videoElement,
  onTranscript,
  onConnectionStateChange,
  onPlaybackStateChange,
}: OpenAvatarConnectionOptions): Promise<OpenAvatarConnection> {
  videoElement.muted = true;
  const peer = new RTCPeerConnection();
  peer.addEventListener('connectionstatechange', () => {
    onConnectionStateChange?.(peer.connectionState);
  });
  const audioTransceiver = peer.addTransceiver('audio', { direction: 'sendrecv' });
  peer.addTransceiver('video', { direction: 'sendrecv' });
  peer.addEventListener('track', (event) => {
    const stream = event.streams[0] ?? new MediaStream([event.track]);
    if (videoElement.srcObject !== stream) {
      videoElement.srcObject = stream;
      void videoElement.play?.().catch(() => undefined);
    }
  });
  const dataChannel = peer.createDataChannel('text');
  dataChannel.addEventListener('message', (event) => {
    try {
      const message = JSON.parse(String(event.data)) as {
        header?: { name?: string };
        payload?: {
          text?: string;
          end_of_speech?: boolean;
          type?: string;
          stream_type?: string;
        };
      };
      const text = message.payload?.text?.trim();
      if (
        message.header?.name === 'EchoHumanText' &&
        message.payload?.end_of_speech === true &&
        text
      ) {
        onTranscript?.(text);
      }
      if (
        message.header?.name === 'ChatSignal' &&
        message.payload?.stream_type === 'client_playback'
      ) {
        if (message.payload.type === 'stream_begin') {
          videoElement.muted = false;
          void videoElement.play?.().catch(() => undefined);
          onPlaybackStateChange?.('speaking');
        }
        if (message.payload.type === 'stream_end' || message.payload.type === 'stream_cancel') {
          onPlaybackStateChange?.('ready');
        }
      }
    } catch {
      // OpenAvatarChat also sends non-JSON control messages on this channel.
    }
  });
  const exchange = (payload: Record<string, unknown>) =>
    fetch(`${bridgeUrl}/api/avatar/webrtc/offer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  const pendingIceCandidates: Record<string, unknown>[] = [];
  let remoteDescriptionReady = false;
  peer.onicecandidate = ({ candidate }) => {
    if (!candidate) return;
    const payload = {
      candidate: candidate.toJSON(),
      webrtc_id: sessionId,
      type: 'ice-candidate',
    };
    if (!remoteDescriptionReady) {
      pendingIceCandidates.push(payload);
      return;
    }
    void exchange(payload);
  };
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  const response = await exchange({
    sdp: peer.localDescription?.sdp,
    type: peer.localDescription?.type,
    webrtc_id: sessionId,
  });
  if (!response.ok) {
    throw new Error(`avatar_webrtc_offer_failed_${response.status}`);
  }
  const answer = (await response.json()) as RTCSessionDescriptionInit;
  await peer.setRemoteDescription(answer);
  remoteDescriptionReady = true;
  await Promise.all(pendingIceCandidates.map(exchange));
  return { peer, dataChannel, audioSender: audioTransceiver.sender };
}

export function closeOpenAvatar(connection: OpenAvatarConnection): void {
  connection.dataChannel.close();
  connection.peer.getTransceivers().forEach((transceiver) => transceiver.stop());
  connection.peer.getSenders().forEach((sender) => sender.track?.stop());
  connection.peer.close();
}

export async function startAvatarMicrophone(
  connection: OpenAvatarConnection,
): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      sampleRate: 16000,
      channelCount: 1,
      autoGainControl: false,
      noiseSuppression: false,
      echoCancellation: true,
    },
  });
  const track = stream.getAudioTracks()[0];
  if (!track) {
    stream.getTracks().forEach((item) => item.stop());
    throw new Error('avatar_microphone_track_missing');
  }
  await connection.audioSender.replaceTrack(track);
  return stream;
}

export async function stopAvatarMicrophone(
  connection: OpenAvatarConnection,
  stream: MediaStream,
): Promise<void> {
  await connection.audioSender.replaceTrack(null);
  stream.getTracks().forEach((track) => track.stop());
}
