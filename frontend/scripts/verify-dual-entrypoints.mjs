import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stopProcessTree } from './process-tree.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const outputDir = path.join(projectRoot, 'test-results', 'dual-entrypoints');
const visitorUrl = process.env.VISITOR_ENTRY_URL || 'http://127.0.0.1:5173';
const adminUrl = process.env.ADMIN_ENTRY_URL || 'http://127.0.0.1:5174';

async function isReady(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForReady(url, attempts = 50) {
  for (let i = 0; i < attempts; i += 1) {
    if (await isReady(url)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Server did not become ready at ${url}`);
}

function startDevServer() {
  return spawn('npm.cmd run dev', {
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
}

function failIf(condition, message) {
  if (condition) {
    throw new Error(message);
  }
}

async function main() {
  const { chromium } = await import('@playwright/test');
  await mkdir(outputDir, { recursive: true });

  const server = startDevServer();
  let browser;

  try {
    await Promise.all([waitForReady(visitorUrl), waitForReady(adminUrl)]);

    browser = await chromium.launch({ headless: true });
    const visitor = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const admin = await browser.newPage({ viewport: { width: 1366, height: 900 } });

    await admin.route('**/api/auth/me', async (route) => {
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

    await visitor.goto(`${visitorUrl}/`, { waitUntil: 'networkidle' });
    const visitorHome = await visitor.locator('body').innerText();
    failIf(!visitorHome.includes('[ HOME ]'), 'Visitor entry should render visitor HOME');
    failIf(visitorHome.includes('[ OPS ]'), 'Visitor entry should not expose OPS navigation');

    await visitor.goto(`${visitorUrl}/admin`, { waitUntil: 'networkidle' });
    await visitor.waitForURL(`${visitorUrl}/`);
    const visitorAdminBody = await visitor.locator('body').innerText();
    failIf(visitorAdminBody.includes('[ OPS LOGIN ]'), 'Visitor entry /admin should not render admin login');
    await visitor.screenshot({ path: path.join(outputDir, '01-visitor-admin-blocked.png'), fullPage: true });

    await admin.goto(`${adminUrl}/`, { waitUntil: 'networkidle' });
    await admin.waitForURL(`${adminUrl}/login`);
    const adminLogin = await admin.locator('body').innerText();
    failIf(!adminLogin.includes('[ OPS LOGIN ]'), 'Admin entry root should reach admin login');
    await admin.screenshot({ path: path.join(outputDir, '02-admin-login-root.png'), fullPage: true });

    await admin.evaluate(() => localStorage.setItem('a5_admin_token', 'valid-admin-token'));
    await admin.goto(`${adminUrl}/dashboard`, { waitUntil: 'networkidle' });
    await admin.getByRole('heading', { name: '数据看板' }).waitFor({ timeout: 5000 });
    const routeLinks = await admin.locator('a[href="/dashboard"], a[href="/spots"], a[href="/routes"], a[href="/knowledge"], a[href="/logs"]').count();
    failIf(routeLinks < 5, 'Admin entry should use root-level admin navigation links');
    await admin.screenshot({ path: path.join(outputDir, '03-admin-dashboard-root-routes.png'), fullPage: true });

    console.log(
      JSON.stringify(
        {
          ok: true,
          visitorUrl,
          adminUrl,
          outputDir,
          screenshots: [
            '01-visitor-admin-blocked.png',
            '02-admin-login-root.png',
            '03-admin-dashboard-root-routes.png',
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    if (browser) {
      await browser.close();
    }
    stopProcessTree(server);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
