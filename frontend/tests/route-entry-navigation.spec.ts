import { expect, test, type Page, type Route } from '@playwright/test';

const now = '2026-07-30T08:00:00+00:00';

const routeSpots = [
  {
    id: 'spot_ls_entrance',
    name: '景区入口',
    stay_minutes: 5,
    reason: '路线计算起点。',
    transition_minutes: 0,
  },
  {
    id: 'spot_ls_004',
    name: '佛足坛',
    stay_minutes: 15,
    reason: '从第一处真实景点开始沉浸讲解。',
    transition_minutes: 8,
  },
  {
    id: 'spot_ls_003',
    name: '五智门',
    stay_minutes: 15,
    reason: '继续了解景区建筑与文化。',
    transition_minutes: 5,
  },
] as const;

const routePlan = {
  id: 'route-entry-e2e',
  map_id: 'ling-shan',
  name: '灵山胜境沉浸路线',
  theme: '佛教文化与建筑艺术',
  stay_minutes: 35,
  estimated_walk_minutes: 13,
  total_minutes: 48,
  time_data_complete: true,
  generation_mode: 'dynamic',
  path_complete: true,
  routing_profile: 'fastest',
  time_estimation_status: 'map_estimate',
  recommendation_reason: '适合沉浸式场景讲解。',
  spots: routeSpots,
};

function draftResponse() {
  return {
    id: 'draft-entry-e2e',
    source_route_id: routePlan.id,
    name: routePlan.name,
    theme: routePlan.theme,
    duration_budget: 120,
    preference_profile: {
      mapId: 'ling-shan',
      durationMinutes: 120,
      physicalLevel: 'medium',
      interestTags: ['佛教文化', '建筑艺术'],
    },
    stay_minutes: routePlan.stay_minutes,
    estimated_walk_minutes: routePlan.estimated_walk_minutes,
    total_minutes: routePlan.total_minutes,
    time_data_complete: true,
    routing_profile: 'fastest',
    time_estimation_status: 'map_estimate',
    budget_exceeded: false,
    revision_count: 0,
    created_at: now,
    updated_at: now,
    spots: routeSpots.map((spot, sequence) => ({
      spot_id: spot.id,
      name: spot.name,
      sequence,
      stay_minutes: spot.stay_minutes,
      reason: spot.reason,
      transition_minutes: spot.transition_minutes,
    })),
  };
}

function tourResponse() {
  return {
    id: 'tour-entry-e2e',
    route_draft_id: 'draft-entry-e2e',
    name: routePlan.name,
    status: 'active',
    current_index: 0,
    started_at: now,
    updated_at: now,
    event_count: 0,
    routing_profile: 'fastest',
    time_estimation_status: 'map_estimate',
    spots: routeSpots.map((spot, sequence) => ({
      spot_id: spot.id,
      name: spot.name,
      sequence,
      stay_minutes: spot.stay_minutes,
      reason: spot.reason,
      transition_minutes: spot.transition_minutes,
      status: sequence === 0 ? 'current' : 'pending',
      arrived_at: sequence === 0 ? now : null,
      completed_at: null,
    })),
  };
}

function mapResponse(mapId: 'ling-shan' | 'nianhua-bay') {
  const isLingShan = mapId === 'ling-shan';
  return {
    id: mapId,
    name: isLingShan ? '灵山胜境' : '拈花湾',
    image_url: isLingShan
      ? '/scenic/maps/ling-shan-overview-v1.webp'
      : '/scenic/maps/nianhua-bay-overview-v1.png',
    version: `${mapId}-route-entry-e2e`,
    width: 941,
    height: 1672,
    center_lat: 31.421388,
    center_lng: 120.102499,
    authorization_status: 'verified',
    source_note: 'route entry navigation test',
    points: isLingShan
      ? [
          ['spot_ls_entrance', '景区入口', 0.46, 0.96],
          ['spot_ls_004', '佛足坛', 0.48, 0.7],
          ['spot_ls_003', '五智门', 0.49, 0.62],
        ].map(([spot_id, name, x_ratio, y_ratio]) => ({
          spot_id,
          name,
          x_ratio,
          y_ratio,
          point_type: 'spot',
          calibration_status: 'verified',
        }))
      : [],
  };
}

function scenicSpotsResponse() {
  const items = routeSpots
    .filter((spot) => spot.id !== 'spot_ls_entrance')
    .map((spot, index) => ({
      id: spot.id,
      name: spot.name,
      summary: spot.reason,
      story: `${spot.name}的场景讲解资料。`,
      tags: ['佛教文化'],
      visit_minutes: spot.stay_minutes,
      crowd_types: ['文化'],
      image_url: `/route-entry/spot-${index + 1}.svg`,
    }));
  return { items, total: items.length };
}

