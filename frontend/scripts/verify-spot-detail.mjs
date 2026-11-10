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
const localNodeBin = path.join(workspaceRoot, '.tools', 'node', 'bin');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : path.join(localNodeBin, 'npm');
const workspaceBrowserPath = path.join(workspaceRoot, '.cache', 'ms-playwright');
const browserPath = existsSync(workspaceBrowserPath) ? workspaceBrowserPath : undefined;
const browserExecutable = process.env.VISITOR_BROWSER_EXECUTABLE;
const baseUrl = process.env.SPOT_DETAIL_VERIFY_URL || 'http://127.0.0.1:5183';
const outputDir = path.join(projectRoot, 'test-results', 'spot-detail');

const fixtures = {
  spot_ls_003: {
    id: 'spot_ls_003',
    name: '佛足坛',
    summary: '佛足坛位于五明桥北侧、菩提大道起点，是景区中轴线上的核心朝圣节点。',
    story: '佛足坛的讲解词。',
    tags: ['佛教文化'],
    visit_minutes: 20,
    crowd_types: ['文化爱好者'],
  },
  spot_ling_shan_buddha: {
    id: 'spot_ling_shan_buddha',
    name: '灵山大佛',
    summary: '灵山大佛是灵山胜境的标志性景观，适合在开阔视野中感受佛教文化与山水格局。',
    story: '灵山大佛的讲解词。',
    tags: ['佛教文化', '地标'],
    visit_minutes: 45,
    crowd_types: ['亲子', '文化爱好者'],
  },
};

function failIf(condition, message) {
  if (condition) throw new Error(message);
}

