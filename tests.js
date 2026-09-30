/* These tests run in a real browser, using its XML and SVG implementations. */
(async () => {
  const V = window.VectorStudio;
  const results = [];
  function equal(actual, expected) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
    }
  }
  function ok(value, message) {
    if (!value) throw new Error(message);
  }
  function throws(fn) {
    let caught = false;
    try {
      fn();
    } catch {
      caught = true;
    }
    ok(caught, 'Expected rejection');
  }
  async function test(name, fn) {
    try {
      await fn();
      results.push(`PASS ${name}`);
    } catch (error) {
      results.push(`FAIL ${name}: ${error.message}`);
    }
    document.querySelector('#results').textContent =
      results.join('\n') + '\nRunning remaining checks…';
  }
  const wrap = (body, extra = '') =>
    `<vector xmlns:android="http://schemas.android.com/apk/res/android" xmlns:aapt="http://schemas.android.com/aapt" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24" ${extra}>${body}</vector>`;
  const path = (fill, extra = '') =>
    `<path android:pathData="M0,0h24v24h-24z" android:fillColor="${fill}" ${extra}/>`;

  await test('Android short and alpha-first colors normalize without losing alpha', () => {
    // Given / When / Then: Android ARGB is not CSS RGBA.
    equal(V.normalizeColor('#8abc'), '#88AABBCC');
    equal(V.normalizeColor('#abc'), '#AABBCC');
    equal(V.normalizeColor('#ffaabbcc'), '#AABBCC');
    equal(V.normalizeColor('#80FF0000'), '#80FF0000');
    equal(V.normalizeColor('#badhex'), null);
  });
  await test('Suggestions retain hue family and transparency; transparent shadows stay transparent', () => {
    // Given
    const source = '#803F3D56';
    // When
    const target = V.suggest(source);
    // Then
    ok(target.startsWith('#80'), 'Alpha changed');
    ok(target !== source, 'Dark source was not lightened');
    equal(V.suggest('#00000000'), '#00000000');
  });
  await test('Colorful accents and pale skin suggestions remain light enough to recognize', () => {
    // Given
    for (const source of ['#FF6584', '#6C63FF', '#FFB8B8']) {
      // When
      const color = V.colorParts(V.suggest(source)).rgb;
      const channels = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
      // Then: a lightness inversion made these into dark maroon and blue.
      ok((Math.min(...channels) + Math.max(...channels)) / 2 >= 0.54, `${source} became too dark`);
    }
  });
  await test('Palette groups equivalent literals but preserves separate resource identities', () => {
    // Given
    const model = V.parseVector(wrap(path('#abc') + path('#AABBCC') + path('@color/brand')));
    // When
    const palette = V.palette(model);
    // Then
    equal(
      palette.map((p) => [p.key, p.uses.length]),
      [
        ['#AABBCC', 2],
        ['@color/brand', 1],
      ],
    );
  });
  await test('Export changes colors only, preserves geometry, comments, alpha and unmapped references', () => {
    // Given
    const xml = wrap(
      '<!-- original comment -->' +
        path('#80FF0000', 'android:fillAlpha="0.4"') +
        path('@color/brand'),
    );
    const model = V.parseVector(xml);
    // When
    const output = V.exportXml(model, { '#80FF0000': '#80123456' });
    const parsed = V.parseVector(output);
    // Then
    equal(
      parsed.uses.map((u) => u.raw),
      ['#80123456', '@color/brand'],
    );
    ok(output.includes('original comment'), 'Comment lost');
    ok(output.includes('android:fillAlpha="0.4"'), 'Alpha attribute lost');
    equal(
      parsed.document.querySelector('path').getAttributeNS(V.ANDROID, 'pathData'),
      'M0,0h24v24h-24z',
    );
    equal(model.uses[0].raw, '#80FF0000');
  });
  await test('A shape override wins over its palette mapping without affecting another shape', () => {
    // Given
    const model = V.parseVector(wrap(path('#abc') + path('#abc')));
    // When
    const output = V.exportXml(model, { '#AABBCC': '#112233' }, { [model.uses[0].id]: '#445566' });
    // Then
    equal(
      V.parseVector(output).uses.map((u) => u.raw),
      ['#445566', '#112233'],
    );
  });
  await test('Keep-original mapping preserves the original resource reference', () => {
    // Given
    const model = V.parseVector(wrap(path('@color/brand')));
    // When / Then
    equal(
      V.parseVector(V.exportXml(model, { '@color/brand': 'keep' })).uses[0].raw,
      '@color/brand',
    );
  });
  await test('Resource aliases resolve and cycles remain unresolved', () => {
    // Given
    const resources = V.parseResources(
      '<resources><color name="brand">@color/base</color><color name="base">#f25</color><color name="loop">@color/loop</color></resources>',
    );
    // When / Then
    equal(V.resolveColor('@color/brand', resources), '#FF2255');
    equal(V.resolveColor('@color/loop', resources), null);
    equal(V.resolveColor('@color/missing', resources), null);
  });
  await test('Malformed, unsafe and non-vector XML are rejected', () => {
    // Given / When / Then
    for (const xml of [
      '<vector>',
      '<svg/>',
      '<!DOCTYPE vector [<!ENTITY x "value">]><vector/>',
      wrap(path('#fff')).replace('viewportWidth="24"', 'viewportWidth="0"'),
    ]) {
      throws(() => V.parseVector(xml));
    }
  });
  await test('SVG preview combines color alpha with fill alpha and never copies active XML', () => {
    // Given
    const model = V.parseVector(
      wrap(
        path('#80FF0000', 'android:fillAlpha="0.5" onclick="alert(1)"') +
          '<script>alert(1)</script>',
      ),
    );
    // When
    const { svg, warnings } = V.render(model);
    const rendered = svg.querySelector('path');
    // Then
    equal(rendered.getAttribute('fill'), '#FF0000');
    ok(
      Math.abs(Number(rendered.getAttribute('fill-opacity')) - (128 / 255) * 0.5) < 0.0001,
      'Incorrect opacity',
    );
    equal(svg.querySelector('script'), null);
    equal(rendered.getAttribute('onclick'), null);
    ok(warnings.length > 0, 'Unsupported node silently ignored');
  });
  await test('Clip paths affect subsequent siblings only and group transforms preserve pivots', () => {
    // Given
    const model = V.parseVector(
      wrap(
        path('#f00') +
          '<group android:pivotX="2" android:pivotY="3" android:scaleX="2" android:rotation="30" android:translateX="4"><clip-path android:pathData="M0,0h10v10z"/>' +
          path('#0f0') +
          '</group>' +
          path('#00f'),
      ),
    );
    // When
    const { svg } = V.render(model);
    // Then
    equal(
      svg.querySelector('g[transform]').getAttribute('transform'),
      'translate(6 3) rotate(30) scale(2 1) translate(-2 -3)',
    );
    const paths = svg.querySelectorAll('path[data-node]');
    equal(paths[0].closest('[clip-path]'), null);
    ok(paths[1].closest('[clip-path]'), 'Clip missing');
    equal(paths[2].closest('[clip-path]'), null);
  });
  await test('Gradient stop mappings are exported and rendered', () => {
    // Given
    const model = V.parseVector(
      wrap(
        '<path android:pathData="M0,0h24v24z"><aapt:attr name="android:fillColor"><gradient android:startX="0" android:endX="24"><item android:offset="0" android:color="#fff"/><item android:offset="1" android:color="#000"/></gradient></aapt:attr></path>',
      ),
    );
    // When
    const mapped = { '#FFFFFF': '#222222', '#000000': '#EEEEEE' };
    const { svg } = V.render(model, mapped);
    // Then
    equal(
      [...svg.querySelectorAll('stop')].map((n) => n.getAttribute('stop-color')),
      ['#222222', '#EEEEEE'],
    );
    equal(
      V.parseVector(V.exportXml(model, mapped)).uses.map((u) => u.raw),
      ['#222222', '#EEEEEE'],
    );
  });
  await test('Unsupported trim, tint and unresolved colors are explicitly reported', () => {
    // Given
    const model = V.parseVector(
      wrap(path('@color/missing', 'android:trimPathEnd="0.5"'), 'android:tint="#fff"'),
    );
    // When
    const { warnings } = V.render(model);
    // Then
    for (const word of ['trim', 'tint', '@color/missing'])
      ok(
        warnings.some((w) => w.toLowerCase().includes(word)),
        `Missing ${word} warning`,
      );
  });
  await test('Profile JSON round-trips exact mappings and protected colors; invalid imports fail', () => {
    // Given
    const profile = {
      version: 1,
      kind: 'vector-dark-palette',
      name: 'My illustrations',
      mappings: { '#AABBCC': '#112233', '@color/brand': 'keep' },
      resources: { '@color/brand': '#FF2255' },
      background: '#171923',
    };
    // When / Then
    equal(V.validateProfile(JSON.parse(JSON.stringify(profile))), profile);
    throws(() => V.validateProfile({ ...profile, version: 9 }));
    throws(() => V.validateProfile({ ...profile, mappings: { '#abc': 'url(https://invalid)' } }));
  });
  await test('ZIP export contains readable stored entries with a standard CRC32', () => {
    // Given / When
    const zip = window.VectorStudioZip([
      { name: 'drawable-night/example.xml', text: 'hello' },
      { name: 'palette.json', text: '{}' },
    ]);
    const view = new DataView(zip.buffer);
    // Then: independently known ZIP header and CRC for the bytes "hello".
    equal(view.getUint32(0, true), 0x04034b50);
    equal(view.getUint32(14, true), 0x3610a686);
    const nameLength = view.getUint16(26, true);
    equal(new TextDecoder().decode(zip.slice(30, 30 + nameLength)), 'drawable-night/example.xml');
    equal(new TextDecoder().decode(zip.slice(30 + nameLength, 35 + nameLength)), 'hello');
    equal(view.getUint32(zip.length - 22, true), 0x06054b50);
    equal(view.getUint16(zip.length - 12, true), 2);
  });

  await test('Bundled artwork renders and exports without the Android repository', async () => {
    // Given
    const models = [
      V.parseVector(window.VectorStudioDemo),
      V.parseVector(await (await fetch('fixtures/palette.svg')).text()),
    ];
    for (const model of models) {
      // When
      const mapping = Object.fromEntries(
        V.palette(model).map((p) => [p.key, V.suggest(p.key) || 'keep']),
      );
      const preview = V.render(model, mapping);
      // Then
      equal(preview.warnings, []);
      ok(preview.svg.querySelectorAll('path,rect').length > 5, 'Sample artwork did not render');
      equal(V.parseVector(V.exportXml(model, mapping)).uses.length, model.uses.length);
    }
  });

  await test('Editing one illustration leaves another illustration and its dark palette unchanged', async () => {
    // Given: two illustrations use the same source color.
    const frame = document.createElement('iframe');
    frame.src = 'index.html';
    const loaded = new Promise((resolve) => (frame.onload = resolve));
    document.body.append(frame);
    await loaded;
    const doc = frame.contentDocument;
    const el = (id) => doc.getElementById(id);
    const add = (name) => {
      el('paste-open').click();
      el('xml-name').value = name;
      el('xml-input').value = wrap(path('#123456'));
      el('paste-import').click();
    };
    add('first.xml');
    const firstColor = el('palette-list').querySelector(
      '.palette-row .color-cell:last-child .color-text',
    ).textContent;
    add('second.xml');

    // When: change the active illustration without changing the scope.
    el('target-hex').value = '#ABCDEF';
    el('target-hex').dispatchEvent(new frame.contentWindow.Event('input', { bubbles: true }));

    // Then: each illustration keeps its own preview and palette replacement.
    equal(
      el('palette-list').querySelector('.palette-row .color-cell:last-child .color-text')
        .textContent,
      '#ABCDEF',
    );
    el('asset-list').querySelectorAll('.asset')[0].click();
    equal(el('dark-preview').querySelector('path[data-node]').getAttribute('fill'), firstColor);
    equal(
      el('palette-list').querySelector('.palette-row .color-cell:last-child .color-text')
        .textContent,
      firstColor,
    );
    el('asset-list').querySelectorAll('.asset')[1].click();
    equal(el('dark-preview').querySelector('path[data-node]').getAttribute('fill'), '#ABCDEF');
    frame.remove();
  });

  await test('Editor imports XML, updates both previews, saves a profile, and restores it on reload', async () => {
    // Given: use the real UI and a fresh browser storage origin.
    const frame = document.createElement('iframe');
    frame.src = 'index.html';
    const loaded = new Promise((resolve) => (frame.onload = resolve));
    document.body.append(frame);
    await loaded;
    let doc = frame.contentDocument;
    const el = (id) => {
      const node = doc.getElementById(id);
      ok(node, `Editor control ${id} is missing`);
      return node;
    };
    const change = (id, value) => {
      const input = el(id);
      input.value = value;
      input.dispatchEvent(new frame.contentWindow.Event('change', { bubbles: true }));
    };
    const input = (id, value) => {
      const field = el(id);
      field.value = value;
      field.dispatchEvent(new frame.contentWindow.Event('input', { bubbles: true }));
    };
    // When: paste a real vector and edit a palette color.
    el('paste-open').click();
    el('xml-name').value = 'test_vector.xml';
    el('xml-input').value = wrap(path('#3f3d56') + path('#fff'));
    el('paste-import').click();
    // Then: original stays unchanged while dark preview updates.
    ok(el('asset-name').textContent.includes('test_vector.xml'), 'Imported asset not selected');
    equal(el('light-preview').querySelector('path[data-node]').getAttribute('fill'), '#3F3D56');
    change('edit-scope', 'palette');
    input('target-hex', '#A1B2C3');
    equal(el('dark-preview').querySelector('path[data-node]').getAttribute('fill'), '#A1B2C3');
    equal(el('light-preview').querySelector('path[data-node]').getAttribute('fill'), '#3F3D56');
    // When / Then: undo and redo change actual output, not only the input.
    el('undo').click();
    ok(
      el('dark-preview').querySelector('path[data-node]').getAttribute('fill') !== '#A1B2C3',
      'Undo did not restore the previous color',
    );
    el('redo').click();
    equal(el('dark-preview').querySelector('path[data-node]').getAttribute('fill'), '#A1B2C3');
    input('profile-name', 'Regression palette');
    el('save-profile').click();
    ok(el('status').textContent.includes('Saved'), 'Save did not succeed');
    // When: reload and import another illustration using the same palette.
    const reloaded = new Promise((resolve) => (frame.onload = resolve));
    frame.contentWindow.location.reload();
    await reloaded;
    doc = frame.contentDocument;
    equal(el('profile-name').value, 'Regression palette');
    el('paste-open').click();
    el('xml-input').value = wrap(path('#3F3D56'));
    el('paste-import').click();
    // Then: saved mapping is reused automatically.
    equal(el('dark-preview').querySelector('path[data-node]').getAttribute('fill'), '#A1B2C3');
    // When / Then: image overrides do not change the shared profile.
    change('edit-scope', 'image');
    input('target-hex', '#445566');
    equal(el('dark-preview').querySelector('path[data-node]').getAttribute('fill'), '#445566');
    // When / Then: exported profiles must not learn an image-only override.
    let downloaded;
    frame.contentWindow.HTMLAnchorElement.prototype.click = function () {}; // Capture downloads without writing test files into Downloads.
    const originalCreate = frame.contentWindow.URL.createObjectURL;
    frame.contentWindow.URL.createObjectURL = (blob) => {
      downloaded = blob;
      return originalCreate.call(frame.contentWindow.URL, blob);
    };
    el('export-profile').click();
    const profile = JSON.parse(await downloaded.text());
    equal(profile.mappings['#3F3D56'], '#A1B2C3');
    el('save-workspace').click();
    const workspace = JSON.parse(await downloaded.text());
    equal(workspace.assets.at(-1).overrides['#3F3D56'], '#445566');
    equal(workspace.profile.mappings['#3F3D56'], '#A1B2C3');
    el('show-xml').click();
    ok(el('export-xml').value.includes('#445566'), 'Export ignored image override');
    el('export-close').click();
    el('reset-color').click();
    equal(el('dark-preview').querySelector('path[data-node]').getAttribute('fill'), '#A1B2C3');
    // When / Then: rejected input leaves the existing vector intact.
    el('paste-open').click();
    el('xml-input').value = '<vector>broken';
    el('paste-import').click();
    ok(
      !el('paste-error').hidden && el('paste-error').textContent.length > 0,
      'Malformed XML silently accepted',
    );
    equal(el('dark-preview').querySelector('path[data-node]').getAttribute('fill'), '#A1B2C3');
    el('paste-close').click();
    // When: reopen the downloaded workspace using the actual file input handler.
    const transfer = new frame.contentWindow.DataTransfer();
    transfer.items.add(
      new frame.contentWindow.File([JSON.stringify(workspace)], 'workspace.json', {
        type: 'application/json',
      }),
    );
    el('json-file').files = transfer.files;
    el('json-file').dispatchEvent(new frame.contentWindow.Event('change', { bubbles: true }));
    await new Promise((resolve, reject) => {
      let attempts = 0;
      const check = () => {
        if (el('status').textContent.startsWith('Imported workspace.json')) resolve();
        else if (++attempts > 100)
          reject(new Error('Workspace import did not finish: ' + el('status').textContent));
        else setTimeout(check, 10);
      };
      check();
    });
    // Then: image overrides survive without changing the reusable profile.
    equal(el('dark-preview').querySelector('path[data-node]').getAttribute('fill'), '#445566');
    frame.remove();
  });

  const svgWrap = (body) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`;
  await test('SVG CSS colors share Android palette keys without reversing alpha', () => {
    // Given / When
    const model = V.parseVector(
      svgWrap(
        '<rect width="30" height="30" fill="#ff000080"/><circle cx="50" cy="50" r="20" fill="rgba(255,0,0,0.502)"/><path d="M0 0h10v10z" fill="red"/>',
      ),
    );
    // Then
    equal(model.format, 'svg');
    equal(
      V.palette(model).map((p) => [p.key, p.uses.length]),
      [
        ['#80FF0000', 2],
        ['#FF0000', 1],
      ],
    );
    const output = V.exportXml(model, { '#80FF0000': '#80445566' });
    const doc = new DOMParser().parseFromString(output, 'image/svg+xml');
    ok(
      doc.querySelector('rect').style.fill.includes('68, 85, 102'),
      'SVG replacement RGB is wrong',
    );
    equal(V.parseVector(output).uses[0].key, '#80445566');
  });
  await test('SVG CSS cascade, inherited/currentColor, and implicit black are editable per shape', () => {
    // Given
    const model = V.parseVector(
      svgWrap(
        '<style>.ink { fill: #3f3d56 !important; }</style><g color="hsl(0,100%,50%)"><rect class="ink" fill="blue" width="10" height="10"/><circle class="ink" r="5"/><path fill="currentColor" d="M0 0h5v5z"/></g><ellipse rx="4" ry="2"/>',
      ),
    );
    // When
    const output = V.exportXml(model, { '#3F3D56': '#A1B2C3' }, { [model.uses[0].id]: '#445566' });
    // Then
    equal(
      model.uses.map((u) => u.key),
      ['#3F3D56', '#3F3D56', '#FF0000', '#000000'],
    );
    equal(
      V.parseVector(output).uses.map((u) => u.key),
      ['#445566', '#A1B2C3', '#FF0000', '#000000'],
    );
    equal(V.parseVector(V.exportXml(model, { '#3F3D56': 'keep' })).uses[0].key, '#3F3D56');
  });
  await test('SVG gradients and clip references are isolated between previews; opacity is preserved', () => {
    // Given
    const model = V.parseVector(
      svgWrap(
        '<defs><linearGradient id="paint"><stop stop-color="#ff000080"/><stop offset="1" stop-color="blue"/></linearGradient><clipPath id="clip"><rect width="80" height="80"/></clipPath></defs><g opacity="0.4" transform="translate(2,3)"><rect width="100" height="100" fill="url(#paint)" clip-path="url(#clip)"/></g>',
      ),
    );
    // When
    const first = V.render(model, { '#80FF0000': '#80112233' }).svg;
    const second = V.render(model).svg;
    // Then
    ok(
      first.querySelector('linearGradient').id !== second.querySelector('linearGradient').id,
      'Preview IDs collide',
    );
    ok(
      first.querySelector('g rect').style.fill.includes(first.querySelector('linearGradient').id),
      'Gradient reference broken',
    );
    equal(first.querySelector('g').getAttribute('opacity'), '0.4');
    equal(first.querySelector('g').getAttribute('transform'), 'translate(2,3)');
    equal(V.parseVector(V.exportXml(model, { '#80FF0000': '#80112233' })).uses[0].key, '#80112233');
  });
  await test('SVG active content, external resources and stylesheet leakage are removed', () => {
    // Given
    const model = V.parseVector(
      svgWrap(
        '<style>body { color:red } rect {fill: red} @import url(https://invalid.example/a.css);</style><script>alert(1)</script><foreignObject/><image href="https://invalid.example/a.png"/><rect width="20" height="20" onclick="alert(1)" style="filter:url(https://invalid.example/filter)"/>',
      ),
    );
    // When
    const { svg, warnings } = V.render(model);
    const exported = V.exportXml(model);
    // Then
    equal(svg.querySelector('style,script,foreignObject,image'), null);
    ok(
      !exported.includes('onclick') && !exported.includes('https://invalid.example'),
      'Unsafe content survives export',
    );
    ok(warnings.length > 0, 'Sanitization was not reported');
    equal(svg.querySelector('rect').style.fill, 'rgb(255, 0, 0)');
  });
  await test('SVG masks retain their original paints when artwork colors are mapped', () => {
    // Given
    const model = V.parseVector(
      svgWrap(
        '<defs><mask id="cut"><rect width="100" height="100" fill="white"/></mask></defs><rect width="100" height="100" fill="white" mask="url(#cut)"/>',
      ),
    );
    // When / Then
    equal(V.palette(model)[0].uses.length, 1);
    const output = V.exportXml(model, { '#FFFFFF': '#222222' });
    const doc = new DOMParser().parseFromString(output, 'image/svg+xml');
    equal(doc.querySelector('mask rect').getAttribute('fill'), 'white');
    equal(doc.documentElement.lastElementChild.style.fill, 'rgb(34, 34, 34)');
  });
  await test('SVG mask paint servers outside the mask also retain their luminance colors', () => {
    // Given
    const model = V.parseVector(
      svgWrap(
        '<defs><linearGradient id="maskPaint"><stop stop-color="white"/><stop offset="1" stop-color="black"/></linearGradient><mask id="cut"><rect width="100" height="100" fill="url(#maskPaint)"/></mask></defs><rect width="100" height="100" fill="white" mask="url(#cut)"/>',
      ),
    );
    // When / Then
    equal(
      V.palette(model).map((p) => [p.key, p.uses.length]),
      [['#FFFFFF', 1]],
    );
    const doc = new DOMParser().parseFromString(
      V.exportXml(model, { '#FFFFFF': '#222222' }),
      'image/svg+xml',
    );
    equal(doc.querySelector('stop').getAttribute('stop-color'), 'white');
  });
  await test('SVG gradient selection follows inherited paint servers to affected shapes', () => {
    // Given
    const model = V.parseVector(
      svgWrap(
        '<defs><linearGradient id="base"><stop stop-color="red"/></linearGradient><linearGradient id="derived" href="#base"/></defs><rect width="50" height="50" fill="url(#derived)"/><circle r="10" fill="blue"/>',
      ),
    );
    // When / Then
    const stop = model.uses.find((u) => u.key === '#FF0000');
    equal(
      V.svgNodesForUse(model, stop).map((i) => model.nodes[i].localName),
      ['rect'],
    );
  });

  await test('Editor imports SVG files, shares the Android palette, and exports mixed collections and workspaces', async () => {
    // Given: the previous editor test saved #3F3D56 → #A1B2C3.
    const frame = document.createElement('iframe');
    frame.src = 'index.html';
    const loaded = new Promise((resolve) => (frame.onload = resolve));
    document.body.append(frame);
    await loaded;
    const doc = frame.contentDocument,
      win = frame.contentWindow;
    const el = (id) => doc.getElementById(id);
    const input = (id, value) => {
      el(id).value = value;
      el(id).dispatchEvent(new win.Event('input', { bubbles: true }));
    };
    const waitFor = async (condition) => {
      for (let i = 0; i < 500; i++) {
        if (condition()) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error('Editor did not finish: ' + el('status').textContent);
    };
    // When: import SVG and Android XML together using the real file handler.
    const transfer = new win.DataTransfer();
    transfer.items.add(
      new win.File(
        [
          svgWrap(
            '<rect width="100" height="100" fill="#3f3d56"/><circle cx="50" cy="50" r="20" fill="#ff000080"/>',
          ),
        ],
        'artwork.svg',
        { type: 'image/svg+xml' },
      ),
    );
    transfer.items.add(
      new win.File([wrap(path('#3f3d56'))], 'android.xml', { type: 'application/xml' }),
    );
    el('vector-files').files = transfer.files;
    el('vector-files').dispatchEvent(new win.Event('change', { bubbles: true }));
    await waitFor(() => el('asset-count').textContent === '2');
    // Then: SVG filename, correct export label, and existing shared profile are retained.
    equal(el('asset-name').textContent, 'artwork.svg');
    equal(el('export-current').textContent, 'Export SVG ↓');
    equal(el('target-hex').value, '#A1B2C3');
    equal(el('dark-preview').querySelector('rect').style.fill, 'rgb(161, 178, 195)');
    // When / Then: SVG input interprets alpha-last but saves canonical ARGB.
    doc.querySelector('[aria-label="Edit #FF000080"]').click();
    el('edit-scope').value = 'palette';
    el('edit-scope').dispatchEvent(new win.Event('change'));
    input('target-hex', '#11223380');
    let download;
    win.HTMLAnchorElement.prototype.click = function () {};
    const createUrl = win.URL.createObjectURL;
    win.URL.createObjectURL = (blob) => {
      download = blob;
      return createUrl.call(win.URL, blob);
    };
    el('export-current').click();
    equal(download.type, 'image/svg+xml');
    equal(V.parseVector(await download.text()).uses[1].key, '#80112233');
    el('export-profile').click();
    equal(JSON.parse(await download.text()).mappings['#80FF0000'], '#80112233');
    // When / Then: ZIP folders preserve each format.
    el('export-all').click();
    const archive = new TextDecoder().decode(await download.arrayBuffer());
    ok(
      archive.includes('svg-dark/artwork.svg') && archive.includes('drawable-night/android.xml'),
      'Mixed export lost format-specific filenames',
    );
    // When / Then: selected-use overrides, SVGs, and Android XML survive workspace import.
    el('edit-scope').value = 'shape';
    el('edit-scope').dispatchEvent(new win.Event('change'));
    input('target-hex', '#ABCDEF80');
    el('save-workspace').click();
    const workspace = JSON.parse(await download.text());
    equal(workspace.assets[0].uses[Object.keys(workspace.assets[0].uses)[0]], '#80ABCDEF');
    const json = new win.DataTransfer();
    json.items.add(new win.File([JSON.stringify(workspace)], 'mixed.json'));
    el('json-file').files = json.files;
    el('json-file').dispatchEvent(new win.Event('change'));
    await waitFor(() => el('status').textContent.startsWith('Imported mixed.json'));
    equal(el('asset-name').textContent, 'artwork.svg');
    doc.querySelector('[aria-label="Edit #FF000080"]').click();
    equal(el('target-hex').value, '#ABCDEF80');
    // When / Then: SVG shapes support selection highlighting too.
    el('highlight').checked = true;
    el('highlight').dispatchEvent(new win.Event('change'));
    ok(
      Number(el('dark-preview').querySelector('rect').style.opacity) < 1,
      'Unselected SVG shape was not dimmed',
    );
    frame.remove();
  });

  await test('Generated tints and shades match the reference ten-step palette', () => {
    // Given / When
    const ramps = V.tintsAndShades('#2F2E41');
    // Then: independently transcribed from the supplied reference screenshot.
    equal(ramps.shades, [
      '#2F2E41',
      '#2A293B',
      '#262534',
      '#21202E',
      '#1C1C27',
      '#181721',
      '#13121A',
      '#0E0E14',
      '#09090D',
      '#050507',
    ]);
    equal(ramps.tints, [
      '#2F2E41',
      '#444354',
      '#595867',
      '#6D6D7A',
      '#82828D',
      '#9797A0',
      '#ACABB3',
      '#C1C0C6',
      '#D5D5D9',
      '#EAEAEC',
    ]);
    equal(V.tintsAndShades('#802F2E41').tints[5], '#809797A0');
    equal(V.tintsAndShades('#002F2E41').shades[5], '#00181721');
    equal(V.tintsAndShades('@color/unresolved'), null);
  });
  await test('Tint and shade buttons use the original color, honor scope, and update export with undo', async () => {
    // Given
    const frame = document.createElement('iframe');
    frame.src = 'index.html';
    const loaded = new Promise((resolve) => (frame.onload = resolve));
    document.body.append(frame);
    await loaded;
    const doc = frame.contentDocument,
      win = frame.contentWindow;
    const el = (id) => doc.getElementById(id);
    el('paste-open').click();
    el('xml-input').value = wrap(path('#2F2E41') + path('#2F2E41'));
    el('paste-import').click();
    // When: apply a tint only to the selected use.
    el('edit-scope').value = 'shape';
    el('edit-scope').dispatchEvent(new win.Event('change'));
    const ramp = el('tone-ramps');
    ok(ramp, 'Generated palette is missing');
    equal(ramp.querySelectorAll('button').length, 20);
    ramp.querySelector('[aria-label="Tint 50% #9797A0"]').click();
    // Then: preview and exported XML change only one shape, and the original ramp stays stable.
    equal(el('target-hex').value, '#9797A0');
    const paths = el('dark-preview').querySelectorAll('path[data-node]');
    equal(paths[0].getAttribute('fill'), '#9797A0');
    ok(paths[1].getAttribute('fill') !== '#9797A0', 'Selected-use edit changed another shape');
    ok(
      el('tone-ramps').querySelector('[aria-label="Shade 10% #2A293B"]'),
      'Ramp drifted to replacement color',
    );
    el('show-xml').click();
    equal(V.parseVector(el('export-xml').value).uses[0].raw, '#9797A0');
    el('export-close').click();
    el('undo').click();
    ok(el('target-hex').value !== '#9797A0', 'Undo did not restore previous mapping');
    // When / Then: SVG uses RGBA in labels and preserves alpha in export.
    el('paste-open').click();
    el('xml-input').value = svgWrap('<rect width="100" height="100" fill="#2f2e4180"/>');
    el('paste-import').click();
    el('tone-ramps').querySelector('[aria-label="Tint 50% #9797A080"]').click();
    equal(el('target-hex').value, '#9797A080');
    el('show-xml').click();
    equal(V.parseVector(el('export-xml').value).uses[0].key, '#809797A0');
    el('export-close').click();
    // When / Then: unresolved resources provide guidance instead of made-up colors.
    el('paste-open').click();
    el('xml-input').value = wrap(path('@color/missing'));
    el('paste-import').click();
    equal(el('tone-ramps').querySelectorAll('button').length, 0);
    ok(el('tone-ramps').textContent.includes('colors.xml'), 'Missing resource guidance');
    frame.remove();
  });

  await test('Five and twenty step ramps retain the reference intervals and alpha', () => {
    // Given / When
    const five = V.tintsAndShades('#802F2E41', 5);
    const twenty = V.tintsAndShades('#802F2E41', 20);
    // Then
    equal(five.tints.length, 5);
    equal(five.shades.length, 5);
    equal(five.tints[4], '#80D5D5D9');
    equal(twenty.tints.length, 20);
    equal(twenty.shades.length, 20);
    equal(twenty.tints[1], '#8039384B');
    equal(twenty.tints[19], '#80F5F5F6');
    equal(twenty.shades[19], '#80020203');
  });
  await test('Ramp count selector updates both lists without changing the replacement', async () => {
    // Given
    const frame = document.createElement('iframe');
    frame.src = 'index.html';
    const loaded = new Promise((resolve) => (frame.onload = resolve));
    document.body.append(frame);
    await loaded;
    const doc = frame.contentDocument,
      el = (id) => doc.getElementById(id);
    const original = el('target-hex').value;
    // When / Then
    for (const count of [5, 20, 10]) {
      el('tone-steps').querySelector(`[data-steps="${count}"]`).click();
      equal(el('tone-ramps').querySelectorAll('button').length, count * 2);
      equal(el('tone-steps').querySelector('[aria-pressed="true"]').textContent, String(count));
      equal(el('target-hex').value, original);
      equal(
        el('tone-ramps').querySelector('.tone-grid').lastChild.querySelector('.tone-step')
          .textContent,
        100 - 100 / count + '%',
      );
    }
    // When / Then: selecting a color retains the chosen count.
    el('tone-steps').querySelector('[data-steps="20"]').click();
    el('tone-ramps').querySelectorAll('button')[1].click();
    equal(el('tone-ramps').querySelectorAll('button').length, 40);
    frame.remove();
  });
  await test('Vector selections reveal clipped palette rows without moving visible rows or the page', async () => {
    // Given: more colors than fit in the palette viewport.
    const frame = document.createElement('iframe');
    frame.src = 'index.html';
    frame.style.cssText = 'width:1200px;height:800px';
    const loaded = new Promise((resolve) => (frame.onload = resolve));
    document.body.append(frame);
    await loaded;
    const doc = frame.contentDocument,
      win = frame.contentWindow,
      el = (id) => doc.getElementById(id);
    el('paste-open').click();
    el('xml-input').value = wrap(
      Array.from({ length: 20 }, (_, i) => path('#' + (0x302040 + i * 256).toString(16))).join(''),
    );
    el('paste-import').click();
    const list = el('palette-list');
    const selectPath = (index) =>
      el('light-preview')
        .querySelectorAll('path[data-node]')
        [index].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    const visible = () => {
      const row = list.querySelector('.active').getBoundingClientRect(),
        box = list.getBoundingClientRect();
      return row.top >= box.top - 1 && row.bottom <= box.top + list.clientHeight + 1;
    };
    const pageScroll = win.scrollY;
    // When / Then: an offscreen last color is revealed.
    selectPath(19);
    ok(visible(), 'Selected bottom row is clipped');
    ok(list.scrollTop > 0, 'Palette did not scroll down');
    equal(win.scrollY, pageScroll);
    // When / Then: an already visible row does not move the palette.
    const previous = list.scrollTop;
    selectPath(19);
    equal(list.scrollTop, previous);
    // When / Then: selection above the viewport scrolls back up.
    selectPath(0);
    ok(visible(), 'Selected top row is clipped');
    equal(win.scrollY, pageScroll);
    frame.remove();
  });

  await test('Nested SVG text keeps the clicked span color selected', async () => {
    // Given
    const frame = document.createElement('iframe');
    frame.src = 'index.html';
    const loaded = new Promise((resolve) => (frame.onload = resolve));
    document.body.append(frame);
    await loaded;
    const doc = frame.contentDocument,
      win = frame.contentWindow,
      el = (id) => doc.getElementById(id);
    el('paste-open').click();
    el('xml-input').value = svgWrap(
      '<text x="0" y="20" fill="red">Parent <tspan fill="blue">Child</tspan></text>',
    );
    el('paste-import').click();
    // When
    el('light-preview')
      .querySelector('tspan')
      .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    // Then
    ok(
      el('selected-source').textContent.startsWith('#0000FF'),
      'Bubbling selected the parent color',
    );
    frame.remove();
  });
  await test('Saving a profile does not clear the unsaved artwork warning', async () => {
    // Given
    const frame = document.createElement('iframe');
    frame.src = 'index.html';
    const loaded = new Promise((resolve) => (frame.onload = resolve));
    document.body.append(frame);
    await loaded;
    const doc = frame.contentDocument,
      win = frame.contentWindow,
      el = (id) => doc.getElementById(id);
    const blocked = () => {
      const event = new win.Event('beforeunload', { cancelable: true });
      win.dispatchEvent(event);
      return event.defaultPrevented;
    };
    equal(blocked(), false);
    // When
    el('paste-open').click();
    el('xml-input').value = wrap(path('#123456'));
    el('paste-import').click();
    el('save-profile').click();
    // Then
    equal(blocked(), true);
    ok(el('workspace-state').textContent.includes('Unsaved'), 'Missing workspace status');
    // When / Then
    win.HTMLAnchorElement.prototype.click = () => {};
    el('save-workspace').click();
    equal(blocked(), false);
    el('keep-original').click();
    equal(blocked(), true);
    frame.remove();
  });

  await test('Public mobile layout keeps help links accessible without horizontal overflow', async () => {
    // Given
    const frame = document.createElement('iframe');
    frame.src = 'index.html';
    frame.style.cssText = 'width:390px;height:844px';
    const loaded = new Promise((resolve) => (frame.onload = resolve));
    document.body.append(frame);
    await loaded;
    const doc = frame.contentDocument,
      win = frame.contentWindow;
    // When / Then
    ok(
      doc.documentElement.scrollWidth <= doc.documentElement.clientWidth,
      'Editor overflows mobile width',
    );
    const links = doc.querySelector('.footer-links');
    ok(
      links && win.getComputedStyle(links).display !== 'none',
      'Public help links are hidden on mobile',
    );
    equal(links.querySelector('a[href="privacy.html"]').textContent, 'Privacy & local data');
    equal(doc.querySelector('.skip-link').getAttribute('href'), '#editor');
    frame.remove();
  });

  await test('Oversized collections are rejected without replacing the current artwork', async () => {
    // Given
    const frame = document.createElement('iframe');
    frame.src = 'index.html';
    const loaded = new Promise((resolve) => (frame.onload = resolve));
    document.body.append(frame);
    await loaded;
    const doc = frame.contentDocument,
      win = frame.contentWindow,
      el = (id) => doc.getElementById(id);
    const original = el('asset-name').textContent;
    const files = Array.from(
      { length: 101 },
      (_, i) => new win.File([wrap(path('#123456'))], `item-${i}.xml`),
    );
    // When
    await el('vector-files').onchange({ target: { files, value: 'test' } });
    // Then
    equal(el('asset-name').textContent, original);
    equal(el('asset-count').textContent, '1');
    ok(el('status').textContent.includes('100 illustrations'), 'Missing collection limit message');
    frame.remove();
  });

  await test('Micro interactions confirm selection, imports, history, scope and clipboard outcomes', async () => {
    const frame = document.createElement('iframe');
    frame.src = 'index.html';
    const loaded = new Promise((resolve) => (frame.onload = resolve));
    document.body.append(frame);
    await loaded;
    const doc = frame.contentDocument,
      win = frame.contentWindow;
    const el = (id) => doc.getElementById(id);
    try {
      await el('vector-files').onchange({
        target: {
          files: [
            new win.File([wrap(path('#123456'))], 'one.xml'),
            new win.File([wrap(path('#123456'))], 'two.xml'),
          ],
          value: '',
        },
      });
      equal(doc.querySelectorAll('.asset.feedback-flash').length, 2);
      el('light-preview')
        .querySelector('[data-node]')
        .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      ok(el('palette-list').querySelector('.active.feedback-flash'), 'Missing selection feedback');
      el('tone-ramps').querySelectorAll('button')[1].click();
      const selected = el('tone-ramps').querySelector('[aria-pressed="true"] .tone-check');
      ok(
        selected && win.getComputedStyle(selected).display !== 'none',
        'Missing selected tone check',
      );
      el('edit-scope').value = 'palette';
      el('edit-scope').dispatchEvent(new win.Event('change'));
      ok(
        el('scope-impact').textContent.startsWith('Affects 1 illustration.'),
        'Scope includes overridden illustration',
      );
      el('undo').click();
      ok(el('palette-list').querySelector('.feedback-flash'), 'Undo did not mark changed color');
      ok(el('status').textContent.includes('Undo complete'), 'Missing undo announcement');
      ok(
        el('scope-impact').textContent.startsWith('Affects 2 illustrations.'),
        'Scope count did not refresh',
      );
      el('redo').click();
      ok(el('palette-list').querySelector('.feedback-flash'), 'Redo did not mark changed color');
      ok(el('status').textContent.includes('Redo complete'), 'Missing redo announcement');
      const transfer = new win.DataTransfer();
      transfer.items.add(new win.File(['test'], 'test.xml'));
      doc.dispatchEvent(new win.DragEvent('dragenter', { dataTransfer: transfer }));
      equal(el('drop-overlay').hidden, false);
      doc.dispatchEvent(new win.DragEvent('dragleave', { dataTransfer: transfer }));
      equal(el('drop-overlay').hidden, true);
      let copied;
      Object.defineProperty(win.navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (value) => {
            copied = value;
          },
        },
      });
      el('show-xml').click();
      await el('copy-xml').onclick();
      equal(copied, el('export-xml').value);
      equal(el('copy-xml').textContent, 'Copied ✓');
      await new Promise((resolve) => win.setTimeout(resolve, 1600));
      equal(el('copy-xml').textContent, 'Copy XML');
      win.navigator.clipboard.writeText = async () => {
        throw new Error('Denied');
      };
      await el('copy-xml').onclick();
      equal(el('copy-xml').textContent, 'Copy XML');
      equal(el('copy-xml').disabled, false);
      ok(el('status').textContent.includes('Ctrl+C'), 'Copy failure lost manual fallback');
      equal(doc.querySelectorAll('.feedback-flash').length, 0);
    } finally {
      frame.remove();
    }
  });

  await test('Removal preserves selection, drops exports, resets history and supports an empty workspace', async () => {
    const frame = document.createElement('iframe');
    frame.src = 'index.html';
    const loaded = new Promise((resolve) => (frame.onload = resolve));
    document.body.append(frame);
    await loaded;
    const doc = frame.contentDocument,
      win = frame.contentWindow;
    const el = (id) => doc.getElementById(id);
    const remove = (index) => el('asset-list').querySelectorAll('.asset-remove')[index].click();
    try {
      await el('vector-files').onchange({
        target: {
          files: ['one', 'two', 'three'].map(
            (name) => new win.File([wrap(path('#123456'))], name + '.xml'),
          ),
          value: '',
        },
      });
      el('asset-list').querySelectorAll('.asset')[1].click();
      el('keep-original').click();
      remove(0);
      equal(el('asset-name').textContent, 'two.xml');
      equal(el('asset-count').textContent, '2');
      equal(el('undo').disabled, true);
      equal(el('redo').disabled, true);
      equal(doc.activeElement.getAttribute('aria-label'), 'Remove two.xml');
      let workspace;
      win.URL.createObjectURL = (blob) => {
        workspace = blob;
        return 'blob:test';
      };
      win.HTMLAnchorElement.prototype.click = () => {};
      el('save-workspace').click();
      equal(
        JSON.parse(await workspace.text()).assets.map((asset) => asset.name),
        ['two.xml', 'three.xml'],
      );
      remove(1);
      equal(el('asset-name').textContent, 'two.xml');
      remove(0);
      equal(el('asset-count').textContent, '0');
      equal(el('color-editor').hidden, true);
      equal(doc.activeElement, el('import-vectors'));
      for (const id of ['export-current', 'export-all', 'show-xml', 'save-workspace'])
        equal(el(id).disabled, true);
      el('dark-background').value = '#112233';
      el('dark-background').dispatchEvent(new win.Event('input'));
      el('undo').click();
      equal(el('dark-background').value, '#191b24');
      el('load-demo').click();
      equal(el('asset-count').textContent, '1');
      equal(el('export-current').disabled, false);
    } finally {
      frame.remove();
    }
  });

  await test('Narrow layouts show the whole palette and a visible profile name input', async () => {
    const frame = document.createElement('iframe');
    frame.src = 'index.html';
    frame.style.cssText = 'width:777px;height:925px';
    const loaded = new Promise((resolve) => (frame.onload = resolve));
    document.body.append(frame);
    await loaded;
    const doc = frame.contentDocument,
      win = frame.contentWindow;
    const el = (id) => doc.getElementById(id);
    try {
      const artwork = wrap(
        Array.from({ length: 30 }, (_, index) => path('#' + (0x123400 + index).toString(16))).join(
          '',
        ),
      );
      await el('vector-files').onchange({
        target: { files: [new win.File([artwork], 'many.xml')], value: '' },
      });
      for (const width of [777, 390]) {
        frame.style.width = width + 'px';
        const list = el('palette-list');
        equal(win.getComputedStyle(list).maxHeight, 'none');
        ok(list.scrollHeight <= list.clientHeight + 1, 'Palette has an inner scrollbar');
        ok(
          doc.documentElement.scrollWidth <= doc.documentElement.clientWidth,
          'Narrow layout overflows',
        );
        const input = win.getComputedStyle(el('profile-name'));
        ok(parseFloat(input.borderTopWidth) > 0, 'Profile name lacks input border');
        ok(parseFloat(input.paddingLeft) > 0, 'Profile name lacks input padding');
      }
      frame.style.width = '1200px';
      ok(
        win.getComputedStyle(el('palette-list')).maxHeight !== 'none',
        'Desktop cap unexpectedly removed',
      );
    } finally {
      frame.remove();
    }
  });

  await test('Background animation respects pause control and motion preference', async () => {
    const frame = document.createElement('iframe');
    frame.src = 'index.html';
    const loaded = new Promise((resolve) => (frame.onload = resolve));
    document.body.append(frame);
    await loaded;
    try {
      const doc = frame.contentDocument,
        win = frame.contentWindow;
      const background = doc.querySelector('.ambient-background');
      const style = () => win.getComputedStyle(background, '::before');
      if (background.querySelector('canvas'))
        ok(
          background.classList.contains('canvas-ready'),
          'Canvas shader failed to compile or link',
        );
      if (win.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        equal(style().animationName, 'none');
      } else {
        equal(style().animationName, 'none');
        equal(win.getComputedStyle(background, '::after').animationName, 'ambient-grain');
        if (background.classList.contains('canvas-ready'))
          equal(background.dataset.running, 'true');
        doc.getElementById('background-motion').click();
        if (background.classList.contains('canvas-ready'))
          equal(background.dataset.running, 'false');
        equal(win.getComputedStyle(background, '::after').animationPlayState, 'paused');
        doc.getElementById('background-motion').click();
        if (background.classList.contains('canvas-ready'))
          equal(background.dataset.running, 'true');
      }
      equal(win.getComputedStyle(background).pointerEvents, 'none');
      equal(win.getComputedStyle(background).position, 'absolute');
      const top = background.getBoundingClientRect().top;
      win.scrollTo(0, 150);
      ok(win.scrollY > 0, 'Page did not scroll');
      equal(Math.round(background.getBoundingClientRect().top + win.scrollY), Math.round(top));
    } finally {
      frame.remove();
    }
  });

  const failures = results.filter((r) => r.startsWith('FAIL')).length;
  document.querySelector('#results').textContent =
    results.join('\n') + `\n${results.length - failures}/${results.length} passed`;
  document.body.dataset.testStatus = failures ? 'failed' : 'passed';
})();
