import { expect, test, type Page, type Route } from '@playwright/test';

const now = '2026-07-29T08:00:00+00:00';

function journal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'journal-e2e',
    status: 'draft',
    description: '今天沿着灵山的林荫路慢慢前行，想记下安静的夏日时光。',
    target_words: 600,
    title: '',
    opening: '',
    text_sections: [],
    conclusion: '',
    images: [],
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

const generatedJournal = journal({
  target_words: 300,
  title: '风从灵山来',
  opening: '清晨的光落在林荫路上，旅程也由此慢慢展开。',
  text_sections: [
    {
      id: 'section-1',
      title: '沿着树影慢行',
      body: '我没有急着赶路，只把脚步放轻，让风声和远处的钟声陪我向前。',
    },
    {
      id: 'section-2',
      title: '把此刻留住',
      body: '旅行的意义并不总在抵达，也在这些愿意停下来认真感受的瞬间。',
    },
    {
      id: 'section-3',
      title: '一段温柔的回望',
      body: '回头看时，走过的路已被午后的光染成一段安静而明亮的记忆。',
    },
  ],
  conclusion: '愿下一次出发时，我仍能带着今天这份从容。',
});

async function mockApis(page: Page) {
  let current = journal();
  let generateCalls = 0;
  await page.addInitScript(() => {
    window.localStorage.setItem('a5_visitor_token', 'e2e-token');
  });
  await page.route('http://127.0.0.1:8001/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === '/api/auth/me') {
      return json(route, { id: 'visitor-e2e', username: '旅行者', role: 'visitor' });
    }
    if (path === '/api/spots') {
      return json(route, { items: [], total: 0 });
    }
    if (path === '/api/travel-journals' && method === 'POST') {
      current = { ...current, ...request.postDataJSON(), id: 'journal-e2e' };
      return json(route, current);
    }
    if (path === '/api/travel-journals' && method === 'GET') {
      return json(route, { items: [current], total: 1, page: 1, page_size: 9 });
    }
    if (path.endsWith('/display') && method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          'base64',
        ),
      });
    }
    if (path.endsWith('/images') && method === 'POST') {
      const fileCount = 9;
      current = {
        ...current,
        images: Array.from({ length: fileCount }, (_, index) => ({
          id: `image-${index + 1}`,
          display_url: `/api/travel-journals/journal-e2e/images/image-${index + 1}/display`,
          sort_order: index,
          title: '',
          body: '',
        })),
      };
      return json(route, { journal: current, errors: [] });
    }
    if (path.endsWith('/images/order') && method === 'PUT') {
      const order = request.postDataJSON().image_ids as string[];
      current = {
        ...current,
        images: order.map((id, index) => ({
          ...(current.images as Array<Record<string, unknown>>).find((item) => item.id === id)!,
          sort_order: index,
        })),
      };
      return json(route, current);
    }
    if (/\/images\/[^/]+$/.test(path) && method === 'DELETE') {
      const imageId = path.split('/').at(-1);
      current = {
        ...current,
        images: (current.images as Array<Record<string, unknown>>)
          .filter((item) => item.id !== imageId)
          .map((item, index) => ({ ...item, sort_order: index })),
      };
      return json(route, current);
    }
    if (path === '/api/travel-journals/journal-e2e' && method === 'PATCH') {
      const payload = request.postDataJSON();
      current = {
        ...current,
        ...payload,
        target_words: payload.target_words ?? current.target_words,
        text_sections: payload.text_sections ?? current.text_sections,
      };
      return json(route, current);
    }
    if (path.endsWith('/generate')) {
      generateCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 120));
      current = { ...generatedJournal, description: request.postDataJSON().description };
      return json(route, current);
    }
    if (path.endsWith('/publish')) {
      current = { ...current, status: 'published' };
      return json(route, { journal: current, post_id: 901 });
    }
    if (path.endsWith('/export.pdf')) {
      return route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': "attachment; filename*=UTF-8''travel-journal.pdf",
        },
        body: '%PDF-1.7 e2e',
      });
    }
    if (path === '/api/community/posts') {
      return json(route, {
        items: [
          {
            id: 901,
            author_id: 'visitor-e2e',
            author_name: '旅行者',
            content: current.opening,
            post_type: 'travel_journal',
            travel_journal: {
              id: current.id,
              title: current.title,
              opening: current.opening,
              text_sections: current.text_sections,
              conclusion: current.conclusion,
              images: [],
            },
            spot: null,
            status: 'published',
            like_count: 0,
            liked_by_me: false,
            is_mine: true,
            created_at: now,
            updated_at: now,
          },
        ],
        total: 1,
        page: 1,
        page_size: 10,
      });
    }
    return json(route, {});
  });
  return {
    getGenerateCalls: () => generateCalls,
  };
}

