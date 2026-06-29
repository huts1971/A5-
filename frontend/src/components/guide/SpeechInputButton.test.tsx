// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SpeechInputButton from './SpeechInputButton';

describe('SpeechInputButton', () => {
  afterEach(cleanup);

  it('uses explicit start and stop clicks for avatar microphone recording', async () => {
    const onStart = vi.fn().mockResolvedValue(undefined);
    const onStop = vi.fn().mockResolvedValue(undefined);
    render(
      <SpeechInputButton
        iconOnly
        onTranscript={vi.fn()}
        onStartRecording={onStart}
        onStopRecording={onStop}
      />,
    );

    fireEvent.click(screen.getByTestId('guide-voice-input'));
    await waitFor(() => expect(onStart).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('停止语音输入');

    fireEvent.click(screen.getByTestId('guide-voice-input'));
    await waitFor(() => expect(onStop).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('语音输入');
  });

  it('returns to an idle button and reports a light error when permission is denied', async () => {
    const onError = vi.fn();
    render(
      <SpeechInputButton
        iconOnly
        onTranscript={vi.fn()}
        onError={onError}
        onStartRecording={vi.fn().mockRejectedValue(new Error('not allowed'))}
        onStopRecording={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('guide-voice-input'));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('麦克风启动失败，请检查浏览器权限。');
    });
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('语音输入');
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(false);
  });
});
