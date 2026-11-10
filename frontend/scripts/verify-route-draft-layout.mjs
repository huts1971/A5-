import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(projectRoot, '..');
const workspaceBrowserPath = path.join(workspaceRoot, '.cache', 'ms-playwright');
const browserPath = existsSync(workspaceBrowserPath) ? workspaceBrowserPath : undefined;
const browserExecutable = process.env.VISITOR_BROWSER_EXECUTABLE;
const baseUrl = process.env.VISITOR_VERIFY_URL || 'http://127.0.0.1:5182';
const outputDir = path.join(projectRoot, 'test-results', 'route-draft-layout');

const spots = [
  ['spot_ls_entrance', '景区入口', 0.462791, 0.969331, 5, 0],
  ['spot_ls_004', '佛足坛', 0.487281, 0.700741, 10, 11],
  ['spot_ls_003', '五智门', 0.484211, 0.734312, 10, 1],
  ['spot_nine_dragons', '阿育王柱', 0.490789, 0.578801, 10, 10],
  ['spot_xiangfu_temple', '祥符禅寺', 0.499561, 0.367997, 25, 5],
];

function failIf(condition, message) {
  if (condition) throw new Error(message);
}

function json(route, body) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function createDraftPayload() {
  return {
    id: 'draft-layout-1',
    source_route_id: null,
    name: '灵山胜境个性化路线',
    theme: '佛教文化与建筑艺术',
    duration_budget: 120,
    preference_profile: {},
    stay_minutes: 60,
    estimated_walk_minutes: 27,
    total_minutes: 87,
    time_data_complete: true,
    routing_profile: 'fastest',
    time_estimation_status: 'map_estimate',
    budget_exceeded: false,
    revision_count: 2,
    created_at: '2026-07-29T10:00:00.000Z',
    updated_at: '2026-07-29T10:00:00.000Z',
    spots: spots.map(([spotId, name, , , stayMinutes, transitionMinutes], sequence) => ({
      spot_id: spotId,
      name,
      sequence,
      stay_minutes: stayMinutes,
      reason: sequence === 0 ? '路线起点' : '推荐景点',
      transition_minutes: transitionMinutes,
    })),
  };
}

function createMapPayload(mapId) {
  const nianhua = mapId === 'nianhua-bay';
  return {
    id: mapId,
    name: nianhua ? '拈花湾' : '灵山胜境',
    image_url: nianhua
      ? '/scenic/maps/nianhua-bay-overview-v1.png'
      : '/scenic/maps/ling-shan-overview-v1.webp',
    version: `${mapId}-layout-test`,
    width: 941,
    height: 1672,
    center_lat: 31.421388,
    center_lng: 120.102499,
    authorization_status: 'verified',
    source_note: 'route draft layout verification',
    points: nianhua
      ? []
      : spots.map(([spotId, name, xRatio, yRatio]) => ({
          spot_id: spotId,
          name,
          x_ratio: xRatio,
          y_ratio: yRatio,
          point_type: 'spot',
          calibration_status: 'verified',
        })),
  };
}

async function installApiRoutes(page) {
  await page.route('**/api/auth/me', (route) =>
    json(route, { id: 'layout-user', username: 'yxa', role: 'visitor' }),
  );
  await page.route('**/api/avatar/current', (route) =>
    json(route, {
      avatar_id: 'builtin-avatar151',
      version: 'builtin-avatar151',
      fallback_url: '/avatar/uketsukejou151/avatar-151.png',
    }),
  );
  await page.route('**/api/route-drafts/draft-layout-1', (route) =>
    json(route, createDraftPayload()),
  );
  await page.route('**/api/spots', (route) =>
    json(route, {
      total: spots.length,
      items: spots.map(([id, name, , , stayMinutes]) => ({
        id,
        name,
        summary: '测试景点',
        story: '测试景点',
        tags: ['路线'],
        visit_minutes: stayMinutes,
        crowd_types: [],
        image_url: null,
      })),
    }),
  );
  await page.route('**/api/maps/ling-shan', (route) =>
    json(route, createMapPayload('ling-shan')),
  );
  await page.route('**/api/maps/nianhua-bay', (route) =>
    json(route, createMapPayload('nianhua-bay')),
  );
  await page.route('**/api/maps/*/route-path', (route) =>
    json(route, {
      map_id: 'ling-shan',
      path_complete: true,
      routing_profile: 'fastest',
      time_estimation_status: 'map_estimate',
      calibration_confidence: 1,
      map_length_px: 100,
      segments: [],
      missing_transitions: [],
    }),
  );
}

