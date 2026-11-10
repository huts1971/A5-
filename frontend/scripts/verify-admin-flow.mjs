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
const outputDir = path.join(projectRoot, 'test-results', 'admin-flow');
const baseUrl = process.env.ADMIN_VERIFY_URL || 'http://127.0.0.1:5174';
const apiBaseUrl = process.env.ADMIN_VERIFY_API_URL || process.env.VITE_API_BASE_URL || 'http://127.0.0.1:8001';

const routes = [
  { path: '/dashboard/charts', waitText: '累计问答', requiresTable: false, shot: '01-admin-dashboard-charts.png' },
  { path: '/dashboard/hot-questions', waitText: '热门问题', requiresTable: true, shot: '02-admin-dashboard-hot-questions.png' },
  { path: '/dashboard/visitor-insights', waitText: '游客关注点分析', requiresTable: false, shot: '03-admin-dashboard-visitor-insights.png' },
  { path: '/spots', waitText: '新增景点', requiresTable: true, shot: '04-admin-spots.png' },
  { path: '/routes', waitText: '新增路线', requiresTable: true, shot: '05-admin-routes.png' },
  { path: '/knowledge/docs', waitText: '后端知识文档', requiresTable: true, shot: '06-admin-knowledge-docs.png' },
  { path: '/knowledge/facts', waitText: '已入库联网事实', requiresTable: true, shot: '07-admin-knowledge-facts.png' },
  { path: '/knowledge/candidates', waitText: '联网事实候选', requiresTable: true, shot: '08-admin-knowledge-candidates.png' },
  { path: '/logs', waitText: '当前日志', requiresTable: true, shot: '09-admin-logs.png' },
];

async function isServerReady() {
  try {
    const response = await fetch(baseUrl);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer() {
  for (let i = 0; i < 30; i += 1) {
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

  const child = spawn('npm.cmd run dev:admin -- --port 5174', {
    cwd: projectRoot,
    env: {
      ...process.env,
      ...(browserPath ? { PLAYWRIGHT_BROWSERS_PATH: browserPath } : {}),
      VITE_USE_MOCK_API: 'true',
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

function isIgnoredConsoleError(text) {
  return text.includes('[antd: Modal] `destroyOnClose` is deprecated');
}

async function resolveAdminToken() {
  try {
    const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/api/auth/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: '123456' }),
    });
    if (!response.ok) {
      return 'valid-admin-token';
    }
    const payload = await response.json();
    return payload.token || 'valid-admin-token';
  } catch {
    return 'valid-admin-token';
  }
}

async function main() {
  if (browserPath) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = browserPath;
  }
  const { chromium } = await import('@playwright/test');
  await mkdir(outputDir, { recursive: true });

  const server = await ensureServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  const adminToken = await resolveAdminToken();

  page.on('console', (message) => {
    if (message.type() === 'error') {
      if (isIgnoredConsoleError(message.text())) return;
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    await page.route('**/api/auth/me', async (route) => {
      const authorization = route.request().headers().authorization || '';
      if (authorization === `Bearer ${adminToken}`) {
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

    await page.addInitScript((token) => {
      localStorage.setItem('a5_admin_token', token);
    }, adminToken);

    const checkedRoutes = [];

    for (const route of routes) {
      await page.goto(`${baseUrl}${route.path}`, { waitUntil: 'networkidle' });
      await page.getByText(route.waitText).first().waitFor({ timeout: 5000 });
      if (route.requiresTable) {
        failIf(await page.locator('.ant-table').count() < 1, `Missing admin table on ${route.path}`);
      }
      await page.waitForFunction(() => document.querySelectorAll('.ant-spin-blur, .ant-spin-spinning').length === 0, {
        timeout: 5000,
      });
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(outputDir, route.shot), fullPage: true });
      checkedRoutes.push({ path: route.path, ok: true, screenshot: route.shot });
    }

    await page.goto(`${baseUrl}/knowledge/docs`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /重建索引/ }).click();
    await page.getByText(/索引已重建/).waitFor({ timeout: 5000 });
    await page.screenshot({ path: path.join(outputDir, '10-admin-knowledge-rebuild.png'), fullPage: true });

    await page.goto(`${baseUrl}/spots`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /新增景点/ }).click();
    await page.getByText('新增景点').last().waitFor({ timeout: 3000 });
    await page.screenshot({ path: path.join(outputDir, '11-admin-spot-modal.png'), fullPage: true });

    failIf(consoleErrors.length > 0, `Browser console errors:\n${consoleErrors.join('\n')}`);
    failIf(pageErrors.length > 0, `Browser page errors:\n${pageErrors.join('\n')}`);

    console.log(
      JSON.stringify(
        {
          ok: true,
          baseUrl,
          browserPath,
          outputDir,
          checkedRoutes,
          knowledgeRebuild: 'ok',
          modalSmoke: 'ok',
          screenshots: [...routes.map((route) => route.shot), '10-admin-knowledge-rebuild.png', '11-admin-spot-modal.png'],
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
