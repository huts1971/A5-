// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ChatBox from './ChatBox';

describe('ChatBox input', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(cleanup);

  it('inserts a line break with Shift+Enter without sending', () => {
    const onSend = vi.fn();
    render(<ChatBox onSend={onSend} />);
    const input = screen.getByLabelText('输入问题') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '第一行第二行' } });
    input.setSelectionRange(3, 3);

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });

    expect(input.value).toBe('第一行\n第二行');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('sends multiline content with Enter', () => {
    const onSend = vi.fn();
    render(<ChatBox onSend={onSend} />);
    const input = screen.getByLabelText('输入问题') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '第一行\n第二行' } });

    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSend).toHaveBeenCalledWith('第一行\n第二行');
    expect(input.value).toBe('');
  });

  it('grows the input as long content wraps', () => {
    render(<ChatBox onSend={vi.fn()} />);
    const input = screen.getByLabelText('输入问题') as HTMLTextAreaElement;
    Object.defineProperty(input, 'scrollHeight', {
      configurable: true,
      value: 66,
    });

    fireEvent.change(input, {
      target: { value: '这是一段足够长的内容，用于验证聊天输入框可以自动折行并增加显示高度。' },
    });

    expect(input.wrap).toBe('soft');
    expect(input.style.height).toBe('66px');
  });
});
