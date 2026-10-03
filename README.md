# Vector Dusk™

![Vector Dusk icon and name beside artwork transitioning from light to dark](assets/readme-cover.png)

**A local-first dark palette editor for SVG and Android VectorDrawable artwork.** Import illustrations, refine their colors with side-by-side previews, and export files ready for your project. Artwork is processed in your browser, with no account or uploads.

[User guide](guide.html) · [Privacy](privacy.html) · [Deployment](DEPLOYMENT.md)

## What it does

- **One palette for every illustration.** Edits apply to the shared palette by default. Turn on **Edit this illustration separately** to tune one illustration, or **Selected use only** for a single fill, stroke or gradient stop.
- **Build consistent dark palettes.** Adjust replacements directly or explore tints and shades.
- **Work with Android resources.** Import VectorDrawable XML and light-mode `colors.xml` references; export dark resources under their original filenames.
- **Keep your work portable.** Save a profile for shared colors, or download a workspace containing artwork and overrides.
- **Export without a service.** Download an individual SVG/XML file or the full collection as a ZIP.

## Quick start

Requires **Node.js 22+** and **Python 3**. From this directory:

```sh
npm run build
python3 -m http.server 8765 --bind 127.0.0.1 --directory dist
```

Open [http://127.0.0.1:8765](http://127.0.0.1:8765). Keep the terminal running while you use the editor; press **Ctrl+C** to stop. Rebuild and refresh after changing source files. The build and site have no runtime package dependencies, so `npm install` is not needed for this quick start.

## Editing workflow

1. Import SVG or Android VectorDrawable XML, or paste the artwork. For Android resource references, import the corresponding light-mode `colors.xml`.
2. Select a color and choose a replacement or tint/shade. Changes reach all illustrations unless you switch on **Edit this illustration separately** or **Selected use only**. A picker drag or typed hex value is one undo step; removing an illustration can be undone from its message.
3. Save a **profile** to retain shared palette settings in this browser. Saving over a different profile with the same name asks first, and **Delete** removes the selected saved profile (with Undo). Save a **workspace** to download the artwork and all overrides; reopen either exported JSON file with **Import JSON**.
4. Export one file or the collection ZIP. Place exported Android XML files in `res/drawable-night/` using their original filenames.

Save a workspace before closing or refreshing the page. Profiles do not contain artwork.

## Use with an agent

Choose **Copy prompt for agent** and paste the instructions into your agent chat. The agent can open your SVG or Android VectorDrawable XML in the editor, then wait while you review and adjust it. When you tell the agent you are finished, it can return to the same tab and retrieve the current export through **View XML** or **Download**. The prompt does not grant browser access; if the agent cannot access the tab, download the result and give it the exported file.

Agent import links use `#v=1&name=<filename>&encoding=gzip&data=<payload>`. The payload is gzip-compressed UTF-8 source encoded as unpadded Base64url. Uncompressed source is also accepted with `encoding=text` or with `encoding` omitted; build all parameters with `URLSearchParams`.

To generate a compressed link without dependencies, save this as `agent-link.mjs`, set `SITE_URL` to your editor URL, then run `node agent-link.mjs path/to/illustration.svg` (or an XML file):

```js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

const SITE_URL = 'https://your-editor.example/index.html';
const file = process.argv[2];
assert(file, 'Pass an SVG or VectorDrawable XML file.');
const source = readFileSync(file);
assert(source.length <= 5_000_000, 'Use a vector of at most 5 MB.');
const data = gzipSync(source).toString('base64url');
assert.deepEqual(gunzipSync(Buffer.from(data, 'base64url')), source);
const url = new URL(SITE_URL);
url.hash = new URLSearchParams({
  v: '1',
  name: basename(file),
  encoding: 'gzip',
  data,
}).toString();
assert(url.href.length <= 65_536, 'Link too large: use Paste XML or Import vectors.');
console.log(url.href);
```

The full URL limit is **65,536 characters** and decompressed source must not exceed **5,000,000 bytes**. For larger links, use **Paste XML** or **Import vectors**. For Android color resource references, also import the corresponding light-mode `colors.xml`.

The link contains your artwork: compression is not encryption, and anyone with the link can read it. The fragment is processed in the browser rather than sent to the hosting server. After a successful import the editor clears the fragment; save a workspace before refreshing or closing the tab.

Local Promptfoo prompt-understanding evals live in [evals/README.md](evals/README.md). Run `npm run eval` with your Codex login; `npm run eval:validate` checks configuration without calling a model. These scenario tests do not prove browser execution.

## Development

Install the pinned formatter and run the checks:

```sh
npm ci
npm run format:check
npm test
npm run build
npm run test:site
```

`npm run format` applies formatting. Automated browser tests use Chrome and a temporary profile; set `CHROME_BIN` if Chrome is installed in a nonstandard location. Firefox and Safari need manual checks. See [Deployment](DEPLOYMENT.md) for publishing and release checks.

The source is intentionally small: `colors.js` handles palette math and resource resolution; `vector.js` and `svg.js` handle their respective formats; `app.js` owns editor state and interactions; `zip.js` writes downloads. `build.mjs` publishes approved files to generated `dist/`.

## Format and preview limits

Vector Dusk edits static artwork; it does not convert SVG to VectorDrawable or vice versa. Expand SVG `symbol`/`use` instances before importing. Unsupported SVG content is removed with preview notes. Android previews may approximate tint, trim paths, and sweep gradients, so verify exported resources in Android Studio or on a device.

Limits are **5 MB per vector**, **100 illustrations per workspace**, and **50 MB per workspace JSON**.

## License and branding

Source code and documentation are under the [MIT license](LICENSE). The Vector Dusk name and `icon.png` have separate [branding terms](BRANDING.md).
