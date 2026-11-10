import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stopProcessTree } from './process-tree.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(projectRoot, '..');
const workspaceBrowserPath = path.join(workspaceRoot, '.cache', 'ms-playwright');
const browserPath = existsSync(workspaceBrowserPath) ? workspaceBrowserPath : undefined;
const outputDir = path.join(projectRoot, 'test-results', 'source-provenance');
const baseUrl = process.env.VISITOR_VERIFY_URL || 'http://127.0.0.1:5175';
const localNodeBin = path.join(workspaceRoot, '.tools', 'node', 'bin');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : path.join(localNodeBin, 'npm');

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

  const child = spawn('npm.cmd run dev:visitor -- --port 5175', {
    cwd: projectRoot,
    env: {
      ...process.env,
      ...(browserPath ? { PLAYWRIGHT_BROWSERS_PATH: browserPath } : {}),
    },
    shell: true,
    stdio: 'ignore',
    windowsHide: true,
  });

  await waitForServer();
  return child;
}

function sseFinal(payload) {
  return `event: delta\ndata: ${JSON.stringify({ text: payload.answer })}\n\n`
    + `event: final\ndata: ${JSON.stringify(payload)}\n\n`;
}

function responseForQuestion(question) {
  const base = {
    session_id: 'verify-source-session',
    audio_url: null,
    tts_job_id: null,
    tts_status: 'disabled',
    mode: 'openai_compatible',
    degraded: false,
    metrics: {
      retrieval_ms: 1,
      llm_ms: 1,
      tts_ms: 0,
      total_ms: 2,
      cache_hit: false,
      degraded: false,
    },
  };

  if (question.includes('数据库')) {
    return {
      ...base,
      answer: '根据景区资料库，灵山大佛高度为 88 米。',
      sources: [
        {
          title: '景区资料库',
          spot_name: '灵山大佛',
          section: '结构化事实',
          snippet: '高度：88米',
          score: 1000,
          source_type: 'database',
          source_url: '',
        },
      ],
    };
  }

  if (question.includes('已审核')) {
    return {
      ...base,
      answer: '根据已审核联网补充，梵宫票务以官方页面为准。',
      sources: [
        {
          title: '已审核联网补充',
          spot_name: '梵宫',
          section: '结构化事实',
          snippet: '票务信息以官方页面为准。',
          score: 900,
          source_type: 'approved_web',
          source_url: 'https://www.lingshan.com/tickets',
        },
      ],
    };
  }

  if (question.includes('冲突')) {
    return {
      ...base,
      answer: '不同来源可能存在差异，数据库证据优先；请以官方公告或现场说明为准。',
      sources: [
        {
          title: '景区资料库',
          spot_name: '梵宫',
          section: '结构化事实',
          snippet: '票务信息以景区资料库为准。',
          score: 1000,
          source_type: 'database',
          source_url: '',
        },
        {
          title: '联网搜索结果',
          spot_name: null,
          section: '基于联网搜索',
          snippet: '网页信息存在差异。',
          score: 700,
          source_type: 'realtime_web',
          source_url: 'https://www.lingshan.com/tickets',
        },
      ],
    };
  }

  if (question.includes('闲聊')) {
    return {
      ...base,
      answer: '你好呀，我是灵诗音，很高兴陪你逛灵山胜境。',
      sources: [],
    };
  }

  return {
    ...base,
    answer: '基于联网搜索：梵宫门票信息请以景区官方票务页面为准。来源：https://www.lingshan.com/tickets。',
    sources: [
      {
        title: '灵山胜境官方票务',
        spot_name: null,
        section: '基于联网搜索',
        snippet: '梵宫门票信息请以景区官方票务页面为准。',
        score: 700,
        source_type: 'realtime_web',
        source_url: 'https://www.lingshan.com/tickets',
      },
    ],
  };
}

function failIf(condition, message) {
  if (condition) {
    throw new Error(message);
  }
}

async function ask(page, question, expectSources = true) {
  const assistantCount = await page.locator('.chat-bubble.assistant').count();
  await page.locator('.chat-input-row textarea, .chat-input-row input').first().fill(question);
  await page.getByTestId('guide-send').click();
  await page.getByTestId('guide-typing-message').waitFor({ timeout: 5000 });
  await page.waitForFunction(
    (count) => document.querySelectorAll('.chat-bubble.assistant').length > count,
    assistantCount,
    { timeout: 8000 },
  );
  if (expectSources) {
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="guide-source-toggle"]').length > 0,
      null,
      { timeout: 8000 },
    );
    await page.evaluate(() => {
      const toggles = document.querySelectorAll('[data-testid="guide-source-toggle"]');
      toggles[toggles.length - 1]?.click();
    });
    await page.locator('.source-card').last().waitFor({ timeout: 5000 });
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
  await page.addInitScript(() => {
    Math.random = () => 0;
    localStorage.setItem('a5_visitor_token', 'valid-visitor-token');
  });

  try {
    await page.route('**/api/auth/me', async (route) => {
      const authorization = route.request().headers().authorization || '';
      if (authorization === 'Bearer valid-visitor-token') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'user-1', username: 'visitor_001', role: 'visitor' }),
        });
        return;
      }
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: '登录状态无效', code: 'AUTH_TOKEN_INVALID', status: 401 }),
      });
    });

    await page.route('**/api/chat/stream', async (route) => {
      const payload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sseFinal(responseForQuestion(payload.question)),
      });
    });
    await page.route('**/api/tts/jobs/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'tts', status: 'disabled', audio_url: null }),
      });
    });

    await page.goto(`${baseUrl}/guide`, { waitUntil: 'networkidle' });
    await page.locator('.chat-bubble.assistant').first().waitFor({ timeout: 5000 });

    await ask(page, '数据库来源验证');
    await page.getByText('景区资料库').last().waitFor({ timeout: 5000 });

    await ask(page, '已审核来源验证');
    await page.getByText('已审核联网补充').last().waitFor({ timeout: 5000 });

    await ask(page, '实时联网来源验证');
    await page.getByText('基于联网搜索').last().waitFor({ timeout: 5000 });
    await page.getByRole('link', { name: 'https://www.lingshan.com/tickets' }).last().waitFor({ timeout: 5000 });

    await ask(page, '冲突来源验证');
    await page.getByText('不同来源可能存在差异').last().waitFor({ timeout: 5000 });

    const beforeCasualSourceCount = await page.locator('.source-card').count();
    await ask(page, '闲聊来源验证', false);
    const afterCasualSourceCount = await page.locator('.source-card').count();
    failIf(afterCasualSourceCount !== beforeCasualSourceCount, 'Casual answer rendered fake source cards');

    await page.screenshot({ path: path.join(outputDir, 'source-provenance-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(outputDir, 'source-provenance-mobile.png'), fullPage: true });

    console.log(JSON.stringify({ ok: true, outputDir }, null, 2));
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
