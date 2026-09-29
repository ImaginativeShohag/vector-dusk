# Vector Dusk™

Create dark-mode SVG and Android VectorDrawable artwork with reusable palettes. Files are processed in your browser; no account, uploads or runtime dependencies.

## Run locally

Requires Node.js 22+ and Python 3. From this folder:

```sh
npm run build
python3 -m http.server 8765 --bind 127.0.0.1 --directory dist
```

Open **http://127.0.0.1:8765**. Keep the terminal open; press **Ctrl+C** to stop. After editing source files, rebuild and refresh. You do not need `npm install` to build or run the app.

## Use

1. Import SVG/XML or paste artwork. Import light-mode `colors.xml` for Android resource references.
2. Select a color and edit its replacement, or choose a tint/shade. Set the scope: palette, illustration or individual use.
3. **Save profile** stores shared colors locally. **Save workspace** downloads artwork and all overrides; use **Import JSON** to reopen it.
4. Export one file or the collection ZIP. Android exports belong in `res/drawable-night/` under their original filenames.

[Guide](guide.html) · [Privacy](privacy.html) · [Deployment](DEPLOYMENT.md) · [MIT license](LICENSE) · [Branding](BRANDING.md)

## Development

Install the pinned development formatter once, then use:

```sh
npm ci
npm run format
npm run format:check
npm test
npm run build
npm run test:site
```

Tests require Chrome; set `CHROME_BIN` for a custom installation. They use a temporary browser profile and check the built site under `/vector-dusk/`. Chrome is automated; Firefox and Safari checks are manual.

| File                      | Responsibility                                                            |
| ------------------------- | ------------------------------------------------------------------------- |
| `colors.js`               | Color normalization, resource resolution, suggestions and tint/shade math |
| `vector.js`               | Android XML parsing, preview/export and palette validation                |
| `svg.js`                  | SVG sanitization, CSS resolution and preview/export                       |
| `app.js`                  | Editor state, scoped edits, history, persistence and UI events            |
| `zip.js`                  | Dependency-free ZIP downloads                                             |
| `index.html`, `style.css` | Markup and responsive styles                                              |
| `build.mjs`               | Publish only approved files to `dist/`, with versioned asset URLs         |

Keep source readable; `dist/` is generated. Deferred scripts share the `VectorStudio` namespace in order: colors → Android adapter → SVG adapter → demo/ZIP → app. The legacy namespace and storage keys preserve compatibility. Internal colors use `#AARRGGBB`; SVG converts to/from `#RRGGBBAA` at its boundary. Override precedence is use → illustration → palette → suggestion. Add regression coverage when changing these contracts.

## Limits

Static SVG only; expand `symbol`/`use` instances first. Unsupported SVG content is removed with notes. Android previews have tint, trim-path and sweep-gradient limitations; verify exports in Android Studio or on a device. This is not a format converter.

Limits: 5 MB per vector, 100 illustrations per workspace, 50 MB workspace JSON. Save a workspace before closing; profiles do not contain artwork.

## License and branding

Source code and documentation are licensed under [MIT](LICENSE). The Vector Dusk name and `icon.png` are reserved; see [Branding](BRANDING.md) for reuse terms.
