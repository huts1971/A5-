import { expect, test, type Page, type Route } from '@playwright/test';

const startedAt = '2026-07-30T01:00:00.000Z';
const finishedAt = '2026-07-30T02:12:00.000Z';

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function tour(
  id: string,
  status: 'active' | 'finished',
  updatedAt: string,
) {
  return {
    id,
    routeDraftId: `draft-${id}`,
    name: status === 'finished' ? '灵山建筑文化漫游' : '灵山午后慢游线',
    status,
    currentIndex: status === 'finished' ? 2 : 1,
    startedAt,
    updatedAt,
    finishedAt: status === 'finished' ? finishedAt : undefined,
    eventCount: status === 'finished' ? 4 : 1,
    routingProfile: 'fastest',
    timeEstimationStatus: 'map_estimate',
    spots: [
      {
        spotId: 'spot_ls_entrance',
        name: '景区入口',
        sequence: 0,
        stayMinutes: 5,
        reason: '路线起点',
        status: 'completed',
        completedAt: startedAt,
      },
      {
        spotId: 'spot_ls_003',
        name: '佛足坛',
        sequence: 1,
        stayMinutes: 12,
        reason: '文化体验',
        transitionMinutes: 6,
        status: 'completed',
        completedAt: updatedAt,
      },
      {
        spotId: 'spot_ls_004',
        name: '五智门',
        sequence: 2,
        stayMinutes: 15,
        reason: '建筑观察',
        transitionMinutes: 4,
        status: status === 'finished' ? 'completed' : 'current',
        completedAt: status === 'finished' ? updatedAt : undefined,
      },
    ],
  };
}

async function mockSignedInVisitor(page: Page, withHistory = true) {
  const completedTour = tour('tour-done', 'finished', finishedAt);
  const activeTour = tour('tour-active', 'active', '2026-07-30T03:00:00.000Z');
  await page.addInitScript(
    ({ completed, active, seedHistory }) => {
      window.localStorage.setItem('a5_visitor_token', 'tour-recaps-e2e-token');
      if (!seedHistory) return;
      window.localStorage.setItem(
        'ling-shan-tour-history:v1',
        JSON.stringify([
          {
            tourId: active.id,
            name: active.name,
            mapId: 'ling-shan',
            status: active.status,
            startedAt: active.startedAt,
            coverSpotId: 'spot_ls_004',
            updatedAt: active.updatedAt,
          },
          {
            tourId: completed.id,
            name: completed.name,
            mapId: 'ling-shan',
            status: completed.status,
            startedAt: completed.startedAt,
            finishedAt: completed.finishedAt,
            coverSpotId: 'spot_ls_003',
            updatedAt: completed.updatedAt,
          },
        ]),
      );
      window.localStorage.setItem(
        `ling-shan-tour:${completed.id}`,
        JSON.stringify(completed),
      );
      window.localStorage.setItem(
        `ling-shan-tour:${active.id}`,
        JSON.stringify(active),
      );
    },
    { completed: completedTour, active: activeTour, seedHistory: withHistory },
  );

  await page.route('http://127.0.0.1:8001/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') {
      return json(route, {
        id: 'visitor-tour-recaps',
        username: '旅迹测试',
        role: 'visitor',
      });
    }
    if (path === '/api/spots') {
      return json(route, {
        items: [
          {
            id: 'spot_ls_003',
            name: '佛足坛',
            summary: '佛足坛景点介绍',
            tags: ['佛教文化'],
            visit_minutes: 12,
            image_url: '/scenic/spots/photos/LS-003_佛足坛/1.jpg',
          },
          {
            id: 'spot_ls_004',
            name: '五智门',
            summary: '五智门景点介绍',
            tags: ['建筑艺术'],
            visit_minutes: 15,
            image_url: '/scenic/spots/photos/LS-004_五智门/1.jpg',
          },
        ],
        total: 2,
      });
    }
    if (path === '/api/tours/tour-active/recap') {
      return json(route, {
        id: 'tour-active',
        name: '灵山午后慢游线',
        status: 'active',
        map_id: 'ling-shan',
        started_at: startedAt,
        finished_at: null,
        elapsed_minutes: 36,
        completed_count: 0,
        skipped_count: 0,
        adjustment_count: 0,
        deviation_count: 2,
        recommended_order: ['五智门', '佛足坛'],
        preference_profile: {
          mapId: 'ling-shan',
          interestTags: ['建筑艺术'],
        },
        actual_order: [],
        ai_topics: [],
        movement: {
          estimated_walking_minutes: null,
          planned_scenic_minutes: null,
          estimated_distance_meters: null,
          estimated_steps: null,
          estimated_calories_kcal: null,
          coverage_ratio: 0,
          confidence: 'unavailable',
          formula_version: 'demo-v1',
        },
      });
    }
    if (path === '/api/tours/tour-done/recap') {
      return json(route, {
        id: 'tour-done',
        name: '灵山建筑文化漫游',
        status: 'finished',
        map_id: 'ling-shan',
        started_at: startedAt,
        finished_at: finishedAt,
        elapsed_minutes: 72,
        completed_count: 2,
        skipped_count: 0,
        adjustment_count: 0,
        deviation_count: 0,
        recommended_order: ['佛足坛', '五智门'],
        preference_profile: {
          mapId: 'ling-shan',
          interestTags: ['建筑艺术', '佛教文化'],
        },
        actual_order: [
          {
            spot_id: 'spot_ls_003',
            name: '佛足坛',
            result: 'completed',
            occurred_at: '2026-07-30T01:28:00.000Z',
            planned_stay_minutes: 12,
            transition_minutes: 6,
          },
          {
            spot_id: 'spot_ls_004',
            name: '五智门',
            result: 'completed',
            occurred_at: finishedAt,
            planned_stay_minutes: 15,
            transition_minutes: 4,
          },
        ],
        ai_topics: ['五智门建筑'],
        movement: {
          estimated_walking_minutes: 10,
          planned_scenic_minutes: 27,
          estimated_distance_meters: 700,
          estimated_steps: 1000,
          estimated_calories_kcal: 35,
          coverage_ratio: 1,
          confidence: 'medium',
          formula_version: 'demo-v1',
        },
      });
    }
    return json(route, {});
  });
}

