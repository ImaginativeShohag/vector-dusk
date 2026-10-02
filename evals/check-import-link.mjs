import { readFileSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: true,
  parseTagValue: false,
  ignoreDeclaration: true,
});
export function parseXml(source) {
  if (/<!DOCTYPE|<!ENTITY/i.test(source) || XMLValidator.validate(source) !== true) return;
  return parser.parse(source);
}

function linkedResources(output) {
  const sources = [];
  for (const match of output.matchAll(/\]\((?:<([^>]+)>|([^\s)]+))\)/g)) {
    try {
      const target = match[1] ?? match[2];
      const file = realpathSync(target.startsWith('file:') ? new URL(target) : target);
      const relative = path.relative(realpathSync(tmpdir()), file).split(path.sep);
      if (!/^vector-dusk-promptfoo-[A-Za-z0-9]+$/.test(relative[0])) continue;
      if (relative.slice(1).join('/') !== 'app/src/main/res/values/colors.xml') continue;
      const stat = statSync(file);
      if (stat.isFile() && stat.size <= 5_000_000) sources.push(readFileSync(file, 'utf8'));
    } catch {
      // Missing files and links outside eval workspaces are not resource artifacts.
    }
  }
  return sources;
}

export default function (output, { vars: { fixture } }) {
  const file = fixture === 'svg' ? 'panel.svg' : 'app/src/main/res/drawable/panel.xml';
  const expected = readFileSync(new URL(`./fixtures/${fixture}/${file}`, import.meta.url));
  const colors =
    fixture === 'android'
      ? parseXml(
          readFileSync(
            new URL('./fixtures/android/app/src/main/res/values/colors.xml', import.meta.url),
            'utf8',
          ),
        )
      : undefined;
  for (const candidate of output.match(
    /https:\/\/vector-dusk\.example\/index\.html#[^\s<>`"')]+/g,
  ) ?? []) {
    try {
      const url = new URL(candidate.replace(/[.,;]+$/, ''));
      const params = new URLSearchParams(url.hash.slice(1));
      if (
        url.href.length > 65_536 ||
        params.get('v') !== '1' ||
        params.get('name') !== file.split('/').at(-1)
      )
        continue;
      if (['v', 'name', 'encoding', 'data'].some((key) => params.getAll(key).length > 1)) continue;
      const data = params.get('data') ?? '';
      let source;
      if (params.get('encoding') === 'gzip' && /^[A-Za-z0-9_-]+$/.test(data)) {
        source = gunzipSync(Buffer.from(data, 'base64url'), { maxOutputLength: 5_000_000 });
      } else if (!params.get('encoding') || params.get('encoding') === 'text') {
        source = Buffer.from(data);
      } else continue;
      if (source.length > 5_000_000) continue;
      if (fixture === 'svg') {
        if (source.equals(expected)) return true;
        continue;
      }
      const actual = parseXml(source.toString('utf8'));
      const original = parseXml(expected.toString('utf8'));
      const resolved = structuredClone(original);
      resolved.vector.path['@_android:fillColor'] = colors.resources.color['#text'];
      if (isDeepStrictEqual(actual, resolved)) return true;
      // ponytail: this fixture has one color; add more resource cases when needed.
      const resourceBlocks = [
        ...(output.match(/<resources\b[^>]*>[\s\S]*?<\/resources>/g) ?? []),
        ...linkedResources(output),
      ];
      if (
        isDeepStrictEqual(actual, original) &&
        resourceBlocks.some((xml) => isDeepStrictEqual(parseXml(xml), colors))
      )
        return true;
    } catch {
      // Malformed links or XML cannot satisfy the artifact contract.
    }
  }
  return false;
}
