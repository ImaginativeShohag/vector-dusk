/**
 * Shared color math. Canonical values use Android #AARRGGBB (or opaque #RRGGBB).
 * SVG alpha-last conversion belongs to svg.js; never change saved palette keys.
 */
(() => {
  'use strict';
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const hex = (n) => Math.round(n).toString(16).padStart(2, '0').toUpperCase();

  function normalizeColor(value) {
    if (
      typeof value !== 'string' ||
      !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value.trim())
    )
      return null;
    let digits = value.trim().slice(1).toUpperCase();
    if (digits.length < 5) digits = [...digits].map((c) => c + c).join('');
    if (digits.length === 8 && digits.startsWith('FF')) digits = digits.slice(2);
    return '#' + digits;
  }

  function colorParts(value) {
    const normalized = normalizeColor(value);
    if (!normalized) return null;
    const digits = normalized.slice(1);
    return {
      rgb: '#' + digits.slice(-6),
      alpha: digits.length === 8 ? parseInt(digits.slice(0, 2), 16) / 255 : 1,
    };
  }

  function resolveColor(value, resources = {}) {
    const visited = new Set();
    while (typeof value === 'string' && !visited.has(value)) {
      const color = normalizeColor(value);
      if (color) return color;
      if (value === '@android:color/transparent') return '#00000000';
      if (value === '@android:color/black') return '#000000';
      if (value === '@android:color/white') return '#FFFFFF';
      visited.add(value);
      value = own(resources, value) ? resources[value] : null;
    }
    return null;
  }

  // A deterministic first draft. Invert neutral lightness, retain chromatic
  // accents, and slightly soften saturation. Human review remains essential.
  function suggest(value) {
    const parts = colorParts(value);
    if (!parts) return null;
    if (parts.alpha === 0) return normalizeColor(value);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(parts.rgb.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b),
      delta = max - min;
    const light = (max + min) / 2;
    const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * light - 1));
    let hue =
      delta === 0
        ? 0
        : max === r
          ? ((g - b) / delta) % 6
          : max === g
            ? (b - r) / delta + 2
            : (r - g) / delta + 4;
    if (hue < 0) hue += 6;
    const accentWeight = Math.max(0, Math.min(1, (saturation - 0.2) / 0.25));
    const neutralLight = 0.18 + (1 - light) * 0.68;
    const accentLight = Math.max(0.55, Math.min(0.82, light));
    const targetLight = neutralLight * (1 - accentWeight) + accentLight * accentWeight;
    const chroma = (1 - Math.abs(2 * targetLight - 1)) * saturation * 0.82;
    const x = chroma * (1 - Math.abs((hue % 2) - 1));
    const combos = [
      [chroma, x, 0],
      [x, chroma, 0],
      [0, chroma, x],
      [0, x, chroma],
      [x, 0, chroma],
      [chroma, 0, x],
    ];
    const rgb = combos[Math.floor(hue)]
      .map((c) => hex((c + targetLight - chroma / 2) * 255))
      .join('');
    return '#' + (parts.alpha < 1 ? hex(parts.alpha * 255) : '') + rgb;
  }

  // Blend encoded RGB channels toward black/white in the selected number of evenly spaced steps.
  // Use integer weights before rounding, and keep source alpha unchanged.
  function tintsAndShades(value, steps = 10) {
    const normalized = normalizeColor(value);
    const parts = colorParts(normalized);
    if (!parts) return null;
    const alpha = normalized.length === 9 ? normalized.slice(1, 3) : '';
    const channels = [1, 3, 5].map((i) => parseInt(parts.rgb.slice(i, i + 2), 16));
    const ramp = (endpoint) =>
      Array.from(
        { length: steps },
        (_, step) =>
          '#' +
          alpha +
          channels
            .map((channel) => hex((channel * (steps - step) + endpoint * step) / steps))
            .join(''),
      );
    return { shades: ramp(0), tints: ramp(255) };
  }

  window.VectorStudio = { normalizeColor, colorParts, resolveColor, suggest, tintsAndShades };
})();
