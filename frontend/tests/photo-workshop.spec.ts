import { expect, test, type Page, type Route } from '@playwright/test';

const resultBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const webpBase64 =
  'UklGRjAAAABXRUJQVlA4ICQAAABQAQCdASoCAAIAAUAmJQBOgCgAAP73a6+vvKHYpR7pP1P5QAA=';

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function mockApis(page: Page) {
  let generateCalls = 0;
  let polishCalls = 0;
  let failNextGeneration = false;
  let lastGenerateBody = '';
  await page.addInitScript(() => {
    window.localStorage.setItem('a5_visitor_token', 'photo-workshop-e2e-token');
  });
  await page.route('http://127.0.0.1:8001/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me') {
      return json(route, {
        id: 'photo-workshop-visitor',
        username: '创作者',
        role: 'visitor',
      });
    }
    if (url.pathname === '/api/photo-workshop/polish') {
      polishCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 120));
      return json(route, {
        prompt:
          '以参考图为编辑对象，保留主体与构图不变，将环境转换为自然冬日雪景，补充清冷光影与细腻积雪。',
      });
    }
    if (url.pathname === '/api/photo-workshop/generate') {
      generateCalls += 1;
      lastGenerateBody = route.request().postDataBuffer()?.toString('latin1') ?? '';
      await new Promise((resolve) => setTimeout(resolve, 2500));
      if (failNextGeneration) {
        failNextGeneration = false;
        return json(
          route,
          {
            message: '图片创作服务暂时不可用，请稍后重试',
            code: 'PHOTO_WORKSHOP_UNAVAILABLE',
          },
          502,
        );
      }
      return json(route, {
        image_base64: resultBase64,
        mime_type: 'image/png',
        width: 1280,
        height: 720,
      });
    }
    return json(route, {});
  });
  return {
    failNext() {
      failNextGeneration = true;
    },
    generateCalls: () => generateCalls,
    polishCalls: () => polishCalls,
    lastGenerateBody: () => lastGenerateBody,
  };
}

const referenceImage = {
  name: 'ling-shan.png',
  mimeType: 'image/png',
  buffer: Buffer.from(resultBase64, 'base64'),
};

test('相册创意工坊完成模板、润色、生成、历史与下载闭环', async ({ page }) => {
  const api = await mockApis(page);
  await page.goto('/photo-workshop');

  await expect(page.getByRole('heading', { name: '相册创意工坊' })).toBeVisible();
  const journalLink = page.getByRole('link', { name: '旅行手账共创' });
  const workshopLink = page.getByRole('link', { name: '相册创意工坊' });
  expect((await workshopLink.boundingBox())!.y).toBeGreaterThan((await journalLink.boundingBox())!.y);
  await expect(page.getByRole('button', { name: /二次元.*动漫风/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Q 版二次元/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /时尚杂志风/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /一键更换季节/ })).toBeVisible();
  await page.getByRole('button', { name: /二次元.*动漫风/ }).hover();
  await expect(page.getByText('明快线稿与电影感光影')).toBeVisible();

  const prompt = page.getByRole('textbox', { name: '创意想法' });
  await prompt.fill('把画面变成我想象中的样子');
  await page.getByRole('button', { name: /时尚杂志风/ }).click();
  await expect(prompt).toHaveValue(/灵山梵宫/);

  await page.getByRole('button', { name: 'AI 提示词润色' }).click();
  await expect(prompt).toHaveValue(/自然冬日雪景/);
  expect(api.polishCalls()).toBe(1);
  expect(api.generateCalls()).toBe(0);

  await page.locator('input[type="file"]').setInputFiles(referenceImage);
  await expect(page.getByRole('button', { name: '替换参考图片' })).toBeVisible();
  await page.getByRole('button', { name: '图片参数' }).click();
  await page.getByRole('button', { name: '16:9', exact: true }).click();
  await page.getByRole('button', { name: '2K', exact: true }).click();

  await page.getByRole('button', { name: '开始生成' }).click();
  await expect(page.getByRole('button', { name: '开始生成' })).toBeDisabled();
  await expect(page.getByText('灵感正在成形')).toBeVisible();
  await expect(page.getByRole('region', { name: '本次创作历史' }).locator('canvas')).toBeVisible();
  await expect(page.getByRole('heading', { name: '本次创作' })).toBeVisible();
  await expect(page.getByText('2K', { exact: true })).toBeVisible();
  await expect(page.getByText('16:9', { exact: true })).toBeVisible();

  const result = page.getByRole('button', { name: '预览生成图片' });
  await expect(result).toBeVisible();
  expect(await result.evaluate((node) => getComputedStyle(node).aspectRatio)).toBe('1 / 1');
  expect(api.generateCalls()).toBe(1);

  await result.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载图片' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^灵诗音-相册创意-\d{8}-\d{6}\.png$/);
  await page.getByRole('button', { name: '关闭预览' }).click();

  await page.getByRole('button', { name: '重新编辑' }).click();
  await expect(prompt).toHaveValue(/自然冬日雪景/);
  await page.getByRole('button', { name: '重新生成' }).click();
  await expect(page.getByText('灵感正在成形')).toBeVisible();
  await expect(page.getByRole('button', { name: '预览生成图片' })).toHaveCount(2);
  expect(api.generateCalls()).toBe(2);
  await page.waitForTimeout(400);
  const historyRegion = page.getByRole('region', { name: '本次创作历史' });
  const scrollState = await historyRegion.evaluate((node) => ({
    clientHeight: node.clientHeight,
    scrollHeight: node.scrollHeight,
    scrollTop: node.scrollTop,
  }));
  expect(scrollState.scrollTop + scrollState.clientHeight).toBeGreaterThanOrEqual(
    scrollState.scrollHeight - 3,
  );

  await page.getByRole('button', { name: /模板/ }).click();
  await expect(page.getByRole('button', { name: /一键更换季节/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '本次创作' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /二次元.*动漫风/ })).toBeVisible();
});

