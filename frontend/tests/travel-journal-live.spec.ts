import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';


const liveUrl = process.env.TRAVEL_JOURNAL_LIVE_URL ?? '';
const liveApiUrl = process.env.TRAVEL_JOURNAL_LIVE_API_URL ?? '';
const testDir = path.dirname(fileURLToPath(import.meta.url));
const scenicPhoto = path.resolve(
  testDir,
  '../public/scenic/spots/photos/LS-001_灵山大照壁/1.jpg',
);

test.skip(
  !liveUrl || !liveApiUrl,
  'Set TRAVEL_JOURNAL_LIVE_URL and TRAVEL_JOURNAL_LIVE_API_URL explicitly.',
);

test('真实旅行手账完成生成、编辑、导出、发布与社区阅读', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const username = `journal_live_${Date.now()}`;
  const registered = await request.post(`${liveApiUrl}/api/auth/register`, {
    data: {
      username,
      password: 'secret123',
    },
  });
  expect(registered.ok()).toBe(true);
  const { token } = await registered.json();

  await page.addInitScript((visitorToken) => {
    window.localStorage.setItem('a5_visitor_token', visitorToken);
  }, token);
  await page.goto(`${liveUrl}/travel-journal`, {
    waitUntil: 'networkidle',
  });

  await page
    .locator('input[type="file"]')
    .setInputFiles(scenicPhoto);
  await expect(page.getByAltText('旅行素材 1')).toBeVisible();
  await page
    .getByPlaceholder('写下今天的心情、印象深刻的片段或想保留的旅途感受……')
    .fill('今天沿着灵山景区慢慢行走，想记录夏日光影与放慢脚步后的安静心情。');
  await page.getByText('300 字', { exact: true }).click();
  await page.getByRole('button', { name: 'Kimi 帮我创作' }).click();

  await expect(page.getByText('旅行手账已生成，你仍可继续编辑。')).toBeVisible({
    timeout: 150_000,
  });
  const titleInput = page.locator('input.ant-input').first();
  await expect(titleInput).not.toHaveValue('');
  await titleInput.fill('真实联调旅行手账');
  await expect(page.getByText('已自动保存')).toBeVisible({
    timeout: 10_000,
  });
  await page.screenshot({
    path: '.tmp/travel-journal-live-editor.png',
    fullPage: true,
  });

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PDF' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('真实联调旅行手账');

  await page.getByRole('button', { name: '发布到评论社区' }).click();
  await page
    .locator('.ant-modal-confirm')
    .getByRole('button', { name: '确认发布' })
    .click();
  await page.waitForURL(/\/community\?highlight=\d+$/, {
    timeout: 15_000,
  });
  await expect(page.getByRole('heading', { name: '真实联调旅行手账' })).toBeVisible();
  await page.getByRole('button', { name: /真实联调旅行手账/ }).click();
  await expect(
    page.locator('.ant-modal').getByRole('heading', {
      name: '真实联调旅行手账',
    }),
  ).toBeVisible();
  await expect(page.locator('.ant-modal img')).toHaveCount(1);
  await page.screenshot({
    path: '.tmp/travel-journal-live-community.png',
    fullPage: true,
  });
});
