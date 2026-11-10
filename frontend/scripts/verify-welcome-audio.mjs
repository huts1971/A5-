import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modulePath = resolve(root, 'src/components/guide/welcomeMessage.ts');

if (!existsSync(modulePath)) {
  throw new Error('welcomeMessage.ts does not exist');
}

const moduleText = readFileSync(modulePath, 'utf8');
if (!moduleText.includes('WELCOME_MESSAGE_AUDIO_URL: string | undefined = undefined')) {
  throw new Error('welcome message must avoid stale static audio until a matching Ling Shiyin asset exists');
}

if (!moduleText.includes('你好，我是灵诗音，灵山胜境 AI 导游')) {
  throw new Error('welcome message text is missing the expected guide greeting');
}

if (moduleText.includes('/audio/guide-welcome.mp3')) {
  throw new Error('welcome message must not reference the old static guide-welcome audio');
}

console.log(JSON.stringify({ ok: true, audioUrl: null }));
