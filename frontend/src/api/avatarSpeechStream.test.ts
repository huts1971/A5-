import { describe, expect, it, vi } from 'vitest';

import { createAvatarSpeechStream } from './avatarSpeechStream';

describe('avatar speech stream', () => {
  it('forwards answer deltas in order and explicitly closes the stream', async () => {
    const submit = vi.fn().mockResolvedValue(true);
    const stream = createAvatarSpeechStream({
      sessionId: 'a5-guide-123',
      streamId: 'answer-123',
      submit,
    });

    stream.write('第一段，');
    stream.write('第二段。');
    await stream.close();

    expect(submit.mock.calls).toEqual([
      [
        'a5-guide-123',
        { streamId: 'answer-123', text: '第一段，', end: false },
      ],
      [
        'a5-guide-123',
        { streamId: 'answer-123', text: '第二段。', end: false },
      ],
      [
        'a5-guide-123',
        { streamId: 'answer-123', text: '', end: true },
      ],
    ]);
  });

  it('drops queued old deltas when a newer question cancels the stream', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstSubmit = new Promise<boolean>((resolve) => {
      releaseFirst = () => resolve(true);
    });
    const submit = vi.fn().mockReturnValueOnce(firstSubmit).mockResolvedValue(true);
    const stream = createAvatarSpeechStream({
      sessionId: 'a5-guide-123',
      streamId: 'old-answer',
      submit,
    });

    stream.write('已经提交的一段');
    stream.write('必须丢弃的旧内容');
    await Promise.resolve();
    const canceled = stream.cancel();
    releaseFirst?.();
    await canceled;

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(
      'a5-guide-123',
      { streamId: 'old-answer', text: '已经提交的一段', end: false },
    );
  });
});
