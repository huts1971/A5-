import {
  expect,
  test,
  type Page,
  type Request,
  type Route,
} from '@playwright/test';

const now = '2026-07-29T08:00:00+00:00';

const routeSpots = [
  {
    spot_id: 'spot_ls_entrance',
    name: '景区入口',
    sequence: 0,
    stay_minutes: 5,
    reason: '路线计算起点。',
    transition_minutes: null,
    transition_note: null,
  },
  {
    spot_id: 'spot_ls_001',
    name: '九龙灌浴',
    sequence: 1,
    stay_minutes: 25,
    reason: '从入口开始感受灵山胜境的仪式氛围。',
    transition_minutes: null,
    transition_note: null,
  },
  {
    spot_id: 'spot_ls_002',
    name: '灵山大佛',
    sequence: 2,
    stay_minutes: 35,
    reason: '在地标景观前了解灵山文化。',
    transition_minutes: 8,
    transition_note: '沿主游线步行前往。',
  },
  {
    spot_id: 'spot_ls_003',
    name: '灵山梵宫',
    sequence: 3,
    stay_minutes: 30,
    reason: '欣赏建筑、艺术与室内穹顶。',
    transition_minutes: 10,
    transition_note: '经菩提大道前往。',
  },
] as const;

const scenicSpots = [
  {
    id: 'spot_ls_001',
    name: '九龙灌浴',
    summary: '九龙灌浴以大型动态音乐喷泉演出展现佛教文化故事。',
    story: '这里是路线的第一处代表性景观。',
    tags: ['佛教文化', '演艺亲子'],
    visit_minutes: 25,
    crowd_types: ['亲子', '文化'],
    image_url: '/e2e/spot-one.svg',
  },
  {
    id: 'spot_ls_002',
    name: '灵山大佛',
    summary: '灵山大佛是景区最具辨识度的地标之一。',
    story: '登临沿线可以从不同角度远眺大佛。',
    tags: ['佛教文化', '地标'],
    visit_minutes: 35,
    crowd_types: ['文化'],
    image_url: '/e2e/spot-two.svg',
  },
  {
    id: 'spot_ls_003',
    name: '灵山梵宫',
    summary: '灵山梵宫以宏大的空间和丰富的艺术细节著称。',
    story: '内部参观适合放慢脚步欣赏建筑细节。',
    tags: ['建筑艺术', '室内体验'],
    visit_minutes: 30,
    crowd_types: ['建筑', '摄影'],
    image_url: '/e2e/spot-three.svg',
  },
];

function draftResponse() {
  return {
    id: 'draft-e2e',
    source_route_id: 'route-e2e',
    name: '灵山沉浸经典线',
    theme: '文化建筑',
    duration_budget: 120,
    preference_profile: {
      mapId: 'ling-shan',
      durationMinutes: 120,
      physicalLevel: 'medium',
      interestTags: ['佛教文化', '建筑艺术'],
    },
    stay_minutes: 90,
    estimated_walk_minutes: 18,
    total_minutes: 108,
    time_data_complete: true,
    routing_profile: 'fastest',
    time_estimation_status: 'map_estimate',
    budget_exceeded: false,
    revision_count: 0,
    spots: routeSpots,
    created_at: now,
    updated_at: now,
  };
}

function tourResponse(currentIndex = 1) {
  return {
    id: 'tour-e2e',
    route_draft_id: 'draft-e2e',
    name: '灵山沉浸经典线',
    status: 'active',
    current_index: currentIndex,
    started_at: now,
    updated_at: now,
    event_count: currentIndex,
    routing_profile: 'fastest',
    time_estimation_status: 'map_estimate',
    spots: routeSpots.map((spot, index) => ({
      ...spot,
      status:
        index < currentIndex
          ? 'completed'
          : index === currentIndex
            ? 'current'
            : 'pending',
      arrived_at: index === currentIndex ? now : null,
      completed_at: index < currentIndex ? now : null,
    })),
  };
}

interface MockSceneGuideOptions {
  brokenFirstImage?: boolean;
  chatDelays?: Record<string, number>;
  audioUrl?: string | null;
  spotsDelayMs?: number;
  tourCurrentIndex?: number;
  degradedChat?: boolean;
  ttsPending?: boolean;
}

interface SceneGuideChatRequest {
  question?: string;
  spot_id?: string;
  profile?: {
    current_spot_name?: string;
    route_context?: {
      current_index?: number;
      current_spot?: { spot_id?: string };
      next_spot?: { spot_id?: string };
      ordered_spots?: Array<{ spot_id?: string }>;
    };
  };
}

