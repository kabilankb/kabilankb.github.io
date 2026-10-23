// Hero viewport: the real SO-101 (meshes from so101_new_calib.urdf) moving a gear between two
// shafts. Joint paths are baked offline with IK so the tool point drops straight down onto
// each shaft; the browser only interpolates them.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const JOINTS = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll'];
// Gear centre (25.5 mm in from the fixed jaw, tool pointing down) over each shaft at
// z = 62, 50, 40, 30, 22, 13.6 mm. URDF base frame, radians.
const PATHS = {
  ready: [-0.0078, -0.4325, 0.4437, 1.5596, -0.0],
  A: [
    [-0.5516, 0.0106, 0.0846, 1.4757, -0.0],
    [-0.5516, 0.0211, 0.1611, 1.3886, -0.0],
    [-0.5516, 0.0365, 0.2173, 1.3169, -0.0],
    [-0.5516, 0.0579, 0.2669, 1.2459, -0.0],
    [-0.5516, 0.0793, 0.302, 1.1895, -0.0],
    [-0.5516, 0.1056, 0.3344, 1.1307, -0.0]
  ],
  B: [
    [0.5398, 0.0106, 0.0846, 1.4757, -0.0],
    [0.5398, 0.0211, 0.1611, 1.3886, -0.0],
    [0.5398, 0.0365, 0.2173, 1.3169, -0.0],
    [0.5398, 0.0579, 0.2669, 1.2459, -0.0],
    [0.5398, 0.0793, 0.302, 1.1895, -0.0],
    [0.5398, 0.1056, 0.3344, 1.1307, -0.0]
  ],
};
const SEAT = { A: [0.22, 0.11], B: [0.22, -0.11] };   // shaft x, y in metres
const TABLE_Z = -0.0024, PUCK_H = 0.008, GEAR_T = 0.016;
const GEAR_Z = TABLE_Z + PUCK_H + GEAR_T / 2;          // 13.6 mm, the IK grasp height
const G_REST = 0.12, G_OPEN = 1.0, G_HOLD = 0.35;
const BG = 0x0a0d0a, GREEN = 0x76b900;

const smoother = u => u * u * u * (u * (u * 6 - 15) + 10);
const lerp = (a, b, f) => a + (b - a) * f;
function along(path, u) {
  if (path.length === 1) return path[0];
  const x = u * (path.length - 1), i = Math.min(path.length - 2, Math.floor(x)), f = x - i;
  return path[i].map((v, k) => lerp(v, path[i + 1][k], f));
}

// One pick-and-place, from shaft `F` to shaft `T`. [phase, seconds, joint waypoints, grip from, grip to]
function cycle(F, T) {
  const f = PATHS[F], t = PATHS[T], r = PATHS.ready;
  return [
    ['approach', 1.5, [r, f[0]], G_REST, G_OPEN],
    ['descend', 1.0, f, G_OPEN, G_OPEN],
    ['grasp', 0.5, [f[5]], G_OPEN, G_HOLD],
    ['lift', 0.9, [...f].reverse(), G_HOLD, G_HOLD],
    ['transfer', 1.6, [f[0], t[0]], G_HOLD, G_HOLD],
    ['insert', 1.1, t, G_HOLD, G_HOLD],
    ['release', 0.45, [t[5]], G_HOLD, G_OPEN],
    ['retract', 0.8, [...t].reverse(), G_OPEN, G_OPEN],
    ['home', 1.3, [t[0], r], G_OPEN, G_REST],
    ['idle', 0.8, [r], G_REST, G_REST],
  ];
}
const CYCLES = [['A', 'B', cycle('A', 'B')], ['B', 'A', cycle('B', 'A')]];
const CYCLE_S = CYCLES[0][2].reduce((s, p) => s + p[1], 0);
const CARRIED = new Set(['lift', 'transfer', 'insert']);

function gearGeometry() {
  const n = 16, ro = 0.0225, rr = 0.019, p = (Math.PI * 2) / n, s = new THREE.Shape();
  for (let i = 0; i < n; i++) {
    const a = i * p, pts = [[rr, a], [rr, a + 0.22 * p], [ro, a + 0.38 * p], [ro, a + 0.62 * p], [rr, a + 0.78 * p]];
    pts.forEach(([r, b], k) => (i === 0 && k === 0 ? s.moveTo : s.lineTo).call(s, r * Math.cos(b), r * Math.sin(b)));
  }
  s.closePath();
  const hole = new THREE.Path(); hole.absarc(0, 0, 0.0052, 0, Math.PI * 2, true); s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: GEAR_T - 0.0012, bevelEnabled: true, bevelThickness: 0.0006, bevelSize: 0.0005, bevelSegments: 2, curveSegments: 24 });
  g.translate(0, 0, -(GEAR_T - 0.0012) / 2);
  return g;
}

