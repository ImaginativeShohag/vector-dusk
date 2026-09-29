import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
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
const profile = await mkdtemp(path.join(tmpdir(), 'vector-dusk-test-'));
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
let output = '';
let errors = '';
try {
  const child = spawn(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
    '--dump-dom',
    '--virtual-time-budget=15000',
    `http://127.0.0.1:${server.address().port}${prefix}tests.html`,
  ]);
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (errors += chunk));
  const timeout = setTimeout(() => child.kill('SIGKILL'), 45000);
  await new Promise((resolve, reject) => {
    child.on('close', resolve);
    child.on('error', reject);
  }).finally(() => clearTimeout(timeout));
  const report = output.match(/<pre id="results">([\s\S]*?)<\/pre>/)?.[1];
  console.log(
    (report || errors || output)
      .replaceAll('&gt;', '>')
      .replaceAll('&lt;', '<')
      .replaceAll('&amp;', '&'),
  );
  if (!/data-test-status="(?:passed|failed)"/.test(output))
    console.error('Browser suite did not finish. No success result was reported.');
  process.exitCode = output.includes('data-test-status="passed"') ? 0 : 1;
} finally {
  server.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