test('游览回顾按完成与进行中记录分区，并保持侧栏选中', async ({ page }) => {
  await mockSignedInVisitor(page);
  await page.goto('/tour-recaps');

  await expect(page.getByRole('heading', { name: '你的游览回顾' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '继续未完成的场景导览' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '刚刚走过的这一程' })).toBeVisible();
  await expect(page.getByRole('link', { name: /打开这份旅行纪录/ })).toHaveAttribute(
    'href',
    '/tour/tour-done/recap',
  );
  await expect(page.getByRole('link', { name: /继续场景导览/ })).toHaveAttribute(
    'href',
    '/scene-guide?tourId=tour-active',
  );

  const sceneLink = page.getByRole('link', { name: '场景式导览' });
  const recapLink = page.getByRole('link', { name: '游览回顾' });
  expect((await recapLink.boundingBox())!.y).toBeGreaterThan(
    (await sceneLink.boundingBox())!.y,
  );
  await expect(page.locator('.visitor-primary-menu .ant-menu-item-selected')).toContainText(
    '游览回顾',
  );
  await expect(page.locator('.ling-shiyin-chat-fab')).toHaveCount(0);
});

test('空记录同时提供开始入口和明确标注的示例回顾', async ({ page }) => {
  await mockSignedInVisitor(page, false);
  await page.goto('/tour-recaps');

  await expect(page.getByRole('heading', { name: /完成一次场景导览/ })).toBeVisible();
  await expect(page.getByRole('link', { name: '开始一次场景导览' })).toHaveAttribute(
    'href',
    '/routes',
  );
  await expect(page.getByText('示例数据', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /查看示例回顾 · 示例数据/ })).toHaveAttribute(
    'href',
    '/tour/demo-v1/recap?demo=1',
  );
});

test('空实际顺序的进行中回顾使用当前景点实景封面并保持精简章节', async ({
  page,
}) => {
  await mockSignedInVisitor(page);
  await page.goto('/tour/tour-active/recap');

  await expect(page.getByTestId('tour-recap-cover')).toHaveAttribute(
    'src',
    '/scenic/spots/photos/LS-004_五智门/1.jpg',
  );
  await expect(page.getByText('本次游览核心指标', { exact: true })).toHaveCount(0);
  await expect(page.getByText('动态足迹地图', { exact: true })).toHaveCount(0);
  await expect(page.getByText('一句一景', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '你的旅行兴趣' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '未完待续' })).toBeVisible();
  await expect(page.getByText('灵诗音寄语', { exact: true })).toBeVisible();
});

test('390px 手机端精简回顾无横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockSignedInVisitor(page);
  await page.goto('/tour/tour-active/recap');

  await expect(page.getByTestId('tour-recap-cover')).toBeVisible();
  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth);
  await expect(page.getByRole('heading', { name: '你的旅行兴趣' })).toBeVisible();
});

test('回顾详情保持游览回顾菜单选中且不展示全局聊天入口', async ({ page }) => {
  await mockSignedInVisitor(page);
  await page.goto('/tour/tour-done/recap');

  await expect(page.locator('.visitor-primary-menu .ant-menu-item-selected')).toContainText(
    '游览回顾',
  );
  await expect(page.locator('.ling-shiyin-chat-fab')).toHaveCount(0);
});

test('未登录访问游览回顾会回到登录首页', async ({ page }) => {
  await page.goto('/tour-recaps');
  await expect(page).toHaveURL('/');
});
