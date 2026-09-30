/** Aurora GLSL from https://nestjs.com/assets/lazy-render-BSmxDXBZ.js
 * Native WebGL integration for Vector Dusk; no React/OGL runtime required.
 */
(() => {
  'use strict';
  const vertexSource = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;
  const fragmentSource = `#version 300 es
precision highp float;

uniform float uTime;
uniform float uAmplitude;
uniform vec3 uColorStopsA[3];
uniform vec3 uColorStopsB[3];
uniform float uPaletteMix;
uniform vec2 uResolution;
uniform float uBlend;
uniform vec2 uMouse;
uniform vec3 uGlowColor;

out vec4 fragColor;

vec3 permute(vec3 x) {
  return mod(((x * 34.0) + 1.0) * x, 289.0);
}

float snoise(vec2 v){
  const vec4 C = vec4(
      0.211324865405187, 0.366025403784439,
      -0.577350269189626, 0.024390243902439
  );
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);

  vec3 p = permute(
      permute(i.y + vec3(0.0, i1.y, 1.0))
    + i.x + vec3(0.0, i1.x, 1.0)
  );

  vec3 m = max(
      0.5 - vec3(
          dot(x0, x0),
          dot(x12.xy, x12.xy),
          dot(x12.zw, x12.zw)
      ), 
      0.0
  );
  m = m * m;
  m = m * m;

  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);

  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

struct ColorStop {
  vec3 color;
  float position;
};

#define COLOR_RAMP(colors, factor, finalColor) {                int index = 0;                                              for (int i = 0; i < 2; i++) {                                    ColorStop currentColor = colors[i];                         bool isInBetween = currentColor.position <= factor;         index = int(mix(float(index), float(i), float(isInBetween)));   }                                                           ColorStop currentColor = colors[index];                     ColorStop nextColor = colors[index + 1];                    float range = nextColor.position - currentColor.position;   float lerpFactor = (factor - currentColor.position) / range;   finalColor = mix(currentColor.color, nextColor.color, lerpFactor); }

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  
  vec3 c0 = mix(uColorStopsA[0], uColorStopsB[0], uPaletteMix);
  vec3 c1 = mix(uColorStopsA[1], uColorStopsB[1], uPaletteMix);
  vec3 c2 = mix(uColorStopsA[2], uColorStopsB[2], uPaletteMix);

  ColorStop colors[3];
  colors[0] = ColorStop(c0, 0.0);
  colors[1] = ColorStop(c1, 0.5);
  colors[2] = ColorStop(c2, 1.0);
  
  vec3 rampColor;
  COLOR_RAMP(colors, uv.x, rampColor);
  
  float height = snoise(vec2(uv.x * 2.0 + uTime * 0.1, uTime * 0.25)) * 0.5 * uAmplitude;
  height = exp(height);
  height = (uv.y * 3.5 - height + 0.2);
  float intensity = 0.6 * height;
  
  float midPoint = 0.20;
  float auroraAlpha = smoothstep(midPoint - uBlend * 0.5, midPoint + uBlend * 0.5, intensity);
  vec3 auroraColor = intensity * rampColor;

  // Cursor effect (glow) — works even if auroraAlpha is zero
  vec2 mouseUV = uMouse / uResolution;
  float dist = distance(uv, mouseUV);
  float cursorEffect = smoothstep(0.6, 0.0, dist);

  vec3 finalColor = mix(auroraColor, uGlowColor, cursorEffect * 0.3); 
  float finalAlpha = max(auroraAlpha, cursorEffect * 0.5);

  fragColor = vec4(finalColor, finalAlpha);
}
`;
  const background = document.querySelector('.ambient-background');
  const canvas = document.createElement('canvas');
  const motion = document.getElementById('background-motion');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  background.prepend(canvas);
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
  });
  if (!gl) {
    canvas.remove();
    return;
  }
  let program,
    frame = 0,
    elapsed = 0,
    previous = 0,
    visible = true,
    ready = false;
  let timeLocation, mouseLocation;
  const colors = (values) =>
    values.flatMap((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255));
  function setup() {
    program = gl.createProgram();
    for (const [type, source] of [
      [gl.VERTEX_SHADER, vertexSource],
      [gl.FRAGMENT_SHADER, fragmentSource],
    ]) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        gl.deleteProgram(program);
        return;
      }
      gl.attachShader(program, shader);
      gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return;
    }
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    timeLocation = gl.getUniformLocation(program, 'uTime');
    mouseLocation = gl.getUniformLocation(program, 'uMouse');
    gl.uniform1f(gl.getUniformLocation(program, 'uAmplitude'), 1);
    gl.uniform1f(gl.getUniformLocation(program, 'uBlend'), 0.5);
    gl.uniform1f(gl.getUniformLocation(program, 'uPaletteMix'), 0);
    gl.uniform3fv(gl.getUniformLocation(program, 'uGlowColor'), colors(['#e0234e']));
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    ready = true;
    background.classList.add('canvas-ready');
    resize();
    sync();
  }
  function draw() {
    gl.uniform1f(timeLocation, elapsed * 0.003);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function resize() {
    if (!ready) return;
    const width = background.clientWidth,
      height = background.clientHeight;
    // ponytail: cap backing pixels at 2048; raise the cap for sharper large canvases.
    const ratio = Math.min(devicePixelRatio, 1.5, 2048 / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(gl.getUniformLocation(program, 'uResolution'), canvas.width, canvas.height);
    const palette = colors(
      innerWidth > 1024 ? ['#780f20', '#050303', '#5a0b18'] : ['#780f20', '#510712', '#5a0b18'],
    );
    gl.uniform3fv(gl.getUniformLocation(program, 'uColorStopsA[0]'), palette);
    gl.uniform3fv(gl.getUniformLocation(program, 'uColorStopsB[0]'), palette);
    draw();
  }
  function tick(now) {
    elapsed += previous ? Math.min(now - previous, 100) : 0;
    previous = now;
    draw();
    frame = requestAnimationFrame(tick);
  }
  function sync() {
    cancelAnimationFrame(frame);
    previous = 0;
    const running = ready && motion.checked && !reduced.matches && !document.hidden && visible;
    background.dataset.running = String(running);
    if (running) frame = requestAnimationFrame(tick);
  }
  motion.addEventListener('change', sync);
  reduced.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
  new ResizeObserver(resize).observe(background);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    sync();
  }).observe(background);
  window.addEventListener(
    'pointermove',
    (event) => {
      if (!ready || reduced.matches || !motion.checked) return;
      const bounds = canvas.getBoundingClientRect();
      gl.uniform2f(
        mouseLocation,
        ((event.clientX - bounds.left) * canvas.width) / bounds.width,
        ((bounds.bottom - event.clientY) * canvas.height) / bounds.height,
      );
    },
    { passive: true },
  );
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    ready = false;
    background.classList.remove('canvas-ready');
    sync();
  });
  canvas.addEventListener('webglcontextrestored', setup);
  setup();
})();
