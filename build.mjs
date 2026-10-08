import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = path.dirname(fileURLToPath(import.meta.url));
const destination = path.join(root, 'dist');
// Publish only runtime files, never tests, workspaces, or the parent repository.
const files = [
  'index.html',
  'guide.html',
  'privacy.html',
  '404.html',
  'icon.png',
  'style.css',
  'colors.js',
  'vector.js',
  'svg.js',
  'demo.js',
  'zip.js',
  'app.js',
  'preview.js',
  'background.js',
  'fixtures/palette.svg',
];
await rm(destination, { recursive: true, force: true });
await mkdir(path.join(destination, 'fixtures'), { recursive: true });
for (const file of files) await copyFile(path.join(root, file), path.join(destination, file));
// Version asset URLs so a new release cannot reuse an old script or stylesheet.
for (const file of files.filter((file) => file.endsWith('.html'))) {
  let html = await readFile(path.join(destination, file), 'utf8');
  for (const asset of files.filter((file) => /\.(js|css|svg|png)$/.test(file))) {
    const digest = createHash('sha256')
      .update(await readFile(path.join(destination, asset)))
      .digest('hex')
      .slice(0, 12);
    html = html.replaceAll(`"${asset}"`, `"${asset}?v=${digest}"`);
  }
  await writeFile(path.join(destination, file), html);
}
await writeFile(path.join(destination, '.nojekyll'), '');
console.log(`Built ${files.length + 1} static files in ${destination}`);
