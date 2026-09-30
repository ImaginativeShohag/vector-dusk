import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const expected = [
  '.nojekyll',
  '404.html',
  'app.js',
  'background.js',
  'demo.js',
  'icon.png',
  'fixtures',
  'guide.html',
  'index.html',
  'privacy.html',
  'style.css',
  'svg.js',
  'colors.js',
  'vector.js',
  'zip.js',
];
assert.deepEqual(
  (await readdir(root)).sort(),
  expected.sort(),
  'Site must contain only approved runtime files',
);
for (const name of expected.filter((name) => name.endsWith('.html'))) {
  const html = await readFile(path.join(root, name), 'utf8');
  assert.match(html, /name="viewport"/);
  assert.match(
    html,
    /rel="icon"\s+href="icon.png\?v=/,
    'Every page must use the selected app icon',
  );
  assert.match(
    html,
    /class="brand-icon"\s+src="icon.png\?v=/,
    'Every header must use the selected app icon',
  );
  assert.match(html, /Content-Security-Policy/);
  for (const [, link] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (/^(https:|#)/.test(link)) continue;
    assert.ok(
      !link.startsWith('/'),
      `${name} has a root-relative URL that breaks project Pages: ${link}`,
    );
    const content = await readFile(path.join(root, link.split('?')[0]));
    if (/\.(js|css|svg|png)(?:\?|$)/.test(link)) {
      const digest = createHash('sha256').update(content).digest('hex').slice(0, 12);
      assert.ok(link.endsWith('?v=' + digest), `${name} has a stale asset version: ${link}`);
    }
  }
}
const index = await readFile(path.join(root, 'index.html'), 'utf8');
assert.match(index, /connect-src 'none'/, 'Editor must not upload user artwork');
assert.match(index, /href="privacy.html"/);
assert.match(index, /<noscript\s*>/);
assert.match(index, /<title>Vector Dusk · Dark palette editor<\/title>/);
assert.doesNotMatch(index, /Vector Studio/);
// Internal help links should behave consistently in embedded browsers too.
const guideLinks = [...index.matchAll(/<a\b[^>]*href="guide.html"[^>]*>/g)].map(
  (match) => match[0],
);
assert.ok(guideLinks.length >= 2);
for (const link of guideLinks)
  assert.doesNotMatch(link, /target=/, 'Guide links must navigate in the current tab');
console.log('PASS publication allowlist, local links, project-subpath URLs, privacy link and CSP');