test('旅行手账从创作到社区阅读形成完整 PC 链路', async ({ page }) => {
  const api = await mockApis(page);
  await page.goto('/travel-journal');

  await expect(page.getByRole('heading', { name: '旅行手账共创' })).toBeVisible();
  const communityItem = page.getByRole('link', { name: '评论社区' });
  const journalItem = page.getByRole('link', { name: '旅行手账共创' });
  await expect(journalItem).toBeVisible();
  expect((await journalItem.boundingBox())!.y).toBeGreaterThan((await communityItem.boundingBox())!.y);

  await page.getByPlaceholder(/写下今天的心情/).fill(
    '今天沿着灵山的林荫路慢慢前行，想记下安静的夏日时光。',
  );
  await page.getByText('300 字', { exact: true }).click();
  await page.getByRole('button', { name: 'Kimi 帮我创作' }).dblclick();

  await expect(page.locator('input[value="风从灵山来"]')).toBeVisible();
  expect(api.getGenerateCalls()).toBe(1);
  await expect(page.getByRole('heading', { name: '风从灵山来' })).toBeVisible();
  await expect(page.getByText('所有修改会自动保存')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);

  const titleInput = page.locator('input[value="风从灵山来"]');
  await titleInput.fill('我与灵山的一天');
  await expect(page.getByRole('heading', { name: '我与灵山的一天' })).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PDF' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('我与灵山的一天.pdf');

  await page.getByRole('button', { name: '发布到评论社区' }).click();
  await expect(page.locator('.ant-modal-confirm-title', { hasText: '确认发布到评论社区？' })).toBeVisible();
  await page.getByRole('button', { name: '确认发布' }).click();

  await expect(page).toHaveURL(/\/community\?highlight=901/);
  await expect(page.getByRole('heading', { name: '评论社区' })).toBeVisible();
  await page.locator('button[class*="journalPost"]').click();
  await expect(page.getByRole('heading', { name: /灵山/ }).last()).toBeVisible();
  await expect(page.getByText('愿下一次出发时，我仍能带着今天这份从容。')).toBeVisible();
});

test('未登录游客不能直接进入旅行手账', async ({ page }) => {
  await page.goto('/travel-journal');
  await expect(page).toHaveURL('http://127.0.0.1:5183/');
  await expect(page.getByRole('button', { name: '[ 登录 ]' })).toBeVisible();
});

test('我的手账可以恢复草稿并显示状态', async ({ page }) => {
  await mockApis(page);
  await page.goto('/travel-journal');
  await page.getByText('我的手账', { exact: true }).first().click();

  await expect(page.getByText('草稿', { exact: true })).toBeVisible();
  await expect(page.getByText('更新于 2026年7月29日')).toBeVisible();
  await page.getByRole('button', { name: '继续编辑' }).click();
  await expect(page.getByPlaceholder(/写下今天的心情/)).toHaveValue(/灵山的林荫路/);
});

test('多图上传、拖动排序、删除和九图上限保持图文整体', async ({ page }) => {
  await mockApis(page);
  await page.goto('/travel-journal');
  const fileInput = page.locator('input[type="file"]');
  const files = Array.from({ length: 10 }, (_, index) => ({
    name: `trip-${index + 1}.jpg`,
    mimeType: 'image/jpeg',
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  }));
  const uploadResponse = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().endsWith('/images'),
  );
  await fileInput.setInputFiles(files);
  const uploadBody = await (await uploadResponse).json() as { journal: { images: unknown[] } };
  expect(uploadBody.journal.images).toHaveLength(9);

  await expect(page.locator('div[class*="imageThumb"]')).toHaveCount(9);
  await expect(page.getByText('超出 9 张上限的图片未上传。')).toBeVisible();

  const orderRequest = page.waitForRequest(
    (request) => request.method() === 'PUT' && request.url().endsWith('/images/order'),
  );
  const thumbs = page.locator('div[class*="imageThumb"]');
  await thumbs.first().dragTo(thumbs.nth(1));
  expect((await orderRequest).postDataJSON().image_ids.slice(0, 2)).toEqual([
    'image-2',
    'image-1',
  ]);

  await page.getByRole('button', { name: '删除第 1 张图片' }).click();
  await page.getByRole('tooltip').getByRole('button', { name: /删\s*除/ }).click();
  await expect(page.locator('div[class*="imageThumb"]')).toHaveCount(8);
});

async function json(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}