async function isServerReady() {
  try {
    return (await fetch(baseUrl)).ok;
  } catch {
    return false;
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await isServerReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Vite server did not become ready at ${baseUrl}`);
}

async function ensureServer() {
  if (await isServerReady()) return undefined;

  const server = spawn('npm.cmd run dev:visitor -- --port 5183', {
    cwd: projectRoot,
    env: {
      ...process.env,
      ...(browserPath ? { PLAYWRIGHT_BROWSERS_PATH: browserPath } : {}),
      VITE_USE_MOCK_API: 'false',
    },
    shell: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  let serverError = '';
  server.stderr?.on('data', (chunk) => {
    serverError += chunk.toString();
  });
  try {
    await waitForServer();
  } catch (error) {
    stopProcessTree(server);
    const detail = serverError.trim();
    throw new Error(`${error.message}${detail ? `\n${detail}` : ''}`);
  }
  return server;
}

async function waitForAnimation(page) {
  await page.waitForTimeout(1_350);
}

async function checkSpot(page, id, titles) {
  await page.goto(`${baseUrl}/spots/${id}`, { waitUntil: 'networkidle' });
  await page.getByTestId('spot-detail-slider').waitFor({ timeout: 5_000 });
  failIf((await page.locator('.visitor-header').count()) !== 0, 'Visitor header is visible on an immersive detail page');
  failIf((await page.locator('.spot-detail-slider__questions a').count()) !== 3, 'Expected three glass AI questions');

  const root = page.getByTestId('spot-detail-slider');
  const title = page.locator('[data-title-line="current"]');
  const copy = page.locator('.spot-detail-slider__copy');
  const details = page.locator('.spot-detail-slider__details');
  const photos = page.locator('.spot-detail-slider__photos');
  const summary = page.locator('.spot-detail-slider__summary');
  await title.waitFor({ timeout: 5_000 });
  failIf((await title.innerText()).trim() !== titles[0], `Initial title should be ${titles[0]}`);

  const [rootBox, copyBox, detailsBox, photosBox] = await Promise.all([
    root.boundingBox(),
    copy.boundingBox(),
    details.boundingBox(),
    photos.boundingBox(),
  ]);
  if (!rootBox || !copyBox || !detailsBox || !photosBox) throw new Error('Immersive detail layout is missing a measurable region');
  const viewport = page.viewportSize();
  failIf(rootBox.y < 0 || rootBox.y > 80, 'Immersive detail page does not start directly below the visitor shell');
  failIf(
    !viewport || Math.abs(rootBox.y + rootBox.height - viewport.height) > 1,
    'Immersive detail page does not fill the viewport below the visitor shell',
  );
  failIf(copyBox.x >= photosBox.x || detailsBox.x >= photosBox.x, 'Title, summary, or AI controls are not in the left column');
  failIf(
    await page.evaluate(() => document.scrollingElement.scrollHeight > window.innerHeight + 1),
    'Desktop detail page has vertical document overflow',
  );
  failIf(
    (await summary.evaluate((element) => getComputedStyle(element).overflow)) !== 'visible',
    'Spot summary is still clipped',
  );

  const activeImage = page.locator('.spot-detail-slider__photo-card[data-slot="0"] img');
  await activeImage.waitFor({ timeout: 5_000 });
  failIf(
    !(await activeImage.evaluate((image) => image.complete && image.naturalWidth > 0)),
    `Active image did not load for ${id}`,
  );

  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('[data-testid="spot-detail-slider"]')).getPropertyValue('--detail-tone').trim() !== 'hsl(126 10% 13%)',
  );
  const firstTone = await root.evaluate((element) => getComputedStyle(element).getPropertyValue('--detail-tone').trim());

  await root.focus();
  await page.keyboard.press('ArrowRight');
  await waitForAnimation(page);
  failIf((await title.innerText()).trim() !== titles[1], `Arrow navigation did not reach ${titles[1]}`);
  failIf(
    !(await title.evaluate((element) => element.scrollWidth <= element.clientWidth)),
    `${titles[1]} is clipped horizontally`,
  );
  const nextTone = await root.evaluate((element) => getComputedStyle(element).getPropertyValue('--detail-tone').trim());
  failIf(firstTone === nextTone, 'Background glass tone did not change with the active photo');

  await root.hover();
  const box = await root.boundingBox();
  if (!box) throw new Error('Detail slider has no bounding box');
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5);
  failIf((await page.getByTestId('spot-detail-cursor').getAttribute('data-visible')) !== 'true', 'Follow cursor did not appear');

  const guideHref = await page.locator('.spot-detail-slider__questions a').first().getAttribute('href');
  failIf(!guideHref?.includes(`spotId=${id}`) || !guideHref.includes('question='), 'AI question did not preserve guide context');

  if (titles[2]) {
    await page.keyboard.press('ArrowRight');
    await waitForAnimation(page);
    failIf((await title.innerText()).trim() !== titles[2], `Second navigation did not reach ${titles[2]}`);
  } else {
    await page.mouse.wheel(0, 240);
    await waitForAnimation(page);
    failIf((await title.innerText()).trim() !== titles[0], 'Mouse wheel did not move through a two-photo sequence');
    await page.waitForTimeout(4_250);
    failIf((await title.innerText()).trim() !== titles[1], 'Automatic rotation did not resume after manual navigation');
  }

  return { title: titles.at(-1), tone: nextTone };
}

async function main() {
  if (browserPath) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = browserPath;
  }
  await mkdir(outputDir, { recursive: true });
  const server = await ensureServer();
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: true, ...(browserExecutable ? { executablePath: browserExecutable } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
  await page.addInitScript(() => {
    localStorage.setItem('a5_visitor_token', 'valid-visitor-token');
  });
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
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
  await page.route('**/api/spots/**', async (route) => {
    const spotId = new URL(route.request().url()).pathname.split('/').at(-1);
    const fixture = fixtures[spotId];
    if (!fixture) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'not found' }) });
      return;
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(fixture) });
  });

  try {
    await checkSpot(page, 'spot_ls_003', ['佛足坛', 'Lingshan']);
    await checkSpot(page, 'spot_ling_shan_buddha', ['灵山大佛', 'Lingshan', 'Buddha']);
    await page.screenshot({ path: path.join(outputDir, 'spot-detail-desktop.png'), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${baseUrl}/spots/spot_ling_shan_buddha`, { waitUntil: 'networkidle' });
    await page.getByTestId('spot-detail-slider').waitFor({ timeout: 5_000 });
    failIf(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      'Mobile detail page has horizontal overflow',
    );
    await page.screenshot({ path: path.join(outputDir, 'spot-detail-mobile.png'), fullPage: true });

    failIf(consoleErrors.length > 0, `Browser console errors:\n${consoleErrors.join('\n')}`);
    failIf(pageErrors.length > 0, `Browser page errors:\n${pageErrors.join('\n')}`);
    console.log(JSON.stringify({ ok: true, outputDir, checked: ['two-photo', 'three-photo', 'layout', 'mobile'] }, null, 2));
  } finally {
    await browser.close();
    if (server) stopProcessTree(server);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
