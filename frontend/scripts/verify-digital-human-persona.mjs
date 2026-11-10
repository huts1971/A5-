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
const browserExecutable = process.env.VISITOR_BROWSER_EXECUTABLE;
const outputDir = path.join(projectRoot, 'test-results', 'digital-human-persona');
const baseUrl = process.env.DIGITAL_HUMAN_VERIFY_URL || 'http://127.0.0.1:5177';

async function isServerReady() {
  try {
    return (await fetch(baseUrl)).ok;
  } catch {
    return false;
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await isServerReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Vite server did not become ready at ${baseUrl}`);
}

async function ensureServer() {
  if (await isServerReady()) return undefined;
  const child = spawn('npm.cmd run dev:visitor -- --port 5177', {
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
  if (condition) throw new Error(message);
}

function isIgnoredConsoleError(text) {
  return (
    text.includes('Looks like you are rendering without using requestAnimationFrame for the main loop')
    || text.includes('[antd: Modal] `destroyOnClose` is deprecated')
  );
}

async function main() {
  if (browserPath) process.env.PLAYWRIGHT_BROWSERS_PATH = browserPath;
  const { chromium } = await import('@playwright/test');
  await mkdir(outputDir, { recursive: true });

  const server = await ensureServer();
  const browser = await chromium.launch({
    headless: true,
    ...(browserExecutable ? { executablePath: browserExecutable } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', (message) => {
    if (message.type() === 'error' && !isIgnoredConsoleError(message.text())) {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    await page.route('**/api/auth/me', async (route) => {
      const authorization = route.request().headers().authorization || '';
      await route.fulfill({
        status: authorization === 'Bearer valid-visitor-token' ? 200 : 401,
        contentType: 'application/json',
        body: JSON.stringify(
          authorization === 'Bearer valid-visitor-token'
            ? { id: 'persona-user', username: 'persona_visitor', role: 'visitor' }
            : { message: '登录状态无效', code: 'AUTH_TOKEN_INVALID', status: 401 },
        ),
      });
    });
    await page.addInitScript(() => {
      localStorage.setItem('a5_visitor_token', 'valid-visitor-token');
      if (!sessionStorage.getItem('persona-verify-initialized')) {
        localStorage.removeItem('a5-mock-digital-human-persona');
        sessionStorage.setItem('persona-verify-initialized', 'true');
      }
    });

    await page.goto(`${baseUrl}/guide`, { waitUntil: 'networkidle' });
    await page.waitForFunction(
      () =>
        !document.querySelector('[data-testid="visitor-guide-entry-loader"]')
        && !document.querySelector('.guide-entry-content--waiting'),
      undefined,
      { timeout: 8000 },
    );

    const trigger = page.getByTestId('digital-human-persona-trigger');
    await trigger.waitFor({ state: 'visible', timeout: 8000 });
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="digital-human-persona-trigger"][disabled]'),
      undefined,
      { timeout: 8000 },
    );
    failIf((await trigger.innerText()).trim() !== '个性化数字人', 'Default trigger label is incorrect');
    failIf((await page.getByText('导游模式', { exact: true }).count()) > 0, 'Legacy guide mode is still visible');

    await trigger.click();
    const form = page.getByTestId('digital-human-persona-form');
    await form.waitFor({ state: 'visible' });
    failIf(
      (await form.getByPlaceholder('自由发挥您的创意，详细描述您的奇思妙想', { exact: true }).count()) !== 1,
      'Creative prompt placeholder is missing',
    );
    failIf(
      (await form.locator('[data-value="professional_guide"][aria-pressed="true"]').count()) !== 1,
      'Default identity is incorrect',
    );

    await form.locator('[data-value="photography_guide"]').click();
    await form.getByLabel('具体年龄', { exact: true }).fill('42');
    await form.getByRole('button', { name: '中性', exact: true }).click();
    await form.getByRole('button', { name: '幽默风趣', exact: true }).click();
    await form.getByRole('button', { name: '好奇博学', exact: true }).click();
    failIf(
      await form.getByRole('button', { name: '冷静克制', exact: true }).isEnabled(),
      'A fourth personality should be disabled',
    );
    await form.getByRole('button', { name: '故事化', exact: true }).click();

    const creative = form.getByLabel('创想时刻', { exact: true });
    const originalDraft = '像老朋友一样讲故事，偶尔提醒我最佳拍照时间。';
    await creative.fill(originalDraft);
    await form.getByTestId('digital-human-persona-generate').click();
    const overwriteDialog = page.getByRole('dialog', { name: '将覆盖当前内容，是否继续？', exact: true });
    await overwriteDialog.waitFor({ state: 'visible' });
    await overwriteDialog.getByRole('button', { name: '取 消', exact: true }).click();
    failIf((await creative.inputValue()) !== originalDraft, 'Cancelling AI overwrite changed the draft');

    await form.getByTestId('digital-human-persona-generate').click();
    await page
      .getByRole('dialog', { name: '将覆盖当前内容，是否继续？', exact: true })
      .getByRole('button', { name: '继续创作', exact: true })
      .click();
    await page.waitForFunction(
      () => {
        const textarea = document.querySelector('[aria-label="创想时刻"]');
        return textarea instanceof HTMLTextAreaElement && textarea.value !== '像老朋友一样讲故事，偶尔提醒我最佳拍照时间。';
      },
      undefined,
      { timeout: 5000 },
    );
    const generatedDraft = await creative.inputValue();
    failIf(!generatedDraft, 'AI generation did not fill the editable textarea');

    await creative.fill(`${generatedDraft} 仍可编辑。`);
    await form.getByTestId('digital-human-persona-polish').click();
    await page.waitForFunction(
      (previous) => {
        const textarea = document.querySelector('[aria-label="创想时刻"]');
        return textarea instanceof HTMLTextAreaElement && textarea.value !== previous;
      },
      `${generatedDraft} 仍可编辑。`,
      { timeout: 5000 },
    );
    failIf(!(await form.isVisible()), 'AI action submitted or closed the editor');

    await page.getByTestId('digital-human-persona-save').click();
    await form.waitFor({ state: 'hidden' });
    failIf((await trigger.innerText()).trim() !== '已个性化', 'Saved persona state was not reflected in the trigger');

    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('digital-human-persona-trigger').waitFor({ state: 'visible' });
    failIf(
      (await page.getByTestId('digital-human-persona-trigger').innerText()).trim() !== '已个性化',
      'Saved persona was not restored after reload',
    );
    await page.getByTestId('digital-human-persona-trigger').click();
    const reloadedForm = page.getByTestId('digital-human-persona-form');
    await reloadedForm.waitFor({ state: 'visible' });
    failIf(
      (await reloadedForm.locator('[data-value="photography_guide"][aria-pressed="true"]').count()) !== 1,
      'Saved identity was not restored',
    );
    failIf((await reloadedForm.getByLabel('具体年龄', { exact: true }).inputValue()) !== '42', 'Exact age was not restored');

    await reloadedForm.locator('[data-value="local_friend"]').click();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    const discardDialog = page.getByRole('dialog', { name: '放弃未保存修改？', exact: true });
    await discardDialog.waitFor({ state: 'visible' });
    await discardDialog.getByRole('button', { name: '放弃修改', exact: true }).click();
    await reloadedForm.waitFor({ state: 'hidden' });

    await page.screenshot({
      path: path.join(outputDir, 'digital-human-persona-pc.png'),
      fullPage: true,
    });
    failIf(consoleErrors.length > 0, `Console errors:\n${consoleErrors.join('\n')}`);
    failIf(pageErrors.length > 0, `Page errors:\n${pageErrors.join('\n')}`);
    console.log('Digital human persona PC verification passed.');
  } finally {
    await browser.close();
    stopProcessTree(server);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