interface NavigationMockState {
  draftCreates: number;
  tourCreates: number;
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function installNavigationMocks(page: Page): Promise<NavigationMockState> {
  const state: NavigationMockState = {
    draftCreates: 0,
    tourCreates: 0,
  };

  await page.addInitScript(() => {
    window.localStorage.setItem('a5_visitor_token', 'route-entry-e2e-token');
  });

  await page.route('**/route-entry/*.svg', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="100%" height="100%" fill="#6f806f"/></svg>',
    });
  });

  await page.route('http://127.0.0.1:8001/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === '/api/auth/me') {
      return json(route, {
        id: 'route-entry-visitor',
        username: '入口测试游客',
        role: 'visitor',
      });
    }
    if (path === '/api/routes/recommend' && method === 'POST') {
      return json(route, { items: [routePlan] });
    }
    if (path === '/api/route-drafts' && method === 'POST') {
      state.draftCreates += 1;
      return json(route, draftResponse());
    }
    if (path === '/api/route-drafts/draft-entry-e2e' && method === 'GET') {
      return json(route, draftResponse());
    }
    if (path === '/api/tours' && method === 'POST') {
      state.tourCreates += 1;
      return json(route, tourResponse());
    }
    if (path === '/api/tours/tour-entry-e2e' && method === 'GET') {
      return json(route, tourResponse());
    }
    if (path === '/api/spots' && method === 'GET') {
      return json(route, scenicSpotsResponse());
    }
    if (path.startsWith('/api/spots/') && method === 'GET') {
      const spotId = decodeURIComponent(path.split('/').pop() ?? '');
      const spot = scenicSpotsResponse().items.find((item) => item.id === spotId);
      return spot ? json(route, spot) : json(route, { message: 'not_found' }, 404);
    }
    if (path === '/api/maps/ling-shan' && method === 'GET') {
      return json(route, mapResponse('ling-shan'));
    }
    if (path === '/api/maps/nianhua-bay' && method === 'GET') {
      return json(route, mapResponse('nianhua-bay'));
    }
    if (path.endsWith('/route-path') && method === 'POST') {
      return json(route, {
        map_id: 'ling-shan',
        path_complete: true,
        routing_profile: 'fastest',
        time_estimation_status: 'map_estimate',
        calibration_confidence: 1,
        map_length_px: 100,
        segments: [],
        missing_transitions: [],
      });
    }
    if (path === '/api/avatar/current') {
      return json(route, {
        avatar_id: 'builtin-avatar151',
        version: 'builtin-avatar151',
        fallback_url: '/avatar/ling-shiyin-pet.png',
      });
    }
    if (path === '/api/digital-human-persona') {
      return json(route, {
        identity: 'professional_guide',
        age_mode: 'group',
        age_group: 'young',
        exact_age: null,
        gender: 'unspecified',
        personalities: ['gentle'],
        expression_style: 'unspecified',
        creative_prompt: '',
        is_customized: false,
      });
    }
    if (path === '/api/chat/stream' && method === 'POST') {
      const payload = {
        answer: '欢迎来到当前景点。请先观察眼前的建筑，再留意它与周围景观的关系。',
        sources: [],
        session_id: 'route-entry-scene-session',
        audio_url: null,
        tts_job_id: null,
        tts_status: 'disabled',
        mode: 'normal',
        degraded: false,
      };
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream; charset=utf-8',
        body: `event: final\ndata: ${JSON.stringify(payload)}\n\n`,
      });
    }

    return json(route, {});
  });

  return state;
}

async function expectSceneGuideUrl(page: Page) {
  await expect(page).toHaveURL((url) => {
    return (
      url.pathname === '/scene-guide' &&
      url.searchParams.get('tourId') === 'tour-entry-e2e' &&
      url.searchParams.get('mapId') === 'ling-shan'
    );
  });
  await expect(page.getByTestId('scene-guide-page')).toBeVisible();
}

test('推荐页：咨询导游进入数字人导游，且不创建 Tour', async ({ page }) => {
  const state = await installNavigationMocks(page);
  await page.goto('/routes');
  await expect(page.getByTestId('route-workbench')).toBeVisible();

  await page.getByRole('link', { name: '咨询导游' }).click();

  await expect(page).toHaveURL((url) => url.pathname === '/guide');
  await expect(page.getByTestId('ai-guide-workbench')).toBeVisible();
  expect(state.draftCreates).toBe(0);
  expect(state.tourCreates).toBe(0);
});

test('推荐页：开始游览创建 Tour 后进入场景式导览', async ({ page }) => {
  const state = await installNavigationMocks(page);
  await page.goto('/routes');
  await expect(page.getByTestId('route-workbench')).toBeVisible();

  await page.getByTestId('start-recommended-tour').click();

  await expectSceneGuideUrl(page);
  expect(state.draftCreates).toBe(1);
  expect(state.tourCreates).toBe(1);
});

test('路线编辑页：咨询导游进入数字人导游，且不创建 Tour', async ({ page }) => {
  const state = await installNavigationMocks(page);
  await page.goto('/route-drafts/draft-entry-e2e');
  await expect(page.getByTestId('start-tour')).toBeVisible();

  await page.getByRole('button', { name: '咨询导游' }).click();

  await expect(page).toHaveURL((url) => url.pathname === '/guide');
  await expect(page.getByTestId('ai-guide-workbench')).toBeVisible();
  expect(state.tourCreates).toBe(0);
});

test('路线编辑页：开始游览创建 Tour 后进入场景式导览', async ({ page }) => {
  const state = await installNavigationMocks(page);
  await page.goto('/route-drafts/draft-entry-e2e');
  await expect(page.getByTestId('start-tour')).toBeVisible();

  await page.getByTestId('start-tour').click();

  await expectSceneGuideUrl(page);
  expect(state.draftCreates).toBe(0);
  expect(state.tourCreates).toBe(1);
});