async function main() {
  if (browserPath) process.env.PLAYWRIGHT_BROWSERS_PATH = browserPath;
  const { chromium } = await import('@playwright/test');
  await mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    ...(browserExecutable ? { executablePath: browserExecutable } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 2048, height: 1152 } });
  const consoleErrors = [];
  page.on('console', (message) => {
    const text = message.text();
    if (
      (message.type() === 'error' || message.type() === 'warning') &&
      !text.includes('[antd: Select] `popupClassName` is deprecated') &&
      !text.includes('[Avatar151] Unity WebGL unavailable')
    ) {
      consoleErrors.push(text);
    }
  });

  try {
    await installApiRoutes(page);
    await page.addInitScript(() => {
      localStorage.setItem('a5_visitor_token', 'layout-test-token');
    });
    await page.goto(`${baseUrl}/route-drafts/draft-layout-1`, { waitUntil: 'networkidle' });

    const map = page.getByTestId('route-map-scroll-area');
    await map.waitFor({ timeout: 8000 });
    await page.locator('[class*="_spotRow_"]').first().waitFor({ timeout: 8000 });

    const samples = [];
    for (let index = 0; index < 12; index += 1) {
      samples.push(await map.boundingBox());
      await page.waitForTimeout(100);
    }
    const validSamples = samples.filter(Boolean);
    failIf(validSamples.length !== samples.length, 'Map was not measurable during stability sampling.');
    const widthDelta =
      Math.max(...validSamples.map((sample) => sample.width)) -
      Math.min(...validSamples.map((sample) => sample.width));
    const heightDelta =
      Math.max(...validSamples.map((sample) => sample.height)) -
      Math.min(...validSamples.map((sample) => sample.height));
    failIf(widthDelta > 1 || heightDelta > 1, `Map size is unstable: ${widthDelta}x${heightDelta}px.`);

    const mapPanel = page.locator('[class*="_mapPanel_"]').first();
    const editor = page.locator('[class*="_editor_"]').first();
    const [mapPanelBox, editorBox] = await Promise.all([
      mapPanel.boundingBox(),
      editor.boundingBox(),
    ]);
    failIf(!mapPanelBox || !editorBox, 'Draft workspace columns were not measurable.');
    failIf(mapPanelBox.width <= editorBox.width, 'Map column should be wider than the editor column.');

    const mapScrollMetrics = await map.evaluate((element) => ({
      clientWidth: element.clientWidth,
      clientHeight: element.clientHeight,
      scrollWidth: element.scrollWidth,
      scrollHeight: element.scrollHeight,
    }));
    failIf(
      mapScrollMetrics.scrollWidth > mapScrollMetrics.clientWidth + 1,
      'Map should not require horizontal scrolling.',
    );
    failIf(
      mapScrollMetrics.scrollHeight <= mapScrollMetrics.clientHeight,
      'Map should remain vertically scrollable.',
    );

    const actionButtons = page.locator('[class*="_rowActions_"] .ant-btn');
    const addButton = page.locator('[data-testid="add-draft-spot"]');
    const actionButtonBoxes = [];
    failIf(!(await addButton.isVisible()), 'Add route spot action is hidden.');
    failIf((await actionButtons.count()) !== spots.length * 3, 'Expected three actions per route spot.');
    for (let index = 0; index < (await actionButtons.count()); index += 1) {
      failIf(!(await actionButtons.nth(index).isVisible()), `Route action ${index + 1} is hidden.`);
      const box = await actionButtons.nth(index).boundingBox();
      failIf(!box, `Route action ${index + 1} is not visible.`);
      actionButtonBoxes.push(box);
      failIf(box.x + box.width > editorBox.x + editorBox.width + 1, `Route action ${index + 1} overflows the editor.`);
    }
    const firstActionStyle = await actionButtons.first().evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        color: style.color,
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        opacity: style.opacity,
        visibility: style.visibility,
      };
    });

    await page.screenshot({
      path: path.join(outputDir, 'route-draft-desktop.png'),
      fullPage: true,
    });
    await actionButtons.nth(1).screenshot({
      path: path.join(outputDir, 'route-action-visible.png'),
    });
    await page.locator('[class*="_rowActions_"]').first().screenshot({
      path: path.join(outputDir, 'route-actions-visible.png'),
    });

    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.waitForTimeout(250);
    const compactEditorBox = await editor.boundingBox();
    const compactAddButtonBox = await addButton.boundingBox();
    failIf(!compactEditorBox || !compactAddButtonBox, 'Compact editor controls were not measurable.');
    failIf(
      compactAddButtonBox.x + compactAddButtonBox.width >
        compactEditorBox.x + compactEditorBox.width + 1,
      'Add route spot action overflows the compact editor.',
    );
    for (let index = 0; index < (await actionButtons.count()); index += 1) {
      const box = await actionButtons.nth(index).boundingBox();
      failIf(!box, `Compact route action ${index + 1} is not visible.`);
      failIf(
        box.x + box.width > compactEditorBox.x + compactEditorBox.width + 1,
        `Compact route action ${index + 1} overflows the editor.`,
      );
    }
    await page.screenshot({
      path: path.join(outputDir, 'route-draft-compact.png'),
      fullPage: true,
    });
    failIf(
      consoleErrors.some((text) => text.includes('ResizeObserver loop')),
      `ResizeObserver loop detected:\n${consoleErrors.join('\n')}`,
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          mapWidth: Math.round(mapPanelBox.width),
          editorWidth: Math.round(editorBox.width),
          actionButtonCount: await actionButtons.count(),
          firstActionBoxes: actionButtonBoxes.slice(0, 3),
          firstActionStyle,
          mapWidthDelta: widthDelta,
          mapHeightDelta: heightDelta,
          mapScrollMetrics,
          compactEditorWidth: Math.round(compactEditorBox.width),
          screenshot: path.join(outputDir, 'route-draft-desktop.png'),
          compactScreenshot: path.join(outputDir, 'route-draft-compact.png'),
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
