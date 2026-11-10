import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stopProcessTree } from './process-tree.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(projectRoot, '..');
const workspaceBrowserPath = path.join(workspaceRoot, '.cache', 'ms-playwright');
const browserPath = existsSync(workspaceBrowserPath) ? workspaceBrowserPath : undefined;
const browserExecutable = process.env.VISITOR_BROWSER_EXECUTABLE;
const outputDir = path.join(projectRoot, 'test-results', 'route-guide-continuity');
const baseUrl = process.env.VISITOR_VERIFY_URL || 'http://127.0.0.1:5181';

const now = '2026-07-05T10:00:00.000Z';

const routePlan = {
  id: 'guide-route-ling-shan',
  map_id: 'ling-shan',
  name: '灵山胜境个性化推荐路线',
  theme: '佛教文化、建筑艺术',
  total_minutes: 116,
  stay_minutes: 80,
  estimated_walk_minutes: 36,
  time_data_complete: true,
  generation_mode: 'dynamic',
  path_complete: true,
  routing_profile: 'fastest',
  time_estimation_status: 'map_estimate',
  recommendation_reason: '根据数字人对话中的偏好生成。',
  spots: [
    { id: 'spot_ls_entrance', name: '景区入口', stay_minutes: 5, reason: '路线起点', transition_minutes: 0 },
    { id: 'spot_ls_004', name: '五明桥', stay_minutes: 5, reason: '衔接中轴游线', transition_minutes: 8 },
    { id: 'spot_ls_003', name: '菩提大道', stay_minutes: 15, reason: '适合了解佛教文化', transition_minutes: 6 },
    { id: 'spot_nine_dragons', name: '九龙灌浴', stay_minutes: 20, reason: '核心表演节点', transition_minutes: 4 },
    { id: 'spot_ls_002', name: '降魔浮雕', stay_minutes: 10, reason: '建筑艺术节点', transition_minutes: 3 },
    { id: 'spot_xiangfu_temple', name: '祥符禅寺', stay_minutes: 20, reason: '禅意参访节点', transition_minutes: 7 },
    { id: 'spot_ling_shan_buddha', name: '百子戏弥勒', stay_minutes: 15, reason: '收束游线', transition_minutes: 2 },
  ],
};

let activeTour = createTourPayload('tour-guide-1', 'draft-guide-1', 0);

