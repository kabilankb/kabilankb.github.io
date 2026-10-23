// Hero backdrop: a lidar-style point field. A grid of points rides a slow rolling terrain toward
// the viewer, and a scan ring sweeps outward across it like a sensor pass over a digital twin.
// All motion happens in the vertex shader; the CPU only updates a few uniforms per frame.
import * as THREE from 'three';

const VERT = /* glsl */ `
uniform float uTime, uScale, uSpeed, uScanR;
uniform vec2 uZRange, uScanAt, uSwell;
attribute float aSeed;
varying float vAlpha, vScan;
float terrain(vec2 p, float t) {
  vec2 d = p - uSwell;                                   // a broad swell: the scene's focal point
  return 0.95 * exp(-dot(d, d) / 7.0)
       + 0.34 * sin(p.x * 0.42 + t * 0.21) * cos(p.y * 0.36 - t * 0.13)
       + 0.13 * sin(p.x * 1.25 - p.y * 0.85 + t * 0.4)
       + 0.035 * sin(p.x * 3.4 + p.y * 2.6 + aSeed * 6.2832);
}
void main() {
  vec3 p = position;
  float span = uZRange.y - uZRange.x;
  p.z = mod(p.z - uZRange.x + uTime * uSpeed, span) + uZRange.x;   // drift toward the camera, wrap far away
  p.y += terrain(p.xz, uTime);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float depth = -mv.z;
  gl_PointSize = uScale * (0.75 + aSeed * 0.5) / depth;
  vScan = exp(-pow((length(p.xz - uSwell) - uScanR) * 1.7, 2.0));
  vAlpha = smoothstep(17.0, 5.0, depth)                 // fade into the horizon
         * smoothstep(0.0, 2.2, uZRange.y - p.z)        // and before reaching the camera
         * (0.5 + 0.5 * smoothstep(-0.9, 0.2, p.y));   // crests read brighter than troughs
}`;

const FRAG = /* glsl */ `
uniform vec3 uBase, uHot;
varying float vAlpha, vScan;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = dot(c, c);
  if (r > 0.25) discard;
  float a = smoothstep(0.25, 0.02, r) * vAlpha * (0.7 + 0.3 * vScan);
  gl_FragColor = vec4(mix(uBase, uHot, vScan), a);
}`;

export function mount(root, { still = false } = {}) {
  const canvas = root.querySelector('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);

  const small = matchMedia('(max-width: 700px)').matches;
  const NX = small ? 150 : 250, NZ = small ? 120 : 170, GAP = 0.1;
  const Z0 = -NZ * GAP + 3, Z1 = 3;
  const pos = new Float32Array(NX * NZ * 3), seed = new Float32Array(NX * NZ);
  for (let i = 0, k = 0; i < NX; i++) for (let j = 0; j < NZ; j++, k++) {
    pos.set([(i - (NX - 1) / 2) * GAP, -0.9, Z0 + j * GAP], k * 3);
    seed[k] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));

  const uniforms = {
    uTime: { value: 0 }, uScale: { value: 10 }, uSpeed: { value: 0.16 },
    uZRange: { value: new THREE.Vector2(Z0, Z1) },
    uSwell: { value: new THREE.Vector2(2.6, -4.6) }, uScanR: { value: 0 },
    uBase: { value: new THREE.Color(0x8cc04f) }, uHot: { value: new THREE.Color(0xd8ff7a) },
  };
  const field = new THREE.Points(geo, new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  field.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(field);

  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 40);
  const look = new THREE.Vector3(0.6, -0.55, -5);
  const ptr = { x: 0, y: 0, sx: 0, sy: 0 };
  window.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    ptr.x = (e.clientX / innerWidth) * 2 - 1; ptr.y = (e.clientY / innerHeight) * 2 - 1;
  }, { passive: true });

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    uniforms.uScale.value = 17 * renderer.getPixelRatio() * THREE.MathUtils.clamp(h / 820, 0.75, 1.3);
  }

  const SCAN_PERIOD = 9, SCAN_REACH = 15;
  let t = still ? 4.2 : 0, last = performance.now(), running = false, visible = true;
  function draw(now) {
    // rAF timestamps can trail performance.now(), so clamp to keep time moving forward.
    const dt = THREE.MathUtils.clamp((now - last) / 1000, 0, 0.05); last = Math.max(last, now);
    if (!still) t += dt;
    ptr.sx += (ptr.x - ptr.sx) * 0.04; ptr.sy += (ptr.y - ptr.sy) * 0.04;
    camera.position.set(ptr.sx * 0.45, 0.95 - ptr.sy * 0.12, 3.4);
    camera.lookAt(look);
    uniforms.uTime.value = t;
    uniforms.uScanR.value = ((t % SCAN_PERIOD) / SCAN_PERIOD) * SCAN_REACH;
    renderer.render(scene, camera);
  }
  function frame(now) {
    if (!running) return;
    draw(now);
    requestAnimationFrame(frame);
  }
  function setRunning() {
    const on = visible && !document.hidden && !still;
    if (on === running) return;
    running = on; last = performance.now();
    if (on) requestAnimationFrame(frame);
  }

  new ResizeObserver(() => { resize(); if (!running) draw(performance.now()); }).observe(canvas);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; setRunning(); }).observe(canvas);
  document.addEventListener('visibilitychange', setRunning);
  resize(); draw(performance.now());
  root.classList.add('ready');
  setRunning();
}
