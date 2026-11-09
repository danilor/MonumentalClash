// Dev helper: open the built game in a headless browser, optionally run a script, and save a screenshot.
//   node test/shot.mjs <out.png> [query] [--wait=ms] [--eval="js"] [--viewport=1280x720]
import { chromium } from 'playwright-core';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { browserPath } from './browser.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, d) => (args.find((a) => a.startsWith(`--${name}=`)) || '').slice(name.length + 3) || d;
const pos = args.filter((a) => !a.startsWith('--'));
const out = pos[0] || 'shot.png';
const query = pos[1] || '';
const wait = Number(flag('wait', '1500'));
const evalJs = flag('eval', '');
const [vw, vh] = flag('viewport', '1280x720').split('x').map(Number);

const executablePath = browserPath();
const browser = await chromium.launch({ executablePath, headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: vw, height: vh } });
const problems = [];
const IGNORED = [/CONTEXT_LOST_WEBGL/, /GPU stall due to ReadPixels/, /GL Driver Message/];
page.on('console', (m) => {
  const text = m.text();
  if (['error', 'warning'].includes(m.type())) {
    if (!IGNORED.some((re) => re.test(text))) problems.push(`[${m.type()}] ${text}`);
  } else if (args.includes('--verbose')) console.log(`[${m.type()}] ${text}`);
});
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}\n${e.stack || ''}`));
await page.goto(`${pathToFileURL(resolve(root, 'dist/index.html')).href}${query}`);
await page.waitForTimeout(wait);
if (evalJs) {
  const r = await page.evaluate(evalJs);
  if (r !== undefined) console.log('eval →', JSON.stringify(r));
  await page.waitForTimeout(Number(flag('after', '800')));
}
await page.screenshot({ path: out });
console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'no console problems');
await browser.close();
