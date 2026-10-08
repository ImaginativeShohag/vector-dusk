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
      document.querySelectorAll('iframe').forEach((frame) => frame.remove());
      await clearRecovery();
      await fn();
      results.push(`PASS ${name}`);
    } catch (error) {
      results.push(`FAIL ${name}: ${error.message}`);
    }
    document.querySelector('#results').textContent =
      results.join('\n') + '\nRunning remaining checks…';
  }
  const recoveryDatabase = 'vector-dusk.recovery.v1';
  function clearRecovery() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(recoveryDatabase);
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
  }
  async function until(check, message) {
    const deadline = Date.now() + 5000;
    while (!(await check())) {
      if (Date.now() >= deadline) throw new Error(message);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  async function editorReady(frame) {
    await until(
      () => !frame.contentDocument.querySelector('[aria-busy="true"]'),
      'Workspace recovery did not finish',
    );
  }
  async function recoveryRecord(value) {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(recoveryDatabase, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('workspaces');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('workspaces', value === undefined ? 'readonly' : 'readwrite');
        const store = tx.objectStore('workspaces');
        const request = value === undefined ? store.get('current') : store.put(value, 'current');
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }
  async function reloadEditor(frame) {
    const loaded = new Promise((resolve) => (frame.onload = resolve));
    frame.contentWindow.location.reload();
    await loaded;
    await editorReady(frame);
    const doc = frame.contentDocument,
      win = frame.contentWindow;
    return { frame, doc, win, el: (id) => doc.getElementById(id) };
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

  await test('Edits reach every illustration by default; the separate switch isolates one illustration', async () => {
    // Given: two illustrations use the same source color.
    const frame = document.createElement('iframe');
    frame.src = 'index.html';
    const loaded = new Promise((resolve) => (frame.onload = resolve));
    document.body.append(frame);
    await loaded;
    await editorReady(frame);
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
    const type = (value) => {
      el('target-hex').value = value;
      el('target-hex').dispatchEvent(new frame.contentWindow.Event('input', { bubbles: true }));
      el('target-hex').dispatchEvent(new frame.contentWindow.Event('change', { bubbles: true }));
    };
    equal(el('scope-palette').checked, true);
    equal(el('scope-shape-option').hidden, true, 'Single-use color offers the clicked shape');

    // When: edit with the default scope. Then: both illustrations share the replacement.
    type('#556677');
    el('asset-list').querySelectorAll('.asset')[0].click();
    equal(el('dark-preview').querySelector('path[data-node]').getAttribute('fill'), '#556677');
    el('undo').click();
    el('asset-list').querySelectorAll('.asset')[1].click();

    // When: switch the second illustration to separate editing and change it.
    el('scope-image').click();
    ok(el('scope-impact').textContent.includes('this illustration only'), 'Scope text unchanged');
    type('#ABCDEF');

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
    equal(el('scope-image').checked, false, 'Separate scope is per illustration');
    el('asset-list').querySelectorAll('.asset')[1].click();
    equal(el('dark-preview').querySelector('path[data-node]').getAttribute('fill'), '#ABCDEF');
    equal(el('scope-image').checked, true);
    // When: turn separation off. Then: earlier edits stay until the toast action drops them.
    el('scope-palette').click();
    equal(el('dark-preview').querySelector('path[data-node]').getAttribute('fill'), '#ABCDEF');
    equal(el('toast-action').textContent, 'Use palette colors');
    el('toast-action').click();
    equal(el('dark-preview').querySelector('path[data-node]').getAttribute('fill'), firstColor);
    el('undo').click();
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
    await editorReady(frame);
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
    await editorReady(frame);
    doc = frame.contentDocument;
    equal(el('profile-name').value, 'Regression palette');
    el('paste-open').click();
    el('xml-input').value = wrap(path('#3F3D56'));
    el('paste-import').click();
    // Then: saved mapping is reused automatically.
    equal(el('dark-preview').querySelector('path[data-node]').getAttribute('fill'), '#A1B2C3');
    // When / Then: image overrides do not change the shared profile.
    el('scope-image').click();
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
    const pasteCallout = el('paste-dialog').querySelector('.field-callout');
    ok(pasteCallout?.textContent.length > 1, 'Malformed XML silently accepted');
    equal(el('xml-input').getAttribute('aria-invalid'), 'true');
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
    // Then: image overrides survive on the edited illustration without changing the reusable profile.
    el('asset-list')
      .querySelectorAll('.asset')
      .item(workspace.assets.length - 1)
      .click();
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
    await editorReady(frame);
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
            '<rect width="100" height="100" fill="#3f3d56"/><circle cx="50" cy="50" r="20" fill="#ff000080"/><circle cx="20" cy="20" r="5" fill="#ff000080"/>',
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
    el('scope-shape').click();
    input('target-hex', '#ABCDEF80');
    equal(el('status').textContent, 'Click a shape in the artwork to choose it.');
    el('dark-preview')
      .querySelector('circle')
      .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    ok(el('scope-impact').textContent.startsWith('Affects only the clicked shape'), 'No pick');
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
    await editorReady(frame);
    const doc = frame.contentDocument,
      win = frame.contentWindow;
    const el = (id) => doc.getElementById(id);
    el('paste-open').click();
    el('xml-input').value = wrap(path('#2F2E41') + path('#2F2E41'));
    el('paste-import').click();
    // When: apply a tint only to the clicked shape.
    el('dark-preview')
      .querySelector('path[data-node]')
      .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    el('scope-shape').click();
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
    await editorReady(frame);
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
    await editorReady(frame);
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
    await editorReady(frame);
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
    await editorReady(frame);
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
    ok(el('workspace-state').textContent.includes('not downloaded'), 'Missing workspace status');
    // When / Then
    win.HTMLAnchorElement.prototype.click = () => {};
    el('save-workspace').click();
    await until(
      () => el('recovery-state').textContent.startsWith('Local recovery saved'),
      'Local save did not settle',
    );
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
    await editorReady(frame);
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
    await editorReady(frame);
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
    await editorReady(frame);
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
      el('scope-image').click();
      el('tone-ramps').querySelectorAll('button')[1].click();
      const selected = el('tone-ramps').querySelector('[aria-pressed="true"] .tone-check');
      ok(
        selected && win.getComputedStyle(selected).display !== 'none',
        'Missing selected tone check',
      );
      el('scope-palette').click();
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

  await test('Micro interactions animate editor chrome without animating artwork', async () => {
    const frame = document.createElement('iframe');
    frame.src = 'index.html';
    const loaded = new Promise((resolve) => (frame.onload = resolve));
    document.body.append(frame);
    await loaded;
    await editorReady(frame);
    const doc = frame.contentDocument,
      win = frame.contentWindow;
    const el = (id) => doc.getElementById(id);
    const has = (node, className) =>
      ok(node?.classList.contains(className), `Missing ${className}`);
    const motion = !win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fire = (id, type) => el(id).dispatchEvent(new win.Event(type));
    try {
      // Given: three imports enter in sequence and the counter rolls.
      await el('vector-files').onchange({
        target: {
          files: ['one', 'two', 'three'].map(
            (name) => new win.File([wrap(path('#123456'))], name + '.xml'),
          ),
          value: '',
        },
      });
      equal(doc.querySelectorAll('.asset-card.entering').length, 3);
      has(el('asset-count'), 'count-roll');
      has(el('toast'), 'open');
      // When: a replacement is typed. Then: only the palette swatch blends.
      el('scope-image').click();
      el('target-hex').value = '#A1B2C3';
      fire('target-hex', 'input');
      const target = el('palette-list').querySelector(
        '.active .color-cell:last-child .swatch > span',
      );
      equal(target.getAnimations().length > 0, motion);
      const artwork = el('dark-preview').querySelector('[data-node]');
      equal(artwork.getAttribute('fill'), '#A1B2C3');
      equal(artwork.getAnimations().length, 0);
      // Invalid hex shakes on commit only.
      el('target-hex').value = '#zz';
      fire('target-hex', 'input');
      ok(!el('target-hex').classList.contains('shake'), 'Shook while typing');
      fire('target-hex', 'change');
      has(el('target-hex'), 'shake');
      el('undo').click();
      has(el('undo'), 'nudge-back');
      el('redo').click();
      has(el('redo'), 'nudge-forward');
      // Scope changes mark exactly the illustrations the next edit would change.
      el('scope-palette').click();
      has(el('scope-impact'), 'status-in');
      ok(el('scope-impact').textContent.startsWith('Affects 2 illustrations.'), 'Wrong impact');
      equal(el('asset-list').querySelectorAll('.asset.feedback-flash').length, 2);
      // The active illustration has an override, so test its pick cue at illustration scope.
      el('scope-image').click();
      el('tone-ramps').querySelectorAll('button')[2].click();
      ok(el('tone-ramps').querySelector('.tone-button.picked[aria-pressed="true"]'), 'No pick cue');
      const pill = win.getComputedStyle(el('tone-steps'), '::before');
      ok(pill.content !== 'none', 'Missing tone step pill');
      if (motion) ok(pill.transitionProperty.includes('transform'), 'Pill does not slide');
      el('highlight').checked = false;
      fire('highlight', 'change');
      el('highlight').checked = true;
      fire('highlight', 'change');
      has(el('dark-preview'), 'highlight-enter');
      // Save and export confirm without shifting labels.
      el('save-profile').click();
      equal(el('save-profile').textContent, 'Saved ✓');
      ok(el('save-profile').style.minWidth, 'Save label can shift neighbours');
      has(el('profile-state'), 'saved-pop');
      win.URL.createObjectURL = () => 'blob:test';
      win.HTMLAnchorElement.prototype.click = () => {};
      el('export-current').click();
      has(el('export-current').querySelector('.arrow'), 'dip');
      equal(el('export-current').textContent, 'Export XML ↓');
      if (motion)
        ok(
          win.getComputedStyle(el('paste-dialog')).transitionProperty.includes('opacity'),
          'Dialog does not fade',
        );
      // Removing a card glides the remaining cards into place.
      el('asset-list').querySelector('.asset-remove').click();
      equal(el('asset-list').querySelector('.asset-card').getAnimations().length > 0, motion);
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
    await editorReady(frame);
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
      await new Promise((resolve) => win.requestAnimationFrame(resolve));
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
    await editorReady(frame);
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

  await test('Messages float in view: control errors point at the control, others use the toast', async () => {
    // Given: a long editor scrolled to the top, far from the profile name and export bar.
    const frame = document.createElement('iframe');
    frame.src = 'index.html';
    frame.style.cssText = 'width: 1200px; height: 600px';
    const loaded = new Promise((resolve) => (frame.onload = resolve));
    document.body.append(frame);
    await loaded;
    await editorReady(frame);
    const doc = frame.contentDocument,
      win = frame.contentWindow;
    const el = (id) => doc.getElementById(id);
    const input = (id, value) => {
      el(id).value = value;
      el(id).dispatchEvent(new win.Event('input', { bubbles: true }));
    };
    const callout = () => doc.querySelector('.field-callout');
    win.HTMLAnchorElement.prototype.click = function () {}; // Keep exports out of Downloads.
    try {
      // When: Export all runs without a profile name.
      input('profile-name', '  ');
      el('export-all').click();
      await new Promise((resolve) => win.setTimeout(resolve, 0));
      // Then: the callout points at the field in the top layer, not at the footer.
      ok(callout()?.matches(':popover-open'), 'Missing profile name callout');
      ok(callout().textContent.includes('profile name'), 'Callout does not name the field');
      equal(el('profile-name').getAttribute('aria-invalid'), 'true');
      equal(el('profile-name').getAttribute('aria-describedby'), 'field-callout-message');
      equal(doc.activeElement, el('profile-name'));
      ok(!el('toast').classList.contains('open'), 'Field error also opened the toast');
      await new Promise((resolve) => win.setTimeout(resolve, 800)); // Let smooth scrolling settle.
      const field = el('profile-name').getBoundingClientRect();
      const box = callout().getBoundingClientRect();
      ok(
        Math.abs(box.top - field.bottom - 10) < 2,
        `Callout is not attached to the field: ${box.top} vs ${field.bottom}`,
      );
      // When: the user types a name. Then: the callout and invalid state clear.
      input('profile-name', 'Night');
      equal(callout(), null);
      equal(el('profile-name').hasAttribute('aria-invalid'), false);
      equal(el('profile-name').hasAttribute('aria-describedby'), false);
      // When: export succeeds. Then: a success toast opens without a close button.
      el('export-all').click();
      await new Promise((resolve) => win.setTimeout(resolve, 0));
      ok(el('toast').classList.contains('open'), 'Missing success toast');
      equal(el('toast').dataset.tone, 'success');
      ok(el('status').textContent.startsWith('Exported 1 dark vectors'), 'Wrong success text');
      equal(win.getComputedStyle(el('toast-close')).display, 'none');
      equal(win.getComputedStyle(el('toast')).position, 'fixed');
      // When: an error has no control to point at. Then: the toast stays until dismissed.
      await el('json-file').onchange({
        target: { files: [new win.File(['{"kind":"nope"}'], 'bad.json')], value: '' },
      });
      equal(el('toast').dataset.tone, 'error');
      ok(el('status').classList.contains('error'), 'Missing error state');
      equal(el('status').getAttribute('aria-live'), 'assertive');
      ok(win.getComputedStyle(el('toast-close')).display !== 'none', 'Error cannot be dismissed');
      el('toast-close').click();
      ok(!el('toast').classList.contains('open'), 'Dismiss did not close the toast');
      // When: an invalid hex value is committed. Then: the callout appears but keeps focus free.
      el('save-profile').focus();
      input('target-hex', '#12');
      el('target-hex').dispatchEvent(new win.Event('change', { bubbles: true }));
      ok(callout()?.textContent.includes('#RRGGBB'), 'Missing hex callout');
      equal(doc.activeElement, el('save-profile'));
      el('target-hex').dispatchEvent(
        new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      equal(callout(), null);
      equal(el('target-hex').getAttribute('aria-invalid'), 'true');
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
    await editorReady(frame);
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

  const agentSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><!-- বাংলা &amp; + # --><path fill="#123456" d="M0 0h24v24z"/></svg>';
  async function agentPayload(source) {
    const compressed = new Blob([source]).stream().pipeThrough(new CompressionStream('gzip'));
    const bytes = new Uint8Array(await new Response(compressed).arrayBuffer());
    return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '');
  }
  async function agentFrame(fragment, check, expectError = false) {
    const frame = document.createElement('iframe');
    frame.src = `index.html#${fragment}`;
    const loaded = new Promise((resolve) => (frame.onload = resolve));
    document.body.append(frame);
    try {
      await loaded;
      await editorReady(frame);
      const doc = frame.contentDocument;
      const status = doc.getElementById('status');
      if (fragment.startsWith('v=')) {
        await new Promise((resolve, reject) => {
          const observer = new MutationObserver(finish);
          const timeout = setTimeout(() => {
            observer.disconnect();
            reject(new Error('Agent import did not finish: ' + status.textContent));
          }, 3000);
          function finish() {
            if (
              !(expectError
                ? status.classList.contains('error')
                : status.textContent.startsWith('Artwork loaded.'))
            )
              return;
            clearTimeout(timeout);
            observer.disconnect();
            resolve();
          }
          observer.observe(status, { childList: true, attributes: true, subtree: true });
          finish();
        });
      }
      await check(doc, frame.contentWindow);
    } finally {
      frame.remove();
    }
  }
  await test('Agent prompt copies a clean editor URL and offers selected text when clipboard fails', async () => {
    await agentFrame('editor', async (doc, win) => {
      equal(win.location.hash, '#editor');
      equal(doc.getElementById('asset-count').textContent, '1');
      let copied;
      Object.defineProperty(win.navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (text) => (copied = text) },
      });
      const button = doc.getElementById('copy-agent-prompt');
      ok(button, 'Missing Copy prompt for agent button');
      await button.onclick();
      ok(copied.includes(win.location.href.split('#')[0]), 'Missing current editor URL');
      ok(!copied.includes(win.location.href), 'Prompt includes editor fragment');
      for (const pattern of [
        /v=1|v:\s*['"]1['"]/,
        /gzip/i,
        /base64url/i,
        /65,?536/,
        /same tab/i,
        /finaliz/i,
        /wait/i,
      ])
        ok(pattern.test(copied), `Missing prompt instruction: ${pattern}`);
      win.navigator.clipboard.writeText = async () => {
        throw new Error('Denied');
      };
      await button.onclick();
      const text = doc.getElementById('agent-prompt-text');
      equal(doc.getElementById('agent-prompt-dialog').open, true);
      equal(text.value, copied);
      equal(doc.activeElement, text);
      equal(text.selectionStart, 0);
      equal(text.selectionEnd, text.value.length);
    });
  });
  await test('Agent links import gzip SVG and text Android XML, replace the demo and export current edits', async () => {
    for (const [name, source, encoding] of [
      ['folder/agent.svg', agentSvg, 'gzip'],
      ['folder/agent.xml', wrap(path('#123456')), 'text'],
      ['agent.xml', wrap(path('#123456')), null],
    ]) {
      const params = new URLSearchParams({
        v: '1',
        name,
        data: encoding === 'gzip' ? await agentPayload(source) : source,
      });
      if (encoding) params.set('encoding', encoding);
      await agentFrame(params.toString(), (doc, win) => {
        equal(win.location.hash, '');
        equal(doc.getElementById('asset-count').textContent, '1');
        equal(doc.getElementById('asset-name').textContent, name.split('/').pop());
        const input = doc.getElementById('target-hex');
        input.value = '#ABCDEF';
        input.dispatchEvent(new win.Event('input', { bubbles: true }));
        doc.getElementById('show-xml').click();
        const output = doc.getElementById('export-xml').value;
        equal(V.parseVector(output).uses[0].key, '#ABCDEF');
        ok(
          output.includes(name.endsWith('.svg') ? '<svg' : '<vector'),
          'Export changed file format',
        );
        if (name.endsWith('.svg')) ok(output.includes('বাংলা'), 'Unicode source lost');
      });
    }
  });
  await test('Invalid agent links retain their payload and demo, including both size limits', async () => {
    const valid = { v: '1', name: 'agent.svg', data: agentSvg };
    const invalidUtf8 = new Uint8Array([
      ...new TextEncoder().encode(agentSvg.replace('</svg>', '<!--')),
      255,
      ...new TextEncoder().encode('--></svg>'),
    ]);
    const fragments = [
      new URLSearchParams({ ...valid, v: '2' }).toString(),
      new URLSearchParams({ ...valid, encoding: 'zip' }).toString(),
      new URLSearchParams({ v: '1', name: 'agent.svg' }).toString(),
      new URLSearchParams({ v: '1', data: agentSvg }).toString(),
      new URLSearchParams(valid).toString() + '&v=1',
      new URLSearchParams(valid).toString() + '&data=extra',
      new URLSearchParams({ ...valid, encoding: 'gzip', data: '%' }).toString(),
      new URLSearchParams({ ...valid, encoding: 'gzip', data: 'YWJj' }).toString(),
      new URLSearchParams({
        ...valid,
        encoding: 'gzip',
        data: await agentPayload(invalidUtf8),
      }).toString(),
      new URLSearchParams({ ...valid, data: '<svg>' }).toString(),
      new URLSearchParams({
        ...valid,
        encoding: 'gzip',
        data: await agentPayload(' '.repeat(5000001)),
      }).toString(),
      new URLSearchParams({ ...valid, data: 'x'.repeat(65536) }).toString(),
    ];
    for (const fragment of fragments) {
      await agentFrame(
        fragment,
        (doc, win) => {
          equal(win.location.hash, '#' + fragment);
          equal(doc.getElementById('asset-count').textContent, '1');
          equal(doc.getElementById('asset-name').textContent, 'sample_bookshelf.xml');
          ok(doc.getElementById('status').classList.contains('error'), 'Missing import error');
        },
        true,
      );
    }
  });
  await test('Agent loading blocks document file drops without changing the workspace', async () => {
    await agentFrame('editor', async (doc, win) => {
      doc.getElementById('editor').inert = true;
      const status = doc.getElementById('status').textContent;
      const transfer = new win.DataTransfer();
      const file = new win.File([wrap(path('#123456'))], 'dropped.xml');
      let read = false;
      file.text = () => {
        read = true;
        return Promise.resolve(wrap(path('#123456')));
      };
      transfer.items.add(file);
      const event = new win.DragEvent('drop', { dataTransfer: transfer, cancelable: true });
      doc.dispatchEvent(event);
      await new Promise((resolve) => win.setTimeout(resolve, 0));
      equal(event.defaultPrevented, true);
      equal(read, false);
      equal(doc.getElementById('asset-count').textContent, '1');
      equal(doc.getElementById('asset-name').textContent, 'sample_bookshelf.xml');
      equal(doc.getElementById('status').textContent, status);
    });
  });
  await test('Agent import does not apply a saved palette or resource definitions', async () => {
    const keys = ['vector-studio.profiles.v1', 'vector-studio.last-profile.v1'];
    const previous = keys.map((key) => localStorage.getItem(key));
    const profile = {
      version: 1,
      kind: 'vector-dark-palette',
      name: 'Agent isolation',
      mappings: { '#123456': '#FEDCBA' },
      resources: { '@color/brand': '#123456' },
      background: '#171923',
    };
    try {
      localStorage.setItem(keys[0], JSON.stringify([profile]));
      localStorage.setItem(keys[1], profile.name);
      await agentFrame(
        new URLSearchParams({ v: '1', name: 'agent.svg', data: agentSvg }).toString(),
        async (doc, win) => {
          ok(
            doc.getElementById('target-hex').value !== '#FEDCBA',
            'Saved palette applied silently',
          );
          ok(
            !doc.getElementById('resource-count').textContent.startsWith('1'),
            'Saved resources applied silently',
          );
          let download;
          win.HTMLAnchorElement.prototype.click = function () {};
          win.URL.createObjectURL = (blob) => {
            download = blob;
            return 'blob:agent-test';
          };
          doc.getElementById('export-profile').click();
          const exported = JSON.parse(await download.text());
          equal(exported.resources, {});
          ok(exported.mappings['#123456'] !== '#FEDCBA', 'Export inherited saved palette');
        },
      );
    } finally {
      keys.forEach((key, index) =>
        previous[index] === null
          ? localStorage.removeItem(key)
          : localStorage.setItem(key, previous[index]),
      );
    }
  });

  const editorFrame = async () => {
    const frame = document.createElement('iframe');
    frame.src = 'index.html';
    const loaded = new Promise((resolve) => (frame.onload = resolve));
    document.body.append(frame);
    await loaded;
    await editorReady(frame);
    const doc = frame.contentDocument,
      win = frame.contentWindow;
    return { frame, doc, win, el: (id) => doc.getElementById(id) };
  };
  const nextFrame = (win) => new Promise((resolve) => win.requestAnimationFrame(() => resolve()));
  async function waitForAsset(el, win, name) {
    const deadline = Date.now() + 5000;
    while (el('asset-name').textContent !== name) {
      if (Date.now() >= deadline) throw new Error(`Import did not finish: ${name}`);
      await nextFrame(win);
    }
  }
  const savedProfile = (name, target) => ({
    version: 1,
    kind: 'vector-dark-palette',
    name,
    mappings: { '#123456': target },
    resources: {},
    background: '#171923',
  });
  /** Runs a test against prepared profile storage and restores the previous values afterwards. */
  async function withStoredProfiles(stored, last, run) {
    const keys = ['vector-studio.profiles.v1', 'vector-studio.last-profile.v1'];
    const previous = keys.map((key) => localStorage.getItem(key));
    try {
      localStorage.setItem(keys[0], stored);
      if (last) localStorage.setItem(keys[1], last);
      else localStorage.removeItem(keys[1]);
      await run(keys);
    } finally {
      keys.forEach((key, index) =>
        previous[index] === null
          ? localStorage.removeItem(key)
          : localStorage.setItem(key, previous[index]),
      );
    }
  }

  await test('One unreadable stored profile is skipped, kept in storage, and never overwritten', async () => {
    // Given: a valid profile stored next to one from an unknown schema.
    const broken = { kind: 'vector-dark-palette', version: 9, name: 'Future' };
    await withStoredProfiles(
      JSON.stringify([savedProfile('Brand', '#ABCDEF'), broken]),
      'Brand',
      async (keys) => {
        const { frame, el } = await editorFrame();
        try {
          // Then: the readable profile loads and the skipped one is reported.
          equal(
            [...el('saved-profiles').options].map((option) => option.value),
            ['', 'Brand'],
          );
          equal(el('saved-profiles').value, 'Brand');
          equal(el('toast').dataset.tone, 'error');
          ok(el('status').textContent.includes('1 saved profile could not be read'), 'No report');
          // When: save another profile. Then: every stored entry survives.
          el('profile-name').value = 'Second';
          el('save-profile').click();
          await new Promise((resolve) => setTimeout(resolve));
          const stored = JSON.parse(localStorage.getItem(keys[0]));
          equal(
            stored.map((p) => p.name),
            ['Future', 'Brand', 'Second'],
          );
          equal(stored[0], broken);
        } finally {
          frame.remove();
        }
      },
    );
  });

  await test('Unparseable profile storage blocks saving instead of replacing it', async () => {
    await withStoredProfiles('{not json', null, async (keys) => {
      const { frame, el } = await editorFrame();
      try {
        ok(el('status').textContent.includes('Saving is paused'), 'Missing storage warning');
        el('save-profile').click();
        await new Promise((resolve) => setTimeout(resolve));
        equal(localStorage.getItem(keys[0]), '{not json');
        equal(el('toast').dataset.tone, 'error');
        ok(el('status').textContent.includes('Export profile'), 'Save error lacks a way out');
      } finally {
        frame.remove();
      }
    });
  });

  await test('Saving over a different same-name profile asks first; profiles can be deleted and restored', async () => {
    await withStoredProfiles(
      JSON.stringify([savedProfile('Brand', '#ABCDEF'), savedProfile('Test', '#FEDCBA')]),
      'Brand',
      async (keys) => {
        const { frame, el, win } = await editorFrame();
        const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
        try {
          // Given: Brand is loaded. When: save it under its own name. Then: no question asked.
          el('save-profile').click();
          await settle();
          equal(el('overwrite-dialog').open, false);
          // When: load Test, rename it to Brand and save. Then: replacing needs confirmation.
          el('saved-profiles').value = 'Test';
          el('saved-profiles').dispatchEvent(new win.Event('change'));
          el('profile-name').value = 'Brand';
          el('save-profile').click();
          equal(el('overwrite-dialog').open, true);
          ok(el('overwrite-title').textContent.includes('Brand'), 'Dialog does not name profile');
          el('overwrite-dialog').querySelector('[value="cancel"]').click();
          await settle();
          const brand = () =>
            JSON.parse(localStorage.getItem(keys[0])).find((p) => p.name === 'Brand');
          equal(brand().mappings['#123456'], '#ABCDEF');
          el('save-profile').click();
          el('overwrite-dialog').querySelector('[value="replace"]').click();
          await settle();
          equal(brand().mappings['#123456'], '#FEDCBA');
          // When: delete the selected profile. Then: it leaves storage and can be restored.
          equal(el('delete-profile').disabled, false);
          el('delete-profile').click();
          equal(brand(), undefined);
          equal(localStorage.getItem(keys[1]), null);
          equal(el('delete-profile').disabled, true);
          equal(el('toast-action').hidden, false);
          el('toast-action').click();
          equal(brand().mappings['#123456'], '#FEDCBA');
          equal(el('saved-profiles').value, 'Brand');
        } finally {
          frame.remove();
        }
      },
    );
  });

  await test('A picker drag or a typed hex value is one undo step; partial hex is not applied', async () => {
    const { frame, el, win } = await editorFrame();
    try {
      el('paste-open').click();
      el('xml-input').value = wrap(path('#123456'));
      el('paste-import').click();
      const fill = () => el('dark-preview').querySelector('path[data-node]').getAttribute('fill');
      const original = fill();
      // When: a drag fires many input events. Then: one frame redraws and one undo restores.
      for (const value of ['#101010', '#202020', '#303030', '#404040']) {
        el('target-picker').value = value;
        el('target-picker').dispatchEvent(new win.Event('input'));
      }
      el('target-picker').dispatchEvent(new win.Event('change'));
      await nextFrame(win);
      equal(fill(), '#404040');
      el('undo').click();
      equal(fill(), original);
      equal(el('undo').disabled, true);
      // When: typing a full value key by key. Then: short prefixes never reach the artwork.
      for (const value of [
        '#1',
        '#12',
        '#123',
        '#1234',
        '#12345',
        '#123456',
        '#1234567',
        '#12345678',
      ]) {
        el('target-hex').value = value;
        el('target-hex').dispatchEvent(new win.Event('input'));
        if (value.length < 7) equal(fill(), original);
      }
      el('target-hex').dispatchEvent(new win.Event('change'));
      equal(fill(), '#345678');
      el('undo').click();
      equal(fill(), original);
      equal(el('undo').disabled, true);
      // When: a short form is committed. Then: it applies on change.
      el('target-hex').value = '#abc';
      el('target-hex').dispatchEvent(new win.Event('input'));
      equal(fill(), original);
      el('target-hex').dispatchEvent(new win.Event('change'));
      equal(fill(), '#AABBCC');
    } finally {
      frame.remove();
    }
  });

  await test('Separate edits re-render only the affected thumbnail; preview clicks still select', async () => {
    const { frame, el, win } = await editorFrame();
    try {
      await el('vector-files').onchange({
        target: {
          files: ['one', 'two'].map(
            (name) => new win.File([wrap(path('#123456') + path('#654321'))], name + '.xml'),
          ),
          value: '',
        },
      });
      const thumbs = () => [...el('asset-list').querySelectorAll('.asset-preview svg')];
      const [first, second] = thumbs();
      el('scope-image').click();
      el('target-hex').value = '#ABCDEF';
      el('target-hex').dispatchEvent(new win.Event('input'));
      equal(thumbs()[1], second, 'Untouched thumbnail was rebuilt');
      ok(thumbs()[0] !== first, 'Edited thumbnail kept stale colors');
      el('dark-preview')
        .querySelectorAll('[data-node]')[1]
        .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      ok(
        el('palette-list').querySelector('.active').getAttribute('aria-label').includes('#654321'),
        'Preview click did not select the clicked color',
      );
    } finally {
      frame.remove();
    }
  });

  await test('Removing an illustration offers Undo that restores it with its overrides and history', async () => {
    const { frame, el, win, doc } = await editorFrame();
    const unloadBlocked = () => {
      const event = new win.Event('beforeunload', { cancelable: true });
      win.dispatchEvent(event);
      return event.defaultPrevented;
    };
    try {
      // Given: removing the bundled example leaves nothing worth saving.
      el('asset-list').querySelector('.asset-remove').click();
      equal(el('asset-count').textContent, '0');
      equal(unloadBlocked(), true);
      await until(
        () => el('recovery-state').textContent.startsWith('Local recovery saved'),
        'Empty recovery did not settle',
      );
      equal(unloadBlocked(), false);
      el('toast-action').click();
      equal(el('asset-count').textContent, '1');
      await el('vector-files').onchange({
        target: {
          files: ['one', 'two'].map((name) => new win.File([wrap(path('#123456'))], name + '.xml')),
          value: '',
        },
      });
      el('asset-list').querySelectorAll('.asset')[1].click();
      el('scope-image').click();
      el('keep-original').click();
      // When: remove the edited illustration.
      el('asset-list').querySelectorAll('.asset-remove')[1].click();
      equal(el('asset-count').textContent, '1');
      equal(el('undo').disabled, true);
      ok(el('status').textContent.startsWith('Removed two.xml'), 'Missing removal message');
      equal(el('toast-action').textContent, 'Undo');
      // Then: Undo brings back the illustration, its override, selection and history.
      el('toast-action').click();
      equal(el('asset-count').textContent, '2');
      equal(el('asset-name').textContent, 'two.xml');
      equal(el('scope-image').checked, true);
      equal(el('mapping-origin').textContent, 'Original kept');
      equal(el('undo').disabled, false);
      ok(doc.querySelector('.asset.active'), 'Restored illustration not active');
      equal(unloadBlocked(), true);
    } finally {
      frame.remove();
    }
  });

  await test('Text drops keep their default; file drops behind an open dialog are not imported', async () => {
    const { frame, el, win, doc } = await editorFrame();
    const drop = (transfer, target = doc) => {
      const event = new win.DragEvent('drop', {
        dataTransfer: transfer,
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(event);
      return event;
    };
    const settle = () => new Promise((resolve) => win.setTimeout(resolve, 0));
    try {
      el('load-demo').click();
      const status = el('status').textContent;
      // When: selected text is dropped into the Paste XML field.
      el('paste-open').click();
      const text = new win.DataTransfer();
      text.setData('text/plain', '<vector/>');
      const textDrop = drop(text, el('xml-input'));
      await settle();
      // Then: the browser may insert it, and the status line is untouched.
      equal(textDrop.defaultPrevented, false);
      equal(el('status').textContent, status);
      // When: a file is dropped while the dialog is open.
      const files = new win.DataTransfer();
      files.items.add(new win.File([wrap(path('#123456'))], 'behind.xml'));
      doc.dispatchEvent(new win.DragEvent('dragenter', { dataTransfer: files }));
      equal(el('drop-overlay').hidden, true);
      const fileDrop = drop(files);
      await settle();
      // Then: the browser does not open the file, and nothing is imported behind the dialog.
      equal(fileDrop.defaultPrevented, true);
      equal(el('asset-count').textContent, '1');
      equal(el('status').textContent, status);
      el('paste-close').click();
      // When: the dialog is closed. Then: the same drop imports the file.
      drop(files);
      await waitForAsset(el, win, 'behind.xml');
      equal(el('asset-name').textContent, 'behind.xml');
    } finally {
      frame.remove();
    }
  });

  await test('The drop overlay clears when the browser skips dragleave or drop', async () => {
    const { frame, el, win, doc } = await editorFrame();
    const drag = (type, init = {}) => {
      const event = new win.DragEvent(type, { bubbles: true, cancelable: true, ...init });
      doc.body.dispatchEvent(event);
      return event;
    };
    const wait = (ms) => new Promise((resolve) => win.setTimeout(resolve, ms));
    try {
      const files = new win.DataTransfer();
      files.items.add(new win.File([wrap(path('#123456'))], 'late.xml'));
      // Synthetic drags have no native drag session, so Chrome ignores dropEffect writes.
      // Capture the handler's requested effect while keeping real file data and events.
      Object.defineProperty(files, 'dropEffect', { value: 'none', writable: true });
      // When: the pointer crosses nested elements, so dragenter outnumbers dragleave.
      const inside = {
        dataTransfer: files,
        clientX: win.innerWidth / 2,
        clientY: win.innerHeight / 2,
      };
      drag('dragenter', inside);
      drag('dragenter', inside);
      drag('dragleave', inside);
      // Then: the overlay shows, and dragover accepts the files as a copy.
      equal(el('drop-overlay').hidden, false);
      const over = drag('dragover', inside);
      equal(over.defaultPrevented, true);
      equal(files.dropEffect, 'copy');
      // When: dragover keeps firing. Then: the overlay stays.
      await wait(400);
      drag('dragover', inside);
      await wait(400);
      equal(el('drop-overlay').hidden, false);
      // When: the drag ends without a drop or a final dragleave. Then: the overlay clears.
      await wait(700);
      equal(el('drop-overlay').hidden, true);
      // When: the pointer leaves the window. Then: the overlay clears at once.
      drag('dragenter', inside);
      drag('dragleave', { dataTransfer: files, clientX: -1, clientY: 200 });
      equal(el('drop-overlay').hidden, true);
      // When: a later drag drops a file. Then: it is imported.
      drag('dragenter', inside);
      drag('drop', inside);
      equal(el('drop-overlay').hidden, true);
      await waitForAsset(el, win, 'late.xml');
      equal(el('asset-name').textContent, 'late.xml');
    } finally {
      frame.remove();
    }
  });

  await test('Local recovery restores source artwork, palette, resources, overrides and draft name after reload', async () => {
    let editor = await editorFrame();
    try {
      let { el, win } = editor;
      await el('vector-files').onchange({
        target: {
          files: [
            new win.File(
              [wrap(path('#123456') + path('#123456') + path('@color/brand'))],
              'recover.xml',
            ),
          ],
          value: '',
        },
      });
      await el('resource-files').onchange({
        target: {
          files: [
            new win.File(
              ['<resources><color name="brand">#789abc</color></resources>'],
              'colors.xml',
            ),
          ],
          value: '',
        },
      });
      const input = (id, value) => {
        el(id).value = value;
        el(id).dispatchEvent(new win.Event('input', { bubbles: true }));
        el(id).dispatchEvent(new win.Event('change', { bubbles: true }));
      };
      input('target-hex', '#AABBCC');
      el('scope-image').click();
      input('target-hex', '#445566');
      el('dark-preview')
        .querySelector('path[data-node]')
        .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      el('scope-shape').click();
      input('target-hex', '#778899');
      input('dark-background', '#112233');
      input('profile-name', 'Recovered artwork');
      await until(
        async () => (await recoveryRecord())?.name === 'Recovered artwork',
        'Workspace was not saved',
      );
      const saved = await recoveryRecord();
      ok(
        saved.workspace.assets[0].xml.includes('@color/brand'),
        'Source resource reference was lost',
      );
      equal(saved.workspace.profile.resources['@color/brand'], '#789ABC');
      equal(saved.workspace.profile.background, '#112233');
      equal(Object.values(saved.workspace.assets[0].uses), ['#778899']);
      editor = await reloadEditor(editor.frame);
      ({ el, win } = editor);
      equal(el('asset-name').textContent, 'recover.xml');
      equal(el('profile-name').value, 'Recovered artwork');
      equal(el('dark-background').value, '#112233');
      equal(
        [...el('dark-preview').querySelectorAll('path[data-node]')]
          .map((node) => node.getAttribute('fill'))
          .slice(0, 2),
        ['#778899', '#445566'],
      );
      equal(el('light-preview').querySelector('path[data-node]').getAttribute('fill'), '#123456');
      equal(await recoveryRecord(), saved);
      el('profile-name').value = '';
      el('profile-name').dispatchEvent(new win.Event('input'));
      await until(async () => (await recoveryRecord())?.name === '', 'Unnamed draft was not saved');
      editor = await reloadEditor(editor.frame);
      equal(editor.el('profile-name').value, '');
    } finally {
      editor.frame.remove();
    }
  });

  await test('Recovery keeps removed artwork removed, including an empty unnamed collection', async () => {
    let editor = await editorFrame();
    try {
      const { el, win } = editor;
      await el('vector-files').onchange({
        target: {
          files: ['one', 'two'].map((name) => new win.File([wrap(path('#123456'))], name + '.xml')),
          value: '',
        },
      });
      el('asset-list').querySelector('.asset-remove').click();
      await until(
        async () => (await recoveryRecord())?.workspace.assets.length === 1,
        'Removal not saved',
      );
      editor = await reloadEditor(editor.frame);
      equal(editor.el('asset-name').textContent, 'two.xml');
      editor.el('asset-list').querySelector('.asset-remove').click();
      await until(
        async () => (await recoveryRecord())?.workspace.assets.length === 0,
        'Empty collection not saved',
      );
      editor = await reloadEditor(editor.frame);
      equal(editor.el('asset-count').textContent, '0');
      equal(editor.el('export-current').disabled, true);
    } finally {
      editor.frame.remove();
    }
  });

  await test('Failed recovery writes keep the prior backup and leave the editor usable', async () => {
    const { frame, el, win } = await editorFrame();
    const original = win.IDBObjectStore.prototype.put;
    try {
      await el('vector-files').onchange({
        target: { files: [new win.File([wrap(path('#123456'))], 'safe.xml')], value: '' },
      });
      await until(async () => !!(await recoveryRecord()), 'Initial backup missing');
      el('target-hex').value = '#ABCDEF';
      el('target-hex').dispatchEvent(new win.Event('input'));
      const pending = new win.Event('beforeunload', { cancelable: true });
      win.dispatchEvent(pending);
      equal(pending.defaultPrevented, true);
      await nextFrame(win);
      await until(
        () => el('recovery-state').textContent.startsWith('Local recovery saved'),
        'Edited backup did not settle',
      );
      const settled = new win.Event('beforeunload', { cancelable: true });
      win.dispatchEvent(settled);
      equal(settled.defaultPrevented, false);
      const editedBackup = await recoveryRecord();
      win.IDBObjectStore.prototype.put = () => {
        throw new win.DOMException('Storage full', 'QuotaExceededError');
      };
      el('profile-name').value = 'Unstored edit';
      el('profile-name').dispatchEvent(new win.Event('input'));
      await until(
        () => /unavailable|failed|could not/i.test(el('recovery-state').textContent),
        'Storage failure was not shown',
      );
      equal(await recoveryRecord(), editedBackup);
      el('target-hex').value = '#ABCDEF';
      el('target-hex').dispatchEvent(new win.Event('input'));
      await nextFrame(win);
      equal(el('dark-preview').querySelector('path[data-node]').getAttribute('fill'), '#ABCDEF');
      equal(el('save-workspace').disabled, false);
    } finally {
      win.IDBObjectStore.prototype.put = original;
      frame.remove();
    }
  });

  await test('Unreadable local recovery remains intact and reports the problem', async () => {
    const invalid = { workspace: { version: 999, assets: [] }, name: 'future draft', active: 0 };
    await recoveryRecord(invalid);
    const { frame, el, win } = await editorFrame();
    try {
      ok(
        /unavailable|could not|invalid|unreadable/i.test(el('recovery-state').textContent),
        'Invalid recovery not explained',
      );
      el('profile-name').value = 'New edit';
      el('profile-name').dispatchEvent(new win.Event('input'));
      await new Promise((resolve) => win.setTimeout(resolve, 350));
      equal(await recoveryRecord(), invalid);
      equal(el('paste-open').disabled, false);
    } finally {
      frame.remove();
    }
  });

  await test('Agent links protect a saved workspace on failure and replace it only after a valid import', async () => {
    const saved = {
      workspace: {
        kind: 'vector-dark-workspace',
        version: 1,
        profile: savedProfile('Old palette', '#ABCDEF'),
        assets: [
          {
            name: 'prior.xml',
            xml: wrap(path('#123456')),
            overrides: {},
            uses: {},
            separate: false,
          },
        ],
      },
      name: 'Prior draft',
      active: 0,
    };
    await recoveryRecord(saved);
    await agentFrame(
      new URLSearchParams({ v: '1', name: 'broken.xml', data: '<vector>' }).toString(),
      async (doc) => {
        equal(doc.getElementById('asset-name').textContent, 'prior.xml');
        equal(doc.getElementById('profile-name').value, 'Prior draft');
        equal(
          doc.getElementById('dark-preview').querySelector('[data-node]').getAttribute('fill'),
          '#ABCDEF',
        );
        equal(await recoveryRecord(), saved);
      },
      true,
    );
    await agentFrame(
      new URLSearchParams({ v: '1', name: 'incoming.xml', data: wrap(path('#123456')) }).toString(),
      async (doc) => {
        equal(doc.getElementById('asset-name').textContent, 'incoming.xml');
        ok(
          doc.getElementById('dark-preview').querySelector('[data-node]').getAttribute('fill') !==
            '#ABCDEF',
          'Incoming artwork inherited the recovered palette',
        );
        await until(
          async () => (await recoveryRecord())?.workspace.assets[0].name === 'incoming.xml',
          'Incoming artwork not saved',
        );
        equal((await recoveryRecord()).workspace.assets.length, 1);
      },
    );
  });

  await test('Preview zoom, pan, keyboard and fit stay synchronized without changing exported artwork', async () => {
    const { frame, el, win } = await editorFrame();
    try {
      await el('vector-files').onchange({
        target: {
          files: ['one', 'two'].map(
            (name) => new win.File([wrap(path('#123456') + path('#123456'))], name + '.xml'),
          ),
          value: '',
        },
      });
      const canvases = [el('light-preview'), el('dark-preview')];
      const view = () =>
        canvases.map((canvas) =>
          ['--preview-zoom', '--preview-x', '--preview-y'].map((key) =>
            canvas.style.getPropertyValue(key),
          ),
        );
      const key = (value) =>
        canvases[0].dispatchEvent(
          new win.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }),
        );
      el('show-xml').click();
      const original = el('export-xml').value || el('export-xml').textContent;
      el('export-close').click();
      el('preview-zoom-in').click();
      equal(view()[0][0], '1.25');
      equal(view()[0], view()[1]);
      key('ArrowRight');
      key('ArrowDown');
      equal(view()[0].slice(1), ['24px', '24px']);
      equal(view()[0], view()[1]);
      const beforeEdit = view();
      el('target-hex').value = '#AABBCC';
      el('target-hex').dispatchEvent(new win.Event('input'));
      await nextFrame(win);
      equal(view(), beforeEdit);
      el('undo').click();
      el('show-xml').click();
      equal(el('export-xml').value || el('export-xml').textContent, original);
      el('export-close').click();
      for (let i = 0; i < 40; i++) el('preview-zoom-in').click();
      equal(view()[0][0], '8');
      equal(el('preview-zoom-in').disabled, true);
      for (let i = 0; i < 40; i++) el('preview-zoom-out').click();
      equal(view()[0][0], '0.25');
      equal(el('preview-zoom-out').disabled, true);
      key('+');
      equal(view()[0][0], '0.5');
      key('Home');
      equal(view()[0], ['1', '0px', '0px']);
      key('+');
      key('ArrowLeft');
      el('preview-fit').click();
      equal(view()[0], ['1', '0px', '0px']);
      key('+');
      key('ArrowLeft');
      el('asset-list').querySelector('.asset:not(.active)').click();
      equal(view()[0], ['1', '0px', '0px']);
      equal(view()[0], view()[1]);
    } finally {
      frame.remove();
    }
  });

  await test('Preview drags pan while plain clicks select shapes, and cancellation ends panning', async () => {
    const { frame, el, win } = await editorFrame();
    try {
      await el('vector-files').onchange({
        target: {
          files: [new win.File([wrap(path('#123456') + path('#123456'))], 'pan.xml')],
          value: '',
        },
      });
      const canvas = el('dark-preview');
      let node = canvas.querySelector('[data-node]');
      const pointer = (type, x, y) =>
        node.dispatchEvent(
          new win.PointerEvent(type, {
            pointerId: 1,
            isPrimary: true,
            pointerType: 'mouse',
            button: 0,
            buttons: type === 'pointerup' ? 0 : 1,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        );
      // Synthetic events have no native pointer capture session; verify handlers independently.
      canvas.setPointerCapture = () => {};
      canvas.releasePointerCapture = () => {};
      pointer('pointerdown', 10, 10);
      pointer('pointermove', 50, 40);
      pointer('pointerup', 50, 40);
      node.dispatchEvent(
        new win.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }),
      );
      equal(el('highlight').checked, false);
      equal(canvas.style.getPropertyValue('--preview-x'), '40px');
      equal(canvas.style.getPropertyValue('--preview-y'), '30px');
      equal(el('light-preview').style.getPropertyValue('--preview-x'), '40px');
      pointer('pointerdown', 50, 40);
      pointer('pointermove', 51, 41);
      pointer('pointerup', 51, 41);
      node.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
      equal(el('highlight').checked, true);
      node = canvas.querySelector('[data-node]');
      pointer('pointerdown', 10, 10);
      pointer('pointermove', 30, 30);
      node.dispatchEvent(
        new win.PointerEvent('lostpointercapture', { pointerId: 1, bubbles: true }),
      );
      pointer('pointermove', 40, 40);
      equal(canvas.style.getPropertyValue('--preview-x'), '70px');
      pointer('pointercancel', 30, 30);
      const offset = canvas.style.getPropertyValue('--preview-x');
      pointer('pointermove', 80, 80);
      equal(canvas.style.getPropertyValue('--preview-x'), offset);
    } finally {
      frame.remove();
    }
  });

  const failures = results.filter((r) => r.startsWith('FAIL')).length;
  document.querySelector('#results').textContent =
    results.join('\n') + `\n${results.length - failures}/${results.length} passed`;
  document.body.dataset.testStatus = failures ? 'failed' : 'passed';
})();