export async function mount(root, { modelUrl, still = false } = {}) {
  const canvas = root.querySelector('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(BG, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(BG, 1.1, 2.7);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.32;

  scene.add(new THREE.HemisphereLight(0xe4ecdc, 0x0a0d0a, 0.55));
  const key = new THREE.DirectionalLight(0xfff6ea, 2.6);
  key.position.set(0.7, 1.3, 0.9);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -0.45, right: 0.45, top: 0.45, bottom: -0.45, near: 0.2, far: 3.5 });
  key.shadow.bias = -0.0003; key.shadow.normalBias = 0.0015; key.shadow.radius = 4;
  scene.add(key);
  const rim = new THREE.DirectionalLight(GREEN, 1.6);
  rim.position.set(-0.9, 0.55, -0.7);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xb9d7ff, 0.5);
  fill.position.set(-0.4, 0.3, 1.0);
  scene.add(fill);

  // Floor, a low workcell plate and a 5 cm grid that fades into the page background.
  const floorY = TABLE_Z - 0.012;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshStandardMaterial({ color: 0x0c100c, roughness: 0.92 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = floorY; floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(4, 80, 0x3d5a1c, 0x1d2a1a);
  grid.position.y = floorY + 0.0004;
  grid.material.transparent = true; grid.material.opacity = 0.7; grid.material.depthWrite = false;
  scene.add(grid);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.012, 0.5), new THREE.MeshStandardMaterial({ color: 0x1a1f1a, roughness: 0.78, metalness: 0.05 }));
  plate.position.set(0.14, TABLE_Z - 0.006, 0); plate.receiveShadow = true; plate.castShadow = true;
  scene.add(plate);
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(plate.geometry), new THREE.LineBasicMaterial({ color: GREEN, transparent: true, opacity: 0.55 }));
  edge.position.copy(plate.position);
  scene.add(edge);

  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(modelUrl);
  const printed = new THREE.MeshStandardMaterial({ color: 0xebe9e2, roughness: 0.52, metalness: 0 });
  const motor = new THREE.MeshStandardMaterial({ color: 0x151715, roughness: 0.36, metalness: 0.25 });
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    o.material = o.name.endsWith('motor') ? motor : printed;
    o.castShadow = o.receiveShadow = true;
  });
  scene.add(gltf.scene);
  const base = gltf.scene.getObjectByName('base_link');
  const joint = Object.fromEntries([...JOINTS, 'gripper'].map(n => [n, gltf.scene.getObjectByName('q_' + n)]));
  const tcp = new THREE.Object3D();           // gripper_frame_joint: xyz (-0.0079, -0.0002, -0.0981), rpy (0, pi, 0)
  tcp.position.set(-0.0079, -0.000218, -0.0981274); tcp.rotation.set(0, Math.PI, 0);
  joint.wrist_roll.add(tcp);

  // Props live in the URDF base frame, so seats use the same coordinates as the IK.
  const steel = new THREE.MeshStandardMaterial({ color: 0xc8ccc4, roughness: 0.28, metalness: 1 });
  const anod = new THREE.MeshStandardMaterial({ color: 0x262b26, roughness: 0.5, metalness: 0.4 });
  for (const [x, y] of Object.values(SEAT)) {
    const puck = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.028, PUCK_H, 48).rotateX(Math.PI / 2), anod);
    puck.position.set(x, y, TABLE_Z + PUCK_H / 2);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.024, 24).rotateX(Math.PI / 2), steel);
    shaft.position.set(x, y, TABLE_Z + PUCK_H + 0.012);
    for (const m of [puck, shaft]) { m.castShadow = m.receiveShadow = true; base.add(m); }
  }
  const gear = new THREE.Mesh(gearGeometry(), new THREE.MeshStandardMaterial({ color: GREEN, roughness: 0.34, metalness: 0.3, emissive: 0x152400 }));
  gear.castShadow = gear.receiveShadow = true;
  gear.matrixAutoUpdate = false;

  const setJoints = (q, g) => { JOINTS.forEach((n, i) => (joint[n].rotation.z = q[i])); joint.gripper.rotation.z = g; };
  // Gear pose in the TCP frame, measured at the shaft-A grasp; the shaft-B seat pose follows from it,
  // so picking up and setting down never makes the gear jump.
  const seatA = new THREE.Matrix4().makeTranslation(SEAT.A[0], SEAT.A[1], GEAR_Z);
  setJoints(PATHS.A[5], G_HOLD); gltf.scene.updateMatrixWorld(true);
  const inTcp = tcp.matrixWorld.clone().invert().multiply(base.matrixWorld).multiply(seatA);
  setJoints(PATHS.B[5], G_HOLD); gltf.scene.updateMatrixWorld(true);
  const seatB = base.matrixWorld.clone().invert().multiply(tcp.matrixWorld).multiply(inTcp);
  seatB.setPosition(SEAT.B[0], SEAT.B[1], GEAR_Z);
  const seats = { A: seatA, B: seatB };

  function place(parent, m) {
    if (gear.parent !== parent) parent.add(gear);
    gear.matrix.copy(m); gear.matrixWorldNeedsUpdate = true;
  }

  // Timeline state at sim time `t`; deterministic, so seek() can jump anywhere.
  const state = { phase: 'idle', from: 'A', to: 'B', q: PATHS.ready, g: G_REST };
  function apply(t) {
    const k = ((Math.floor(t / CYCLE_S) % 2) + 2) % 2, [from, to, phases] = CYCLES[k];
    let local = ((t % CYCLE_S) + CYCLE_S) % CYCLE_S, idx = 0;
    while (idx < phases.length - 1 && local >= phases[idx][1]) local -= phases[idx++][1];
    const [phase, dur, path, g0, g1] = phases[idx], u = smoother(Math.min(1, local / dur));
    const q = along(path, u), g = lerp(g0, g1, u);
    setJoints(q, g);
    if (CARRIED.has(phase)) place(tcp, inTcp);
    else place(base, seats[idx < 3 ? from : to]);
    Object.assign(state, { phase, from, to, q, g });
  }

  // Camera: slow idle sway, pointer parallax, and drag-to-orbit with a mouse.
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 10);
  const target = new THREE.Vector3(0.14, 0.075, 0);
  const view = { az: 0.62, el: 0.36, r: 1.1, dragAz: 0, dragEl: 0, vAz: 0, px: 0, py: 0, pxS: 0, pyS: 0 };
  function placeCamera(t) {
    view.pxS = lerp(view.pxS, view.px, 0.05); view.pyS = lerp(view.pyS, view.py, 0.05);
    const az = view.az + view.dragAz + (still ? 0 : 0.14 * Math.sin(t * 0.22)) + view.pxS * 0.1;
    const el = THREE.MathUtils.clamp(view.el + view.dragEl + view.pyS * 0.05, 0.1, 1.05);
    const r = view.r * Math.max(1, 0.95 / camera.aspect);   // keep the workcell in frame on tall screens
    camera.position.set(target.x + r * Math.cos(el) * Math.cos(az), target.y + r * Math.sin(el), target.z + r * Math.cos(el) * Math.sin(az));
    camera.lookAt(target);
  }

  let drag = null;
  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') return;     // touch keeps scrolling the page
    drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); root.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = (e.clientX - drag.x) / canvas.clientWidth, dy = (e.clientY - drag.y) / canvas.clientHeight;
    drag = { x: e.clientX, y: e.clientY };
    view.dragAz += dx * 3; view.vAz = dx * 3; view.dragEl += dy * 1.5;
    if (still) frame(performance.now());
  });
  const endDrag = () => { drag = null; root.classList.remove('dragging'); };
  canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
  window.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    view.px = (e.clientX / innerWidth) * 2 - 1; view.py = (e.clientY / innerHeight) * 2 - 1;
  }, { passive: true });

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(() => { resize(); if (still || !running) frame(performance.now(), true); }).observe(canvas);

  // HUD: live joint readout from the same values that pose the model.
  const hud = Object.fromEntries([...root.querySelectorAll('[data-hud]')].map(el => [el.dataset.hud, el]));
  const deg = r => { const d = (r * 180) / Math.PI; return (d < 0 ? '−' : '+') + Math.abs(d).toFixed(1).padStart(5, '0') + '°'; };
  const tcpPos = new THREE.Vector3();
  let hudAt = 0;
  function updateHud(now) {
    if (now - hudAt < 90) return; hudAt = now;
    JOINTS.forEach((n, i) => hud[n] && (hud[n].textContent = deg(state.q[i])));
    if (hud.gripper) hud.gripper.textContent = deg(state.g);
    if (hud.phase) hud.phase.textContent = state.phase;
    if (hud.task) hud.task.textContent = `shaft ${state.from} → shaft ${state.to}`;
    if (hud.tcp) {
      tcp.getWorldPosition(tcpPos); base.worldToLocal(tcpPos);
      hud.tcp.textContent = [tcpPos.x, tcpPos.y, tcpPos.z].map(v => (v * 1000).toFixed(0).padStart(4, ' ')).join(' ');
    }
  }

  let simT = still ? CYCLE_S * 0.47 : 0, last = performance.now(), running = false, visible = true;
  function frame(now, once) {
    // rAF timestamps can trail performance.now(), so clamp to keep time moving forward.
    const dt = THREE.MathUtils.clamp((now - last) / 1000, 0, 0.05); last = Math.max(last, now);
    if (!still && !once) simT += dt;
    if (!drag) { view.dragAz += view.vAz; view.vAz *= 0.92; }
    apply(simT); placeCamera(simT); renderer.render(scene, camera); updateHud(now);
    if (running && !once) requestAnimationFrame(frame);
  }
  function setRunning(on) {
    on = on && visible && !document.hidden && !still;
    if (on === running) return;
    running = on; last = performance.now();
    if (on) requestAnimationFrame(frame);
  }
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; setRunning(true); }).observe(canvas);
  document.addEventListener('visibilitychange', () => setRunning(true));

  resize(); frame(performance.now(), true);
  root.classList.add('ready');
  setRunning(true);
  return {
    seek(t) { simT = t; frame(performance.now(), true); },
    setView({ target: t, ...v }) { if (t) target.set(...t); Object.assign(view, v); frame(performance.now(), true); },
    pause() { still = true; running = false; },
    cycleSeconds: CYCLE_S,
  };
}
