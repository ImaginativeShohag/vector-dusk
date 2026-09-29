/* SVG adapter. Shared profiles retain the original Android ARGB color contract. */
(() => {
  'use strict';
  const V = window.VectorStudio;
  const NS = 'http://www.w3.org/2000/svg';
  const shapes = new Set([
    'path',
    'rect',
    'circle',
    'ellipse',
    'line',
    'polyline',
    'polygon',
    'text',
    'tspan',
  ]);
  const tags = new Set([
    ...shapes,
    'svg',
    'g',
    'defs',
    'linearGradient',
    'radialGradient',
    'stop',
    'clipPath',
    'mask',
    'pattern',
    'title',
    'desc',
    'style',
  ]);
  const properties = new Set(
    'fill stroke color fill-opacity stroke-opacity opacity fill-rule clip-rule stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset stop-color stop-opacity clip-path mask display visibility paint-order vector-effect font-family font-size font-weight font-style text-anchor dominant-baseline letter-spacing word-spacing transform transform-origin transform-box'.split(
      ' ',
    ),
  );
  const attributes = new Set(
    'id class viewBox preserveAspectRatio x y x1 y1 x2 y2 cx cy r rx ry width height d points pathLength transform gradientTransform gradientUnits spreadMethod offset fx fy fr clipPathUnits maskUnits maskContentUnits patternUnits patternContentUnits patternTransform dx dy rotate textLength lengthAdjust'
      .split(' ')
      .concat([...properties]),
  );
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const hex = (n) => Math.round(n).toString(16).padStart(2, '0').toUpperCase();
  const context = document.createElement('canvas').getContext('2d');

  function normalizeSvgColor(value) {
    if (typeof value !== 'string') return null;
    value = value.trim();
    if (/^#[\da-f]{3,8}$/i.test(value)) {
      let digits = value.slice(1);
      if (digits.length === 3 || digits.length === 4)
        digits = [...digits].map((c) => c + c).join('');
      if (digits.length === 8) return V.normalizeColor('#' + digits.slice(6) + digits.slice(0, 6));
      return digits.length === 6 ? V.normalizeColor('#' + digits) : null;
    }
    if (
      /^(?:currentcolor|inherit|initial|unset|revert|revert-layer)$/i.test(value) ||
      /var\(/i.test(value) ||
      !CSS.supports('color', value)
    )
      return null;
    context.fillStyle = '#010203';
    context.fillStyle = value;
    const resolved = context.fillStyle;
    if (resolved.startsWith('#')) return V.normalizeColor(resolved);
    const rgb = resolved.match(
      /^rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)$/,
    );
    if (!rgb) return null;
    return V.normalizeColor(
      '#' +
        hex(Number(rgb[4] ?? 1) * 255) +
        rgb
          .slice(1, 4)
          .map((n) => hex(Number(n)))
          .join(''),
    );
  }

  function svgColor(canonical) {
    const color = V.normalizeColor(canonical);
    return color?.length === 9 ? '#' + color.slice(3) + color.slice(1, 3) : color;
  }

  function referenceIds(node, styles) {
    const ids = [];
    for (const value of Object.values(styles)) {
      for (const match of value.matchAll(/url\(\s*["']?[^)]*?#([\w.-]+)["']?\s*\)/g))
        ids.push(match[1]);
    }
    if (node.getAttribute('href')?.startsWith('#')) ids.push(node.getAttribute('href').slice(1));
    return ids;
  }

  // Only local paint/clip references are allowed. CSS escapes and variables are
  // rejected here so a delayed CSS substitution cannot introduce an external URL.
  function safeValue(value) {
    if (/[\\<>@]/.test(value) || /var\(|expression\(/i.test(value)) return false;
    const rest = value.replace(/url\(\s*["']?#[\w.-]+["']?\s*\)/gi, '');
    return !/url\s*\(/i.test(rest);
  }
  function safeStyle(source, warnings) {
    const probe = document.createElement('span').style;
    probe.cssText = source;
    const clean = document.createElement('span').style;
    for (const property of probe) {
      const value = probe.getPropertyValue(property);
      if (properties.has(property) && safeValue(value))
        clean.setProperty(property, value, probe.getPropertyPriority(property));
      else
        warnings.add(
          `Unsupported or external CSS property “${property}” was removed from preview and export.`,
        );
    }
    return clean.cssText;
  }

  function parseSvg(text) {
    const input = V.parseXml(text);
    if (
      input.documentElement.localName !== 'svg' ||
      ![null, NS].includes(input.documentElement.namespaceURI)
    )
      throw new Error('Choose an SVG document with an <svg> root.');
    const warnings = new Set();
    const doc = document.implementation.createDocument(NS, 'svg');
    function sanitize(node) {
      if (node.nodeType === Node.COMMENT_NODE) return doc.createComment(node.textContent);
      if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.textContent);
      if (node.nodeType !== Node.ELEMENT_NODE) return null;
      if (node.localName === 'use' || node.localName === 'symbol')
        throw new Error(
          'SVG symbol/use instances are not supported yet. Expand instances to paths in your design editor before importing.',
        );
      if (!tags.has(node.localName) || ![null, NS].includes(node.namespaceURI)) {
        warnings.add(
          `Unsupported SVG element <${node.nodeName}> was removed from preview and export.`,
        );
        return null;
      }
      const clean = doc.createElementNS(NS, node.localName);
      for (const attribute of node.attributes) {
        const { name, value } = attribute;
        if (name === 'xmlns' || name.startsWith('xmlns:')) continue;
        if (name === 'style') {
          clean.setAttribute('style', safeStyle(value, warnings));
          continue;
        }
        if (name === 'href' || name === 'xlink:href') {
          if (
            ['linearGradient', 'radialGradient', 'pattern'].includes(node.localName) &&
            /^#[\w.-]+$/.test(value)
          )
            clean.setAttribute('href', value);
          else
            warnings.add('Unsupported or external SVG link was removed from preview and export.');
          continue;
        }
        if (attributes.has(name) && safeValue(value)) clean.setAttribute(name, value);
        else if (!name.startsWith('data-') && !name.startsWith('aria-'))
          warnings.add(`Unsupported SVG attribute “${name}” was removed from preview and export.`);
      }
      if (node.localName === 'style') {
        const sheet = new CSSStyleSheet();
        // Constructed sheets never load @import; only plain style rules survive.
        sheet.replaceSync(node.textContent);
        if (/@/.test(node.textContent))
          warnings.add(
            'SVG CSS at-rules (imports, fonts, media queries) are not supported and were removed.',
          );
        const rules = [];
        for (const rule of sheet.cssRules) {
          if (rule.type !== CSSRule.STYLE_RULE) continue;
          rules.push(`${rule.selectorText} { ${safeStyle(rule.style.cssText, warnings)} }`);
        }
        clean.textContent = rules.join('\n');
      } else {
        for (const child of node.childNodes) {
          const safe = sanitize(child);
          if (safe) clean.append(safe);
        }
      }
      return clean;
    }
    const root = sanitize(input.documentElement);
    doc.replaceChild(root, doc.documentElement);
    let bounds = root
      .getAttribute('viewBox')
      ?.trim()
      .split(/[\s,]+/)
      .map(Number);
    if (!bounds) {
      const dimension = (name) => {
        const match = root.getAttribute(name)?.match(/^([\d.]+)(?:px)?$/);
        return match ? Number(match[1]) : NaN;
      };
      bounds = [0, 0, dimension('width'), dimension('height')];
      if (bounds.every(Number.isFinite)) root.setAttribute('viewBox', bounds.join(' '));
    }
    if (bounds.length !== 4 || !bounds.every(Number.isFinite) || bounds[2] <= 0 || bounds[3] <= 0)
      throw new Error('SVG needs a valid viewBox, or positive numeric/px width and height.');
    const nodes = [root, ...root.querySelectorAll('*')];
    const ids = nodes.filter((n) => n.id).map((n) => n.id);
    if (new Set(ids).size !== ids.length)
      throw new Error('SVG has duplicate IDs; make them unique before importing.');
    // Resolve the real CSS cascade in an isolated shadow tree. Never attach the
    // original markup or let imported CSS touch the editor's document.
    const host = document.createElement('div');
    host.style.cssText = `all:initial;position:fixed;left:-100000px;top:0;opacity:0;pointer-events:none;width:${bounds[2]}px;height:${bounds[3]}px;color:black;font:16px serif;`;
    const shadow = host.attachShadow({ mode: 'closed' });
    const probe = document.importNode(root, true);
    shadow.append(probe);
    document.body.append(host);
    const computed = [],
      uses = [];
    try {
      const probes = [probe, ...probe.querySelectorAll('*')];
      probes.forEach((node, index) => {
        const style = getComputedStyle(node);
        const values = {};
        for (const property of properties) values[property] = style.getPropertyValue(property);
        computed.push(values);
        if (node.closest('mask,clipPath')) return; // Structural luminance is not artwork color.
        const paints =
          node.localName === 'stop'
            ? ['stop-color']
            : shapes.has(node.localName)
              ? node.localName === 'line'
                ? ['stroke']
                : ['fill', 'stroke']
              : [];
        for (const property of paints) {
          const raw = values[property];
          if (raw === 'none' || /url\(/i.test(raw)) continue;
          const key = normalizeSvgColor(raw);
          if (!key) {
            warnings.add(`Unsupported SVG color “${raw}” is preserved without recoloring.`);
            continue;
          }
          uses.push({
            id: `${index}:${property}`,
            nodeIndex: index,
            attribute: property,
            raw,
            key,
            label: `${node.id || node.localName + ' ' + index} · ${property}`,
          });
        }
      });
    } finally {
      host.remove();
    }
    // A mask may reference a gradient/pattern declared elsewhere in <defs>.
    // Follow those links too; recoloring their luminance changes the silhouette.
    const protectedNodes = new Set(nodes.filter((node) => node.closest('mask,clipPath')));
    const byId = new Map(nodes.filter((node) => node.id).map((node) => [node.id, node]));
    const indexes = new Map(nodes.map((node, index) => [node, index]));
    for (const node of protectedNodes) {
      for (const id of referenceIds(node, computed[indexes.get(node)])) {
        const resource = byId.get(id);
        if (resource) {
          protectedNodes.add(resource);
          for (const child of resource.querySelectorAll('*')) protectedNodes.add(child);
        }
      }
    }
    return {
      format: 'svg',
      document: doc,
      nodes,
      uses: uses.filter((use) => !protectedNodes.has(nodes[use.nodeIndex])),
      text,
      computed,
      bounds,
      warnings: [...warnings],
    };
  }

  function svgNodesForUse(model, use) {
    const node = model.nodes[use.nodeIndex];
    const resource = node.closest('linearGradient,radialGradient,pattern');
    if (!resource?.id) return [use.nodeIndex];
    const ids = new Set([resource.id]);
    // Follow reverse references, including gradients inheriting another gradient.
    let changed = true;
    while (changed) {
      changed = false;
      model.nodes.forEach((candidate, index) => {
        if (!referenceIds(candidate, model.computed[index]).some((id) => ids.has(id))) return;
        const parent = candidate.closest('linearGradient,radialGradient,pattern');
        if (parent?.id && !ids.has(parent.id)) {
          ids.add(parent.id);
          changed = true;
        }
      });
    }
    return model.nodes.flatMap((candidate, index) =>
      shapes.has(candidate.localName) &&
      referenceIds(candidate, model.computed[index]).some((id) => ids.has(id))
        ? [index]
        : [],
    );
  }

  function mappedDocument(model, mappings, overrides) {
    const copy = model.document.cloneNode(true);
    const nodes = [...copy.querySelectorAll('*')];
    for (const use of model.uses) {
      const target = own(overrides, use.id) ? overrides[use.id] : mappings[use.key];
      if (!target || target === 'keep') continue;
      const color = svgColor(target);
      if (color) nodes[use.nodeIndex].style.setProperty(use.attribute, color, 'important');
    }
    return copy;
  }
  function exportSvg(model, mappings = {}, overrides = {}) {
    return (
      '<?xml version="1.0" encoding="utf-8"?>\n' +
      new XMLSerializer().serializeToString(mappedDocument(model, mappings, overrides))
    );
  }

  let renderId = 0;
  function renderSvg(model, mappings = {}, overrides = {}) {
    const svg = document.importNode(model.document.documentElement, true);
    const nodes = [svg, ...svg.querySelectorAll('*')];
    const idMap = new Map(
      nodes.filter((n) => n.id).map((n, i) => [n.id, `svg-${++renderId}-${i}`]),
    );
    const localize = (value) =>
      value.replace(
        /url\(\s*["']?[^)]*?#([\w.-]+)["']?\s*\)/g,
        (_, id) => `url(#${idMap.get(id) || id})`,
      );
    nodes.forEach((node, index) => {
      if (node.localName === 'style') {
        node.remove();
        return;
      }
      if (node.id) node.id = idMap.get(node.id);
      if (node.hasAttribute('href'))
        node.setAttribute(
          'href',
          '#' + (idMap.get(node.getAttribute('href').slice(1)) || 'missing'),
        );
      for (const attribute of [...node.attributes])
        if (/url\(/.test(attribute.value))
          node.setAttribute(attribute.name, localize(attribute.value));
      // Freeze resolved presentation properties so stylesheet selectors cannot
      // escape the SVG, and editor styles cannot change imported artwork.
      node.removeAttribute('style');
      for (const [property, value] of Object.entries(model.computed[index])) {
        if (value) node.style.setProperty(property, localize(value), 'important');
      }
      if (shapes.has(node.localName)) node.dataset.node = index;
    });
    for (const use of model.uses) {
      const target = own(overrides, use.id) ? overrides[use.id] : mappings[use.key];
      if (target && target !== 'keep' && svgColor(target))
        nodes[use.nodeIndex].style.setProperty(use.attribute, svgColor(target), 'important');
    }
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'SVG preview');
    return { svg, warnings: model.warnings };
  }
  Object.assign(V, { parseSvg, exportSvg, renderSvg, normalizeSvgColor, svgColor, svgNodesForUse });
})();
