import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(projectRoot, '..');
const browserPath = path.join(workspaceRoot, '.cache', 'ms-playwright');
const outputDir = path.join(projectRoot, 'test-results', 'admin-flow');
const baseUrl = process.env.ADMIN_VERIFY_URL || 'http://127.0.0.1:5174';

const routes = [
  { path: '/admin/dashboard', title: '数据看板', waitText: '累计问答', shot: '01-admin-dashboard.png' },
  { path: '/admin/spots', title: '景点管理', waitText: '远香堂', shot: '02-admin-spots.png' },
  { path: '/admin/routes', title: '路线管理', waitText: '灵山胜境个性化推荐路线', shot: '03-admin-routes.png' },
  { path: '/admin/knowledge', title: '知识库管理', waitText: 'LS-011-灵山大佛', shot: '04-admin-knowledge.png' },
  { path: '/admin/logs', title: '问答日志', waitText: '远香堂有什么历史故事？', shot: '05-admin-logs.png' },
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

  const child = spawn('npm.cmd run dev -- --port 5174', {
    cwd: projectRoot,
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: browserPath,
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

async function main() {
  process.env.PLAYWRIGHT_BROWSERS_PATH = browserPath;
  const { chromium } = await import('@playwright/test');
  await mkdir(outputDir, { recursive: true });

  const server = await ensureServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    const checkedRoutes = [];

    for (const route of routes) {
      await page.goto(`${baseUrl}${route.path}`, { waitUntil: 'networkidle' });
      const body = await page.locator('body').innerText();
      failIf(!body.includes(route.title), `Missing expected admin title on ${route.path}: ${route.title}`);
      failIf(await page.locator('.ant-table').count() < 1, `Missing admin table on ${route.path}`);
      await page.getByText(route.waitText).first().waitFor({ timeout: 5000 });
      await page.waitForFunction(() => document.querySelectorAll('.ant-spin-blur, .ant-spin-spinning').length === 0, {
        timeout: 5000,
      });
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(outputDir, route.shot), fullPage: true });
      checkedRoutes.push({ path: route.path, ok: true, screenshot: route.shot });
    }

    await page.goto(`${baseUrl}/admin/knowledge`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /重建索引/ }).click();
    await page.getByText('索引重建结果').waitFor({ timeout: 5000 });
    await page.screenshot({ path: path.join(outputDir, '06-admin-knowledge-rebuild.png'), fullPage: true });

    await page.goto(`${baseUrl}/admin/spots`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /新增景点/ }).click();
    await page.getByText('新增景点').last().waitFor({ timeout: 3000 });
    await page.screenshot({ path: path.join(outputDir, '07-admin-spot-modal.png'), fullPage: true });

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
          screenshots: [...routes.map((route) => route.shot), '06-admin-knowledge-rebuild.png', '07-admin-spot-modal.png'],
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
    if (server) {
      server.kill();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
