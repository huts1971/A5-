import type { ChatMessage } from '../../types/scenic';

export const WELCOME_MESSAGE_TEXT =
  '你好，我是灵诗音，灵山胜境 AI 导游。你可以问我景点故事、游览路线、亲子建议或拍照点位，我会结合景区资料为你讲解。';

export const WELCOME_MESSAGE_AUDIO_URL: string | undefined = undefined;

export const initialGuideMessages: ChatMessage[] = [
  {
    id: 'assistant-welcome',
    role: 'assistant',
    content: WELCOME_MESSAGE_TEXT,
    audioUrl: WELCOME_MESSAGE_AUDIO_URL,
    ttsStatus: 'ready',
  },
];
