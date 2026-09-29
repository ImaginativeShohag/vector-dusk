/** Editor state, rendering and user actions. Parsing and color math live in the adapters. */
(() => {
  'use strict';
  const vectorTools = window.VectorStudio;
  const getElement = (id) => document.getElementById(id);
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  // Keep the legacy storage keys so existing palettes survive branding changes.
  const STORAGE = 'vector-studio.profiles.v1';
  const LAST = 'vector-studio.last-profile.v1';
  const state = {
    assets: [],
    active: 0,
    selected: '',
    use: '',
    scope: 'image',
    toneSteps: 10,
    mappings: {},
    resources: {},
    background: '#191B24',
    profiles: [],
    dirty: true,
    workspaceDirty: false,
    undo: [],
    redo: [],
  };
  const activeAsset = () => state.assets[state.active];
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  function status(message, error = false) {
    getElement('status').textContent = message;
    getElement('status').classList.toggle('error', error);
  }
  function filename(name, format) {
    const basename =
      name
        .split(/[\\/]/)
        .pop()
        .replace(/[^a-zA-Z0-9_.-]/g, '_') || 'illustration';
    const extension = format === 'svg' ? '.svg' : '.xml';
    return basename.replace(/\.(xml|svg)$/i, '') + extension;
  }
  function makeAsset(name, xml) {
    const model = vectorTools.parseVector(xml);
    vectorTools.render(model); // Reject unsupported numeric resource values before changing editor state.
    return { name: filename(name, model.format), model, overrides: {}, uses: {} };
  }
  const displayColor = (color) =>
    activeAsset()?.model.format === 'svg' && vectorTools.normalizeColor(color)
      ? vectorTools.svgColor(color)
      : color;
  function selectedPaletteEntry() {
    return (
      activeAsset() &&
      vectorTools.palette(activeAsset().model).find((p) => p.key === state.selected)
    );
  }
  function effectiveMappings(asset) {
    const map = { ...state.mappings };
    for (const color of vectorTools.palette(asset.model)) {
      if (!own(map, color.key))
        map[color.key] =
          vectorTools.suggest(vectorTools.resolveColor(color.key, state.resources)) || 'keep';
    }
    return Object.assign(map, asset.overrides);
  }
  function selectedReplacement() {
    const asset = activeAsset();
    if (!asset || !state.selected) return 'keep';
    if (state.scope === 'shape' && own(asset.uses, state.use)) return asset.uses[state.use];
    return effectiveMappings(asset)[state.selected] || 'keep';
  }
  function snapshotEdits() {
    return JSON.stringify({
      mappings: state.mappings,
      resources: state.resources,
      background: state.background,
      name: getElement('profile-name').value,
      assets: state.assets.map((a) => ({ overrides: a.overrides, uses: a.uses })),
    });
  }
  function recordEdit() {
    state.undo.push(snapshotEdits());
    if (state.undo.length > 80) state.undo.shift();
    state.redo = [];
    state.dirty = true;
    state.workspaceDirty = true;
  }
  function restoreEdits(text) {
    const value = JSON.parse(text);
    state.mappings = value.mappings;
    state.resources = value.resources;
    state.background = value.background;
    getElement('profile-name').value = value.name;
    value.assets.forEach((a, index) => {
      if (state.assets[index]) Object.assign(state.assets[index], a);
    });
    state.dirty = true;
    state.workspaceDirty = true;
    render();
  }
  function resetHistory() {
    state.undo = [];
    state.redo = [];
  }
  function edit(target, keepInput = false) {
    if (!activeAsset() || !state.selected) return;
    recordEdit();
    if (state.scope === 'shape') activeAsset().uses[state.use] = target;
    else if (state.scope === 'image') activeAsset().overrides[state.selected] = target;
    else state.mappings[state.selected] = target;
    render(keepInput);
  }
  function swatch(value) {
    const outer = element('span', 'swatch');
    const inner = element('span');
    const color = vectorTools.colorParts(value);
    if (color) {
      inner.style.background = color.rgb;
      inner.style.opacity = color.alpha;
    } else {
      inner.style.background = '#FF00FF';
      inner.title = 'Unresolved source color';
    }
    outer.append(inner);
    return outer;
  }
  function colorCell(key, resolved) {
    const cell = element('span', 'color-cell');
    const text = element('span', 'color-text', key);
    text.title = key;
    cell.append(swatch(resolved), text);
    return cell;
  }
  function selectColor(key, use = '') {
    state.selected = key;
    state.use = use || selectedPaletteEntry()?.uses[0]?.id || '';
    render();
  }
  function revealPaletteSelection() {
    const list = getElement('palette-list');
    const row = list.querySelector('.active');
    if (!row) return;
    const bounds = row.getBoundingClientRect();
    const top = list.getBoundingClientRect().top + list.clientTop;
    const bottom = top + list.clientHeight;
    if (bounds.top < top) list.scrollTop += bounds.top - top;
    else if (bounds.bottom > bottom) list.scrollTop += bounds.bottom - bottom;
  }
  function renderPreviews() {
    const asset = activeAsset();
    if (!asset) {
      for (const id of ['light-preview', 'dark-preview'])
        getElement(id).replaceChildren(
          element('p', 'empty', 'Import a vector or load the example.'),
        );
      getElement('warning-box').hidden = true;
      return;
    }
    const warnings = new Set();
    const palette = selectedPaletteEntry();
    const selectedUses =
      state.scope === 'shape' ? palette?.uses.filter((u) => u.id === state.use) : palette?.uses;
    const selectedNodes = new Set(
      (selectedUses || []).flatMap((u) => {
        if (asset.model.format === 'svg') return vectorTools.svgNodesForUse(asset.model, u);
        const node = asset.model.nodes[u.nodeIndex];
        return [asset.model.nodes.indexOf(node.closest('path') || node)];
      }),
    );
    for (const [id, map, overrides] of [
      ['light-preview', {}, {}],
      ['dark-preview', effectiveMappings(asset), asset.uses],
    ]) {
      const result = vectorTools.render(asset.model, map, overrides, state.resources);
      result.warnings.forEach((w) => warnings.add(w));
      getElement(id).replaceChildren(result.svg);
      getElement(id).classList.toggle('highlighting', getElement('highlight').checked);
      for (const path of result.svg.querySelectorAll('[data-node]')) {
        const index = Number(path.dataset.node);
        path.classList.toggle('selected', selectedNodes.has(index));
        if (
          asset.model.format === 'svg' &&
          getElement('highlight').checked &&
          !selectedNodes.has(index)
        )
          path.style.setProperty(
            'opacity',
            String(Number(path.style.opacity || 1) * 0.16),
            'important',
          );
        path.addEventListener('click', (event) => {
          const use =
            asset.model.uses.find((u) => u.nodeIndex === index) ||
            asset.model.uses.find((u) =>
              asset.model.format === 'svg'
                ? vectorTools.svgNodesForUse(asset.model, u).includes(index)
                : asset.model.nodes[u.nodeIndex].closest('path') === asset.model.nodes[index],
            );
          if (use) {
            event.stopPropagation();
            getElement('highlight').checked = true;
            selectColor(use.key, use.id);
            revealPaletteSelection();
          }
        });
      }
    }
    getElement('dark-preview').style.background = state.background;
    getElement('warning-box').hidden = warnings.size === 0;
    getElement('warning-summary').textContent =
      `${warnings.size} preview note${warnings.size === 1 ? '' : 's'} · review before export`;
    getElement('warnings').replaceChildren(...[...warnings].map((w) => element('li', '', w)));
  }
  function renderAssets() {
    getElement('asset-list').replaceChildren(
      ...state.assets.map((asset, index) => {
        const button = element('button', 'asset' + (index === state.active ? ' active' : ''));
        button.setAttribute('aria-label', `Select ${asset.name}`);
        button.setAttribute('aria-pressed', index === state.active);
        const image = element('span', 'asset-preview');
        image.style.background = state.background;
        const { svg } = vectorTools.render(
          asset.model,
          effectiveMappings(asset),
          asset.uses,
          state.resources,
        );
        svg.setAttribute('aria-hidden', 'true');
        image.append(svg);
        button.append(image, element('span', 'asset-title', asset.name));
        button.title = asset.name;
        button.onclick = () => {
          state.active = index;
          const palette = vectorTools.palette(asset.model);
          if (!palette.some((p) => p.key === state.selected))
            state.selected = palette[0]?.key || '';
          state.use = selectedPaletteEntry()?.uses[0]?.id || '';
          render();
        };
        return button;
      }),
    );
  }
  function renderPalette() {
    const asset = activeAsset();
    const colors = asset ? vectorTools.palette(asset.model) : [];
    const map = asset ? effectiveMappings(asset) : {};
    const scrollTop = getElement('palette-list').scrollTop;
    getElement('palette-list').replaceChildren(
      ...colors.map((color) => {
        const target = map[color.key];
        const button = element(
          'button',
          'palette-row' + (color.key === state.selected ? ' active' : ''),
        );
        button.setAttribute('aria-label', `Edit ${displayColor(color.key)}`);
        button.setAttribute('aria-pressed', color.key === state.selected);
        const localUses = color.uses.filter((u) => own(asset.uses, u.id)).length;
        button.title = `${color.uses.length} uses${localUses ? ` · ${localUses} individual overrides` : ''}`;
        button.append(
          colorCell(displayColor(color.key), vectorTools.resolveColor(color.key, state.resources)),
          element('span', 'mapping-arrow', '→'),
          colorCell(
            target === 'keep' ? 'Original' : displayColor(target),
            vectorTools.resolveColor(target === 'keep' ? color.key : target, state.resources),
          ),
        );
        if (localUses) button.lastChild.append(element('span', 'count', '*'));
        button.onclick = () => selectColor(color.key);
        return button;
      }),
    );
    getElement('palette-list').scrollTop = scrollTop;
    getElement('color-count').textContent = colors.length;
    getElement('color-editor').hidden = !colors.length;
  }
  function renderTones(replacement) {
    const container = getElement('tone-ramps');
    container.replaceChildren();
    const ramps = vectorTools.tintsAndShades(
      vectorTools.resolveColor(state.selected, state.resources),
      state.toneSteps,
    );
    if (!ramps) {
      container.append(
        element(
          'p',
          'editor-tip',
          'Import colors.xml to resolve the original color and generate tints and shades.',
        ),
      );
      return;
    }
    for (const [kind, label] of [
      ['shades', 'Shade'],
      ['tints', 'Tint'],
    ]) {
      const group = element('div', 'tone-group');
      const heading = element(
        'h4',
        'tone-heading',
        kind === 'shades' ? 'Shades · toward black' : 'Tints · toward white',
      );
      const grid = element('div', 'tone-grid');
      ramps[kind].forEach((value, index) => {
        const code = displayColor(value);
        const button = element('button', 'tone-button');
        button.type = 'button';
        button.dataset.tone = `${kind}-${index}`;
        button.setAttribute('aria-label', `${label} ${(index * 100) / state.toneSteps}% ${code}`);
        button.setAttribute('aria-pressed', value === replacement);
        button.title = `${index ? (index * 100) / state.toneSteps + '%' : 'Original'} ${label.toLowerCase()} · ${code}`;
        button.append(
          element('span', 'tone-step', index ? (index * 100) / state.toneSteps + '%' : 'Base'),
          swatch(value),
          element('code', 'tone-hex', code.slice(1)),
        );
        button.onclick = () => {
          edit(value);
          // Rendering replaces the grid; keep keyboard navigation on this swatch.
          container.querySelector(`[data-tone="${kind}-${index}"]`)?.focus({ preventScroll: true });
        };
        grid.append(button);
      });
      group.append(heading, grid);
      container.append(group);
    }
  }
  function renderEditor(keepInput) {
    const color = selectedPaletteEntry();
    if (!color) return;
    if (!color.uses.some((u) => u.id === state.use)) state.use = color.uses[0].id;
    const asset = activeAsset();
    const target = selectedReplacement();
    const resolved = vectorTools.resolveColor(
      target === 'keep' ? state.selected : target,
      state.resources,
    );
    const parts = vectorTools.colorParts(resolved);
    renderTones(resolved);
    getElement('selected-source').textContent =
      `${displayColor(state.selected)} · ${color.uses.length} use${color.uses.length === 1 ? '' : 's'}`;
    if (!keepInput) {
      getElement('target-hex').value = displayColor(resolved) || '';
      getElement('color-error').hidden = true;
      getElement('target-hex').removeAttribute('aria-invalid');
    }
    getElement('target-picker').value = parts?.rgb || '#FF00FF';
    getElement('color-error').textContent =
      asset.model.format === 'svg'
        ? 'Use SVG #RGB, #RGBA, #RRGGBB or #RRGGBBAA (alpha last).'
        : 'Use #RGB, #ARGB, #RRGGBB or #AARRGGBB (alpha first).';
    getElement('hex-hint').textContent =
      asset.model.format === 'svg'
        ? 'SVG hex · alpha last: #RRGGBBAA'
        : 'Android hex · alpha first: #AARRGGBB';
    getElement('edit-scope').value = state.scope;
    getElement('selected-use').replaceChildren(
      ...color.uses.map((use) => {
        const option = element('option', '', use.label);
        option.value = use.id;
        return option;
      }),
    );
    getElement('selected-use').value = state.use;
    getElement('selected-use').hidden = getElement('use-label').hidden = state.scope !== 'shape';
    const origin =
      state.scope === 'shape' && own(asset.uses, state.use)
        ? 'Selected use'
        : own(asset.overrides, state.selected)
          ? 'This image'
          : own(state.mappings, state.selected)
            ? 'Palette'
            : 'Suggested';
    getElement('mapping-origin').textContent = target === 'keep' ? 'Original kept' : origin;
  }
  function render(keepInput = false) {
    const asset = activeAsset();
    if (asset && !selectedPaletteEntry())
      state.selected = vectorTools.palette(asset.model)[0]?.key || '';
    getElement('asset-name').textContent = asset?.name || 'Your illustration';
    getElement('asset-count').textContent = state.assets.length;
    getElement('vector-meta').textContent = asset
      ? `${asset.model.document.querySelectorAll('path').length} paths · ${asset.model.document.documentElement.getAttributeNS(vectorTools.ANDROID, 'viewportWidth')} × ${asset.model.document.documentElement.getAttributeNS(vectorTools.ANDROID, 'viewportHeight')}`
      : '';
    const isSvg = asset?.model.format === 'svg';
    if (isSvg)
      getElement('vector-meta').textContent =
        `SVG · ${asset.model.bounds[2]} × ${asset.model.bounds[3]}`;
    getElement('export-current').textContent = isSvg ? 'Export SVG ↓' : 'Export XML ↓';
    getElement('export-title').textContent = isSvg ? 'Dark SVG' : 'Dark VectorDrawable XML';
    getElement('export-help').textContent = isSvg
      ? 'Export keeps SVG geometry, gradients, and supported styling.'
      : 'Save in drawable-night with the original filename.';
    getElement('dark-background').value = state.background;
    getElement('background-label').textContent = state.background;
    getElement('undo').disabled = !state.undo.length;
    getElement('redo').disabled = !state.redo.length;
    for (const id of ['export-current', 'export-all', 'show-xml', 'save-workspace'])
      getElement(id).disabled = !asset;
    getElement('profile-state').textContent = state.dirty
      ? 'Unsaved palette'
      : 'Palette saved locally';
    getElement('workspace-state').textContent = state.workspaceDirty
      ? 'Unsaved workspace · download to keep artwork and overrides.'
      : 'Save workspace to keep artwork and overrides.';
    getElement('profile-state').classList.toggle('saved', !state.dirty);
    getElement('resource-count').textContent = Object.keys(state.resources).length
      ? `${Object.keys(state.resources).length} source colors loaded`
      : 'Using @color/…? Add your source palette.';
    renderPalette();
    renderEditor(keepInput);
    renderPreviews();
    renderAssets();
  }
  function addAssets(assets) {
    const existing = state.assets.length === 1 && state.assets[0].demo ? 0 : state.assets.length;
    if (existing + assets.length > 100)
      throw new Error('A workspace supports up to 100 illustrations. Import a smaller collection.');
    if (state.assets.length === 1 && state.assets[0].demo) state.assets = [];
    for (const asset of assets) {
      const extension = asset.model.format === 'svg' ? '.svg' : '.xml';
      const base = asset.name.slice(0, -extension.length);
      let suffix = 2;
      while (state.assets.some((a) => a.name === asset.name))
        asset.name = `${base}_${suffix++}${extension}`;
      state.assets.push(asset);
    }
    state.active = state.assets.length - assets.length;
    state.selected = '';
    state.use = '';
    state.dirty = true;
    state.workspaceDirty = true;
    resetHistory();
    render();
  }
  function currentProfile() {
    const mappings = { ...state.mappings };
    // Snapshot shared suggestions only. Image/use overrides must never leak into a profile.
    for (const asset of state.assets)
      for (const color of vectorTools.palette(asset.model)) {
        const resolved = vectorTools.resolveColor(color.key, state.resources);
        if (!own(mappings, color.key) && resolved)
          mappings[color.key] = vectorTools.suggest(resolved);
      }
    return vectorTools.validateProfile({
      kind: 'vector-dark-palette',
      version: 1,
      name: getElement('profile-name').value,
      mappings,
      resources: state.resources,
      background: state.background,
    });
  }
  function applyProfile(profile) {
    state.mappings = { ...profile.mappings };
    state.resources = { ...profile.resources };
    state.background = profile.background;
    getElement('profile-name').value = profile.name;
    state.dirty = true;
    state.workspaceDirty = true;
    resetHistory();
    render();
  }
  function renderProfileOptions() {
    const initial = element('option', '', 'Saved profiles…');
    initial.value = '';
    getElement('saved-profiles').replaceChildren(
      initial,
      ...state.profiles.map((profile) => {
        const option = element('option', '', profile.name);
        option.value = profile.name;
        return option;
      }),
    );
  }
  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = element('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  const exportActiveAsset = () =>
    vectorTools.exportXml(
      activeAsset().model,
      effectiveMappings(activeAsset()),
      activeAsset().uses,
    );
  function downloadXml() {
    if (activeAsset()) {
      download(
        activeAsset().name,
        exportActiveAsset(),
        activeAsset().model.format === 'svg' ? 'image/svg+xml' : 'application/xml',
      );
      status(
        activeAsset().model.format === 'svg'
          ? `Downloaded ${activeAsset().name} as SVG.`
          : `Downloaded ${activeAsset().name}. Place it in drawable-night/ with the original filename.`,
      );
    }
  }
  function reportErrors(action) {
    return async (...args) => {
      try {
        await action(...args);
      } catch (error) {
        status(error.message, true);
      }
    };
  }
  async function readFiles(files) {
    if (files.length > 100) throw new Error('Import up to 100 illustrations at a time.');
    const loaded = [],
      errors = [];
    for (const file of files) {
      try {
        if (file.size > 5_000_000) throw new Error('File exceeds 5 MB.');
        loaded.push(makeAsset(file.name, await file.text()));
      } catch (error) {
        errors.push(`${file.name}: ${error.message}`);
      }
    }
    if (loaded.length) addAssets(loaded);
    status(
      [
        loaded.length
          ? `Added ${loaded.length} illustration${loaded.length === 1 ? '' : 's'}.`
          : '',
        ...errors,
      ]
        .filter(Boolean)
        .join(' '),
      errors.length > 0,
    );
  }
  function importWorkspace(value) {
    if (
      value.version !== 1 ||
      !Array.isArray(value.assets) ||
      !value.assets.length ||
      value.assets.length > 100
    )
      throw new Error('Invalid workspace: expected 1–100 illustrations.');
    const profile = vectorTools.validateProfile(value.profile);
    const assets = value.assets.map((entry) => {
      if (typeof entry.name !== 'string') throw new Error('Workspace asset needs a filename.');
      const asset = makeAsset(entry.name, entry.xml);
      asset.overrides = vectorTools.validateProfile({
        ...profile,
        mappings: entry.overrides,
      }).mappings;
      if (!entry.uses || typeof entry.uses !== 'object' || Array.isArray(entry.uses))
        throw new Error('Invalid selected-use overrides.');
      for (const [key, target] of Object.entries(entry.uses)) {
        if (
          !asset.model.uses.some((u) => u.id === key) ||
          !(target === 'keep' || vectorTools.normalizeColor(target))
        )
          throw new Error('Invalid selected-use override.');
        asset.uses[key] = target === 'keep' ? target : vectorTools.normalizeColor(target);
      }
      return asset;
    });
    if (new Set(assets.map((a) => a.name)).size !== assets.length)
      throw new Error('Workspace has duplicate filenames.');
    state.assets = assets;
    state.active = 0;
    state.selected = '';
    state.use = '';
    applyProfile(profile);
  }

  function bindImportEvents() {
    getElement('import-vectors').onclick = () => getElement('vector-files').click();
    getElement('vector-files').onchange = reportErrors(async (event) => {
      await readFiles([...event.target.files]);
      event.target.value = '';
    });
    getElement('paste-open').onclick = () => {
      getElement('paste-error').hidden = true;
      getElement('paste-dialog').showModal();
    };
    getElement('paste-close').onclick = () => getElement('paste-dialog').close();
    getElement('paste-import').onclick = () => {
      try {
        addAssets([makeAsset(getElement('xml-name').value, getElement('xml-input').value)]);
        getElement('paste-dialog').close();
        status('Added illustration. Select a color to edit its replacement.');
      } catch (error) {
        getElement('paste-error').textContent = error.message;
        getElement('paste-error').hidden = false;
      }
    };
    getElement('load-demo').onclick = () => {
      const asset = makeAsset('sample_bookshelf.xml', window.VectorStudioDemo);
      asset.demo = true;
      addAssets([asset]);
      status('Example loaded. Try editing the palette on the right.');
    };
  }

  function bindColorEditorEvents() {
    getElement('target-hex').oninput = () => {
      const color =
        activeAsset()?.model.format === 'svg'
          ? /^#[\da-f]+$/i.test(getElement('target-hex').value)
            ? vectorTools.normalizeSvgColor(getElement('target-hex').value)
            : null
          : vectorTools.normalizeColor(getElement('target-hex').value);
      getElement('color-error').hidden = !!color;
      getElement('target-hex').setAttribute('aria-invalid', !color);
      if (color) edit(color, true);
    };
    getElement('target-picker').oninput = () => {
      const current = vectorTools.resolveColor(
        selectedReplacement() === 'keep' ? state.selected : selectedReplacement(),
        state.resources,
      );
      const alpha = current?.length === 9 ? current.slice(1, 3) : '';
      edit('#' + alpha + getElement('target-picker').value.slice(1).toUpperCase());
    };
    for (const button of getElement('tone-steps').querySelectorAll('button')) {
      button.onclick = () => {
        state.toneSteps = Number(button.dataset.steps);
        for (const option of getElement('tone-steps').querySelectorAll('button'))
          option.setAttribute('aria-pressed', option === button);
        renderEditor(false);
      };
    }
    getElement('edit-scope').onchange = (event) => {
      state.scope = event.target.value;
      render();
    };
    getElement('selected-use').onchange = (event) => {
      state.use = event.target.value;
      render();
    };
    getElement('highlight').onchange = () => renderPreviews();
    getElement('keep-original').onclick = () => edit('keep');
    getElement('reset-color').onclick = () => {
      if (!activeAsset()) return;
      recordEdit();
      if (state.scope === 'shape') delete activeAsset().uses[state.use];
      else if (state.scope === 'image') delete activeAsset().overrides[state.selected];
      else delete state.mappings[state.selected];
      render();
    };
    getElement('undo').onclick = () => {
      if (state.undo.length) {
        state.redo.push(snapshotEdits());
        restoreEdits(state.undo.pop());
      }
    };
    getElement('redo').onclick = () => {
      if (state.redo.length) {
        state.undo.push(snapshotEdits());
        restoreEdits(state.redo.pop());
      }
    };
    getElement('dark-background').oninput = () => {
      recordEdit();
      state.background = getElement('dark-background').value.toUpperCase();
      render();
    };
    getElement('profile-name').oninput = () => {
      state.dirty = true;
      state.workspaceDirty = true;
      getElement('workspace-state').textContent =
        'Unsaved workspace · download to keep artwork and overrides.';
      getElement('profile-state').textContent = 'Unsaved palette';
      getElement('profile-state').classList.remove('saved');
    };
  }

  function bindProfileEvents() {
    getElement('save-profile').onclick = reportErrors(() => {
      const profile = currentProfile();
      const profiles = state.profiles.filter((p) => p.name !== profile.name).concat(profile);
      try {
        localStorage.setItem(STORAGE, JSON.stringify(profiles));
        localStorage.setItem(LAST, profile.name);
      } catch {
        throw new Error(
          'Browser storage is unavailable or full. Export the profile JSON to keep your palette.',
        );
      }
      state.profiles = profiles;
      state.mappings = profile.mappings;
      state.dirty = false;
      renderProfileOptions();
      getElement('saved-profiles').value = profile.name;
      render();
      status(
        `Saved “${profile.name}” in this browser. Export profile JSON for a portable backup. Illustration overrides remain in the workspace.`,
      );
    });
    getElement('saved-profiles').onchange = reportErrors((event) => {
      const profile = state.profiles.find((p) => p.name === event.target.value);
      if (!profile) return;
      applyProfile(profile);
      state.dirty = false;
      try {
        localStorage.setItem(LAST, profile.name);
      } catch {
        /* Export remains available. */
      }
      render();
      status(`Loaded “${profile.name}”. Per-illustration overrides are retained.`);
    });
    getElement('export-profile').onclick = reportErrors(() => {
      const profile = currentProfile();
      download('palette.json', JSON.stringify(profile, null, 2), 'application/json');
      status('Exported palette.json. Keep it to reuse your colors in any browser.');
    });
    getElement('save-workspace').onclick = reportErrors(() => {
      const workspace = {
        kind: 'vector-dark-workspace',
        version: 1,
        profile: currentProfile(),
        assets: state.assets.map((a) => ({
          name: a.name,
          xml: a.model.text,
          overrides: a.overrides,
          uses: a.uses,
        })),
      };
      const json = JSON.stringify(workspace, null, 2);
      if (new Blob([json]).size > 50_000_000)
        throw new Error(
          'Workspace exceeds the 50 MB import limit. Export the illustrations and palette separately instead.',
        );
      download('vector-workspace.json', json, 'application/json');
      state.workspaceDirty = false;
      render();
      status(
        'Workspace download requested with original vectors, palette, and all overrides. Check your downloads before closing.',
      );
    });
    getElement('import-json').onclick = () => getElement('json-file').click();
    getElement('json-file').onchange = reportErrors(async (event) => {
      const file = event.target.files[0];
      event.target.value = '';
      if (!file) return;
      if (file.size > 50_000_000) throw new Error('Use a JSON file smaller than 50 MB.');
      const value = JSON.parse(await file.text());
      if (value.kind === 'vector-dark-workspace') importWorkspace(value);
      else applyProfile(vectorTools.validateProfile(value));
      status(`Imported ${file.name}. Save profile to retain the shared palette in this browser.`);
    });
    getElement('import-resources').onclick = () => getElement('resource-files').click();
    getElement('resource-files').onchange = reportErrors(async (event) => {
      const files = [...event.target.files];
      event.target.value = '';
      const resources = {};
      for (const file of files) {
        if (file.size > 5_000_000) throw new Error('Use colors.xml files smaller than 5 MB.');
        Object.assign(resources, vectorTools.parseResources(await file.text()));
      }
      recordEdit();
      Object.assign(state.resources, resources);
      render();
      status(
        `Imported ${Object.keys(resources).length} source color definitions. Save profile to retain them.`,
      );
    });
  }

  function bindExportEvents() {
    getElement('export-current').onclick = downloadXml;
    getElement('download-xml').onclick = downloadXml;
    getElement('show-xml').onclick = () => {
      if (activeAsset()) {
        getElement('export-xml').value = exportActiveAsset();
        getElement('export-dialog').showModal();
      }
    };
    getElement('export-close').onclick = () => getElement('export-dialog').close();
    getElement('copy-xml').onclick = reportErrors(async () => {
      try {
        await navigator.clipboard.writeText(getElement('export-xml').value);
        status('XML copied.');
      } catch {
        getElement('export-xml').focus();
        getElement('export-xml').select();
        status('Press ⌘C / Ctrl+C to copy the selected XML.');
      }
    });
    getElement('export-all').onclick = reportErrors(() => {
      const files = state.assets.map((asset) => ({
        name: (asset.model.format === 'svg' ? 'svg-dark/' : 'drawable-night/') + asset.name,
        text: vectorTools.exportXml(asset.model, effectiveMappings(asset), asset.uses),
      }));
      files.push({ name: 'palette.json', text: JSON.stringify(currentProfile(), null, 2) });
      download('dark-vectors.zip', window.VectorStudioZip(files), 'application/zip');
      status(`Exported ${state.assets.length} dark vectors and palette.json in dark-vectors.zip.`);
    });
  }

  function bindPageEvents() {
    let dragDepth = 0;
    document.addEventListener('dragenter', (event) => {
      if ([...event.dataTransfer.types].includes('Files')) {
        event.preventDefault();
        dragDepth++;
        getElement('drop-overlay').hidden = false;
      }
    });
    document.addEventListener('dragover', (event) => {
      if ([...event.dataTransfer.types].includes('Files')) event.preventDefault();
    });
    document.addEventListener('dragleave', () => {
      if (--dragDepth <= 0) {
        dragDepth = 0;
        getElement('drop-overlay').hidden = true;
      }
    });
    document.addEventListener(
      'drop',
      reportErrors(async (event) => {
        event.preventDefault();
        dragDepth = 0;
        getElement('drop-overlay').hidden = true;
        await readFiles([...event.dataTransfer.files]);
      }),
    );

    window.addEventListener('beforeunload', (event) => {
      if (state.workspaceDirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
  }

  function initialize() {
    bindImportEvents();
    bindColorEditorEvents();
    bindProfileEvents();
    bindExportEvents();
    bindPageEvents();
    let storageProblem = '';
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE) || '[]');
      if (!Array.isArray(data)) throw new Error('Invalid stored profiles');
      state.profiles = data.map(vectorTools.validateProfile);
      renderProfileOptions();
      const profile = state.profiles.find((p) => p.name === localStorage.getItem(LAST));
      if (profile) {
        applyProfile(profile);
        state.dirty = false;
        getElement('saved-profiles').value = profile.name;
      }
    } catch {
      storageProblem =
        'Browser profiles could not be loaded. Your stored data has not been overwritten; use Import JSON or export your draft as a backup.';
    }
    const sample = makeAsset('sample_bookshelf.xml', window.VectorStudioDemo);
    sample.demo = true;
    state.assets = [sample];
    state.workspaceDirty = false;
    render();
    if (storageProblem) status(storageProblem, true);
  }

  initialize();
})();
