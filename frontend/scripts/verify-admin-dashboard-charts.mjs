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
const baseUrl = 'http://127.0.0.1:5184';
const outputDir = path.join(projectRoot, 'test-results', 'admin-dashboard-charts');

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // Keep waiting for Vite.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Vite server did not become ready at ${baseUrl}`);
}

function failIf(condition, message) {
  if (condition) throw new Error(message);
}

async function main() {
  if (browserPath) process.env.PLAYWRIGHT_BROWSERS_PATH = browserPath;
  const { chromium } = await import('@playwright/test');
  await mkdir(outputDir, { recursive: true });
  const server = spawn('npm.cmd run dev:admin -- --port 5184', {
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
  let browser;

  try {
    await waitForServer();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    await page.route('**/api/auth/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'admin-1', username: 'admin', role: 'admin' }),
      }),
    );
    await page.addInitScript(() => localStorage.setItem('a5_admin_token', 'valid-admin-token'));
    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: '数据看板' }).waitFor({ timeout: 5000 });

    const qaTrendChart = page.getByRole('img', { name: '最近 7 天问答量趋势图' });
    failIf((await qaTrendChart.count()) !== 1, 'Dashboard should render one accessible QA trend chart');
    failIf((await qaTrendChart.locator('canvas, svg').count()) < 1, 'QA trend chart should render a graphical surface');

    const sentimentChart = page.getByRole('img', { name: '游客情感趋势堆叠柱状图' });
    failIf((await sentimentChart.count()) !== 1, 'Dashboard should render one accessible sentiment chart');
    failIf((await sentimentChart.locator('canvas, svg').count()) < 1, 'Sentiment chart should render a graphical surface');

    const satisfactionChart = page.getByRole('img', { name: '游客满意度趋势折线图' });
    failIf((await satisfactionChart.count()) !== 1, 'Dashboard should render one accessible satisfaction chart');
    failIf((await satisfactionChart.locator('canvas, svg').count()) < 1, 'Satisfaction chart should render a graphical surface');

    const preferenceChart = page.getByRole('img', { name: '游客偏好分布环形图' });
    failIf((await preferenceChart.count()) !== 1, 'Dashboard should render one accessible preference chart');
    failIf((await preferenceChart.locator('canvas, svg').count()) < 1, 'Preference chart should render a graphical surface');
    await preferenceChart.getByText('文化 16（42%）', { exact: true }).waitFor({ timeout: 3000 });
    await page.screenshot({ path: path.join(outputDir, 'desktop-dashboard.png'), fullPage: true });

    const todayOption = page.locator('.ant-segmented-item').filter({ hasText: '今日' });
    failIf((await todayOption.count()) !== 1, 'Dashboard should expose one Today range option');
    await todayOption.click();
    await page.getByText('暂无情感趋势数据', { exact: true }).waitFor({ timeout: 5000 });
    await page.getByText('暂无满意度趋势数据', { exact: true }).waitFor({ timeout: 5000 });
    failIf(
      (await page.getByRole('img', { name: '游客情感趋势堆叠柱状图' }).count()) !== 0,
      'Empty sentiment data should not render an empty chart',
    );
    failIf(
      (await page.getByRole('img', { name: '游客满意度趋势折线图' }).count()) !== 0,
      'Empty satisfaction data should not render an empty chart',
    );

    const weekOption = page.locator('.ant-segmented-item').filter({ hasText: '本周' });
    failIf((await weekOption.count()) !== 1, 'Dashboard should expose one Week range option');
    await weekOption.click();
    await page.getByRole('img', { name: '游客情感趋势堆叠柱状图' }).waitFor({ timeout: 5000 });
    await page.setViewportSize({ width: 390, height: 844 });
    const mobilePreferenceChart = page.getByRole('img', { name: '游客偏好分布环形图' });
    await page.waitForTimeout(500);
    const mobileLayout = await mobilePreferenceChart.evaluate((element) => getComputedStyle(element).gridTemplateColumns);
    failIf(mobileLayout.trim().includes(' '), 'Preference chart should stack chart and legend on narrow screens');
    const chartOverflows = await page.locator('.dashboard-chart').evaluateAll((charts) =>
      charts.map((chart) => ({
        id: chart.getAttribute('data-testid'),
        overflow: chart.scrollWidth - chart.clientWidth,
      })),
    );
    const chartOverflow = Math.max(0, ...chartOverflows.map((chart) => chart.overflow));
    failIf(
      chartOverflow > 1,
      `Dashboard charts should not overflow horizontally on mobile: ${JSON.stringify(chartOverflows)}`,
    );
    await page.screenshot({ path: path.join(outputDir, 'mobile-dashboard.png'), fullPage: true });
    failIf(consoleErrors.length > 0, `Browser console errors:\n${consoleErrors.join('\n')}`);
    failIf(pageErrors.length > 0, `Browser page errors:\n${pageErrors.join('\n')}`);
    console.log(JSON.stringify({ ok: true, outputDir }, null, 2));
  } finally {
    if (browser) await browser.close();
    stopProcessTree(server);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
