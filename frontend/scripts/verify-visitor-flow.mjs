import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stopProcessTree } from './process-tree.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(projectRoot, '..');
const workspaceBrowserPath = path.join(workspaceRoot, '.cache', 'ms-playwright');
const browserPath = existsSync(workspaceBrowserPath) ? workspaceBrowserPath : undefined;
const browserExecutable = process.env.VISITOR_BROWSER_EXECUTABLE;
const outputDir = path.join(projectRoot, 'test-results', 'visitor-flow');
const baseUrl = process.env.VISITOR_VERIFY_URL || 'http://127.0.0.1:5176';
const localNodeBin = path.join(workspaceRoot, '.tools', 'node', 'bin');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : path.join(localNodeBin, 'npm');

const routes = [
  { path: '/', title: '灵山胜境景点导览', shot: '01-home-desktop.png' },
  { path: '/spots', title: null, shot: '02-spots-desktop.png' },
  { path: '/spots/yuanxiang-hall', title: '远香堂', shot: '03-spot-detail-desktop.png' },
  { path: '/routes', title: '个性化路线推荐', shot: '04-routes-desktop.png' },
  { path: '/guide', title: '灵诗音', shot: '05-guide-desktop.png' },
];

async function isServerReady() {
  try {
    const response = await fetch(baseUrl);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer() {
  for (let i = 0; i < 30; i += 1) {
    if (await isServerReady()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Vite server did not become ready at ${baseUrl}`);
}

async function ensureServer() {
  if (await isServerReady()) {
    return undefined;
  }

  const child = spawn('npm.cmd run dev:visitor -- --port 5176', {
    cwd: projectRoot,
    env: {
      ...process.env,
      ...(browserPath ? { PLAYWRIGHT_BROWSERS_PATH: browserPath } : {}),
      VITE_USE_MOCK_API: 'true',
    },
    shell: true,
    stdio: 'ignore',
    windowsHide: true,
  });

  await waitForServer();
  return child;
}

function failIf(condition, message) {
  if (condition) {
    throw new Error(message);
  }
}

async function waitForGuideEntryReady(page) {
  await page.waitForFunction(
    () =>
      !document.querySelector('[data-testid="visitor-guide-entry-loader"]') &&
      !document.querySelector('.guide-entry-content--waiting'),
    undefined,
    { timeout: 8000 },
  );
  await page.getByTestId('ai-guide-workbench').waitFor({ timeout: 8000 });
}

function isIgnoredConsoleError(text) {
  return (
    text.includes('Looks like you are rendering without using requestAnimationFrame for the main loop')
    || text.includes('[antd: Select] `popupClassName` is deprecated')
    || text.includes('[antd: Modal] `destroyOnClose` is deprecated')
  );
}

async function main() {
  if (browserPath) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = browserPath;
  }
  const { chromium } = await import('@playwright/test');
  await mkdir(outputDir, { recursive: true });

  const server = await ensureServer();
  const browser = await chromium.launch({ headless: true, ...(browserExecutable ? { executablePath: browserExecutable } : {}) });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  const responseErrors = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      if (isIgnoredConsoleError(message.text())) return;
      const location = message.location();
      consoleErrors.push(
        `${message.text()}${location.url ? ` @ ${location.url}:${location.lineNumber ?? 0}` : ''}`,
      );
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.status() >= 400) {
      responseErrors.push(`${response.status()} ${response.url()}`);
    }
  });

  try {
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

    await page.addInitScript(() => {
      localStorage.setItem('a5_visitor_token', 'valid-visitor-token');
    });

    const routeResults = [];

    for (const route of routes) {
      await page.goto(`${baseUrl}${route.path}`, { waitUntil: 'networkidle' });
      const body = await page.locator('body').innerText();
      if (route.title) {
        failIf(!body.includes(route.title), `Missing expected text on ${route.path}: ${route.title}`);
      }
      failIf((await page.locator('main').count()) < 1, `Missing main content on ${route.path}`);
      if (route.path === '/') {
        const sidebar = page.locator('.visitor-sider');
        await sidebar.waitFor({ timeout: 5000 });
        const sidebarText = await sidebar.innerText();
        failIf(sidebarText.includes('[ OPS ]'), 'Visitor entry must not expose OPS navigation');
        failIf(!sidebarText.includes('景区导览'), 'Signed-in visitor shell must expose the scenic navigation group');
        failIf(
          (await sidebar.locator('.visitor-primary-menu .ant-menu-item').count()) !== 3,
          'Signed-in visitor shell must render exactly three navigation children',
        );
      }
      if (route.path === '/spots') {
        const serviceMenu = page.getByTestId('guide-service-menu');
        await serviceMenu.waitFor({ timeout: 5000 });
        failIf(
          (await serviceMenu.locator('[data-testid^="guide-service-"]').count()) !== 5,
          'Scenic overview must retain the five scenic service actions',
        );
        await page.getByTestId('guide-service-restroom').click();
        const serviceDialog = page.getByRole('dialog', { name: '景区服务地图' });
        await serviceDialog.waitFor({ timeout: 5000 });
        await page.getByRole('button', { name: '关闭景区服务地图' }).click();
        failIf(
          await page.getByRole('dialog', { name: '景区服务地图' }).count(),
          'Scenic overview service map dialog did not close',
        );

        const reel = page.getByTestId('spot-reel');
        await reel.waitFor({ timeout: 5000 });
        failIf((await page.getByTestId('spot-reel-card').count()) !== 5, 'Mock scenic spots were not rendered in the reel');
        failIf(
          !(await page.locator('.spot-reel__image').first().evaluate((image) => image.complete && image.naturalWidth > 0)),
          'The active scenic image did not load',
        );
        const cardWidth = await reel.evaluate((element) =>
          Number.parseFloat(getComputedStyle(element).getPropertyValue('--reel-card-width')),
        );
        failIf(cardWidth > 155 || cardWidth < 94, `Scenic reel card width is outside its 50% size range: ${cardWidth}`);

        const rotor = page.getByTestId('spot-reel-rotor');
        const activeCaption = page.getByTestId('spot-reel-active-name');
        await activeCaption.waitFor({ timeout: 5000 });
        const activeLabel = await page.locator('.spot-reel__card[aria-current="true"]').getAttribute('aria-label');
        const initialCaption = (await activeCaption.innerText()).trim();
        failIf(activeLabel !== `查看${initialCaption}详情`, 'The scenic reel caption does not match the active scenic spot');
        const initialAngle = await rotor.evaluate((element) => element.style.getPropertyValue('--reel-rotation'));
        await page.waitForTimeout(700);
        const autoAngle = await rotor.evaluate((element) => element.style.getPropertyValue('--reel-rotation'));
        failIf(initialAngle === autoAngle, 'The scenic reel did not advance automatically');

        await reel.focus();
        const activeBeforeKeyboard = await page.locator('.spot-reel__card[aria-current="true"]').getAttribute('href');
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(520);
        const activeAfterKeyboard = await page.locator('.spot-reel__card[aria-current="true"]').getAttribute('href');
        failIf(activeBeforeKeyboard === activeAfterKeyboard, 'Arrow navigation did not select the next scenic spot');
        const labelAfterKeyboard = await page.locator('.spot-reel__card[aria-current="true"]').getAttribute('aria-label');
        const captionAfterKeyboard = (await activeCaption.innerText()).trim();
        failIf(labelAfterKeyboard !== `查看${captionAfterKeyboard}详情`, 'The scenic reel caption did not follow keyboard selection');

        await reel.hover();
        const angleBeforeWheel = await rotor.evaluate((element) => element.style.getPropertyValue('--reel-rotation'));
        await page.mouse.wheel(0, 240);
        await page.waitForTimeout(240);
        const angleAfterWheel = await rotor.evaluate((element) => element.style.getPropertyValue('--reel-rotation'));
        failIf(angleBeforeWheel === angleAfterWheel, 'Mouse wheel did not rotate the scenic reel');

        await page.waitForTimeout(3000);
        const hoverCooldownAngle = await rotor.evaluate((element) => element.style.getPropertyValue('--reel-rotation'));
        await page.waitForTimeout(800);
        const hoverResumeAngle = await rotor.evaluate((element) => element.style.getPropertyValue('--reel-rotation'));
        failIf(hoverCooldownAngle === hoverResumeAngle, 'The scenic reel did not resume while the mouse remained over it');

        await reel.focus();
        const focusStartAngle = await rotor.evaluate((element) => element.style.getPropertyValue('--reel-rotation'));
        await page.waitForTimeout(800);
        const focusResumeAngle = await rotor.evaluate((element) => element.style.getPropertyValue('--reel-rotation'));
        failIf(focusStartAngle === focusResumeAngle, 'The scenic reel paused indefinitely while it retained keyboard focus');

        const reelBox = await reel.boundingBox();
        if (!reelBox) {
          throw new Error('The scenic reel does not have a draggable bounding box');
        }
        await page.mouse.move(reelBox.x + reelBox.width / 2, reelBox.y + reelBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(reelBox.x + reelBox.width / 2 + 72, reelBox.y + reelBox.height / 2, { steps: 4 });
        await page.mouse.up();
        await page.waitForTimeout(3000);
        const dragCooldownAngle = await rotor.evaluate((element) => element.style.getPropertyValue('--reel-rotation'));
        await page.waitForTimeout(800);
        const dragResumeAngle = await rotor.evaluate((element) => element.style.getPropertyValue('--reel-rotation'));
        failIf(dragCooldownAngle === dragResumeAngle, 'The scenic reel did not resume after dragging while the mouse remained over it');

        const activeCard = page.locator('.spot-reel__card[aria-current="true"]');
        const activeHref = await activeCard.getAttribute('href');
        await page.goto(`${baseUrl}${activeHref}`, { waitUntil: 'networkidle' });
        await page.goBack({ waitUntil: 'networkidle' });
      }
      await page.screenshot({ path: path.join(outputDir, route.shot), fullPage: true });
      routeResults.push({ path: route.path, ok: true, screenshot: route.shot });
    }

    await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      Math.random = () => 0;
    });
    await page.locator('a[href="/guide"]').first().click();
    await page.waitForURL('**/guide');
    await waitForGuideEntryReady(page);
    const workspace = page.getByTestId('ai-guide-workbench');
    const chatWindow = page.getByTestId('guide-chat-window');
    const quickPrompts = page.getByTestId('guide-quick-prompts');
    await workspace.waitFor({ timeout: 5000 });
    await chatWindow.waitFor({ timeout: 5000 });
    failIf((await quickPrompts.getByRole('button').count()) !== 4, 'Guide page must render exactly four quick prompts');
    const serviceMenu = page.getByTestId('guide-service-menu');
    failIf(
      (await serviceMenu.locator('[data-testid^="guide-service-"]').count()) !== 5,
      'Guide page must render five service actions',
    );
    await page.getByTestId('guide-service-restroom').click();
    const serviceDialog = page.getByRole('dialog', { name: '景区服务地图' });
    await serviceDialog.waitFor({ timeout: 5000 });
    failIf((await serviceDialog.getByRole('tab').count()) !== 2, 'Service map must expose two scenic map tabs');
    await serviceDialog.getByRole('tab', { name: '拈花湾' }).click();
    failIf((await serviceDialog.getByRole('tab', { name: '拈花湾' }).getAttribute('aria-selected')) !== 'true', 'Service map must switch to Nianhua Bay');
    await page.getByRole('button', { name: '关闭景区服务地图' }).click();
    failIf(await page.getByRole('dialog', { name: '景区服务地图' }).count(), 'Service map dialog did not close');
    failIf((await page.getByTestId('guide-chat-avatar').getAttribute('src')) !== '/avatar/uketsukejou151/avatar-151-head.png', 'Guide chat avatar is not the supplied 151 avatar image');
    const [sidebarBox, routeBarBox, avatarBox, chatBox, promptsBox] = await Promise.all([
      page.locator('.visitor-sider').boundingBox(),
      page.getByTestId('guide-route-context-bar').boundingBox(),
      page.locator('.ai-guide-workbench__avatar').boundingBox(),
      chatWindow.boundingBox(),
      quickPrompts.boundingBox(),
    ]);
    if (!sidebarBox || !routeBarBox || !avatarBox || !chatBox || !promptsBox) {
      throw new Error('Guide workspace and route status bar are not measurable');
    }
    failIf(
      routeBarBox.x < sidebarBox.x + sidebarBox.width + 16,
      'Guide route status bar extends beneath the visitor sidebar',
    );
    failIf(routeBarBox.width > 1381, 'Guide route status bar exceeds its desktop maximum width');
    failIf(!(avatarBox.x < chatBox.x && chatBox.x < promptsBox.x), 'Guide workspace desktop columns are not ordered left-to-right');
    const bareAvatar = await page.locator('.avatar-guide--bare .avatar-stage-shell').evaluate((element) => {
      const style = getComputedStyle(element);
      return { backgroundColor: style.backgroundColor, borderTopWidth: style.borderTopWidth, boxShadow: style.boxShadow };
    });
    failIf(bareAvatar.backgroundColor !== 'rgba(0, 0, 0, 0)', 'Guide avatar still has a stage background');
    failIf(bareAvatar.borderTopWidth !== '0px', 'Guide avatar still has a stage border');
    failIf(
      (await page.locator('.avatar-guide--bare .avatar-aura, .avatar-guide--bare .avatar-scan-ring, .avatar-guide--bare .avatar-light-dots, .avatar-guide--bare .avatar-speech-wave, .avatar-guide--bare .vrm-stage-hint').count()) !== 0,
      'Guide bare avatar must contain only the digital human',
    );
    const typingMessage = page.getByTestId('guide-typing-message');
    await typingMessage.waitFor({ timeout: 1500 }).catch(() => undefined);
    await page.locator('.chat-bubble.assistant').first().waitFor({ timeout: 8000 });
    failIf(
      (await page.locator('.message-input').getAttribute('placeholder')) !== '……',
      'Guide input does not use the source ellipsis placeholder',
    );
    failIf((await page.locator('.message-box > textarea.message-input').count()) !== 1, 'Guide input must use the source textarea structure');
    const guideInputStyle = await page.locator('.message-input').evaluate((element) => {
      const style = getComputedStyle(element);
      return { backgroundColor: style.backgroundColor, borderTopWidth: style.borderTopWidth, borderRadius: style.borderRadius };
    });
    failIf(guideInputStyle.backgroundColor !== 'rgba(0, 0, 0, 0)', 'Guide input must not have an independent background');
    failIf(guideInputStyle.borderTopWidth !== '0px', 'Guide input must not have an independent border');
    failIf(guideInputStyle.borderRadius !== '0px', 'Guide input must not have rounded input framing');
    failIf((await page.getByTestId('guide-send').innerText()).trim() !== '', 'Guide send control must be icon-only');
    failIf((await page.getByTestId('guide-voice-message-input').innerText()).trim() !== '', 'Guide voice control must be icon-only');

    const beforePromptAnswerCount = await page.locator('.chat-bubble.assistant').count();
    await page.getByTestId('guide-prompt-ling-shan-intro').click();
    await page.locator('.chat-bubble.user').last().waitFor({ timeout: 5000 });
    await page.getByTestId('guide-typing-message').waitFor({ timeout: 5000 });
    await page.waitForFunction(
      (count) => document.querySelectorAll('.chat-bubble.assistant').length > count,
      beforePromptAnswerCount,
      { timeout: 8000 },
    );
    const beforeManualAnswerCount = await page.locator('.chat-bubble.assistant').count();
    await page.locator('.chat-input-row textarea, .chat-input-row input').first().fill('远香堂有什么历史故事？');
    await page.getByTestId('guide-send').click();
    await page.getByTestId('guide-typing-message').waitFor({ timeout: 5000 });
    await page.waitForFunction(
      (count) => document.querySelectorAll('.chat-bubble.assistant').length > count,
      beforeManualAnswerCount,
      { timeout: 8000 },
    );
    await page.getByTestId('guide-source-toggle').last().click();
    await page.locator('.source-card').first().waitFor({ timeout: 8000 });
    failIf((await page.locator('.chat-bubble.assistant').count()) < 2, 'AI guide answer was not rendered');
    failIf((await page.locator('.source-card').count()) < 1, 'AI guide source card was not rendered');
    await page.screenshot({ path: path.join(outputDir, '06-guide-chat-result-desktop.png'), fullPage: true });

    await page.locator('.chat-input-row textarea, .chat-input-row input').first().fill('模拟失败');
    await page.getByTestId('guide-send').click();
    await page.getByTestId('guide-typing-message').waitFor({ timeout: 5000 });
    await page.getByText('AI 服务暂时不可用，已为你保留基础游览建议。').waitFor({ timeout: 8000 });
    await page.screenshot({ path: path.join(outputDir, '07-guide-fallback-desktop.png'), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: path.join(outputDir, '08-home-mobile.png'), fullPage: true });
    await page.goto(`${baseUrl}/guide`, { waitUntil: 'networkidle' });
    await waitForGuideEntryReady(page);
    failIf(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      'Guide page has horizontal overflow on mobile',
    );
    failIf((await page.getByTestId('guide-quick-prompts').getByRole('button').count()) < 3, 'Mobile guide lost quick prompts');
    await page.screenshot({ path: path.join(outputDir, '09-guide-mobile.png'), fullPage: true });
    await page.goto(`${baseUrl}/spots`, { waitUntil: 'networkidle' });
    await page.getByTestId('spot-reel').waitFor({ timeout: 5000 });
    await page.screenshot({ path: path.join(outputDir, '10-spots-mobile.png'), fullPage: true });

    failIf(
      consoleErrors.length > 0 || responseErrors.length > 0,
      `Browser request/console errors:\n${[...responseErrors, ...consoleErrors].join('\n')}`,
    );
    failIf(pageErrors.length > 0, `Browser page errors:\n${pageErrors.join('\n')}`);

    console.log(
      JSON.stringify(
        {
          ok: true,
          baseUrl,
          browserPath,
          browserExecutable: browserExecutable ?? 'Playwright bundled Chromium',
          outputDir,
          checkedRoutes: routeResults,
          chatFlow: 'ok',
          screenshots: [
            ...routes.map((route) => route.shot),
            '06-guide-chat-result-desktop.png',
            '07-guide-fallback-desktop.png',
            '08-home-mobile.png',
            '09-guide-mobile.png',
            '10-spots-mobile.png',
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
    if (server) {
      stopProcessTree(server);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
