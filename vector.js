/* Browser-native VectorDrawable conversion; no runtime dependencies. */
(() => {
  'use strict';
  const ANDROID = 'http://schemas.android.com/apk/res/android';
  const AAPT = 'http://schemas.android.com/aapt';
  const SVG = 'http://www.w3.org/2000/svg';
  const colorAttributes = {
    vector: ['tint'],
    path: ['fillColor', 'strokeColor'],
    gradient: ['startColor', 'centerColor', 'endColor'],
    item: ['color'],
  };
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const attr = (node, key, fallback = '') =>
    node.hasAttributeNS(ANDROID, key) ? node.getAttributeNS(ANDROID, key) : fallback;
  const number = (node, key, fallback = 0) => {
    const value = Number(attr(node, key, String(fallback)));
    if (!Number.isFinite(value))
      throw new Error(
        `Unsupported numeric value for ${key}. Resolve dimension resources before importing.`,
      );
    return value;
  };
  const { normalizeColor, colorParts, resolveColor } = window.VectorStudio;

  function parseXml(text) {
    if (typeof text !== 'string' || text.length > 5_000_000)
      throw new Error('Use an XML file smaller than 5 MB.');
    if (/<!DOCTYPE|<!ENTITY/i.test(text))
      throw new Error('XML document types and entities are not supported.');
    const document = new DOMParser().parseFromString(text, 'application/xml');
    if (document.querySelector('parsererror'))
      throw new Error('Invalid XML. Check that tags and namespace declarations are complete.');
    return document;
  }

  function parseVector(text) {
    const document = parseXml(text);
    const root = document.documentElement;
    if (root.localName === 'svg' && window.VectorStudio.parseSvg)
      return window.VectorStudio.parseSvg(text);
    if (root.localName !== 'vector' || root.namespaceURI)
      throw new Error('Choose an Android <vector> XML or an <svg> file.');
    if (!(number(root, 'viewportWidth') > 0 && number(root, 'viewportHeight') > 0))
      throw new Error('The vector needs positive viewportWidth and viewportHeight values.');
    const nodes = [...document.querySelectorAll('*')];
    const uses = [];
    nodes.forEach((node, index) => {
      if (node.namespaceURI) return;
      for (const key of colorAttributes[node.localName] || []) {
        if (!node.hasAttributeNS(ANDROID, key)) continue;
        const raw = attr(node, key);
        uses.push({
          id: `${index}:${key}`,
          nodeIndex: index,
          attribute: key,
          raw,
          key: normalizeColor(raw) || raw,
          label: `${attr(node, 'name', node.localName + ' ' + index)} · ${key}`,
        });
      }
    });
    return { format: 'android', document, nodes, uses, text };
  }

  function parseResources(text) {
    const document = parseXml(text);
    if (document.documentElement.localName !== 'resources')
      throw new Error('Choose a values/colors.xml file with a <resources> root.');
    const resources = {};
    for (const node of document.documentElement.children) {
      if (
        node.localName !== 'color' &&
        !(node.localName === 'item' && node.getAttribute('type') === 'color')
      )
        continue;
      const name = node.getAttribute('name');
      const value = node.textContent.trim();
      if (name && (normalizeColor(value) || /^[@?]/.test(value)))
        resources['@color/' + name] = normalizeColor(value) || value;
    }
    if (!Object.keys(resources).length)
      throw new Error('No color values found in this resources file.');
    return resources;
  }

  function palette(model) {
    const colors = new Map();
    for (const use of model.uses) {
      if (!colors.has(use.key)) colors.set(use.key, { key: use.key, uses: [] });
      colors.get(use.key).uses.push(use);
    }
    return [...colors.values()];
  }

  function replacement(use, mappings, overrides) {
    const target = own(overrides, use.id)
      ? overrides[use.id]
      : own(mappings, use.key)
        ? mappings[use.key]
        : 'keep';
    return target === 'keep' ? use.raw : normalizeColor(target) || use.raw;
  }

  function exportXml(model, mappings = {}, overrides = {}) {
    if (model.format === 'svg') return window.VectorStudio.exportSvg(model, mappings, overrides);
    const copy = model.document.cloneNode(true);
    const nodes = [...copy.querySelectorAll('*')];
    for (const use of model.uses) {
      const target = replacement(use, mappings, overrides);
      if (target !== use.raw) {
        const attribute = nodes[use.nodeIndex].getAttributeNodeNS(ANDROID, use.attribute);
        attribute.value = target;
      }
    }
    const serialized = new XMLSerializer().serializeToString(copy);
    return /^\s*<\?xml/.test(serialized)
      ? serialized
      : '<?xml version="1.0" encoding="utf-8"?>\n' + serialized;
  }

  let nextRender = 0;
  function render(model, mappings = {}, overrides = {}, resources = {}) {
    if (model.format === 'svg') return window.VectorStudio.renderSvg(model, mappings, overrides);
    const warnings = new Set();
    const prefix = 'vector-' + ++nextRender + '-';
    const create = (name, attributes = {}) => {
      const node = document.createElementNS(SVG, name);
      for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
      return node;
    };
    const root = model.document.documentElement;
    const svg = create('svg', {
      viewBox: `0 0 ${number(root, 'viewportWidth')} ${number(root, 'viewportHeight')}`,
      role: 'img',
      'aria-label': 'VectorDrawable preview',
    });
    const defs = create('defs');
    const content = create('g', { opacity: number(root, 'alpha', 1) });
    svg.append(defs, content);
    const uses = new Map(model.uses.map((u) => [u.id, u]));
    const indexes = new Map(model.nodes.map((node, index) => [node, index]));
    let nextId = 0;
    function paint(node, name, fallback = '#00000000') {
      const use = uses.get(`${indexes.get(node)}:${name}`);
      const value = use ? replacement(use, mappings, overrides) : attr(node, name, fallback);
      const resolved = resolveColor(value, resources);
      if (!resolved)
        warnings.add(
          `Unresolved ${value}: import colors.xml or set a replacement. Magenta marks the missing preview color.`,
        );
      return colorParts(resolved || '#FF00FF');
    }
    function gradient(node) {
      const type = attr(node, 'type', 'linear');
      if (!['linear', 'radial', '0', '1'].includes(type)) {
        warnings.add(
          'Sweep gradients are preserved in export but approximated as linear in the preview.',
        );
      }
      const id = prefix + ++nextId;
      const radial = type === 'radial' || type === '1';
      const grad = create(radial ? 'radialGradient' : 'linearGradient', {
        id,
        gradientUnits: 'userSpaceOnUse',
        spreadMethod:
          { mirror: 'reflect', repeat: 'repeat', 1: 'repeat', 2: 'reflect' }[
            attr(node, 'tileMode')
          ] || 'pad',
      });
      const pairs = radial
        ? { cx: 'centerX', cy: 'centerY', r: 'gradientRadius' }
        : { x1: 'startX', y1: 'startY', x2: 'endX', y2: 'endY' };
      for (const [svgKey, androidKey] of Object.entries(pairs))
        grad.setAttribute(svgKey, number(node, androidKey));
      const items = [...node.children].filter((n) => n.localName === 'item' && !n.namespaceURI);
      const stops = items.length
        ? items.map((n) => [number(n, 'offset'), paint(n, 'color')])
        : [
            [0, paint(node, 'startColor')],
            ...(node.hasAttributeNS(ANDROID, 'centerColor')
              ? [[0.5, paint(node, 'centerColor')]]
              : []),
            [1, paint(node, 'endColor')],
          ];
      for (const [offset, color] of stops)
        grad.append(
          create('stop', { offset, 'stop-color': color.rgb, 'stop-opacity': color.alpha }),
        );
      defs.append(grad);
      return `url(#${id})`;
    }
    function walk(parent, destination) {
      let current = destination;
      for (const node of parent.children) {
        if (node.namespaceURI) {
          warnings.add(
            `Unsupported element ${node.nodeName} is preserved in export but omitted from preview.`,
          );
          continue;
        }
        if (node.localName === 'group') {
          const px = number(node, 'pivotX'),
            py = number(node, 'pivotY');
          const group = create('g', {
            transform: `translate(${number(node, 'translateX') + px} ${number(node, 'translateY') + py}) rotate(${number(node, 'rotation')}) scale(${number(node, 'scaleX', 1)} ${number(node, 'scaleY', 1)}) translate(${-px} ${-py})`,
          });
          if (number(node, 'scaleX', 1) !== number(node, 'scaleY', 1) && node.querySelector('path'))
            warnings.add(
              'Non-uniform group scaling can render Android stroke widths differently; verify on Android.',
            );
          current.append(group);
          walk(node, group);
        } else if (node.localName === 'clip-path') {
          const id = prefix + ++nextId;
          const clip = create('clipPath', { id, clipPathUnits: 'userSpaceOnUse' });
          clip.append(
            create('path', {
              d: attr(node, 'pathData'),
              'clip-rule': attr(node, 'fillType') === 'evenOdd' ? 'evenodd' : 'nonzero',
            }),
          );
          defs.append(clip);
          const clipped = create('g', { 'clip-path': `url(#${id})` });
          current.append(clipped);
          current = clipped;
        } else if (node.localName === 'path') {
          const shape = create('path', {
            d: attr(node, 'pathData'),
            'data-node': indexes.get(node),
            'fill-rule': attr(node, 'fillType') === 'evenOdd' ? 'evenodd' : 'nonzero',
          });
          for (const kind of ['fill', 'stroke']) {
            const color = paint(node, kind + 'Color');
            const complex = [...node.children].find(
              (n) =>
                n.namespaceURI === AAPT &&
                n.localName === 'attr' &&
                n.getAttribute('name') === 'android:' + kind + 'Color',
            );
            const grad =
              complex &&
              [...complex.children].find((n) => n.localName === 'gradient' && !n.namespaceURI);
            shape.setAttribute(kind, grad ? gradient(grad) : color.rgb);
            shape.setAttribute(
              kind + '-opacity',
              number(node, kind + 'Alpha', 1) * (grad ? 1 : color.alpha),
            );
            if (complex && !grad)
              warnings.add(`Unsupported complex ${kind} is preserved in export but not rendered.`);
          }
          for (const [key, name, fallback] of [
            ['stroke-width', 'strokeWidth', '0'],
            ['stroke-linecap', 'strokeLineCap', 'butt'],
            ['stroke-linejoin', 'strokeLineJoin', 'miter'],
            ['stroke-miterlimit', 'strokeMiterLimit', '4'],
          ])
            shape.setAttribute(key, attr(node, name, fallback));
          if (
            number(node, 'trimPathStart') !== 0 ||
            number(node, 'trimPathEnd', 1) !== 1 ||
            number(node, 'trimPathOffset') !== 0
          )
            warnings.add('trimPath is preserved in export but the preview shows the full path.');
          current.append(shape);
        } else
          warnings.add(
            `Unsupported element ${node.nodeName} is preserved in export but omitted from preview.`,
          );
      }
    }
    if (root.hasAttributeNS(ANDROID, 'tint'))
      warnings.add(
        'Root tint is preserved and editable, but not applied in the preview. Verify the result on Android.',
      );
    if (attr(root, 'autoMirrored') === 'true')
      warnings.add('Preview uses left-to-right layout; autoMirrored is preserved for Android.');
    walk(root, content);
    return { svg, warnings: [...warnings] };
  }

  function validateProfile(value) {
    if (
      !value ||
      value.kind !== 'vector-dark-palette' ||
      value.version !== 1 ||
      typeof value.name !== 'string' ||
      !value.name.trim() ||
      value.name.length > 100
    )
      throw new Error('Invalid or unsupported palette profile.');
    const validObject = (object) => object && typeof object === 'object' && !Array.isArray(object);
    if (!validObject(value.mappings) || !validObject(value.resources))
      throw new Error('Profile needs mappings and resources objects.');
    const mappings = {},
      resources = {};
    for (const [key, target] of Object.entries(value.mappings)) {
      if (
        !(normalizeColor(key) || /^[@?][\w:/.]+$/.test(key)) ||
        !(target === 'keep' || normalizeColor(target))
      )
        throw new Error('Profile contains an invalid color mapping.');
      mappings[normalizeColor(key) || key] = target === 'keep' ? target : normalizeColor(target);
    }
    for (const [key, target] of Object.entries(value.resources)) {
      if (!/^[@?][\w:/.]+$/.test(key) || !(normalizeColor(target) || /^[@?][\w:/.]+$/.test(target)))
        throw new Error('Profile contains an invalid resource.');
      resources[key] = normalizeColor(target) || target;
    }
    const background = normalizeColor(value.background);
    if (!background || background.length !== 7)
      throw new Error('Profile needs an opaque preview background.');
    return {
      version: 1,
      kind: 'vector-dark-palette',
      name: value.name.trim(),
      mappings,
      resources,
      background,
    };
  }

  Object.assign(window.VectorStudio, {
    ANDROID,
    parseXml,
    parseVector,
    parseResources,
    palette,
    exportXml,
    render,
    validateProfile,
  });
})();
