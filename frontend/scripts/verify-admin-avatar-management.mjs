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
const baseUrl = 'http://127.0.0.1:5185';
const outputDir = path.join(projectRoot, 'test-results', 'admin-avatar-management');

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(baseUrl)).ok) return;
    } catch {
      // Keep waiting for Vite.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Vite server did not become ready at ${baseUrl}`);
}

async function main() {
  if (browserPath) process.env.PLAYWRIGHT_BROWSERS_PATH = browserPath;
  const server = spawn('npm.cmd run dev:admin -- --port 5185', {
    cwd: projectRoot,
    env: {
      ...process.env,
      ...(browserPath ? { PLAYWRIGHT_BROWSERS_PATH: browserPath } : {}),
      VITE_USE_MOCK_API: 'false',
    },
    shell: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  let browser;

  try {
    await waitForServer();
    const { chromium } = await import('@playwright/test');
    await mkdir(outputDir, { recursive: true });
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    await page.route('**/api/auth/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'admin-1', username: 'admin', role: 'admin' }),
      }),
    );
    const avatars = [
      {
        id: 'builtin-avatar151',
        name: '151 数字人',
        note: '项目内置默认数字人',
        source_filename: '',
        resource_size: 0,
        is_builtin: true,
        is_active: true,
        uploaded_by: 'system',
        created_at: '2026-07-03T10:00:00+00:00',
        updated_at: '2026-07-03T10:00:00+00:00',
        activated_at: '2026-07-03T10:00:00+00:00',
      },
    ];
    await page.route('**/api/admin/avatars**', async (route) => {
      const request = route.request();
      if (request.url().endsWith('/activate')) {
        const id = request.url().split('/').at(-2);
        avatars.forEach((avatar) => {
          avatar.is_active = avatar.id === id;
        });
        const active = avatars.find((avatar) => avatar.id === id);
        active.activated_at = '2026-07-03T12:30:00+00:00';
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(active) });
        return;
      }
      if (request.url().endsWith('/preview-token')) {
        const id = request.url().split('/').at(-2);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            avatar_id: id,
            version: id,
            loader_url: `${baseUrl}/mock-avatar.loader.js`,
            data_url: `${baseUrl}/mock-avatar.data`,
            framework_url: `${baseUrl}/mock-avatar.framework.js`,
            wasm_url: `${baseUrl}/mock-avatar.wasm`,
            streaming_assets_url: '',
            fallback_url: '',
            bridge_object_name: 'Avatar151Bridge',
            expires_at: '2026-07-03T11:10:00+00:00',
          }),
        });
        return;
      }
      if (request.method() === 'POST') {
        const imported = {
          id: 'candidate-1',
          name: '灵山数字导游二号',
          note: '演示候选版本',
          source_filename: 'avatar.zip',
          resource_size: 2048,
          is_builtin: false,
          is_active: false,
          uploaded_by: 'admin',
          created_at: '2026-07-03T11:00:00+00:00',
          updated_at: '2026-07-03T11:00:00+00:00',
          activated_at: null,
        };
        avatars.unshift(imported);
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(imported) });
        return;
      }
      if (request.method() === 'PATCH') {
        const id = request.url().split('/').pop();
        const avatar = avatars.find((item) => item.id === id);
        Object.assign(avatar, request.postDataJSON(), { updated_at: '2026-07-03T12:00:00+00:00' });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(avatar) });
        return;
      }
      if (request.method() === 'DELETE') {
        const id = request.url().split('/').pop();
        const index = avatars.findIndex((item) => item.id === id);
        if (index >= 0) avatars.splice(index, 1);
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'deleted' }) });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: avatars }),
      });
    });
    await page.route('**/mock-avatar.loader.js', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `window.createUnityInstance = async (canvas, config, onProgress) => {
          onProgress?.(1);
          const context = canvas.getContext('2d');
          canvas.width = 320;
          canvas.height = 480;
          context.fillStyle = 'rgb(0, 255, 0)';
          context.fillRect(0, 0, 320, 480);
          context.fillStyle = 'white';
          context.fillRect(120, 80, 80, 300);
          return { SendMessage() {}, async Quit() {} };
        };`,
      }),
    );
    await page.addInitScript(() => localStorage.setItem('a5_admin_token', 'valid-admin-token'));
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await page.goto(`${baseUrl}/avatars`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: '数字人形象管理' }).waitFor();
    await page.getByText('灵诗音', { exact: true }).first().waitFor();
    await page.getByText('灵小语', { exact: true }).waitFor();
    await page.getByText('晴音', { exact: true }).waitFor();
    await page.getByText('当前使用', { exact: true }).first().waitFor();
    if ((await page.getByRole('link', { name: '数字人形象管理' }).count()) !== 1) {
      throw new Error('Admin navigation should expose digital human avatar management');
    }
    if ((await page.locator('.ant-table').count()) !== 1) {
      throw new Error('Avatar management should render one version table');
    }
    for (const heading of ['文件信息', '管理记录']) {
      if ((await page.getByRole('columnheader', { name: heading }).count()) !== 1) {
        throw new Error(`Avatar version table should show ${heading}`);
      }
    }
    await page.getByRole('button', { name: '导入数字人' }).click();
    await page.getByLabel('形象名称').fill('灵山数字导游二号');
    await page.getByLabel('备注').fill('演示候选版本');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'avatar.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from('test zip'),
    });
    await page.getByRole('button', { name: '开始导入' }).click();
    await page.getByText('灵山数字导游二号', { exact: true }).waitFor();
    await page.getByText('候选', { exact: true }).waitFor();
    await page.getByRole('dialog', { name: '导入 Unity WebGL 数字人' }).waitFor({ state: 'detached' });
    await page.screenshot({ path: path.join(outputDir, 'desktop-avatar-management.png'), fullPage: true });
    await page.getByRole('button', { name: '预览 灵山数字导游二号' }).click();
    await page.getByRole('dialog', { name: '预览数字人' }).waitFor();
    await page.locator('canvas[aria-label="Unity WebGL 数字人预览"]').waitFor({ state: 'attached' });
    await page.locator('.admin-avatar-preview .unity-avatar-stage[data-progress="100"]').waitFor();
    await page.getByText(/加载完成|加载进度 100%/).waitFor();
    const previewDialog = page.getByRole('dialog', { name: '预览数字人' });
    const closeButton = previewDialog.locator('.ant-modal-close');
    if ((await closeButton.count()) !== 1) {
      throw new Error(`Preview dialog should expose a close button: ${await previewDialog.innerText()}`);
    }
    await closeButton.click({ force: true });
    await previewDialog.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: '编辑 灵山数字导游二号' }).click();
    await page.getByLabel('形象名称').fill('灵山迎宾数字人');
    await page.getByLabel('备注').fill('用于游客中心');
    await page.getByRole('button', { name: '保存修改' }).click();
    await page.getByText('灵山迎宾数字人', { exact: true }).waitFor();
    await page.getByRole('button', { name: '设为当前 灵山迎宾数字人' }).click();
    await page.getByRole('button', { name: '确认启用' }).click();
    await page.getByText('游客端刷新后生效', { exact: false }).waitFor();
    await page.getByRole('button', { name: '设为当前 灵诗音' }).click();
    await page.getByRole('button', { name: '确认启用' }).click();
    await page.getByRole('button', { name: '删除 灵山迎宾数字人' }).click();
    await page.getByRole('button', { name: '确认删除' }).click();
    await page.getByText('灵山迎宾数字人', { exact: true }).waitFor({ state: 'detached' });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(3500);
    const overflow = await page.locator('body').evaluate((body) => body.scrollWidth - body.clientWidth);
    if (overflow > 1) {
      const offenders = await page.locator('body *').evaluateAll((elements) =>
        elements
          .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
          .slice(0, 8)
          .map((element) => ({
            className: element.className?.toString?.() ?? '',
            right: Math.round(element.getBoundingClientRect().right),
            width: Math.round(element.getBoundingClientRect().width),
          })),
      );
      throw new Error(`Avatar management should not overflow on mobile: ${overflow} ${JSON.stringify(offenders)}`);
    }
    await page.screenshot({ path: path.join(outputDir, 'mobile-avatar-management.png'), fullPage: true });
    if (consoleErrors.length) throw new Error(`Browser console errors:\n${consoleErrors.join('\n')}`);
  } finally {
    if (browser) await browser.close();
    stopProcessTree(server);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