test('上传校验与生成失败会保留输入且不会写入历史', async ({ page }) => {
  const api = await mockApis(page);
  await page.goto('/photo-workshop');

  await page.locator('input[type="file"]').setInputFiles({
    name: 'not-image.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not an image'),
  });
  await expect(page.getByText(/仅支持扩展名和内容一致/)).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles(referenceImage);
  await expect(page.getByRole('button', { name: '替换参考图片' })).toBeVisible();
  const prompt = page.getByRole('textbox', { name: '创意想法' });
  await prompt.fill('保留主体，把天空改成温柔的晚霞');
  api.failNext();
  await page.getByRole('button', { name: '开始生成' }).click();
  await expect(page.getByText('灵感正在成形')).toBeVisible();
  await expect(page.getByText('图片创作服务暂时不可用，请稍后重试')).toBeVisible();
  await expect(prompt).toHaveValue('保留主体，把天空改成温柔的晚霞');
  await expect(page.getByRole('heading', { name: '本次创作' })).toHaveCount(0);
  expect(api.generateCalls()).toBe(1);
});

test('项目中后缀与实际编码不一致的景区图片会按真实格式上传', async ({ page }) => {
  const api = await mockApis(page);
  await page.goto('/photo-workshop');

  await page.locator('input[type="file"]').setInputFiles({
    name: 'scenic.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from(webpBase64, 'base64'),
  });
  await expect(page.getByRole('button', { name: '替换参考图片' })).toBeVisible();
  await page.getByRole('textbox', { name: '创意想法' }).fill('保留构图，转换为冬日雪景。');
  await page.getByRole('button', { name: '开始生成' }).click();
  await expect(page.getByRole('button', { name: '预览生成图片' })).toBeVisible();

  expect(api.lastGenerateBody()).toContain('filename="scenic.webp"');
  expect(api.lastGenerateBody()).toMatch(/Content-Type: image\/webp/i);
});

test('支持拖拽上传并可从缩略图右上角删除当前参考图', async ({ page }) => {
  await mockApis(page);
  await page.goto('/photo-workshop');

  const dataTransfer = await page.evaluateHandle(({ base64 }) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'dragged-scene.png', { type: 'image/png' }));
    return transfer;
  }, { base64: resultBase64 });

  const dropZone = page.getByLabel('图片拖拽上传区');
  await dropZone.dispatchEvent('dragenter', { dataTransfer });
  await dropZone.dispatchEvent('drop', { dataTransfer });

  await expect(page.getByAltText('当前参考图')).toBeVisible();
  await expect(page.getByRole('button', { name: '删除参考图片' })).toBeVisible();
  await page.getByRole('button', { name: '删除参考图片' }).click();
  await expect(page.getByAltText('当前参考图')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '删除参考图片' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '上传参考图片' })).toBeVisible();
  await expect(page.getByRole('button', { name: '开始生成' })).toBeDisabled();
});

test('替换确认、图片解码和输入上限保持当前创作状态', async ({ page }) => {
  await mockApis(page);
  await page.goto('/photo-workshop');
  const fileInput = page.locator('input[type="file"]');
  expect(await fileInput.getAttribute('multiple')).toBeNull();

  await fileInput.setInputFiles({
    name: 'broken.png',
    mimeType: 'image/png',
    buffer: Buffer.from('not-a-png'),
  });
  await expect(page.getByText('图片文件无法读取，请重新选择。')).toBeVisible();

  await fileInput.setInputFiles(referenceImage);
  const currentReference = page.getByAltText('当前参考图');
  await expect(currentReference).toBeVisible();
  const firstUrl = await currentReference.getAttribute('src');
  const prompt = page.getByRole('textbox', { name: '创意想法' });
  await prompt.fill('保留建筑，让天空变成清澈的深蓝色');
  await page.getByRole('button', { name: '图片参数' }).click();
  await page.getByRole('button', { name: '2K', exact: true }).click();

  await fileInput.setInputFiles({ ...referenceImage, name: 'replacement.png' });
  const firstReplaceDialog = page.getByRole('dialog', { name: '替换当前参考图？' });
  await expect(firstReplaceDialog).toBeVisible();
  await firstReplaceDialog.getByRole('button', { name: '取 消', exact: true }).click();
  await expect(firstReplaceDialog).toHaveCount(0);
  await expect(currentReference).toHaveAttribute('src', firstUrl!);

  await fileInput.setInputFiles({ ...referenceImage, name: 'replacement.png' });
  const secondReplaceDialog = page.getByRole('dialog', { name: '替换当前参考图？' });
  await expect(secondReplaceDialog).toBeVisible();
  await secondReplaceDialog.getByRole('button', { name: '确认替换', exact: true }).click();
  await expect(currentReference).not.toHaveAttribute('src', firstUrl!);
  await expect(prompt).toHaveValue('保留建筑，让天空变成清澈的深蓝色');
  await expect(page.getByRole('button', { name: '图片参数' })).toContainText('2K');

  await prompt.fill('景'.repeat(2001));
  expect((await prompt.inputValue()).length).toBe(2000);
});

test('未登录游客不能直接进入相册创意工坊', async ({ page }) => {
  await page.goto('/photo-workshop');
  await expect(page).toHaveURL('http://127.0.0.1:5183/');
  await expect(page.getByRole('button', { name: '[ 登录 ]' })).toBeVisible();
});
