import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(projectRoot, '..');
const workspaceBrowserPath = path.join(workspaceRoot, '.cache', 'ms-playwright');
const browserPath = existsSync(workspaceBrowserPath) ? workspaceBrowserPath : undefined;
const outputDir = path.join(projectRoot, 'test-results', 'haru-live2d');
const baseUrl = process.env.HARU_VERIFY_URL || 'http://127.0.0.1:5173';
const backendUrl = process.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8001';
const fastMode = process.env.HARU_VERIFY_FAST === 'true';

if (browserPath) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = browserPath;
}

const { chromium } = await import('@playwright/test');
let browser;

const hardTimeout = setTimeout(() => {
  console.error('[verify-haru-live2d] timed out after 120s');
  process.exit(1);
}, 120_000);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    console.error(`[verify-haru-live2d] received ${signal}, cleaning up`);
    process.exit(130);
  });
}

function failIf(condition, message) {
  if (condition) {
    throw new Error(message);
  }
}

async function isReady(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForReady(url) {
  for (let index = 0; index < 20; index += 1) {
    if (await isReady(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${url} did not become ready`);
}

await mkdir(outputDir, { recursive: true });
console.log(`[verify-haru-live2d] using ${baseUrl}, backend ${backendUrl}`);
await waitForReady(baseUrl);
await waitForReady(`${backendUrl}/health`);

browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript(() => {
  localStorage.setItem('a5_visitor_token', 'valid-visitor-token');
});
await page.route('**/api/auth/me', async (route) => {
  const authorization = route.request().headers().authorization || '';
  if (authorization === 'Bearer valid-visitor-token') {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'user-1', username: 'visitor_001', role: 'visitor' }),
    });
    return;
  }
  await route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ message: '登录状态无效', code: 'AUTH_TOKEN_INVALID', status: 401 }),
  });
});
page.setDefaultTimeout(15_000);
const waitForCheck = (normalMs, fastMs) => page.waitForTimeout(fastMode ? fastMs : normalMs);
const consoleErrors = [];
const pageErrors = [];
const shots = [];

page.on('console', (message) => {
  if (message.type() === 'error') {
    consoleErrors.push(message.text());
  }
});
page.on('pageerror', (error) => pageErrors.push(error.message));

async function snapshot(name) {
  const fileName = `${shots.length + 1}-${name}.png`;
  const filePath = path.join(outputDir, fileName);
  await page.screenshot({ path: filePath, fullPage: false });
  shots.push(fileName);
}

async function avatarState() {
  return page.evaluate(() => {
    const shell = document.querySelector('.avatar-stage-shell');
    const stage = document.querySelector('.live2d-stage');
    const canvas = document.querySelector('.live2d-canvas');
    const stageRect = stage?.getBoundingClientRect();
    const rect = canvas?.getBoundingClientRect();
    return {
      hasBarePresentation: document.querySelector('.avatar-guide--bare') !== null,
      bareDecorationCount: document.querySelectorAll(
        '.avatar-guide--bare .avatar-aura, .avatar-guide--bare .avatar-scan-ring, .avatar-guide--bare .avatar-light-dots, .avatar-guide--bare .avatar-speech-wave, .avatar-guide--bare .live2d-stage-hint',
      ).length,
      shellClass: shell?.className ?? null,
      shellVisuals: shell
        ? {
            backgroundColor: getComputedStyle(shell).backgroundColor,
            borderTopWidth: getComputedStyle(shell).borderTopWidth,
            boxShadow: getComputedStyle(shell).boxShadow,
          }
        : null,
      stageClass: stage?.className ?? null,
      canvasCss: rect
        ? {
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            x: Math.round(rect.x),
            y: Math.round(rect.y),
          }
        : null,
      stageCss: stageRect
        ? {
            width: Math.round(stageRect.width),
            height: Math.round(stageRect.height),
          }
        : null,
      canvasBuffer: canvas ? { width: canvas.width, height: canvas.height } : null,
      hasDebugApi: Boolean(window.__live2dGuideDebug),
      isTapped: stage?.className?.includes('is-tapped') ?? false,
      hasHorizontalOverflow:
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      bodyText: document.body.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    };
  });
}

try {
  console.log('[verify-haru-live2d] open guide');
  await page.goto(`${baseUrl}/guide`, { waitUntil: 'domcontentloaded' });
  await waitForCheck(9000, 1800);
  const initial = await avatarState();
  await snapshot('initial');
  failIf(!initial.hasBarePresentation, 'Guide avatar is not using the bare presentation');
  failIf(initial.bareDecorationCount !== 0, 'Bare guide avatar renders non-avatar decoration');
  failIf(initial.shellClass !== 'avatar-stage-shell has-live2d', 'Live2D shell is not active');
  failIf(initial.shellVisuals?.backgroundColor !== 'rgba(0, 0, 0, 0)', 'Bare Live2D shell still has a background');
  failIf(initial.shellVisuals?.borderTopWidth !== '0px', 'Bare Live2D shell still has a border');
  failIf(initial.stageClass !== 'live2d-stage live2d-stage-ready', 'Live2D stage is not ready');
  failIf(!initial.hasDebugApi, 'Haru debug motion API is not available');
  failIf(initial.hasHorizontalOverflow, 'Guide page has horizontal overflow');
  failIf(!initial.canvasCss || !initial.stageCss || !initial.canvasBuffer, 'Live2D canvas was not rendered');
  failIf(
    initial.canvasBuffer.width < initial.stageCss.width * 1.8,
    `Canvas buffer is too small for sharp rendering: ${JSON.stringify(initial)}`,
  );

  await page.locator('.avatar-stage-shell').screenshot({
    path: path.join(outputDir, 'live2d-stage.png'),
  });

  console.log('[verify-haru-live2d] tap feedback');
  const avatarBox = await page.locator('.avatar-stage-shell').boundingBox();
  failIf(!avatarBox, 'Avatar shell has no bounding box');
  await page.mouse.click(avatarBox.x + avatarBox.width * 0.48, avatarBox.y + avatarBox.height * 0.44);
  await waitForCheck(650, 280);
  await snapshot('tap-motion');
  await waitForCheck(1800, 2100);
  const tapReset = await avatarState();
  await snapshot('tap-reset');
  failIf(tapReset.isTapped, 'Tap feedback class did not reset');

  console.log('[verify-haru-live2d] wait for sleep');
  await waitForCheck(33000, 400);
  await snapshot('sleep');

  console.log('[verify-haru-live2d] ask backend question');
  const realApiQuestion = 'Haru real backend check';
  await page.locator('.chat-input-row textarea, .chat-input-row input').first().fill(realApiQuestion);
  await page.getByTestId('guide-send').click();
  await waitForCheck(1200, 800);
  await snapshot('wake-thinking');
  await waitForCheck(3600, 1200);
  await snapshot('speaking-motion');
  await waitForCheck(16000, 5000);
  const afterQuestion = await avatarState();
  await snapshot('wake-and-answer');
  failIf(afterQuestion.bodyText.includes('问答服务异常'), 'Guide still shows service error');
  failIf(afterQuestion.bodyText.includes('兜底回答'), 'Guide returned fallback answer');
  failIf(!afterQuestion.bodyText.includes(realApiQuestion), 'User question was not rendered');

  console.log('[verify-haru-live2d] mobile check');
  await page.setViewportSize({ width: 390, height: 820 });
  await page.goto(`${baseUrl}/guide`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.scrollTo(0, 0));
  await waitForCheck(9000, 1800);
  const mobile = await avatarState();
  await snapshot('mobile-initial');
  failIf(mobile.hasHorizontalOverflow, 'Guide page has horizontal overflow on mobile');
  failIf(mobile.shellClass !== 'avatar-stage-shell has-live2d', 'Mobile Live2D shell is not active');

  failIf(consoleErrors.length > 0, `Console errors:\n${consoleErrors.join('\n')}`);
  failIf(pageErrors.length > 0, `Page errors:\n${pageErrors.join('\n')}`);

  const result = {
    ok: true,
    baseUrl,
    outputDir,
    shots,
    initial: {
      shellClass: initial.shellClass,
      stageClass: initial.stageClass,
      canvasCss: initial.canvasCss,
      canvasBuffer: initial.canvasBuffer,
    },
    afterQuestion: {
      shellClass: afterQuestion.shellClass,
      stageClass: afterQuestion.stageClass,
      canvasCss: afterQuestion.canvasCss,
      canvasBuffer: afterQuestion.canvasBuffer,
    },
    mobile: {
      shellClass: mobile.shellClass,
      stageClass: mobile.stageClass,
      canvasCss: mobile.canvasCss,
      canvasBuffer: mobile.canvasBuffer,
    },
  };
  await writeFile(path.join(outputDir, 'result.json'), JSON.stringify(result, null, 2), 'utf-8');
  console.log(JSON.stringify(result, null, 2));
} finally {
  clearTimeout(hardTimeout);
  if (browser) {
    await browser.close();
  }
}