async function isServerReady() {
  try {
    const response = await fetch(baseUrl);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer() {
  for (let i = 0; i < 40; i += 1) {
    if (await isServerReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Vite server did not become ready at ${baseUrl}`);
}

async function ensureServer() {
  if (await isServerReady()) return undefined;

  const child = spawn('npm.cmd run dev:visitor -- --port 5181', {
    cwd: projectRoot,
    env: {
      ...process.env,
      ...(browserPath ? { PLAYWRIGHT_BROWSERS_PATH: browserPath } : {}),
      VITE_USE_MOCK_API: 'false',
      VITE_API_BASE_URL: 'http://127.0.0.1:8001',
    },
    shell: true,
    stdio: 'ignore',
    windowsHide: true,
  });

  await waitForServer();
  return child;
}

function failIf(condition, message) {
  if (condition) throw new Error(message);
}

async function waitForPath(page, pathname) {
  await page.waitForFunction((expectedPathname) => window.location.pathname === expectedPathname, pathname, {
    timeout: 30000,
  });
}

function streamBody(payload) {
  return `event: final\ndata: ${JSON.stringify(payload)}\n\n`;
}

function createRouteChatPayload() {
  return {
    answer: '已为你生成一条灵山胜境个性化推荐路线，可以查看地图或直接开始游览。',
    sources: [
      {
        title: '路线推荐资料',
        spot_name: '灵山胜境',
        snippet: '根据偏好生成路线规划。',
      },
    ],
    session_id: 'guide-session-test',
    tts_status: 'disabled',
    mode: 'normal',
    degraded: false,
    guide_action: {
      type: 'route_recommendation',
      title: '灵山胜境路线',
      route: routePlan,
      preference: {
        map_id: 'ling-shan',
        duration_minutes: 120,
        physical_level: 'high',
        interest_tags: ['演艺亲子', '自然休闲'],
      },
    },
  };
}

function createDraftPayload(id = 'draft-guide-1') {
  return {
    id,
    source_route_id: null,
    name: routePlan.name,
    theme: routePlan.theme,
    duration_budget: 120,
    preference_profile: {},
    stay_minutes: 80,
    estimated_walk_minutes: 36,
    total_minutes: 116,
    time_data_complete: true,
    routing_profile: 'fastest',
    time_estimation_status: 'map_estimate',
    budget_exceeded: false,
    revision_count: 0,
    created_at: now,
    updated_at: now,
    spots: routePlan.spots.map((spot, index) => ({
      spot_id: spot.id,
      name: spot.name,
      sequence: index,
      stay_minutes: spot.stay_minutes,
      reason: spot.reason,
      transition_minutes: spot.transition_minutes,
    })),
  };
}

function createTourPayload(id, draftId, currentIndex, status = 'active') {
  return {
    id,
    route_draft_id: draftId,
    name: routePlan.name,
    status,
    current_index: currentIndex,
    started_at: now,
    updated_at: now,
    event_count: currentIndex,
    routing_profile: 'fastest',
    time_estimation_status: 'map_estimate',
    spots: routePlan.spots.map((spot, index) => ({
      spot_id: spot.id,
      name: spot.name,
      sequence: index,
      stay_minutes: spot.stay_minutes,
      reason: spot.reason,
      transition_minutes: spot.transition_minutes,
      status: status === 'finished' || index < currentIndex ? 'completed' : index === currentIndex ? 'current' : 'pending',
      completed_at: status === 'finished' || index < currentIndex ? now : null,
      arrived_at: index <= currentIndex ? now : null,
    })),
  };
}

function createTourRecapPayload() {
  return {
    id: 'tour-guide-1',
    name: routePlan.name,
    status: 'finished',
    started_at: now,
    finished_at: now,
    elapsed_minutes: 90,
    completed_count: routePlan.spots.length,
    skipped_count: 0,
    adjustment_count: 0,
    deviation_count: 0,
    recommended_order: routePlan.spots.map((spot) => spot.name),
    preference_profile: {},
    actual_order: routePlan.spots.map((spot) => ({
      spot_id: spot.id,
      name: spot.name,
      result: 'completed',
      occurred_at: now,
    })),
    ai_topics: [],
  };
}

function createMapPayload(mapId) {
  const isNianhua = mapId === 'nianhua-bay';
  const points = isNianhua
    ? [
        ['spot_nh_entrance', '景区入口', 0.326357, 0.850663],
        ['spot_nh_001', '拈花广场', 0.38374, 0.564316],
      ]
    : [
        ['spot_ls_entrance', '景区入口', 0.462791, 0.969331],
        ['spot_ls_004', '五明桥', 0.487281, 0.700741],
        ['spot_ls_003', '菩提大道', 0.484211, 0.734312],
        ['spot_nine_dragons', '九龙灌浴', 0.490789, 0.578801],
        ['spot_ls_002', '降魔浮雕', 0.477632, 0.808365],
        ['spot_xiangfu_temple', '祥符禅寺', 0.499561, 0.367997],
        ['spot_ling_shan_buddha', '百子戏弥勒', 0.501316, 0.163117],
      ];
  return {
    id: mapId,
    name: isNianhua ? '拈花湾禅意小镇' : '灵山胜境',
    image_url: isNianhua ? '/scenic/maps/nianhua-bay-overview-v1.png' : '/scenic/maps/ling-shan-overview-v1.webp',
    version: `${mapId}-test`,
    width: 941,
    height: 1672,
    center_lat: 31.421388,
    center_lng: 120.102499,
    authorization_status: 'verified',
    source_note: 'continuity test map',
    points: points.map(([spotId, name, xRatio, yRatio]) => ({
      spot_id: spotId,
      name,
      x_ratio: xRatio,
      y_ratio: yRatio,
      point_type: 'spot',
      calibration_status: 'verified',
    })),
  };
}

function createRoutePathPayload() {
  return {
    map_id: 'ling-shan',
    path_complete: true,
    routing_profile: 'fastest',
    time_estimation_status: 'map_estimate',
    calibration_confidence: 1,
    map_length_px: 100,
    segments: [],
    missing_transitions: [],
  };
}

function createSpotListPayload() {
  return {
    total: routePlan.spots.length,
    items: routePlan.spots.map((spot) => ({
      id: spot.id,
      name: spot.name,
      summary: spot.reason,
      story: spot.reason,
      tags: ['路线'],
      visit_minutes: spot.stay_minutes,
      crowd_types: [],
      image_url: null,
    })),
  };
}

async function installApiRoutes(page) {
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

  await page.route('**/api/chat/stream', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: streamBody(createRouteChatPayload()),
    });
  });

  await page.route('**/api/avatar/current', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        avatar_id: 'builtin-avatar151',
        version: 'builtin-avatar151',
        loader_url: '/avatar/uketsukejou151/webgl/Build/uketsukejou151.loader.js',
        data_url: '/avatar/uketsukejou151/webgl/Build/uketsukejou151.data',
        framework_url: '/avatar/uketsukejou151/webgl/Build/uketsukejou151.framework.js',
        wasm_url: '/avatar/uketsukejou151/webgl/Build/uketsukejou151.wasm',
        streaming_assets_url: '/avatar/uketsukejou151/webgl/StreamingAssets',
        fallback_url: '/avatar/uketsukejou151/avatar-151.png',
        bridge_object_name: 'Avatar151Bridge',
      }),
    });
  });

  await page.route('**/api/digital-human-persona', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        identity: 'professional_guide',
        age_mode: 'group',
        age_group: 'young',
        exact_age: null,
        gender: 'unspecified',
        personalities: ['gentle'],
        expression_style: 'unspecified',
        creative_prompt: '',
        is_customized: false,
      }),
    });
  });

  await page.route('**/api/maps/*/route-path', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createRoutePathPayload()) });
  });

  await page.route('**/api/maps/ling-shan', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createMapPayload('ling-shan')) });
  });

  await page.route('**/api/maps/nianhua-bay', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createMapPayload('nianhua-bay')) });
  });

  await page.route('**/api/spots', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createSpotListPayload()) });
  });

  await page.route('**/api/route-drafts', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createDraftPayload()) });
  });

  await page.route('**/api/tours', async (route) => {
    activeTour = createTourPayload('tour-guide-1', 'draft-guide-1', 0);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(activeTour) });
  });

  await page.route('**/api/tours/tour-guide-1', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(activeTour) });
  });

  await page.route('**/api/tours/tour-guide-1/events', async (route) => {
    const body = route.request().postDataJSON();
    activeTour = body.event_type === 'tour_finished'
      ? createTourPayload('tour-guide-1', 'draft-guide-1', routePlan.spots.length, 'finished')
      : createTourPayload('tour-guide-1', 'draft-guide-1', 1);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(activeTour) });
  });

  await page.route('**/api/tours/tour-guide-1/recap', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(createTourRecapPayload()) });
  });
}

async function main() {
  if (browserPath) process.env.PLAYWRIGHT_BROWSERS_PATH = browserPath;
  const { chromium } = await import('@playwright/test');
  await mkdir(outputDir, { recursive: true });

  const server = await ensureServer();
  const browser = await chromium.launch({ headless: true, ...(browserExecutable ? { executablePath: browserExecutable } : {}) });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', (message) => {
    const text = message.text();
    const ignored =
      text.includes('Looks like you are rendering without using requestAnimationFrame') ||
      text.includes('[Avatar151] Unity WebGL unavailable, using static fallback') ||
      text.includes('Failed to load resource: the server responded with a status of 404') ||
      text.includes('[antd: Select] `popupClassName` is deprecated') ||
      text.includes('[antd: Modal] `destroyOnClose` is deprecated') ||
      text.includes('[antd: Spin] `tip` only work in nest or fullscreen pattern');
    if ((message.type() === 'error' || message.type() === 'warning') && !ignored) {
      consoleErrors.push(text);
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    await installApiRoutes(page);
    await page.addInitScript(() => {
      localStorage.setItem('a5_visitor_token', 'valid-visitor-token');
    });

    await page.goto(`${baseUrl}/guide`, { waitUntil: 'networkidle' });
    await page.getByTestId('ai-guide-workbench').waitFor({ timeout: 8000 });
    await page.locator('.chat-input-row textarea, .chat-input-row input').first().fill('请帮我规划路线');
    await page.getByTestId('guide-send').click();
    await page.getByRole('button', { name: '查看地图' }).waitFor({ timeout: 8000 });
    await page.getByRole('button', { name: '查看地图' }).click();
    await waitForPath(page, '/routes');
    await page.getByTestId('route-workbench').waitFor({ timeout: 8000 });
    await page.locator('.visitor-sider-menu a[href="/guide"]').click();
    await waitForPath(page, '/guide');
    await page.locator('.visitor-sider-menu').getByRole('link', { name: '个性化推荐' }).click();
    await waitForPath(page, '/routes');
    await page.waitForTimeout(300);
    failIf(await page.getByTestId('route-hydra-loader').isVisible().catch(() => false), 'Route loader should be skipped when returning from guide to restored route');
    await page.getByTestId('route-points-panel').waitFor({ timeout: 5000 });
    await page.getByText('景区入口').first().waitFor({ timeout: 5000 });
    await page.screenshot({ path: path.join(outputDir, '01-restored-route-recommendation.png'), fullPage: true });
    await page.locator('.visitor-sider a[href="/spots"]').click();
    await waitForPath(page, '/spots');
    await page.locator('.visitor-sider-menu').getByRole('link', { name: '个性化推荐' }).click();
    await waitForPath(page, '/routes');
    await page.waitForTimeout(300);
    failIf(await page.getByTestId('route-hydra-loader').isVisible().catch(() => false), 'Route loader should not appear during visitor page navigation');
    await page.getByTestId('route-workbench').waitFor({ timeout: 8000 });

    await page.getByRole('link', { name: '咨询导游' }).click();
    await waitForPath(page, '/guide');
    await page.getByTestId('ai-guide-workbench').waitFor({ timeout: 8000 });
    await page.screenshot({ path: path.join(outputDir, '02-consult-opens-guide.png'), fullPage: true });
    await page.locator('.visitor-sider-menu').getByRole('link', { name: '个性化推荐' }).click();
    await waitForPath(page, '/routes');
    await page.getByTestId('route-workbench').waitFor({ timeout: 8000 });

    await page.getByRole('button', { name: '开始游览' }).click();
    await waitForPath(page, '/scene-guide');
    const sceneUrl = new URL(page.url());
    failIf(sceneUrl.searchParams.get('tourId') !== 'tour-guide-1', 'Scene guide should receive the newly created tourId.');
    failIf(sceneUrl.searchParams.get('mapId') !== 'ling-shan', 'Scene guide should receive the active mapId.');
    await page.getByTestId('scene-guide-page').waitFor({ timeout: 8000 });
    await page.getByTestId('scene-route-progress-strip').waitFor({ timeout: 8000 });
    failIf(
      (await page.getByTestId('scene-route-stop-spot_ls_entrance').count()) !== 0,
      'Scene guide should hide the synthetic scenic entrance stop.',
    );
    await page.getByTestId('scene-route-stop-spot_ls_004').waitFor({ timeout: 5000 });
    await page.screenshot({ path: path.join(outputDir, '03-start-opens-scene-guide.png'), fullPage: true });

    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('scene-route-progress-strip').waitFor({ timeout: 8000 });
    failIf(new URL(page.url()).searchParams.get('tourId') !== 'tour-guide-1', 'Scene guide refresh should retain the tourId.');
    await page.screenshot({ path: path.join(outputDir, '04-scene-guide-tour-restored.png'), fullPage: true });

    failIf(consoleErrors.length > 0, `Browser console errors:\n${consoleErrors.join('\n')}`);
    failIf(pageErrors.length > 0, `Browser page errors:\n${pageErrors.join('\n')}`);

    console.log(JSON.stringify({ ok: true, baseUrl, outputDir }, null, 2));
  } finally {
    await browser.close();
    if (server) stopProcessTree(server);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
