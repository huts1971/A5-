import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stopProcessTree } from './process-tree.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const outputDir = path.join(projectRoot, 'test-results', 'admin-api-auth');
const baseUrl = process.env.ADMIN_API_VERIFY_URL || 'http://127.0.0.1:5179';

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

  const child = spawn('npm.cmd run dev:admin -- --port 5179', {
    cwd: projectRoot,
    env: {
      ...process.env,
      VITE_USE_MOCK_API: 'false',
      VITE_API_BASE_URL: baseUrl,
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

function dashboardPayload() {
  return {
    summary: {
      total_questions: 1,
      today_questions: 1,
      spot_count: 2,
      route_count: 1,
      knowledge_doc_count: 1,
      knowledge_chunk_count: 3,
      degraded_count: 0,
      avg_total_ms: 120,
    },
    top_questions: [{ question: '灵山大佛有什么看点？', count: 1 }],
    top_spots: [{ spot_name: '灵山大佛', count: 1 }],
    preference_distribution: [{ label: 'family', count: 1 }],
    qa_trend: [{ date: '2026-06-20', count: 1 }],
    recent_logs: [
      {
        id: 1,
        question: '灵山大佛有什么看点？',
        answer: '适合从文化和摄影角度游览。',
        source_count: 1,
        created_at: '2026-06-20 10:00:00',
      },
    ],
  };
}

async function main() {
  const { chromium } = await import('@playwright/test');
  await mkdir(outputDir, { recursive: true });

  const server = await ensureServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  const dashboardAuthorizations = [];
  let dashboardMode = 'ok';

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
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        token: 'valid-admin-token',
        token_type: 'bearer',
        user: { id: 'admin-1', username: 'admin', role: 'admin' },
      }),
    });
  });

  await page.route('**/api/auth/me', async (route) => {
    const authorization = route.request().headers().authorization || '';
    if (authorization === 'Bearer valid-admin-token' || authorization === 'Bearer stale-admin-token') {
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

  await page.route('**/api/admin/dashboard', async (route) => {
    dashboardAuthorizations.push(route.request().headers().authorization || '');
    if (dashboardMode === 'expired') {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: '管理员令牌无效', code: 'ADMIN_TOKEN_INVALID', status: 401 }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(dashboardPayload()),
    });
  });

  try {
    await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
    await page.getByLabel('用户名').fill('admin');
    await page.getByLabel('密码').fill('123456');
    await page.getByRole('button', { name: /\[ LOGIN \]/ }).click();
    await page.waitForURL('**/dashboard/charts');
    await page.getByText('累计问答').waitFor({ timeout: 5000 });
    failIf(
      !dashboardAuthorizations.includes('Bearer valid-admin-token'),
      'Admin dashboard API should receive Authorization bearer token',
    );
    await page.screenshot({ path: path.join(outputDir, '01-admin-dashboard-auth.png'), fullPage: true });

    dashboardMode = 'expired';
    dashboardAuthorizations.length = 0;
    await page.evaluate(() => localStorage.setItem('a5_admin_token', 'stale-admin-token'));
    await page.goto(`${baseUrl}/dashboard/charts`, { waitUntil: 'networkidle' });
    await page.waitForURL('**/login');
    failIf(
      !dashboardAuthorizations.includes('Bearer stale-admin-token'),
      'Expired admin API call should still send the stored admin token first',
    );
    failIf(await page.evaluate(() => localStorage.getItem('a5_admin_token') !== null), 'Invalid admin API token should be cleared');
    await page.screenshot({ path: path.join(outputDir, '02-admin-token-expired.png'), fullPage: true });

    failIf(consoleErrors.length > 0, `Browser console errors:\n${consoleErrors.join('\n')}`);
    failIf(pageErrors.length > 0, `Browser page errors:\n${pageErrors.join('\n')}`);

    console.log(
      JSON.stringify(
        {
          ok: true,
          baseUrl,
          outputDir,
          screenshots: ['01-admin-dashboard-auth.png', '02-admin-token-expired.png'],
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
