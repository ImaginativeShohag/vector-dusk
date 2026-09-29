# Publish Vector Dusk

Vector Dusk is a static website. GitHub Pages serves only the generated `dist/` artifact; no backend or secrets are required.

## GitHub Pages

1. Create a public `vector-dusk` repository and push this folder as its root on `main`.
2. In **Settings → Pages → Build and deployment**, select **GitHub Actions** as the source.
3. In **Actions → Verify and publish Vector Dusk**, choose **Run workflow** on `main`.
4. Wait for the `deploy` job to succeed, then open the URL shown in its `github-pages` environment. Check import, editing, profile storage, workspace download/reimport and ZIP export on the live site.

The workflow verifies pull requests and publishes only when manually run. It installs the pinned development dependency, checks formatting, runs browser tests, builds `dist/`, tests the built site, and uploads only `dist/`. Runtime links are relative so the site works under a repository path. The browser suite checks `/vector-dusk/`.

## Other static hosts

Run `npm run build` and publish `dist/` over HTTPS. The site has no runtime dependencies or secrets. A local preview can be served with:

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory dist
```

The HTML includes a content security policy. If a host supports response headers, it can also set `X-Content-Type-Options: nosniff` and a `frame-ancestors` content security policy. GitHub Pages does not provide arbitrary response-header configuration.

## Release checks

- Run `npm ci`, `npm run format:check`, `npm test`, `npm run build`, and `npm run test:site`.
- Check Firefox and Safari manually; automated browser tests cover Chrome.
- Check mobile and desktop layouts, keyboard focus, and guide/privacy links.
- Update the privacy page if hosting, network requests, or local storage behavior changes.

[GitHub Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