interface MockSceneGuideState {
  draftReads: number;
  tourReads: number;
  chatSpotIds: string[];
  chatRequests: SceneGuideChatRequest[];
  tourEvents: Array<Record<string, unknown>>;
  ttsPolls: number;
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function requestSpotId(request: Request) {
  try {
    return (request.postDataJSON() as { spot_id?: string }).spot_id ?? 'manual';
  } catch {
    return 'manual';
  }
}

function chatSse(
  spotId: string,
  audioUrl: string | null | undefined,
  degraded = false,
  ttsPending = false,
) {
  const sentences: Record<string, string[]> = {
    spot_ls_001: ['OLD-1：第一站开场。', 'OLD-2：第一站历史。', 'OLD-3：第一站建议。'],
    spot_ls_002: ['MID-1：第二站开场。', 'MID-2：第二站历史。', 'MID-3：第二站建议。'],
    spot_ls_003: ['NEW-1：第三站开场。', 'NEW-2：第三站历史。', 'NEW-3：第三站建议。'],
    manual: ['ANSWER-1：问题回答。', 'ANSWER-2：游览建议。'],
  };
  const answer = (
    sentences[spotId] ?? [`当前点位讲解：${spotId}。`]
  ).join('');
  const final = {
    answer,
    sources: [
      {
        title: '灵山胜境景点资料',
        spot_name: routeSpots.find((spot) => spot.spot_id === spotId)?.name ?? '灵山胜境',
        section: '景点简介',
        snippet: `${answer}的资料来源摘要。`,
      },
    ],
    session_id: `scene-e2e-${spotId}`,
    audio_url: ttsPending ? null : audioUrl ?? null,
    tts_job_id: ttsPending ? `tts-${spotId}` : null,
    tts_status: ttsPending ? 'pending' : audioUrl ? 'ready' : 'disabled',
    mode: 'normal',
    degraded,
  };
  return [
    'event: delta',
    `data: ${JSON.stringify({ text: answer })}`,
    '',
    'event: final',
    `data: ${JSON.stringify(final)}`,
    '',
    '',
  ].join('\n');
}

async function mockSceneGuideApis(
  page: Page,
  options: MockSceneGuideOptions = {},
): Promise<MockSceneGuideState> {
  const state: MockSceneGuideState = {
    draftReads: 0,
    tourReads: 0,
    chatSpotIds: [],
    chatRequests: [],
    tourEvents: [],
    ttsPolls: 0,
  };
  let currentTourIndex = options.tourCurrentIndex ?? 1;
  let tourFinished = false;

  const currentTourResponse = () => {
    const response = tourResponse(currentTourIndex);
    if (!tourFinished) return response;
    return {
      ...response,
      status: 'finished',
      finished_at: now,
      event_count: routeSpots.length,
      spots: response.spots.map((spot) => ({
        ...spot,
        status: 'completed',
        arrived_at: spot.arrived_at ?? now,
        completed_at: spot.completed_at ?? now,
      })),
    };
  };

  await page.addInitScript(() => {
    window.localStorage.setItem('a5_visitor_token', 'scene-guide-e2e-token');

    const runtime = window as unknown as {
      __sceneAudioPlayCount: number;
      __sceneAudioPauseCount: number;
      __sceneSpokenSentences: string[];
      __sceneSpeechCancelCount: number;
      __sceneSetAudioProgress: (currentTime: number, duration: number) => void;
      __sceneFinishAudio: () => void;
      Audio: unknown;
    };
    runtime.__sceneAudioPlayCount = 0;
    runtime.__sceneAudioPauseCount = 0;
    runtime.__sceneSpokenSentences = [];
    runtime.__sceneSpeechCancelCount = 0;

    class FakeSpeechSynthesisUtterance {
      text: string;
      lang = '';
      rate = 1;
      onstart: ((event: Event) => void) | null = null;
      onend: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor(text = '') {
        this.text = text;
      }
    }

    let speechTimer: number | undefined;
    const fakeSpeechSynthesis = {
      speaking: false,
      pending: false,
      paused: false,
      speak(utterance: FakeSpeechSynthesisUtterance) {
        if (speechTimer !== undefined) {
          window.clearTimeout(speechTimer);
        }
        runtime.__sceneSpokenSentences.push(utterance.text);
        this.speaking = true;
        queueMicrotask(() => utterance.onstart?.(new Event('start')));
        speechTimer = window.setTimeout(() => {
          speechTimer = undefined;
          this.speaking = false;
          utterance.onend?.(new Event('end'));
        }, 500);
      },
      cancel() {
        runtime.__sceneSpeechCancelCount += 1;
        if (speechTimer !== undefined) {
          window.clearTimeout(speechTimer);
          speechTimer = undefined;
        }
        this.speaking = false;
      },
      pause() {
        this.paused = true;
      },
      resume() {
        this.paused = false;
      },
      getVoices() {
        return [];
      },
      addEventListener() {
        // Voice discovery is not part of this scene-guide test.
      },
      removeEventListener() {
        // Voice discovery is not part of this scene-guide test.
      },
      dispatchEvent() {
        return true;
      },
      onvoiceschanged: null,
    };

    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: FakeSpeechSynthesisUtterance,
    });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: fakeSpeechSynthesis,
    });

    let activeAudio:
      | {
          setProgress: (currentTime: number, duration: number) => void;
          finish: () => void;
        }
      | undefined;

    class FakeAudio extends EventTarget {
      src = '';
      currentTime = 0;
      duration = Number.NaN;
      preload = '';
      paused = true;
      metadataReady = false;
      onplay: (() => void) | null = null;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onloadedmetadata: (() => void) | null = null;
      ondurationchange: (() => void) | null = null;
      ontimeupdate: (() => void) | null = null;

      constructor(src?: string) {
        super();
        this.src = src ?? '';
        activeAudio = this;
      }

      play() {
        runtime.__sceneAudioPlayCount += 1;
        this.paused = false;
        this.onplay?.();
        this.dispatchEvent(new Event('play'));
        return Promise.resolve();
      }

      pause() {
        runtime.__sceneAudioPauseCount += 1;
        this.paused = true;
        this.dispatchEvent(new Event('pause'));
      }

      setProgress(currentTime: number, duration: number) {
        const durationChanged = this.duration !== duration;
        this.duration = duration;
        if (!this.metadataReady) {
          this.metadataReady = true;
          this.onloadedmetadata?.();
        }
        if (durationChanged) this.ondurationchange?.();
        this.currentTime = currentTime;
        this.ontimeupdate?.();
      }

      finish() {
        if (Number.isFinite(this.duration)) {
          this.currentTime = this.duration;
          this.ontimeupdate?.();
        }
        this.paused = true;
        this.onended?.();
        this.dispatchEvent(new Event('ended'));
      }

      load() {
        // Browser audio loading is not part of this UI test.
      }
    }

    runtime.__sceneSetAudioProgress = (currentTime, duration) => {
      activeAudio?.setProgress(currentTime, duration);
    };
    runtime.__sceneFinishAudio = () => activeAudio?.finish();
    runtime.Audio = FakeAudio;
  });

  await page.route('**/e2e/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/e2e/broken.jpg') {
      await route.fulfill({ status: 404, body: 'missing' });
      return;
    }
    if (pathname.endsWith('.mp3')) {
      await route.fulfill({
        status: 200,
        contentType: 'audio/mpeg',
        body: Buffer.from([0]),
      });
      return;
    }
    const title = pathname.split('/').at(-1)?.replace('.svg', '') ?? 'scene';
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="100%" height="100%" fill="#6b7568"/><text x="40" y="80">${title}</text></svg>`,
    });
  });

  await page.route('http://127.0.0.1:8001/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === '/api/auth/me') {
      return json(route, {
        id: 'scene-guide-visitor',
        username: '导览体验员',
        role: 'visitor',
      });
    }
    if (path === '/api/spots') {
      if (options.spotsDelayMs) {
        await new Promise((resolve) =>
          setTimeout(resolve, options.spotsDelayMs),
        );
      }
      const items = scenicSpots.map((spot, index) =>
        index === 0 && options.brokenFirstImage
          ? { ...spot, image_url: '/e2e/broken.jpg' }
          : spot,
      );
      return json(route, { items, total: items.length });
    }
    if (path.startsWith('/api/spots/') && method === 'GET') {
      const spotId = decodeURIComponent(path.split('/').at(-1) ?? '');
      const spot = scenicSpots.find((item) => item.id === spotId);
      if (!spot) return json(route, { message: 'spot_not_found' }, 404);
      return json(
        route,
        options.brokenFirstImage && spot.id === 'spot_ls_001'
          ? { ...spot, image_url: '/e2e/broken.jpg' }
          : spot,
      );
    }
    if (path === '/api/route-drafts/draft-e2e' && method === 'GET') {
      state.draftReads += 1;
      return json(route, draftResponse());
    }
    if (path === '/api/tours/tour-e2e' && method === 'GET') {
      state.tourReads += 1;
      return json(route, currentTourResponse());
    }
    if (path === '/api/tours/tour-e2e/events' && method === 'POST') {
      const event = request.postDataJSON() as Record<string, unknown>;
      state.tourEvents.push(event);
      const expectedSpotId = routeSpots[currentTourIndex]?.spot_id;
      if (event.spot_id !== expectedSpotId) {
        return json(
          route,
          {
            code: 'TOUR_SPOT_OUT_OF_ORDER',
            message: `expected ${expectedSpotId}`,
          },
          409,
        );
      }
      if (event.event_type === 'spot_completed') {
        if (currentTourIndex >= routeSpots.length - 1) {
          tourFinished = true;
        } else {
          currentTourIndex += 1;
        }
      }
      return json(route, currentTourResponse());
    }
    if (path === '/api/chat/stream' && method === 'POST') {
      state.chatRequests.push(
        request.postDataJSON() as SceneGuideChatRequest,
      );
      const spotId = requestSpotId(request);
      state.chatSpotIds.push(spotId);
      const delay = options.chatDelays?.[spotId] ?? 30;
      await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream; charset=utf-8',
          headers: {
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
          body: chatSse(
            spotId,
            options.audioUrl,
            options.degradedChat,
            options.ttsPending,
          ),
        });
      } catch {
        // Aborted scene narration requests are expected during rapid point switching.
      }
      return;
    }
    if (path.startsWith('/api/tts/jobs/')) {
      state.ttsPolls += 1;
      return json(route, {
        status: 'ready',
        audio_url: '/e2e/narration.mp3',
        error: null,
      });
    }

    return json(route, {});
  });

  return state;
}

async function expectBackgroundContains(page: Page, expected: string) {
  await expect
    .poll(async () => {
      const background = page.getByTestId('scene-guide-background').last();
      return background.evaluate((node) => {
        const image =
          node instanceof HTMLImageElement
            ? node
            : node.querySelector<HTMLImageElement>('img');
        return (
          image?.getAttribute('src') ??
          node.getAttribute('data-src') ??
          node.getAttribute('data-image-url') ??
          getComputedStyle(node).backgroundImage
        );
      });
    })
    .toContain(expected);
}

async function spokenSentences(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __sceneSpokenSentences: string[];
        }
      ).__sceneSpokenSentences,
  );
}

test('访客侧边栏按指定顺序显示九个入口，且未登录访问场景式导览会被拦截', async ({
  page,
}) => {
  await page.goto('/scene-guide');
  await expect(page).toHaveURL('http://127.0.0.1:5183/');
  await expect(page.locator('a[href="/login"]')).toBeVisible();

  await mockSceneGuideApis(page);
  await page.goto('/scene-guide');

  const sceneLink = page.locator('.visitor-sider-menu a[href="/scene-guide"]');
  await expect(sceneLink).toHaveText('场景式导览');
  const navLinks = page.locator('.visitor-primary-menu .ant-menu-item a');
  await expect(navLinks).toHaveCount(9);
  expect(await navLinks.evaluateAll((links) => links.map((link) => link.getAttribute('href')))).toEqual(
    [
      '/guide',
      '/spots',
      '/panorama',
      '/routes',
      '/scene-guide',
      '/tour-recaps',
      '/community',
      '/travel-journal',
      '/photo-workshop',
    ],
  );
});

test('没有可恢复路线时显示空态并引导前往路线生成页', async ({ page }) => {
  await mockSceneGuideApis(page);
  await page.goto('/scene-guide');

  const scene = page.getByTestId('scene-guide-page');
  await expect(scene).toBeVisible();
  await expect(
    scene.getByRole('link', { name: /生成|规划|选择.*路线/ }),
  ).toHaveAttribute('href', '/routes');
});

test('draftId 可从 URL 恢复路线，点位与景点总览封面保持同步', async ({ page }) => {
  const api = await mockSceneGuideApis(page);
  await page.goto('/scene-guide?draftId=draft-e2e');

  await expect(page.getByTestId('scene-guide-page')).toBeVisible();
  const routeStrip = page.getByTestId('scene-route-progress-strip');
  await expect(routeStrip).not.toContainText('SCENE TOUR');
  await expect(routeStrip).not.toContainText('灵山沉浸经典线');
  await expect(routeStrip).not.toContainText('正在预览第');
  await expect(routeStrip).toHaveAttribute(
    'aria-label',
    /灵山沉浸经典线，正在预览第 1 站/,
  );
  await expect(
    page.getByTestId('scene-route-stop-spot_ls_entrance'),
  ).toHaveCount(0);
  await expect(routeStrip).not.toContainText('景区入口');
  await expect(
    routeStrip.locator('[data-testid^="scene-route-stop-"]'),
  ).toHaveCount(3);
  await expect(page.getByTestId('scene-route-stop-spot_ls_001')).toBeVisible();
  await expect(
    page.getByTestId('scene-route-stop-spot_ls_001'),
  ).toHaveAttribute('aria-label', /第 1 站/);
  await expect(page.getByTestId('scene-route-stop-spot_ls_002')).toBeVisible();
  await expect(page.getByTestId('scene-route-stop-spot_ls_003')).toBeVisible();
  await expect(page.getByTestId('scene-route-previous')).toBeDisabled();
  await expectBackgroundContains(page, '/e2e/spot-one.svg');
  await expect(page.locator('[class*="sceneScrim"]')).toHaveCount(0);
  await page.waitForTimeout(600);
  await expect
    .poll(() =>
      page.getByTestId('scene-guide-background').evaluate((image) => {
        const style = window.getComputedStyle(image);
        return {
          filter: style.filter,
          opacity: style.opacity,
          transform: style.transform,
        };
      }),
    )
    .toEqual({
      filter: 'none',
      opacity: '1',
      transform: 'none',
    });
  await expect(page.locator('#scene-guide-spot-name')).toHaveCount(0);
  await expect(
    page.getByText(scenicSpots[0].summary, { exact: true }),
  ).toHaveCount(0);

  await page.getByTestId('scene-route-next').click();
  await expectBackgroundContains(page, '/e2e/spot-two.svg');
  expect(api.draftReads).toBe(1);
});

test('场景式导览可进入和退出浏览器全屏，并保留全部沉浸交互', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let fullscreenElement: Element | null = null;
    const runtime = window as unknown as {
      __sceneFullscreenRequests: number;
      __sceneFullscreenExits: number;
      __sceneFullscreenTarget: string;
      __sceneSimulateFullscreenExit: () => void;
    };

    runtime.__sceneFullscreenRequests = 0;
    runtime.__sceneFullscreenExits = 0;
    runtime.__sceneFullscreenTarget = '';

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement,
    });
    Object.defineProperty(document, 'fullscreenEnabled', {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value(this: HTMLElement) {
        runtime.__sceneFullscreenRequests += 1;
        runtime.__sceneFullscreenTarget = this.dataset.testid ?? '';
        fullscreenElement = this;
        document.dispatchEvent(new Event('fullscreenchange'));
        const unityCanvas = document.querySelector<HTMLCanvasElement>(
          '.unity-avatar-canvas-source',
        );
        if (unityCanvas) {
          unityCanvas.width = window.innerWidth;
          unityCanvas.height = window.innerHeight;
        }
        return Promise.resolve();
      },
    });
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: () => {
        runtime.__sceneFullscreenExits += 1;
        fullscreenElement = null;
        document.dispatchEvent(new Event('fullscreenchange'));
        return Promise.resolve();
      },
    });
    runtime.__sceneSimulateFullscreenExit = () => {
      fullscreenElement = null;
      document.dispatchEvent(new Event('fullscreenchange'));
    };
  });
  await mockSceneGuideApis(page);
  await page.goto('/scene-guide?draftId=draft-e2e');

  const scene = page.getByTestId('scene-guide-page');
  const toggle = page.getByTestId('scene-guide-fullscreen-toggle');
  const runtimeHost = page.getByTestId('unity-avatar-runtime-host');
  const unityRuntime = page.locator('.unity-avatar-runtime');
  const unitySourceCanvas = page.locator('.unity-avatar-canvas-source');
  const avatarShell = page
    .getByTestId('scene-guide-avatar')
    .locator('.avatar-stage-shell');
  await expect(toggle).toBeVisible();
  await expect(runtimeHost).toHaveCount(1);
  await expect(unityRuntime).toHaveCount(1);
  await expect(unitySourceCanvas).toHaveCount(1);
  await expect(unityRuntime).toHaveClass(/is-active/);
  await expect(unityRuntime).toBeVisible();
  await expect
    .poll(() =>
      runtimeHost.evaluate(
        (host) =>
          host.parentElement?.dataset.testid === 'scene-guide-page',
      ),
    )
    .toBe(true);
  const avatarSizeBeforeFullscreen = await avatarShell.evaluate((shell) => {
    const rect = shell.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  const runtimeSizeBeforeFullscreen = await unityRuntime.evaluate((runtime) => {
    const rect = runtime.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  expect(runtimeSizeBeforeFullscreen).toEqual(avatarSizeBeforeFullscreen);
  const expectedCanvasBackingSize = await unitySourceCanvas.evaluate((canvas) => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    return {
      width: Math.max(1, Math.round(rect.width * dpr)),
      height: Math.max(1, Math.round(rect.height * dpr)),
    };
  });
  await expect
    .poll(() =>
      unitySourceCanvas.evaluate((canvas) => ({
        width: canvas.width,
        height: canvas.height,
      })),
    )
    .toEqual(expectedCanvasBackingSize);
  await unityRuntime.evaluate((runtime) => {
    runtime.setAttribute('data-fullscreen-identity', 'stable-runtime');
  });
  await expect(toggle).toHaveAccessibleName('进入全屏');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');

  await toggle.click();
  await expect(scene).toHaveAttribute('data-fullscreen', 'true');
  await expect(toggle).toHaveAccessibleName('退出全屏');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('scene-route-progress-strip')).toBeVisible();
  await expect(page.getByTestId('scene-guide-background')).toBeVisible();
  await expect(page.getByTestId('scene-guide-bubble')).toBeVisible();
  await expect(page.getByTestId('scene-guide-avatar')).toBeVisible();
  await expect(page.getByTestId('guide-composer')).toBeVisible();
  await expect(scene.getByTestId('unity-avatar-runtime-host')).toHaveCount(1);
  await expect(unityRuntime).toHaveClass(/is-active/);
  await expect(unityRuntime).toBeVisible();
  await expect(unityRuntime).toHaveAttribute(
    'data-fullscreen-identity',
    'stable-runtime',
  );
  const avatarSizeInFullscreen = await avatarShell.evaluate((shell) => {
    const rect = shell.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  const runtimeSizeInFullscreen = await unityRuntime.evaluate((runtime) => {
    const rect = runtime.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  expect(runtimeSizeInFullscreen).toEqual(avatarSizeInFullscreen);
  expect(runtimeSizeInFullscreen).toEqual(runtimeSizeBeforeFullscreen);
  await expect
    .poll(() =>
      unitySourceCanvas.evaluate((canvas) => ({
        width: canvas.width,
        height: canvas.height,
      })),
    )
    .toEqual(expectedCanvasBackingSize);

  const fullscreenCalls = await page.evaluate(() => {
    const runtime = window as unknown as {
      __sceneFullscreenRequests: number;
      __sceneFullscreenTarget: string;
    };
    return {
      requests: runtime.__sceneFullscreenRequests,
      target: runtime.__sceneFullscreenTarget,
    };
  });
  expect(fullscreenCalls).toEqual({
    requests: 1,
    target: 'scene-guide-page',
  });

  await toggle.click();
  await expect(scene).toHaveAttribute('data-fullscreen', 'false');
  await expect(toggle).toHaveAccessibleName('进入全屏');
  await expect
    .poll(() =>
      runtimeHost.evaluate(
        (host) =>
          host.parentElement?.dataset.testid === 'scene-guide-page',
      ),
    )
    .toBe(true);
  await expect(unityRuntime).toHaveAttribute(
    'data-fullscreen-identity',
    'stable-runtime',
  );
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as {
            __sceneFullscreenExits: number;
          }
        ).__sceneFullscreenExits,
    ),
  ).toBe(1);

  await toggle.click();
  await expect(scene).toHaveAttribute('data-fullscreen', 'true');
  await page.evaluate(() => {
    (
      window as unknown as {
        __sceneSimulateFullscreenExit: () => void;
      }
    ).__sceneSimulateFullscreenExit();
  });
  await expect(scene).toHaveAttribute('data-fullscreen', 'false');
  await expect(toggle).toHaveAccessibleName('进入全屏');
});

test('放大数字人布局下，AI 多句讲解会以一句一气泡的方式自动推进', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const api = await mockSceneGuideApis(page);
  await page.goto('/scene-guide?draftId=draft-e2e');

  const avatar = page.getByTestId('scene-guide-avatar');
  await expect(avatar).toBeVisible();
  await expect(avatar).toHaveAttribute('data-layout', 'large');
  const routeMaterial = await page
    .getByTestId('scene-route-progress-strip')
    .evaluate((element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        backgroundColor: style.backgroundColor,
        backdropFilter: style.backdropFilter,
        height: rect.height,
      };
    });
  expect(routeMaterial.backgroundColor).toBe('rgba(18, 22, 20, 0.42)');
  expect(routeMaterial.backdropFilter).not.toBe('none');
  expect(routeMaterial.height).toBeLessThanOrEqual(60);
  await expect(page.getByTestId('scene-guide-start')).toHaveCount(0);
  await expect(
    page.getByText('准备好进入当前场景了吗？', { exact: true }),
  ).toHaveCount(0);

  await page.getByTestId('scene-route-stop-spot_ls_001').click();
  const bubble = page.getByTestId('scene-guide-bubble');
  const bubbleText = page.getByTestId('scene-guide-bubble-text');
  const composerMaterial = await page
    .getByTestId('guide-composer')
    .evaluate((element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        backgroundColor: style.backgroundColor,
        height: rect.height,
        width: rect.width,
      };
    });

  await expect(bubble).toHaveAttribute('data-sentence-count', '3');
  expect(composerMaterial.backgroundColor).toBe('rgba(18, 22, 20, 0.56)');
  expect(composerMaterial.width).toBeLessThanOrEqual(342);
  expect(composerMaterial.height).toBeLessThanOrEqual(44);
  await expect(bubble).toHaveAttribute('data-sentence-index', '0');
  await expect(bubbleText).toHaveText('OLD-1：第一站开场。');
  await expect(
    bubble.getByText('灵诗音讲解', { exact: true }),
  ).toHaveCount(0);
  await expect(
    bubble.getByText('查看资料来源', { exact: true }),
  ).toHaveCount(0);
  await expect(bubble.getByText(/正在讲解/)).toHaveCount(0);
  await expect.poll(() => api.chatRequests.length).toBe(1);
  expect(api.chatRequests[0].question).toContain(
    '请讲解当前景点“九龙灌浴”',
  );
  expect(api.chatRequests[0].question).toContain(
    '请用五到六句自然口语',
  );
  expect(api.chatRequests[0].question).not.toMatch(
    /完整路线上下文|生成3到4句|票价|开放时间|安全信息|景点已有摘要/,
  );
  expect(api.chatRequests[0]).toMatchObject({
    spot_id: 'spot_ls_001',
    profile: {
      current_spot_name: '九龙灌浴',
      route_context: {
        current_index: 0,
        current_spot: { spot_id: 'spot_ls_001' },
        next_spot: { spot_id: 'spot_ls_002' },
      },
    },
  });
  expect(
    api.chatRequests[0].profile?.route_context?.ordered_spots?.map(
      (spot) => spot.spot_id,
    ),
  ).toEqual(['spot_ls_001', 'spot_ls_002', 'spot_ls_003']);

  await expect(bubble).toHaveAttribute('data-sentence-index', '1', {
    timeout: 3_000,
  });
  await expect(bubbleText).toHaveText('OLD-2：第一站历史。');

  await expect(bubble).toHaveAttribute('data-sentence-index', '2', {
    timeout: 3_000,
  });
  await expect(bubbleText).toHaveText('OLD-3：第一站建议。');
  await expect.poll(() => spokenSentences(page)).toEqual([
    'OLD-1：第一站开场。',
    'OLD-2：第一站历史。',
    'OLD-3：第一站建议。',
  ]);

  await expect(page.getByText('手动播放', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /手动播放/ }),
  ).toHaveCount(0);

  await page.getByTestId('scene-route-stop-spot_ls_001').click();
  await expect(bubble).toHaveAttribute('data-sentence-index', '0');
  await expect(bubbleText).toHaveText('OLD-1：第一站开场。');
  await expect
    .poll(async () => (await spokenSentences(page))[3])
    .toBe('OLD-1：第一站开场。');
});

test('异步 TTS 使用真实音频时间轴同步气泡，不走浏览器机械朗读', async ({
  page,
}) => {
  const api = await mockSceneGuideApis(page, { ttsPending: true });
  await page.goto('/scene-guide?draftId=draft-e2e');

  await page.getByTestId('scene-route-stop-spot_ls_001').click();

  await expect.poll(() => api.ttsPolls, { timeout: 5_000 }).toBeGreaterThan(0);
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                __sceneAudioPlayCount: number;
              }
            ).__sceneAudioPlayCount,
        ),
      { timeout: 5_000 },
    )
    .toBe(1);
  await expect(page.getByTestId('scene-guide-bubble')).toHaveAttribute(
    'data-sentence-count',
    '3',
  );
  await expect(page.getByTestId('scene-guide-bubble-text')).toHaveText(
    'OLD-1：第一站开场。',
  );

  await page.waitForTimeout(2_100);
  await expect(page.getByTestId('scene-guide-bubble')).toHaveAttribute(
    'data-sentence-index',
    '0',
  );

  await page.evaluate(() => {
    (
      window as unknown as {
        __sceneSetAudioProgress: (
          currentTime: number,
          duration: number,
        ) => void;
      }
    ).__sceneSetAudioProgress(4.5, 9);
  });
  await expect(page.getByTestId('scene-guide-bubble')).toHaveAttribute(
    'data-sentence-index',
    '1',
  );
  await expect(page.getByTestId('scene-guide-bubble-text')).toHaveText(
    'OLD-2：第一站历史。',
  );

  await page.evaluate(() => {
    (
      window as unknown as {
        __sceneSetAudioProgress: (
          currentTime: number,
          duration: number,
        ) => void;
      }
    ).__sceneSetAudioProgress(8.5, 9);
  });
  await expect(page.getByTestId('scene-guide-bubble')).toHaveAttribute(
    'data-sentence-index',
    '2',
  );
  await expect(page.getByTestId('scene-guide-bubble-text')).toHaveText(
    'OLD-3：第一站建议。',
  );
  await page.evaluate(() => {
    (
      window as unknown as {
        __sceneFinishAudio: () => void;
      }
    ).__sceneFinishAudio();
  });
  expect(await spokenSentences(page)).toEqual([]);
});

test('景点资料尚未加载完成时不会抢先发送泛化讲解', async ({ page }) => {
  const api = await mockSceneGuideApis(page, { spotsDelayMs: 1_600 });
  await page.goto('/scene-guide?draftId=draft-e2e');

  await page.getByTestId('scene-route-stop-spot_ls_001').click();
  await page.waitForTimeout(100);
  expect(api.chatRequests).toHaveLength(0);

  await expect.poll(() => api.chatRequests.length).toBe(1);
  expect(api.chatRequests[0]).toMatchObject({
    spot_id: 'spot_ls_001',
    profile: {
      route_context: {
        current_index: 0,
        current_spot: { spot_id: 'spot_ls_001' },
      },
    },
  });
});

test('AI 降级时本地讲解仍保持至少五句', async ({ page }) => {
  await mockSceneGuideApis(page, { degradedChat: true });
  await page.goto('/scene-guide?draftId=draft-e2e');

  await page.getByTestId('scene-route-stop-spot_ls_001').click();
  const bubble = page.getByTestId('scene-guide-bubble');
  await expect(bubble).toHaveAttribute('data-sentence-count', '5');
  await expect(page.getByTestId('scene-guide-bubble-text')).toHaveText(
    scenicSpots[0].story,
  );
});

test('快速连续切换三个点位时，中止的旧 SSE 不会回写当前气泡', async ({ page }) => {
  await mockSceneGuideApis(page, {
    chatDelays: {
      spot_ls_001: 500,
      spot_ls_002: 280,
      spot_ls_003: 30,
    },
  });
  await page.goto('/scene-guide?draftId=draft-e2e');

  const firstChat = page.waitForRequest(
    (request) =>
      request.url().endsWith('/api/chat/stream') &&
      requestSpotId(request) === 'spot_ls_001',
  );
  await page.getByTestId('scene-route-stop-spot_ls_001').click();
  await firstChat;

  const secondChat = page.waitForRequest(
    (request) =>
      request.url().endsWith('/api/chat/stream') &&
      requestSpotId(request) === 'spot_ls_002',
  );
  await page.getByTestId('scene-route-stop-spot_ls_002').click();
  await secondChat;

  const thirdChat = page.waitForRequest(
    (request) =>
      request.url().endsWith('/api/chat/stream') &&
      requestSpotId(request) === 'spot_ls_003',
  );
  await page.getByTestId('scene-route-stop-spot_ls_003').click();
  await thirdChat;

  const bubble = page.getByTestId('scene-guide-bubble');
  const bubbleText = page.getByTestId('scene-guide-bubble-text');
  await expect(bubbleText).toContainText(/NEW-[123]：第三站/);
  await expect(bubble).toHaveAttribute('data-sentence-index', '2', {
    timeout: 3_000,
  });
  await expect(bubbleText).toHaveText('NEW-3：第三站建议。');
});

test('切换点位会取消上一点尚未播放的句子队列', async ({ page }) => {
  await mockSceneGuideApis(page);
  await page.goto('/scene-guide?draftId=draft-e2e');
  await page.getByTestId('scene-route-stop-spot_ls_001').click();

  const bubble = page.getByTestId('scene-guide-bubble');
  const bubbleText = page.getByTestId('scene-guide-bubble-text');
  await expect(bubble).toHaveAttribute('data-sentence-index', '0');
  await expect(bubbleText).toHaveText('OLD-1：第一站开场。');
  await expect.poll(() => spokenSentences(page)).toEqual([
    'OLD-1：第一站开场。',
  ]);

  await page.getByTestId('scene-route-stop-spot_ls_002').click();
  await expectBackgroundContains(page, '/e2e/spot-two.svg');
  await expect(bubble).toHaveAttribute('data-sentence-index', '0');
  await expect(bubbleText).toHaveText('MID-1：第二站开场。');

  await expect(bubble).toHaveAttribute('data-sentence-index', '2', {
    timeout: 3_000,
  });
  await expect(bubbleText).toHaveText('MID-3：第二站建议。');
  await page.waitForTimeout(650);

  const spoken = await spokenSentences(page);
  expect(spoken).toContain('OLD-1：第一站开场。');
  expect(spoken).not.toContain('OLD-2：第一站历史。');
  expect(spoken).not.toContain('OLD-3：第一站建议。');
  expect(spoken).toEqual(
    expect.arrayContaining([
      'MID-1：第二站开场。',
      'MID-2：第二站历史。',
      'MID-3：第二站建议。',
    ]),
  );
});

test('Tour 自由预览不写入进度，只有完成真实当前点才发送 spot_completed', async ({
  page,
}) => {
  const api = await mockSceneGuideApis(page);
  await page.goto('/scene-guide?tourId=tour-e2e');

  await expect(
    page.getByTestId('scene-route-stop-spot_ls_entrance'),
  ).toHaveCount(0);
  await expect(page.getByTestId('scene-route-complete')).toBeVisible();
  await page.getByTestId('scene-route-stop-spot_ls_002').click();
  await expectBackgroundContains(page, '/e2e/spot-two.svg');
  await expect(
    page.getByTestId('scene-route-progress-strip'),
  ).not.toContainText(/行程第|正在预览第|行程与预览均在/);
  await expect(page.getByTestId('scene-route-complete')).toHaveCount(0);
  expect(api.tourEvents).toHaveLength(0);

  await page.getByTestId('scene-route-stop-spot_ls_001').click();
  await expect(page.getByTestId('scene-route-complete')).toBeVisible();
  await page.getByTestId('scene-route-complete').click();

  await expect.poll(() => api.tourEvents.length).toBe(1);
  expect(api.tourEvents[0]).toMatchObject({
    event_type: 'spot_completed',
    spot_id: 'spot_ls_001',
  });
  await expect(page.getByTestId('scene-route-complete')).toBeVisible();
  expect(api.tourReads).toBe(1);
});

test('完成最后一个正式点后停留当前场景，并可刷新恢复回顾入口', async ({
  page,
}) => {
  const api = await mockSceneGuideApis(page, { tourCurrentIndex: 3 });
  await page.goto('/scene-guide?tourId=tour-e2e');

  await expectBackgroundContains(page, '/e2e/spot-three.svg');
  await expect(page.getByTestId('scene-route-complete')).toBeVisible();
  await page.getByTestId('scene-route-complete').click();

  await expect.poll(() => api.tourEvents.length).toBe(1);
  expect(api.tourEvents[0]).toMatchObject({
    event_type: 'spot_completed',
    spot_id: 'spot_ls_003',
  });
  await expectBackgroundContains(page, '/e2e/spot-three.svg');
  await expect(page.getByTestId('scene-guide-view-recap')).toBeVisible();
  await expect(page.getByTestId('scene-guide-view-recap')).toHaveAttribute(
    'href',
    '/tour/tour-e2e/recap',
  );
  const historyEntry = await page.evaluate(() => {
    const raw = window.localStorage.getItem('ling-shan-tour-history:v1');
    const entries = raw ? (JSON.parse(raw) as Array<Record<string, unknown>>) : [];
    return entries.find((entry) => entry.tourId === 'tour-e2e');
  });
  expect(historyEntry).toMatchObject({
    tourId: 'tour-e2e',
    status: 'finished',
  });

  await page.reload();
  await expectBackgroundContains(page, '/e2e/spot-three.svg');
  await expect(page.getByTestId('scene-guide-view-recap')).toBeVisible();
});

test('旧 Tour 的真实进度仍在入口时不会把首个景点误当成可完成点', async ({
  page,
}) => {
  const api = await mockSceneGuideApis(page, { tourCurrentIndex: 0 });
  await page.goto('/scene-guide?tourId=tour-e2e');

  await expect(
    page.getByTestId('scene-route-stop-spot_ls_entrance'),
  ).toHaveCount(0);
  await expectBackgroundContains(page, '/e2e/spot-one.svg');
  await expect(page.getByTestId('scene-route-complete')).toHaveCount(0);
  await expect(
    page.getByTestId('scene-route-progress-strip'),
  ).toHaveAttribute('aria-label', /真实行程尚未进入可讲解景点/);

  await page.getByTestId('scene-route-stop-spot_ls_001').click();
  await expect.poll(() => api.chatSpotIds).toEqual(['spot_ls_001']);
  expect(api.tourEvents).toHaveLength(0);
});

test('景点坏图会回退到现有默认图', async ({ page }) => {
  await mockSceneGuideApis(page, { brokenFirstImage: true });
  await page.goto('/scene-guide?draftId=draft-e2e');

  await expectBackgroundContains(page, '/scenic/spots/default.svg');
});

test('声音开关会阻止后续自动讲解，页面不提供“手动播放”入口', async ({ page }) => {
  await mockSceneGuideApis(page);
  await page.goto('/scene-guide?draftId=draft-e2e');
  await page.getByTestId('scene-route-stop-spot_ls_001').click();

  const bubble = page.getByTestId('scene-guide-bubble');
  await expect(bubble).toHaveAttribute('data-sentence-index', '2', {
    timeout: 3_000,
  });
  await expect.poll(() => spokenSentences(page)).toHaveLength(3);

  const muteButton = page.getByRole('button', {
    name: /静音|关闭.*声音|关闭自动讲解/,
  });
  await muteButton.click();
  await page.getByTestId('scene-route-stop-spot_ls_002').click();
  await expect(bubble).toContainText('MID-1：第二站开场。');
  await page.waitForTimeout(700);
  expect(await spokenSentences(page)).toHaveLength(3);
  await expect(page.getByText('手动播放', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /手动播放/ }),
  ).toHaveCount(0);
});

test('390×844 下主页面无横向溢出且路线条和交互区可用', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockSceneGuideApis(page);
  await page.goto('/scene-guide?draftId=draft-e2e');

  await expect(page.getByTestId('scene-guide-page')).toBeVisible();
  await expect(page.getByTestId('scene-route-progress-strip')).toBeVisible();
  const fullscreenButtonBox = await page
    .getByTestId('scene-guide-fullscreen-toggle')
    .boundingBox();
  expect(fullscreenButtonBox).not.toBeNull();
  expect(fullscreenButtonBox!.x).toBeGreaterThanOrEqual(0);
  expect(fullscreenButtonBox!.y).toBeGreaterThanOrEqual(0);
  expect(fullscreenButtonBox!.x + fullscreenButtonBox!.width).toBeLessThanOrEqual(
    390,
  );
  expect(fullscreenButtonBox!.y + fullscreenButtonBox!.height).toBeLessThanOrEqual(
    844,
  );
  await expect(page.getByTestId('scene-guide-start')).toHaveCount(0);
  await page.getByTestId('scene-route-stop-spot_ls_001').click();
  await expect(page.getByTestId('scene-guide-bubble')).toHaveAttribute(
    'data-sentence-index',
    '0',
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
});
