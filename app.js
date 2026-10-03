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
    useOnly: false,
    // The use last clicked in the artwork; "Only the clicked shape" edits need one.
    pickedUse: '',
    toneSteps: 10,
    mappings: {},
    resources: {},
    background: '#191B24',
    profiles: [],
    // Stored entries that failed validation. They are written back untouched on every save.
    unreadableProfiles: [],
    // Set when the stored list itself cannot be parsed, so a save cannot overwrite it.
    storageLocked: false,
    // Name of the saved profile the draft came from; saving under it updates without asking.
    loadedProfile: null,
    dirty: true,
    workspaceDirty: false,
    undo: [],
    redo: [],
  };
  const activeAsset = () => state.assets[state.active];
  /** Where an edit lands: one fill or stroke, this illustration only, or the shared palette. */
  function editScope() {
    if (state.useOnly && shapeScopeAvailable()) return 'shape';
    return activeAsset()?.separate ? 'image' : 'palette';
  }
  /** A single-use color edits the same shape either way, unless that use already has its own color. */
  function shapeScopeAvailable() {
    const asset = activeAsset();
    const uses = selectedPaletteEntry()?.uses || [];
    return uses.length > 1 || (!!asset && own(asset.uses, state.use));
  }
  const shapePicked = () => !!state.use && state.pickedUse === state.use;
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const pulseTimers = new WeakMap();
  const confirmTimers = new WeakMap();
  // Scripted motion bypasses the stylesheet's reduced-motion guard, so check it here.
  function animate(node, keyframes, options) {
    if (node && !reducedMotion.matches) node.animate(keyframes, options);
  }
  /** Restarts a CSS feedback class, even when the same feedback repeats quickly. */
  function pulse(node, className, duration) {
    if (!node) return;
    const timers = pulseTimers.get(node) || new Map();
    pulseTimers.set(node, timers);
    clearTimeout(timers.get(className));
    node.classList.remove(className);
    void node.offsetWidth;
    node.classList.add(className);
    timers.set(
      className,
      setTimeout(() => node.classList.remove(className), duration),
    );
  }
  const flash = (node) => pulse(node, 'feedback-flash', 900);
  function resetConfirmation(button) {
    clearTimeout(confirmTimers.get(button));
    const text = button.querySelector('.button-label') || button;
    if (button.dataset.label) text.textContent = button.dataset.label;
    button.style.minWidth = '';
  }
  /** Swaps a button label briefly without shifting its neighbours. */
  function confirmButton(button, label) {
    resetConfirmation(button);
    const text = button.querySelector('.button-label') || button;
    button.dataset.label = text.textContent;
    button.style.minWidth = `${button.offsetWidth}px`;
    text.textContent = label;
    pulse(button, 'confirmed', 300);
    confirmTimers.set(
      button,
      setTimeout(() => resetConfirmation(button), 1500),
    );
  }
  function setCount(id, value) {
    const node = getElement(id);
    if (node.textContent === String(value)) return;
    node.textContent = value;
    pulse(node, 'count-roll', 250);
  }
  /** Marks an error that one control can fix, so it is shown beside that control. */
  class FieldError extends Error {
    constructor(field, message) {
      super(message);
      this.field = field;
    }
  }
  let toastTimer;
  function closeToast() {
    clearTimeout(toastTimer);
    getElement('toast').classList.remove('open');
  }
  // Longer messages stay longer so they can be read before they fade.
  function scheduleToastClose() {
    clearTimeout(toastTimer);
    if (getElement('toast').dataset.tone === 'error') return;
    const length = getElement('status').textContent.length;
    const minimum = getElement('toast-action').hidden ? 3000 : 8000; // Leave time to reach Undo.
    toastTimer = setTimeout(closeToast, Math.min(10000, minimum + length * 45));
  }
  /**
   * Shows a floating message. Errors stay until dismissed; success and info messages fade.
   * An optional action ({ label, run }) adds a button, for example Undo; any later message replaces it.
   */
  function status(message, tone = 'success', action = null) {
    const toast = getElement('toast');
    const text = getElement('status');
    const button = getElement('toast-action');
    const wasOpen = toast.classList.contains('open');
    toast.dataset.tone = tone;
    toast.classList.add('open');
    text.classList.toggle('error', tone === 'error');
    text.setAttribute('aria-live', tone === 'error' ? 'assertive' : 'polite');
    text.textContent = message;
    button.hidden = !action;
    button.textContent = action?.label || '';
    button.onclick = action
      ? () => {
          closeToast();
          action.run();
        }
      : null;
    if (wasOpen) pulse(text, 'status-in', 250);
    scheduleToastClose();
  }
  let fieldAlert = null;
  function hideFieldError() {
    if (!fieldAlert) return;
    const { callout, field, ownsInvalid, describedBy, cleanup } = fieldAlert;
    fieldAlert = null;
    cleanup();
    callout.remove();
    if (ownsInvalid) field.removeAttribute('aria-invalid');
    if (describedBy) field.setAttribute('aria-describedby', describedBy);
    else field.removeAttribute('aria-describedby');
  }
  /** Points at the control that needs attention and keeps the callout attached while scrolling. */
  function showFieldError(field, message, { focus = true } = {}) {
    hideFieldError();
    const callout = element('div', 'field-callout');
    const text = element('p', '', message);
    const close = element('button', 'field-callout-close', '×');
    callout.popover = 'manual';
    callout.setAttribute('role', 'alert');
    text.id = 'field-callout-message';
    close.setAttribute('aria-label', 'Dismiss error');
    callout.append(text, close);
    // Inside a modal dialog the callout must be a descendant, or the dialog makes it inert.
    const dialog = field.closest('dialog');
    (dialog || document.body).append(callout);
    const describedBy = field.getAttribute('aria-describedby');
    fieldAlert = {
      callout,
      field,
      ownsInvalid: field.getAttribute('aria-invalid') !== 'true',
      describedBy,
    };
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', [describedBy, text.id].filter(Boolean).join(' '));
    const place = () => {
      const box = field.getBoundingClientRect();
      const width = callout.offsetWidth;
      const height = callout.offsetHeight;
      const above = box.bottom + height + 16 > window.innerHeight && box.top > height + 16;
      const left = Math.max(8, Math.min(box.left, window.innerWidth - width - 8));
      callout.classList.toggle('above', above);
      callout.style.top = `${above ? box.top - height - 10 : box.bottom + 10}px`;
      callout.style.left = `${left}px`;
      callout.style.setProperty(
        '--arrow-left',
        `${Math.max(12, Math.min(box.left - left + 16, width - 24))}px`,
      );
    };
    const onKey = (event) => event.key === 'Escape' && hideFieldError();
    close.onclick = () => {
      hideFieldError();
      field.focus();
    };
    field.addEventListener('input', hideFieldError);
    dialog?.addEventListener('close', hideFieldError);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', place, { capture: true, passive: true });
    window.addEventListener('resize', place);
    fieldAlert.cleanup = () => {
      field.removeEventListener('input', hideFieldError);
      dialog?.removeEventListener('close', hideFieldError);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', place, { capture: true });
      window.removeEventListener('resize', place);
    };
    callout.showPopover();
    place();
    if (focus) {
      field.scrollIntoView({
        block: 'center',
        behavior: reducedMotion.matches ? 'auto' : 'smooth',
      });
      field.focus({ preventScroll: true });
    }
    pulse(field, 'shake', 300);
  }
  const hexFormatError = () =>
    activeAsset()?.model.format === 'svg'
      ? 'Use SVG #RGB, #RGBA, #RRGGBB or #RRGGBBAA (alpha last).'
      : 'Use #RGB, #ARGB, #RRGGBB or #AARRGGBB (alpha first).';
  function paletteValues() {
    const asset = activeAsset();
    if (!asset) return [];
    const map = effectiveMappings(asset);
    return vectorTools
      .palette(asset.model)
      .map((color) =>
        JSON.stringify(
          color.uses.map((use) =>
            vectorTools.resolveColor(
              (asset.uses[use.id] || map[color.key]) === 'keep'
                ? color.key
                : asset.uses[use.id] || map[color.key],
              state.resources,
            ),
          ),
        ),
      );
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
    if (editScope() === 'shape' && own(asset.uses, state.use)) return asset.uses[state.use];
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
  // A picker drag or a typed hex value is one gesture and gets one undo entry.
  let openGesture = null;
  function recordEdit(gesture = null) {
    const key =
      gesture && [gesture, state.active, state.selected, editScope(), state.use].join('|');
    if (!key || key !== openGesture) {
      state.undo.push(snapshotEdits());
      if (state.undo.length > 80) state.undo.shift();
    }
    openGesture = key;
    state.redo = [];
    state.dirty = true;
    state.workspaceDirty = true;
  }
  const endGesture = () => (openGesture = null);
  // Picker drags fire faster than a full render, so they redraw at most once per frame.
  let renderFrame = 0;
  let frameKeepsInput = false;
  function scheduleRender(keepInput = false) {
    frameKeepsInput = keepInput;
    renderFrame ||= requestAnimationFrame(() => render(frameKeepsInput));
  }
  function restoreEdits(text) {
    const before = paletteValues();
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
    const after = paletteValues();
    getElement('palette-list')
      .querySelectorAll('.palette-row')
      .forEach((row, index) => {
        if (before[index] !== after[index]) flash(row);
      });
  }
  function resetHistory() {
    state.undo = [];
    state.redo = [];
  }
  function edit(target, { keepInput = false, gesture = null, deferred = false } = {}) {
    if (!activeAsset() || !state.selected) return;
    if (editScope() === 'shape' && !shapePicked()) {
      status('Click a shape in the artwork to choose it.', 'info');
      render();
      return;
    }
    recordEdit(gesture);
    if (editScope() === 'shape') activeAsset().uses[state.use] = target;
    else if (editScope() === 'image') activeAsset().overrides[state.selected] = target;
    else state.mappings[state.selected] = target;
    if (deferred) scheduleRender(keepInput);
    else render(keepInput);
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
    state.pickedUse = use;
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
      editScope() !== 'shape'
        ? palette?.uses
        : palette?.uses.filter((u) => shapePicked() && u.id === state.use);
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
      }
    }
    getElement('dark-preview').style.background = state.background;
    getElement('warning-box').hidden = warnings.size === 0;
    getElement('warning-summary').textContent =
      `${warnings.size} preview note${warnings.size === 1 ? '' : 's'} · review before export`;
    getElement('warnings').replaceChildren(...[...warnings].map((w) => element('li', '', w)));
  }
  function revealHighlight() {
    for (const id of ['light-preview', 'dark-preview'])
      pulse(getElement(id), 'highlight-enter', 300);
  }
  /** One listener per canvas: previews are rebuilt often, and per-path listeners were rebuilt with them. */
  function selectClickedPath(event) {
    const path = event.target.closest('[data-node]');
    const asset = activeAsset();
    if (!path || !asset) return;
    const index = Number(path.dataset.node);
    const use =
      asset.model.uses.find((u) => u.nodeIndex === index) ||
      asset.model.uses.find((u) =>
        asset.model.format === 'svg'
          ? vectorTools.svgNodesForUse(asset.model, u).includes(index)
          : asset.model.nodes[u.nodeIndex].closest('path') === asset.model.nodes[index],
      );
    if (!use) return;
    const revealing = !getElement('highlight').checked;
    getElement('highlight').checked = true;
    selectColor(use.key, use.id);
    revealPaletteSelection();
    flash(getElement('palette-list').querySelector('.active'));
    if (revealing) revealHighlight();
  }
  // Nothing left to download once only the bundled example (or nothing) remains.
  const hasUserArtwork = () => state.assets.some((asset) => !asset.demo);
  function removeAsset(index) {
    const before = {
      assets: [...state.assets],
      active: state.active,
      selected: state.selected,
      use: state.use,
      undo: state.undo,
      redo: state.redo,
      workspaceDirty: state.workspaceDirty,
    };
    const [removed] = state.assets.splice(index, 1);
    if (index < state.active) state.active--;
    else if (index === state.active) {
      state.active = Math.max(0, Math.min(index, state.assets.length - 1));
      state.selected = '';
      state.use = '';
    }
    state.workspaceDirty = hasUserArtwork();
    resetHistory(); // Edit snapshots use collection indices; removal invalidates them.
    render();
    const focus =
      getElement('asset-list').querySelectorAll('.asset-remove')[
        Math.min(index, state.assets.length - 1)
      ] || getElement('import-vectors');
    focus.focus({ preventScroll: true });
    status(`Removed ${removed.name}. Original file unchanged.`, 'success', {
      label: 'Undo',
      run: () => restoreAsset(removed, index, before),
    });
  }
  function restoreAsset(asset, index, before) {
    // Another asset may have taken the name since; keep filenames unique.
    if (state.assets.length >= 100 || state.assets.some((a) => a.name === asset.name)) {
      status(`Cannot restore ${asset.name}: the collection has changed.`, 'error');
      return;
    }
    const untouched = !state.undo.length && !state.redo.length;
    state.assets.splice(Math.min(index, state.assets.length), 0, asset);
    // The old history still matches only if the collection is back as it was and nothing was edited.
    const unchanged =
      untouched &&
      before.assets.length === state.assets.length &&
      before.assets.every((item, i) => state.assets[i] === item);
    endGesture();
    if (unchanged) {
      state.active = before.active;
      state.selected = before.selected;
      state.use = before.use;
      state.undo = before.undo;
      state.redo = before.redo;
      state.workspaceDirty = before.workspaceDirty;
    } else {
      state.active = state.assets.indexOf(asset);
      state.selected = '';
      state.use = '';
      state.workspaceDirty = hasUserArtwork();
    }
    render();
    flash(getElement('asset-list').querySelectorAll('.asset')[state.assets.indexOf(asset)]);
    status(`Restored ${asset.name}.`);
  }
  // Rendered thumbnails, reused until the colors that reach that illustration change.
  const thumbnails = new WeakMap();
  function thumbnail(asset, resources) {
    const map = effectiveMappings(asset);
    const key = JSON.stringify([
      vectorTools.palette(asset.model).map((color) => map[color.key]),
      asset.uses,
      resources,
    ]);
    const cached = thumbnails.get(asset);
    if (cached?.key === key) return cached.svg;
    const { svg } = vectorTools.render(asset.model, map, asset.uses, state.resources);
    svg.setAttribute('aria-hidden', 'true');
    thumbnails.set(asset, { key, svg });
    return svg;
  }
  function renderAssets() {
    const list = getElement('asset-list');
    // Measure before replacing cards so moved cards glide into place.
    const before = new Map(
      [...list.querySelectorAll('.asset-card')].map((card) => [
        card.dataset.name,
        card.getBoundingClientRect().left,
      ]),
    );
    const resources = JSON.stringify(state.resources);
    list.replaceChildren(
      ...state.assets.map((asset, index) => {
        const button = element('button', 'asset' + (index === state.active ? ' active' : ''));
        button.setAttribute('aria-label', `Select ${asset.name}`);
        button.setAttribute('aria-pressed', index === state.active);
        const image = element('span', 'asset-preview');
        image.style.background = state.background;
        image.append(thumbnail(asset, resources));
        button.append(image, element('span', 'asset-title', asset.name));
        button.title = asset.name;
        button.onclick = () => {
          state.active = index;
          const palette = vectorTools.palette(asset.model);
          if (!palette.some((p) => p.key === state.selected))
            state.selected = palette[0]?.key || '';
          state.use = selectedPaletteEntry()?.uses[0]?.id || '';
          state.pickedUse = '';
          render();
        };
        const card = element('div', 'asset-card');
        card.dataset.name = asset.name;
        const remove = element('button', 'asset-remove quiet', 'Remove');
        remove.type = 'button';
        remove.setAttribute('aria-label', `Remove ${asset.name}`);
        remove.onclick = () => removeAsset(index);
        card.append(button, remove);
        return card;
      }),
    );
    if (reducedMotion.matches) return;
    const glide = { duration: 220, easing: 'ease-out' };
    for (const card of list.querySelectorAll('.asset-card')) {
      const left = card.getBoundingClientRect().left;
      const offset = before.get(card.dataset.name) - left;
      if (offset)
        animate(card, [{ transform: `translateX(${offset}px)` }, { transform: 'none' }], glide);
    }
  }
  const paletteTargets = { asset: null, colors: new Map() };
  function renderPalette() {
    const asset = activeAsset();
    const colors = asset ? vectorTools.palette(asset.model) : [];
    const map = asset ? effectiveMappings(asset) : {};
    const scrollTop = getElement('palette-list').scrollTop;
    // Blend changed replacement swatches from their previous color; the artwork itself never animates.
    const previous = paletteTargets.asset === asset ? paletteTargets.colors : new Map();
    paletteTargets.asset = asset;
    paletteTargets.colors = new Map();
    getElement('palette-list').replaceChildren(
      ...colors.map((color) => {
        const target = map[color.key];
        const resolvedTarget = vectorTools.resolveColor(
          target === 'keep' ? color.key : target,
          state.resources,
        );
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
          colorCell(target === 'keep' ? 'Original' : displayColor(target), resolvedTarget),
        );
        if (localUses) button.lastChild.append(element('span', 'count', '*'));
        const rgb = vectorTools.colorParts(resolvedTarget)?.rgb;
        const from = previous.get(color.key);
        if (rgb) paletteTargets.colors.set(color.key, rgb);
        if (rgb && from && from !== rgb)
          animate(
            button.lastChild.querySelector('.swatch > span'),
            [{ backgroundColor: from }, { backgroundColor: rgb }],
            { duration: 220, easing: 'ease-out' },
          );
        button.onclick = () => selectColor(color.key);
        return button;
      }),
    );
    getElement('palette-list').scrollTop = scrollTop;
    setCount('color-count', colors.length);
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
        const check = element('span', 'tone-check', '✓');
        check.setAttribute('aria-hidden', 'true');
        button.append(check);
        button.onclick = () => {
          edit(value);
          // Rendering replaces the grid; keep keyboard navigation on this swatch.
          const picked = container.querySelector(`[data-tone="${kind}-${index}"]`);
          picked?.focus({ preventScroll: true });
          pulse(picked, 'picked', 300);
        };
        grid.append(button);
      });
      group.append(heading, grid);
      container.append(group);
    }
  }
  /** Collection indices a replacement at the given scope would change. */
  function affectedAssets(scope = editScope()) {
    if (scope !== 'palette') return [state.active];
    return state.assets.flatMap((item, index) =>
      !own(item.overrides, state.selected) &&
      vectorTools
        .palette(item.model)
        .some(
          (entry) =>
            entry.key === state.selected && entry.uses.some((use) => !own(item.uses, use.id)),
        )
        ? [index]
        : [],
    );
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
      if (fieldAlert?.field === getElement('target-hex')) hideFieldError();
      getElement('target-hex').removeAttribute('aria-invalid');
    }
    getElement('target-picker').value = parts?.rgb || '#FF00FF';
    getElement('hex-hint').textContent =
      asset.model.format === 'svg'
        ? 'SVG hex · alpha last: #RRGGBBAA'
        : 'Android hex · alpha first: #AARRGGBB';
    const scope = editScope();
    const affected = affectedAssets('palette').length;
    const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
    getElement('scope-heading').textContent = `Change ${displayColor(state.selected)} in`;
    getElement(`scope-${scope}`).checked = true;
    getElement('scope-palette-count').textContent = `· ${plural(affected, 'illustration')}`;
    getElement('scope-image-count').textContent = `· ${plural(color.uses.length, 'place')}`;
    getElement('scope-shape-option').hidden = !shapeScopeAvailable();
    const picked = color.uses.find((use) => shapePicked() && use.id === state.use);
    getElement('scope-impact').textContent =
      scope === 'shape'
        ? picked
          ? `Affects only the clicked shape (${picked.label}).`
          : 'Click a shape in the artwork to choose it.'
        : scope === 'image'
          ? 'Affects this illustration only. Colors you have not changed here still follow the palette.'
          : `Affects ${plural(affected, 'illustration')}. Separately edited colors stay unchanged.`;
    const origin =
      editScope() === 'shape' && own(asset.uses, state.use)
        ? 'Selected use'
        : own(asset.overrides, state.selected)
          ? 'This image'
          : own(state.mappings, state.selected)
            ? 'Palette'
            : 'Suggested';
    getElement('mapping-origin').textContent = target === 'keep' ? 'Original kept' : origin;
  }
  function render(keepInput = false) {
    cancelAnimationFrame(renderFrame);
    renderFrame = 0;
    const asset = activeAsset();
    if (asset && !selectedPaletteEntry())
      state.selected = vectorTools.palette(asset.model)[0]?.key || '';
    getElement('asset-name').textContent = asset?.name || 'Your illustration';
    setCount('asset-count', state.assets.length);
    getElement('vector-meta').textContent = asset
      ? `${asset.model.document.querySelectorAll('path').length} paths · ${asset.model.document.documentElement.getAttributeNS(vectorTools.ANDROID, 'viewportWidth')} × ${asset.model.document.documentElement.getAttributeNS(vectorTools.ANDROID, 'viewportHeight')}`
      : '';
    const isSvg = asset?.model.format === 'svg';
    if (isSvg)
      getElement('vector-meta').textContent =
        `SVG · ${asset.model.bounds[2]} × ${asset.model.bounds[3]}`;
    // The first text node is the label; the arrow span stays for its download cue.
    getElement('export-current').firstChild.textContent = isSvg ? 'Export SVG ' : 'Export XML ';
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
    const savedName = getElement('saved-profiles').value;
    getElement('delete-profile').disabled = !savedName;
    getElement('delete-profile').setAttribute(
      'aria-label',
      savedName ? `Delete saved profile “${savedName}”` : 'Delete saved profile',
    );
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
    const cards = [...getElement('asset-list').querySelectorAll('.asset-card')].slice(state.active);
    cards.forEach((card, index) => {
      card.style.setProperty('--stagger', `${Math.min(index, 8) * 40}ms`);
      pulse(card, 'entering', 600);
      flash(card.querySelector('.asset'));
    });
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
    if (!getElement('profile-name').value.trim())
      throw new FieldError('profile-name', 'Enter a profile name to save or export your palette.');
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
    state.loadedProfile = null;
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
        if (error.field) showFieldError(getElement(error.field), error.message);
        else status(error.message, 'error');
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
    if (!loaded.length && !errors.length) return;
    status(
      [
        loaded.length
          ? `Added ${loaded.length} illustration${loaded.length === 1 ? '' : 's'}.`
          : '',
        ...errors,
      ]
        .filter(Boolean)
        .join(' '),
      errors.length ? 'error' : 'success',
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
      // Older workspaces have no flag: an illustration with its own colors was edited separately.
      asset.separate =
        typeof entry.separate === 'boolean'
          ? entry.separate
          : Object.keys(asset.overrides).length > 0;
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
    [...getElement('asset-list').querySelectorAll('.asset')].forEach(flash);
  }

  function bindImportEvents() {
    getElement('agent-prompt-close').onclick = () => getElement('agent-prompt-dialog').close();
    getElement('copy-agent-prompt').onclick = reportErrors(async () => {
      const button = getElement('copy-agent-prompt');
      const prompt = agentPrompt();
      resetConfirmation(button);
      button.disabled = true;
      try {
        await navigator.clipboard.writeText(prompt);
        confirmButton(button, 'Copied ✓');
        status('Agent prompt copied. Paste it into your agent chat.');
      } catch {
        const text = getElement('agent-prompt-text');
        text.value = prompt;
        getElement('agent-prompt-dialog').showModal();
        text.focus();
        text.select();
        status('Press ⌘C / Ctrl+C to copy the selected agent prompt.', 'info');
      } finally {
        button.disabled = false;
      }
    });
    getElement('import-vectors').onclick = () => getElement('vector-files').click();
    getElement('vector-files').onchange = reportErrors(async (event) => {
      await readFiles([...event.target.files]);
      event.target.value = '';
    });
    getElement('paste-open').onclick = () => {
      getElement('paste-dialog').showModal();
    };
    getElement('paste-close').onclick = () => getElement('paste-dialog').close();
    getElement('paste-import').onclick = () => {
      try {
        addAssets([makeAsset(getElement('xml-name').value, getElement('xml-input').value)]);
        getElement('paste-dialog').close();
        status('Added illustration. Select a color to edit its replacement.');
      } catch (error) {
        showFieldError(getElement('xml-input'), error.message);
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
    const typedColor = () => {
      const value = getElement('target-hex').value.trim();
      return activeAsset()?.model.format === 'svg'
        ? /^#[\da-f]+$/i.test(value)
          ? vectorTools.normalizeSvgColor(value)
          : null
        : vectorTools.normalizeColor(value);
    };
    // While typing, apply only complete #RRGGBB or 8-digit values: #123 and #1234 are also valid
    // short forms, and applying them would flash unintended colors. Short forms apply on commit.
    const complete = () =>
      /^#?([\da-f]{6}|[\da-f]{8})$/i.test(getElement('target-hex').value.trim());
    getElement('target-hex').oninput = () => {
      const color = typedColor();
      getElement('target-hex').setAttribute('aria-invalid', !color);
      if (color && complete()) edit(color, { keepInput: true, gesture: 'hex' });
    };
    // Shake on commit, not on keystrokes: partial hex values are invalid while typing.
    getElement('target-hex').onchange = () => {
      const color = typedColor();
      if (!color) showFieldError(getElement('target-hex'), hexFormatError(), { focus: false });
      else if (!complete()) edit(color, { gesture: 'hex' });
      endGesture();
    };
    getElement('target-picker').oninput = () => {
      const current = vectorTools.resolveColor(
        selectedReplacement() === 'keep' ? state.selected : selectedReplacement(),
        state.resources,
      );
      const alpha = current?.length === 9 ? current.slice(1, 3) : '';
      edit('#' + alpha + getElement('target-picker').value.slice(1).toUpperCase(), {
        gesture: 'picker',
        deferred: true,
      });
    };
    getElement('target-picker').onchange = endGesture;
    for (const id of ['light-preview', 'dark-preview'])
      getElement(id).addEventListener('click', selectClickedPath);
    for (const button of getElement('tone-steps').querySelectorAll('button')) {
      button.onclick = () => {
        state.toneSteps = Number(button.dataset.steps);
        for (const option of getElement('tone-steps').querySelectorAll('button'))
          option.setAttribute('aria-pressed', option === button);
        renderEditor(false);
      };
    }
    const showScopeChange = () => {
      endGesture();
      render();
      pulse(getElement('scope-impact'), 'status-in', 250);
      if (editScope() === 'shape') flash(getElement('palette-list').querySelector('.active'));
      else {
        const cards = getElement('asset-list').querySelectorAll('.asset');
        for (const index of affectedAssets()) flash(cards[index]);
      }
    };
    const setScope = (scope) => {
      const asset = activeAsset();
      if (!asset) return;
      state.useOnly = scope === 'shape';
      const wasSeparate = !!asset.separate;
      if (scope !== 'shape') asset.separate = scope === 'image';
      if (!!asset.separate !== wasSeparate) state.workspaceDirty = true;
      showScopeChange();
      const custom = Object.keys(asset.overrides).length;
      if (!wasSeparate || asset.separate || !custom) return;
      // Turning separation off keeps earlier edits; offer to drop them in one step.
      status(
        `${asset.name} keeps ${custom} separately edited color${custom === 1 ? '' : 's'}. New changes apply to the palette.`,
        'info',
        {
          label: 'Use palette colors',
          run: () => {
            if (!state.assets.includes(asset)) return;
            recordEdit();
            asset.overrides = {};
            render();
            status(`${asset.name} now follows the palette.`);
          },
        },
      );
    };
    for (const scope of ['palette', 'image', 'shape'])
      getElement(`scope-${scope}`).onchange = () => setScope(scope);
    getElement('highlight').onchange = () => {
      renderPreviews();
      if (getElement('highlight').checked) revealHighlight();
    };
    getElement('keep-original').onclick = () => edit('keep');
    getElement('reset-color').onclick = () => {
      if (!activeAsset()) return;
      recordEdit();
      if (editScope() === 'shape') delete activeAsset().uses[state.use];
      else if (editScope() === 'image') delete activeAsset().overrides[state.selected];
      else delete state.mappings[state.selected];
      render();
    };
    getElement('undo').onclick = () => {
      if (state.undo.length) {
        endGesture();
        state.redo.push(snapshotEdits());
        restoreEdits(state.undo.pop());
        pulse(getElement('undo'), 'nudge-back', 260);
        status('Undo complete. Previous colors and settings restored.');
      }
    };
    getElement('redo').onclick = () => {
      if (state.redo.length) {
        endGesture();
        state.undo.push(snapshotEdits());
        restoreEdits(state.redo.pop());
        pulse(getElement('redo'), 'nudge-forward', 260);
        status('Redo complete. Colors and settings reapplied.');
      }
    };
    getElement('dark-background').oninput = () => {
      recordEdit('background');
      state.background = getElement('dark-background').value.toUpperCase();
      scheduleRender();
    };
    getElement('dark-background').onchange = endGesture;
    getElement('profile-name').oninput = () => {
      state.dirty = true;
      state.workspaceDirty = true;
      getElement('workspace-state').textContent =
        'Unsaved workspace · download to keep artwork and overrides.';
      getElement('profile-state').textContent = 'Unsaved palette';
      getElement('profile-state').classList.remove('saved');
    };
  }

  /**
   * Stores the saved profiles. Entries this version could not read are written back untouched,
   * and nothing is written when the stored list itself was unreadable.
   * `last` names the profile to reopen on the next visit; null forgets it, undefined keeps it.
   */
  function writeProfiles(profiles, last) {
    if (state.storageLocked)
      throw new Error(
        'Saved profiles could not be read, so saving is paused to protect them. Use Export profile to keep your palette.',
      );
    try {
      localStorage.setItem(STORAGE, JSON.stringify([...state.unreadableProfiles, ...profiles]));
      if (last === null) localStorage.removeItem(LAST);
      else if (last) localStorage.setItem(LAST, last);
    } catch {
      throw new Error(
        'Browser storage is unavailable or full. Export the profile JSON to keep your palette.',
      );
    }
    state.profiles = profiles;
    renderProfileOptions();
  }
  const sortedEntries = (object) =>
    Object.entries(object).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const sameColors = (a, b) =>
    JSON.stringify([sortedEntries(a.mappings), sortedEntries(a.resources), a.background]) ===
    JSON.stringify([sortedEntries(b.mappings), sortedEntries(b.resources), b.background]);
  /** Resolves true when the user chooses to replace the saved profile with the same name. */
  function confirmOverwrite(name) {
    const dialog = getElement('overwrite-dialog');
    getElement('overwrite-title').textContent = `Replace “${name}”?`;
    dialog.returnValue = '';
    dialog.showModal();
    return new Promise((resolve) =>
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'replace'), {
        once: true,
      }),
    );
  }
  function bindProfileEvents() {
    getElement('save-profile').onclick = reportErrors(async () => {
      const profile = currentProfile();
      const existing = state.profiles.find((p) => p.name === profile.name);
      if (
        existing &&
        existing.name !== state.loadedProfile &&
        !sameColors(existing, profile) &&
        !(await confirmOverwrite(profile.name))
      ) {
        status(
          `Kept the saved “${profile.name}”. Rename this profile to save it separately.`,
          'info',
        );
        return;
      }
      writeProfiles(
        state.profiles.filter((p) => p.name !== profile.name).concat(profile),
        profile.name,
      );
      state.loadedProfile = profile.name;
      state.mappings = profile.mappings;
      state.dirty = false;
      getElement('saved-profiles').value = profile.name;
      render();
      confirmButton(getElement('save-profile'), 'Saved ✓');
      pulse(getElement('profile-state'), 'saved-pop', 400);
      status(
        `Saved “${profile.name}” in this browser. Export profile JSON for a portable backup. Illustration overrides remain in the workspace.`,
      );
    });
    getElement('saved-profiles').onchange = reportErrors((event) => {
      const profile = state.profiles.find((p) => p.name === event.target.value);
      render();
      if (!profile) return;
      applyProfile(profile);
      state.loadedProfile = profile.name;
      state.dirty = false;
      try {
        localStorage.setItem(LAST, profile.name);
      } catch {
        /* Export remains available. */
      }
      render();
      status(`Loaded “${profile.name}”. Per-illustration overrides are retained.`);
    });
    getElement('delete-profile').onclick = reportErrors(() => {
      const name = getElement('saved-profiles').value;
      const index = state.profiles.findIndex((p) => p.name === name);
      if (index < 0) return;
      const removed = state.profiles[index];
      const wasLoaded = state.loadedProfile === name;
      writeProfiles(
        state.profiles.filter((p) => p !== removed),
        wasLoaded ? null : undefined,
      );
      if (wasLoaded) {
        state.loadedProfile = null;
        state.dirty = true;
      }
      getElement('saved-profiles').value = '';
      render();
      status(`Deleted “${name}” from this browser. Your current colors are unchanged.`, 'success', {
        label: 'Undo',
        run: reportErrors(() => {
          if (state.profiles.some((p) => p.name === name))
            throw new Error(`Cannot restore “${name}”: a profile with that name was saved since.`);
          const profiles = [...state.profiles];
          profiles.splice(Math.min(index, profiles.length), 0, removed);
          writeProfiles(profiles, wasLoaded ? name : undefined);
          if (wasLoaded) {
            state.loadedProfile = name;
            getElement('saved-profiles').value = name;
          }
          render();
          status(`Restored “${name}”.`);
        }),
      });
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
          separate: !!a.separate,
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
    getElement('export-current').onclick = () => {
      downloadXml();
      pulse(getElement('export-current').querySelector('.arrow'), 'dip', 350);
    };
    getElement('download-xml').onclick = downloadXml;
    getElement('show-xml').onclick = () => {
      if (activeAsset()) {
        getElement('export-xml').value = exportActiveAsset();
        getElement('export-dialog').showModal();
      }
    };
    getElement('export-close').onclick = () => getElement('export-dialog').close();
    getElement('copy-xml').onclick = reportErrors(async () => {
      const button = getElement('copy-xml');
      resetConfirmation(button);
      button.disabled = true;
      try {
        await navigator.clipboard.writeText(getElement('export-xml').value);
        confirmButton(button, 'Copied ✓');
        status('XML copied.');
      } catch {
        getElement('export-xml').focus();
        getElement('export-xml').select();
        status('Press ⌘C / Ctrl+C to copy the selected XML.', 'info');
      } finally {
        button.disabled = false;
      }
    });
    getElement('export-all').onclick = reportErrors(() => {
      const files = state.assets.map((asset) => ({
        name: (asset.model.format === 'svg' ? 'svg-dark/' : 'drawable-night/') + asset.name,
        text: vectorTools.exportXml(asset.model, effectiveMappings(asset), asset.uses),
      }));
      files.push({ name: 'palette.json', text: JSON.stringify(currentProfile(), null, 2) });
      download('dark-vectors.zip', window.VectorStudioZip(files), 'application/zip');
      pulse(getElement('export-all').querySelector('.arrow'), 'dip', 350);
      status(`Exported ${state.assets.length} dark vectors and palette.json in dark-vectors.zip.`);
    });
  }

  function bindPageEvents() {
    const toast = getElement('toast');
    getElement('toast-close').onclick = closeToast;
    // Pause fading while the pointer or keyboard focus is on the message.
    toast.addEventListener('mouseenter', () => clearTimeout(toastTimer));
    toast.addEventListener('mouseleave', scheduleToastClose);
    toast.addEventListener('focusin', () => clearTimeout(toastTimer));
    toast.addEventListener('focusout', scheduleToastClose);
    const dropOverlay = getElement('drop-overlay');
    let dropOverlayTimer;
    const hideDropOverlay = () => {
      clearTimeout(dropOverlayTimer);
      dropOverlay.hidden = true;
    };
    // Browsers can skip dragleave or drop, such as after a refused drop or Escape, so a
    // dragenter/dragleave count can stick. The overlay stays only while dragover keeps firing,
    // which the HTML spec requires at least every 550 ms during a drag.
    const showDropOverlay = () => {
      dropOverlay.hidden = false;
      clearTimeout(dropOverlayTimer);
      dropOverlayTimer = setTimeout(hideDropOverlay, 600);
    };
    const hasFiles = (event) => [...(event.dataTransfer?.types || [])].includes('Files');
    // Files dropped while a dialog is open or an agent link loads would land behind it unseen.
    const dropBlocked = () =>
      getElement('editor').inert || !!document.querySelector('dialog[open]');
    document.addEventListener('dragenter', (event) => {
      if (!hasFiles(event) || dropBlocked()) return;
      event.preventDefault();
      showDropOverlay();
    });
    document.addEventListener('dragover', (event) => {
      if (!hasFiles(event)) return; // Text drags keep their default, such as inserting into a field.
      event.preventDefault(); // Without this the browser opens the file and leaves the editor.
      if (dropBlocked()) {
        event.dataTransfer.dropEffect = 'none';
        hideDropOverlay();
        return;
      }
      event.dataTransfer.dropEffect = 'copy';
      showDropOverlay();
    });
    document.addEventListener('dragleave', (event) => {
      // Moving between elements also fires dragleave; only leaving the window hides at once.
      const { clientX: x, clientY: y } = event;
      if (x <= 0 || y <= 0 || x >= innerWidth || y >= innerHeight) hideDropOverlay();
    });
    document.addEventListener(
      'drop',
      reportErrors(async (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        hideDropOverlay();
        if (dropBlocked()) return;
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

  function agentPrompt() {
    const url = new URL(location.href);
    url.hash = '';
    url.search = '';
    return `Open my SVG or Android VectorDrawable XML in Vector Dusk at ${url.href}.

Read the file and retain its original project path and filename. Read-only filesystem access permits reading the source and generating a link in memory; it only prevents file writes. If browser tools are unavailable, still prepare and provide the import link for me to open. If the source is unavailable, ask for the file or its contents.

Run this Node.js example to create a gzip-compressed UTF-8, Base64url import link (#v=1). Copy its output exactly; do not compose or retype compressed data. Decode the generated link and compare it with the source before sharing:

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { gzipSync } from 'node:zlib';
const file = 'path/to/illustration.svg'; // Or a VectorDrawable XML file.
const source = readFileSync(file);
if (source.length > 5_000_000) throw new Error('File exceeds 5 MB.');
const url = new URL(${JSON.stringify(url.href)});
url.hash = new URLSearchParams({ v: '1', name: basename(file), encoding: 'gzip', data: gzipSync(source).toString('base64url') }).toString();
if (url.href.length > 65_536) throw new Error('Link too large: use Paste XML or Import vectors.');
console.log(url.href);

The full URL limit is 65,536 characters; decompressed artwork is limited to 5,000,000 bytes. If the link is too large, use Paste XML or Import vectors instead. Uncompressed source is accepted with encoding=text or encoding omitted, using URLSearchParams. Preserve path geometry and alpha values during preparation.

For Android @color references, read the matching light-mode colors.xml and import it using Import colors.xml. Artwork links accept SVG or <vector> XML only; never create an artwork link for a <resources> file. When I must open the editor myself, provide a usable local colors.xml file link or its XML contents so I can import it separately.

Open the editor visibly for me. Report import and preview warnings. The link contains the artwork and is not encrypted. After import the fragment is cleared; save a workspace before refreshing.

Wait until I explicitly say the artwork is finalized before applying any result. Receiving an export or a request to save work in progress does not mean it is finalized. Tell me you will wait when I am still editing. Once finalized, return to the same tab and retrieve the current result using View XML (for SVG too) or the export/download controls. Opening the original link again loads the original input, not my edits. If you cannot access that tab, ask me to provide the finalized exported file; this prompt does not grant browser access.

Apply the finalized result to the intended project location, preserve the format and filename, and run relevant validation when writes are available. For Android dark-mode resources use the matching res/drawable-night/ directory with the original filename, preserving the light-mode original. State the intended output path when preparing the handoff.`;
  }

  async function importAgentLink() {
    const params = new URLSearchParams(location.hash.slice(1));
    if (!params.has('v')) return;
    if (location.href.length > 65_536)
      throw new Error('Agent link exceeds 65,536 characters. Use Paste XML or Import vectors.');
    for (const key of ['v', 'name', 'data', 'encoding'])
      if (params.getAll(key).length > 1) throw new Error(`Duplicate agent link parameter: ${key}.`);
    if (params.get('v') !== '1') throw new Error('Unsupported agent link version.');
    const name = params.get('name');
    let source = params.get('data');
    if (!name?.trim() || !source) throw new Error('Agent link needs a filename and artwork.');
    const encoding = params.get('encoding') ?? 'text';
    if (encoding === 'gzip') {
      if (!window.DecompressionStream)
        throw new Error(
          'This browser cannot decompress agent links. Use Paste XML or Import vectors.',
        );
      if (!/^[A-Za-z0-9_-]+$/.test(source) || source.length % 4 === 1)
        throw new Error('Invalid Base64url artwork in agent link.');
      const bytes = Uint8Array.from(atob(source.replaceAll('-', '+').replaceAll('_', '/')), (c) =>
        c.charCodeAt(0),
      );
      const reader = new Blob([bytes])
        .stream()
        .pipeThrough(new DecompressionStream('gzip'))
        .getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 5_000_000) throw new Error('Decompressed artwork exceeds 5 MB.');
          chunks.push(decoder.decode(value, { stream: true }));
        }
        chunks.push(decoder.decode());
        source = chunks.join('');
      } catch (error) {
        await reader.cancel().catch(() => {});
        throw new Error(`Cannot import compressed artwork: ${error.message}`);
      } finally {
        reader.releaseLock();
      }
    } else if (encoding !== 'text') throw new Error('Unsupported agent link encoding.');
    if (new TextEncoder().encode(source).byteLength > 5_000_000)
      throw new Error('Artwork exceeds 5 MB.');
    const asset = makeAsset(name, source);
    // Incoming artwork starts with the default suggestions, independent of a saved palette.
    state.mappings = {};
    state.resources = {};
    state.background = '#191B24';
    getElement('profile-name').value = 'My illustrations';
    getElement('saved-profiles').value = '';
    state.loadedProfile = null;
    addAssets([asset]);
    history.replaceState(null, '', location.pathname + location.search);
    status(
      'Artwork loaded. Review the preview notes before exporting. Save a workspace before refreshing.',
    );
  }

  async function initialize() {
    bindImportEvents();
    bindColorEditorEvents();
    bindProfileEvents();
    bindExportEvents();
    bindPageEvents();
    let storageProblem = '';
    let last = null;
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE) || '[]');
      if (!Array.isArray(data)) throw new Error('Invalid stored profiles');
      // One unreadable profile must not hide, or later overwrite, the others.
      for (const entry of data) {
        try {
          state.profiles.push(vectorTools.validateProfile(entry));
        } catch {
          state.unreadableProfiles.push(entry);
        }
      }
      last = localStorage.getItem(LAST);
    } catch {
      state.storageLocked = true;
      storageProblem =
        'Browser profiles could not be loaded. Saving is paused so your stored data is not overwritten; use Export profile or Save workspace as a backup.';
    }
    const skipped = state.unreadableProfiles.length;
    if (skipped)
      storageProblem = `${skipped} saved profile${skipped === 1 ? '' : 's'} could not be read and ${skipped === 1 ? 'was' : 'were'} skipped. ${skipped === 1 ? 'It stays' : 'They stay'} in browser storage unchanged.`;
    renderProfileOptions();
    const profile = state.profiles.find((p) => p.name === last);
    if (profile) {
      applyProfile(profile);
      state.loadedProfile = profile.name;
      state.dirty = false;
      getElement('saved-profiles').value = profile.name;
    }
    const sample = makeAsset('sample_bookshelf.xml', window.VectorStudioDemo);
    sample.demo = true;
    state.assets = [sample];
    state.workspaceDirty = false;
    render();
    if (storageProblem) status(storageProblem, 'error');
    if (new URLSearchParams(location.hash.slice(1)).has('v')) {
      const editor = getElement('editor');
      editor.inert = true;
      editor.setAttribute('aria-busy', 'true');
      status('Loading artwork from agent link…', 'info');
      try {
        await reportErrors(importAgentLink)();
      } finally {
        editor.inert = false;
        editor.removeAttribute('aria-busy');
      }
    }
  }

  initialize();
})();
