// Browser test helper: opens the built game in a headless Chromium-family browser and drives it with real mouse input.
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IGNORED = [/CONTEXT_LOST_WEBGL/, /GPU stall due to ReadPixels/, /GL Driver Message/];

const candidates = [
  process.env.BROWSER_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

export const browserAvailable = () => candidates.some((p) => existsSync(p));
export const browserPath = () => candidates.find((p) => existsSync(p));

/** Open the game (docs/index.html, the output of npm run build) and return helpers. Game coordinates are 1280x720. */
export async function open(query = '', { viewport = { width: 1280, height: 720 }, storage = null } = {}) {
  const executablePath = browserPath();
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport });
  const problems = [];
  page.on('console', (m) => {
    const text = m.text();
    if (['error', 'warning'].includes(m.type()) && !IGNORED.some((re) => re.test(text))) problems.push(`[${m.type()}] ${text}`);
  });
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}\n${e.stack || ''}`));
  const url = `${pathToFileURL(resolve(root, 'docs/index.html')).href}${query}`;
  if (storage) {
    await page.addInitScript((entries) => {
      for (const [k, v] of Object.entries(entries)) if (!localStorage.getItem(`__init_${k}`)) {
        localStorage.setItem(k, v);
        localStorage.setItem(`__init_${k}`, '1');
      }
    }, storage);
  }
  await page.goto(url);

  const api = {
    page,
    problems,
    url,
    async wait(ms) {
      await page.waitForTimeout(ms);
    },
    async click(x, y, opts = {}) {
      await page.mouse.click(x, y, opts);
      await page.waitForTimeout(opts.settle ?? 120);
    },
    async rightClick(x, y) {
      await page.mouse.click(x, y, { button: 'right' });
      await page.waitForTimeout(120);
    },
    async move(x, y) {
      await page.mouse.move(x, y);
      await page.waitForTimeout(80);
    },
    async key(k) {
      await page.keyboard.press(k);
      await page.waitForTimeout(120);
    },
    async eval(fn, arg) {
      return page.evaluate(fn, arg);
    },
    async shot(path) {
      await page.screenshot({ path });
    },
    /** Wait until the controller has nothing left to play (the human is to act, or the game is over). */
    async idle(timeout = 60000) {
      await page.waitForFunction(() => window.__ctl && !window.__ctl.pumping && !window.__ctl.busy, null, { timeout, polling: 100 });
      await page.waitForTimeout(80);
    },
    async ready(timeout = 15000) {
      await page.waitForFunction(() => window.__ctl && window.__game, null, { timeout });
      await api.idle(timeout);
    },
    /** Wait until `fn()` evaluated in the page is truthy. */
    async waitFor(fn, arg, timeout = 20000) {
      await page.waitForFunction(fn, arg, { timeout, polling: 50 });
      await page.waitForTimeout(100);
    },
    async close() {
      await browser.close();
    },
  };
  return api;
}

/** Screen position of the centre of the hex "q,r" (needs a running game, 1280x720 viewport). */
export async function hexPos(app, key) {
  return app.eval((k) => {
    const p = window.__ctl.map.pos(k);
    return { x: p.x, y: p.y };
  }, key);
}
