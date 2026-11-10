import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stopProcessTree } from './process-tree.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const outputDir = path.join(projectRoot, 'test-results', 'admin-login-flow');
const baseUrl = process.env.ADMIN_VERIFY_URL || 'http://127.0.0.1:5178';

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
    if (await isServerReady()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Vite server did not become ready at ${baseUrl}`);
}

async function ensureServer() {
  if (await isServerReady()) {
    return undefined;
  }

  const child = spawn('npm.cmd run dev:admin -- --port 5178', {
    cwd: projectRoot,
    env: {
      ...process.env,
      VITE_USE_MOCK_API: 'true',
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
  if (condition) {
    throw new Error(message);
  }
}

async function main() {
  const { chromium } = await import('@playwright/test');
  await mkdir(outputDir, { recursive: true });

  const server = await ensureServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      const text = message.text();
      if (!text.includes('401 (Unauthorized)')) {
        consoleErrors.push(text);
      }
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.route('**/api/auth/admin/login', async (route) => {
    const payload = route.request().postDataJSON();
    if (payload.username === 'admin' && payload.password === '123456') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          token: 'valid-admin-token',
          token_type: 'bearer',
          user: { id: 'admin-1', username: 'admin', role: 'admin' },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ message: '用户名或密码错误', code: 'AUTH_INVALID_CREDENTIALS', status: 401 }),
    });
  });

  await page.route('**/api/auth/me', async (route) => {
    const authorization = route.request().headers().authorization || '';
    if (authorization === 'Bearer valid-admin-token') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'admin-1', username: 'admin', role: 'admin' }),
      });
      return;
    }
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ message: '登录状态无效', code: 'AUTH_TOKEN_INVALID', status: 401 }),
    });
  });

  try {
    await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
    await page.waitForURL('**/login');
    const loginBody = await page.locator('body').innerText();
    failIf(!loginBody.includes('[ OPS LOGIN ]'), 'Admin login page should show OPS LOGIN');
    failIf(loginBody.includes('注册'), 'Admin login page should not show register entry');
    await page.screenshot({ path: path.join(outputDir, '01-admin-login.png'), fullPage: true });

    await page.getByLabel('用户名').fill('admin');
    await page.getByLabel('密码').fill('123456');
    await page.getByRole('button', { name: /\[ LOGIN \]/ }).click();
    await page.waitForURL('**/dashboard/charts');
    await page.getByText('[ admin ]').waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: /\[ LOG OUT \]/ }).waitFor({ timeout: 5000 });
    const dashboardBody = await page.locator('body').innerText();
    failIf(!dashboardBody.includes('admin'), 'Admin dashboard should show username');
    failIf(!dashboardBody.includes('[ LOG OUT ]'), 'Admin dashboard should show LOG OUT');
    failIf(await page.evaluate(() => localStorage.getItem('a5_admin_token') !== 'valid-admin-token'), 'Admin token should be saved');
    await page.screenshot({ path: path.join(outputDir, '02-admin-dashboard.png'), fullPage: true });

    await page.getByRole('button', { name: /\[ LOG OUT \]/ }).click();
    await page.waitForURL('**/login');
    failIf(await page.evaluate(() => localStorage.getItem('a5_admin_token') !== null), 'LOG OUT should clear admin token');

    failIf(consoleErrors.length > 0, `Browser console errors:\n${consoleErrors.join('\n')}`);
    failIf(pageErrors.length > 0, `Browser page errors:\n${pageErrors.join('\n')}`);

    console.log(
      JSON.stringify(
        {
          ok: true,
          baseUrl,
          outputDir,
          screenshots: ['01-admin-login.png', '02-admin-dashboard.png'],
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
    if (server) {
      stopProcessTree(server);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
