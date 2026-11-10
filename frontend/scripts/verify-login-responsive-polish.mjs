import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const outputDir = path.join(projectRoot, 'test-results', 'login-responsive-polish');
const visitorUrl = process.env.VISITOR_LOGIN_VERIFY_URL || 'http://127.0.0.1:5181';
const adminUrl = process.env.ADMIN_LOGIN_VERIFY_URL || 'http://127.0.0.1:5182';

async function waitForReady(url) {
  for (let i = 0; i < 50; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // keep waiting
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Server did not become ready at ${url}`);
}

function spawnServer(command, apiBaseUrl) {
  return spawn(command, {
    cwd: projectRoot,
    env: {
      ...process.env,
      VITE_USE_MOCK_API: 'true',
      VITE_API_BASE_URL: apiBaseUrl,
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

async function assertNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  failIf(overflow > 1, `${label} should not have horizontal overflow, got ${overflow}px`);
}

async function delayedError(route, message, code) {
  await new Promise((resolve) => setTimeout(resolve, 450));
  await route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ message, code, status: 401 }),
  });
}

async function assertSubmittingLocksButton(page, buttonName) {
  const button = page.getByRole('button', { name: buttonName });
  await button.waitFor({ timeout: 3000 });
  failIf(!(await button.isDisabled()), `${buttonName} should be disabled while request is pending`);
}

async function assertKeyboardEditingWorks(input) {
  await input.press('1');
  await input.press('2');
  failIf((await input.inputValue()) !== '12', 'Numeric keys should enter text in form fields');
  await input.press('Backspace');
  failIf((await input.inputValue()) !== '1', 'Backspace should delete text in form fields');
}

async function main() {
  const { chromium } = await import('@playwright/test');
  await mkdir(outputDir, { recursive: true });

  const visitorServer = spawnServer('npm.cmd run dev:visitor -- --port 5181', visitorUrl);
  const adminServer = spawnServer('npm.cmd run dev:admin -- --port 5182', adminUrl);
  let browser;

  try {
    await Promise.all([waitForReady(visitorUrl), waitForReady(adminUrl)]);
    browser = await chromium.launch({ headless: true });

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await mobile.route('**/api/auth/login', (route) => delayedError(route, '游客账号或密码错误', 'AUTH_INVALID_CREDENTIALS'));
    await mobile.route('**/api/auth/register', (route) => delayedError(route, '用户名已存在', 'USERNAME_EXISTS'));

    await mobile.goto(`${visitorUrl}/login`, { waitUntil: 'networkidle' });
    failIf(!(await mobile.locator('body').innerText()).includes('灵山胜境 AI 导览'), 'Visitor login should show scenic guide context');
    await assertNoHorizontalOverflow(mobile, 'mobile visitor login');
    const visitorUsername = mobile.getByLabel('用户名');
    await assertKeyboardEditingWorks(visitorUsername);
    await visitorUsername.fill('visitor_001');
    await mobile.getByLabel('密码').fill('wrong123');
    await mobile.getByRole('button', { name: /\[ LOGIN \]/ }).click();
    await assertSubmittingLocksButton(mobile, /\[ LOGIN \]/);
    await mobile.locator('.ant-alert-message').getByText('游客账号或密码错误').waitFor({ timeout: 5000 });
    await mobile.screenshot({ path: path.join(outputDir, '01-mobile-visitor-login-error.png'), fullPage: true });

    await mobile.goto(`${visitorUrl}/register`, { waitUntil: 'networkidle' });
    failIf(!(await mobile.locator('body').innerText()).includes('灵山胜境 AI 导览'), 'Visitor register should show scenic guide context');
    await assertNoHorizontalOverflow(mobile, 'mobile visitor register');
    await mobile.getByLabel('用户名').fill('visitor_001');
    await mobile.getByLabel('密码').fill('secret123');
    await mobile.getByRole('button', { name: /\[ REGISTER \]/ }).click();
    await assertSubmittingLocksButton(mobile, /\[ REGISTER \]/);
    await mobile.locator('.ant-alert-message').getByText('用户名已存在').waitFor({ timeout: 5000 });
    await mobile.screenshot({ path: path.join(outputDir, '02-mobile-visitor-register-error.png'), fullPage: true });

    const adminMobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await adminMobile.route('**/api/auth/admin/login', (route) => delayedError(route, '管理员账号或密码错误', 'AUTH_INVALID_CREDENTIALS'));
    await adminMobile.goto(`${adminUrl}/login`, { waitUntil: 'networkidle' });
    failIf(!(await adminMobile.locator('body').innerText()).includes('OPS CONTROL'), 'Admin login should show operations console context');
    await assertNoHorizontalOverflow(adminMobile, 'mobile admin login');
    await adminMobile.getByLabel('用户名').fill('admin');
    await adminMobile.getByLabel('密码').fill('wrong123');
    await adminMobile.getByRole('button', { name: /\[ LOGIN \]/ }).click();
    await assertSubmittingLocksButton(adminMobile, /\[ LOGIN \]/);
    await adminMobile.locator('.ant-alert-message').getByText('管理员账号或密码错误').waitFor({ timeout: 5000 });
    await adminMobile.screenshot({ path: path.join(outputDir, '03-mobile-admin-login-error.png'), fullPage: true });

    const desktop = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    await desktop.goto(`${visitorUrl}/login`, { waitUntil: 'networkidle' });
    await assertNoHorizontalOverflow(desktop, 'desktop visitor login');
    await desktop.screenshot({ path: path.join(outputDir, '04-desktop-visitor-login.png'), fullPage: true });
    await desktop.goto(`${adminUrl}/login`, { waitUntil: 'networkidle' });
    await assertNoHorizontalOverflow(desktop, 'desktop admin login');
    await desktop.screenshot({ path: path.join(outputDir, '05-desktop-admin-login.png'), fullPage: true });

    console.log(
      JSON.stringify(
        {
          ok: true,
          visitorUrl,
          adminUrl,
          outputDir,
          screenshots: [
            '01-mobile-visitor-login-error.png',
            '02-mobile-visitor-register-error.png',
            '03-mobile-admin-login-error.png',
            '04-desktop-visitor-login.png',
            '05-desktop-admin-login.png',
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
    visitorServer.kill();
    adminServer.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
