import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stopProcessTree } from './process-tree.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(projectRoot, '..');
const workspaceBrowserPath = path.join(workspaceRoot, '.cache', 'ms-playwright');
const browserPath = existsSync(workspaceBrowserPath) ? workspaceBrowserPath : undefined;
const baseUrl = 'http://127.0.0.1:5186';

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
  const server = spawn('npm.cmd run dev:visitor -- --port 5186', {
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
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    let currentConfigRequests = 0;
    await page.route('**/api/spots/summary', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ listed_spot_count: 22, collected_spot_count: 22 }),
      }),
    );
    await page.route('**/api/avatar/current', (route) => {
      currentConfigRequests += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          avatar_id: 'uploaded-avatar',
          version: 'uploaded-avatar',
          loader_url: `${baseUrl}/uploaded-avatar.loader.js`,
          data_url: `${baseUrl}/uploaded-avatar.data`,
          framework_url: `${baseUrl}/uploaded-avatar.framework.js`,
          wasm_url: `${baseUrl}/uploaded-avatar.wasm`,
          streaming_assets_url: `${baseUrl}/uploaded-streaming`,
          fallback_url: '/avatar/uketsukejou151/avatar-151-chat.svg',
          bridge_object_name: 'Avatar151Bridge',
        }),
      });
    });
    await page.route('**/uploaded-avatar.loader.js', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `window.createUnityInstance = async (canvas, config, onProgress) => {
          window.__runtimeAvatarConfig = config;
          onProgress?.(1);
          return { SendMessage() {}, async Quit() {} };
        };`,
      }),
    );

    await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__runtimeAvatarConfig?.codeUrl?.includes('uploaded-avatar.wasm'));
    const runtimeConfig = await page.evaluate(() => window.__runtimeAvatarConfig);
    if (currentConfigRequests < 1) {
      throw new Error('Current avatar config should be requested when the visitor app starts');
    }
    if (!runtimeConfig.dataUrl.includes('uploaded-avatar.data')) {
      throw new Error(`Uploaded avatar data URL was not used: ${JSON.stringify(runtimeConfig)}`);
    }
    if (runtimeConfig.streamingAssetsUrl !== `${baseUrl}/uploaded-streaming`) {
      throw new Error(`Uploaded StreamingAssets URL was not used: ${JSON.stringify(runtimeConfig)}`);
    }

    const fallbackPage = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    await fallbackPage.route('**/api/spots/summary', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ listed_spot_count: 22, collected_spot_count: 22 }),
      }),
    );
    await fallbackPage.route('**/api/avatar/current', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          avatar_id: 'broken-upload',
          version: 'broken-upload',
          loader_url: `${baseUrl}/broken-avatar.loader.js`,
          data_url: `${baseUrl}/broken-avatar.data`,
          framework_url: `${baseUrl}/broken-avatar.framework.js`,
          wasm_url: `${baseUrl}/broken-avatar.wasm`,
          streaming_assets_url: '',
          fallback_url: '',
          bridge_object_name: 'Avatar151Bridge',
        }),
      }),
    );
    await fallbackPage.route('**/broken-avatar.loader.js', (route) => route.fulfill({ status: 500 }));
    await fallbackPage.route('**/avatar151-guide.loader.js*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `window.__builtinAvatarFallbackLoaded = true;
          window.createUnityInstance = async () => ({ SendMessage() {}, async Quit() {} });`,
      }),
    );
    await fallbackPage.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
    await fallbackPage.waitForFunction(() => window.__builtinAvatarFallbackLoaded === true);
    await fallbackPage.close();

    const staticFallbackPage = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    await staticFallbackPage.route('**/api/spots/summary', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ listed_spot_count: 22, collected_spot_count: 22 }),
      }),
    );
    await staticFallbackPage.route('**/api/avatar/current', (route) => route.fulfill({ status: 500 }));
    await staticFallbackPage.route('**/avatar151-guide.loader.js*', (route) => route.fulfill({ status: 500 }));
    await staticFallbackPage.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
    await staticFallbackPage.locator('.unity-avatar-static-fallback').waitFor({ state: 'visible' });
    await staticFallbackPage.close();
  } finally {
    if (browser) await browser.close();
    stopProcessTree(server);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
