import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const site = process.argv.includes('--site');
const servedRoot = site ? path.join(root, 'dist') : root;
const prefix = '/vector-dusk/';
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith(prefix)) throw new Error('Not found');
    const pathname = decodeURIComponent(url.pathname.slice(prefix.length));
    const base = ['tests.html', 'tests.js'].includes(pathname) ? root : servedRoot;
    const file = path.resolve(base, pathname);
    if (!file.startsWith(base + path.sep)) throw new Error('Not found');
    const type =
      {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.xml': 'application/xml',
        '.svg': 'image/svg+xml',
      }[path.extname(file)] || 'text/plain';
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': type });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const chrome =
  process.env.CHROME_BIN ||
  (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : process.platform === 'win32'
      ? path.join(
          process.env.PROGRAMFILES || 'C:\\Program Files',
          'Google/Chrome/Application/chrome.exe',
        )
      : 'google-chrome');
let browser;
let page;
try {
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}${prefix}tests.html`);
  // Wait for the suite itself; virtual-time dumps can outrun animations and async imports.
  await page.waitForFunction(
    () => ['passed', 'failed'].includes(document.body.dataset.testStatus),
    null,
    { timeout: 60000 },
  );
  console.log(await page.locator('#results').textContent());
  process.exitCode =
    (await page.evaluate(() => document.body.dataset.testStatus)) === 'passed' ? 0 : 1;
} catch (error) {
  if (page)
    console.error(
      await page
        .locator('#results')
        .textContent()
        .catch(() => ''),
    );
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.close();
}
