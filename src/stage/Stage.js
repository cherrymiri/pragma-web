import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { store } from '../store.js';
import { buildEnvironment, glassMaterial, waterBodyMaterial, waterSurface, createStream, createBubbles, createNozzle, floorShader } from './materials.js';

// Values fixed by the Blender model (metres, Y up)
const CLOSED_Y = 0.183;
const PITCH = 0.004;
const FREE_TURNS = 2.25;      // thread fully disengaged
const FULL_MM = 165;
const CORNER_MM = 16.27;
const FLOOR_MM = 10.45;
const FLOW = 3.4e-5;          // m³/s, about 13 seconds from empty to full
const GRAVITY = 9.8 * 0.42;   // the model is small: slowed so a fall reads at human scale
const NOZZLE_Y = 0.238;
const REST_Y = 0.0021;
const LID_R = 0.0385;

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class Stage {
  constructor(host) {
    this.host = host;
    this.clock = new THREE.Clock();
    this.pour = false;
    this.flow = 0;           // 0…1 stream reaching the water
    this.agitation = 0;
    this.heightMm = FLOOR_MM;
    this.streamHead = -1;    // seconds since opening, -1 = never opened
    this.streamTail = -1;    // seconds since closing, -1 = open
    this.turns = FREE_TURNS;
    this.turnsTarget = FREE_TURNS;
    this.nozzleLift = 0;
    this.pointer = { id: null, x: 0, y: 0, sx: 0, sy: 0, intent: null };
    this.dragTarget = new THREE.Vector3();

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1;
    host.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0c0e);
    this.scene.environment = buildEnvironment(r);
    this.camera = new THREE.PerspectiveCamera(24, 1, 0.05, 6);
    this.home = new THREE.Vector3(0.135, REST_Y, 0);

    this.floorUniforms = null;
    const floor = (this.floor = new Reflector(new THREE.CircleGeometry(1.6, 64), {
      textureWidth: 1024, textureHeight: 1024, clipBias: 0.0005, multisample: 4, shader: floorShader,
    }));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    this.onResize = () => this.resize();
    addEventListener('resize', this.onResize);
    const c = r.domElement;
    this.handlers = {
      pointerdown: (e) => this.down(e), pointermove: (e) => this.move(e),
      pointerup: (e) => this.up(e), pointercancel: (e) => this.up(e),
      wheel: (e) => this.wheel(e),
    };
    for (const k in this.handlers) c.addEventListener(k, this.handlers[k], { passive: false });
    // no page scroll or browser zoom while the piece is on screen
    this.block = (e) => e.preventDefault();
    addEventListener('wheel', this.block, { passive: false });
    document.addEventListener('gesturestart', this.block);
    this.raycaster = new THREE.Raycaster();
    this.resize();
  }

  async load() {
    const loader = new GLTFLoader();
    // the single-file preview carries the model inline; the real site loads it from /models
    const inline = window.__PRAGMA_GLB;
    const gltf = inline
      ? await loader.parseAsync(Uint8Array.from(atob(inline), (c) => c.charCodeAt(0)).buffer, '')
      : await loader.loadAsync(import.meta.env.BASE_URL + 'models/PRAGMA_Tumbler.glb');
    const root = (this.root = gltf.scene);
    this.scene.add(root);
    const get = (n) => root.getObjectByName(n);
    this.lid = get('Lid');
    this.water = get('Water');

    // web-only glass; the shapes are untouched
    const bodyGlass = glassMaterial({ veil: 0.05 });
    const innerGlass = glassMaterial({ veil: 0.018 });
    get('Tumbler_OuterWall').material = bodyGlass; get('Tumbler_OuterWall').renderOrder = 8;
    get('Tumbler_InnerWall').material = innerGlass; get('Tumbler_InnerWall').renderOrder = 7;
    get('Tumbler_Thread').material = innerGlass; get('Tumbler_Thread').renderOrder = 7;
    this.lid.traverse((o) => {
      if (o.isMesh && o.material.name === 'Mat_BrushedSteel') {
        o.material.envMapIntensity = 1.5;
        o.material.anisotropy = 0.22;
      }
    });

    this.setupWater();
    this.stream = createStream(); this.scene.add(this.stream.mesh);
    this.bubbles = createBubbles(); this.scene.add(this.bubbles.points);
    this.nozzle = createNozzle(NOZZLE_Y); this.scene.add(this.nozzle);

    this.lidHit = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
    this.scene.add(this.lidHit);

    this.lid.position.copy(this.home);
    this.lid.rotation.y = FREE_TURNS * Math.PI * 2;
    this.resize();
    this.renderer.compile(this.scene, this.camera);
    this.renderer.setAnimationLoop(() => this.frame());
    store.set({ ready: true });
  }

  setupWater() {
    const m = this.water;
    const g = m.geometry;
    const pos = g.attributes.position;
    const flags = new Float32Array(pos.count * 2);
    let rimIdx = 0, rimR = 0;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getY(i) - FULL_MM / 1000) < 1e-5) {
        const rr = Math.hypot(pos.getX(i), pos.getZ(i));
        if (rr > rimR) { rimR = rr; rimIdx = i; }
      }
    }
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getY(i) - FULL_MM / 1000) < 1e-5) {
        const rr = Math.hypot(pos.getX(i), pos.getZ(i));
        flags[i * 2] = 1;                                  // follows the surface
        flags[i * 2 + 1] = rr < rimR - 1e-5 ? 1 : 0;       // top cap: drawn by the fine surface mesh
      }
    }
    g.setAttribute('aSurface', new THREE.BufferAttribute(flags, 2));
    this.rimIdx = rimIdx;
    const d = m.morphTargetDictionary;
    this.iLower = d.Level_Lower; this.iDrain = d.Level_Drain;
    this.morphL = g.morphAttributes.position[this.iLower];
    this.morphD = g.morphAttributes.position[this.iDrain];
    m.morphTargetInfluences[d.Surface_Ripple] = 0;

    this.waves = {
      uTime: { value: 0 }, uAgit: { value: 0 }, uFlow: { value: 0 },
      uLevelY: { value: 0 }, uRadius: { value: 0.03 },
    };
    m.material = waterBodyMaterial(this.waves);
    m.frustumCulled = false;
    m.renderOrder = 2;
    this.surface = waterSurface(this.waves);
    this.surface.renderOrder = 3;
    this.scene.add(this.surface);
    this.applyLevel();
  }

  applyLevel() {
    const h = this.heightMm;
    const l = h >= CORNER_MM ? (FULL_MM - h) / (FULL_MM - CORNER_MM) : 1;
    const dr = h >= CORNER_MM ? 0 : (CORNER_MM - h) / (CORNER_MM - FLOOR_MM);
    const m = this.water;
    m.morphTargetInfluences[this.iLower] = l;
    m.morphTargetInfluences[this.iDrain] = dr;
    const p = m.geometry.attributes.position, i = this.rimIdx;
    const x = p.getX(i) + l * this.morphL.getX(i) + dr * this.morphD.getX(i);
    const y = p.getY(i) + l * this.morphL.getY(i) + dr * this.morphD.getY(i);
    const z = p.getZ(i) + l * this.morphL.getZ(i) + dr * this.morphD.getZ(i);
    this.levelY = y;
    this.waves.uLevelY.value = y;
    this.waves.uRadius.value = Math.hypot(x, z);
    const on = h > FLOOR_MM + 0.05;
    m.visible = on;
    this.surface.visible = on;
    store.set({ waterLevel: clamp((h - FLOOR_MM) / (FULL_MM - FLOOR_MM), 0, 1) });
  }

  // ---- pouring ----
  setPour(on) {
    const s = store.get();
    if (on && (s.waterLevel >= 1 || !s.ready || this.lidOverMouth())) return;
    if (on === this.pour) return;
    this.pour = on;
    if (on) { this.streamHead = 0; this.streamTail = -1; } else { this.streamTail = 0; }
    store.set({ isPouring: on });
  }

  lidOverMouth() {
    const m = store.get().lidMode;
    return m === 'aligned' || m === 'seating';
  }

  updateWater(dt, t) {
    const fallTo = this.levelY ?? 0.0105;
    const drop = NOZZLE_Y - fallTo;
    const fallTime = Math.sqrt((2 * drop) / GRAVITY);
    let head = 0, tail = 0;                       // fall distance of leading and trailing edge
    if (this.streamHead >= 0) { this.streamHead += dt; head = 0.5 * GRAVITY * this.streamHead ** 2; }
    if (this.streamTail >= 0) { this.streamTail += dt; tail = 0.5 * GRAVITY * this.streamTail ** 2; }
    const landed = this.pour && this.streamHead >= fallTime;

    if (landed) {
      const r = this.waves.uRadius.value;
      const area = Math.PI * r * r;
      const before = this.heightMm;
      this.heightMm = Math.min(FULL_MM, before + ((FLOW / Math.max(area, 3e-4)) * dt) * 1000);
      this.applyLevel();
      if (!store.get().hasPoured) store.set({ hasPoured: true });
      if (this.heightMm >= FULL_MM) this.setPour(false);
    }
    this.flow = damp(this.flow, landed ? 1 : 0, landed ? 9 : 4, dt);
    this.agitation = damp(this.agitation, landed ? 1 : 0, landed ? 3 : 0.8, dt);
    Object.assign(this.waves.uTime, { value: t });
    this.waves.uAgit.value = this.agitation;
    this.waves.uFlow.value = this.flow;

    const flowing = this.pour || (this.streamTail >= 0 && tail < drop);
    this.stream.update({ t, tipY: NOZZLE_Y, bottomY: fallTo, head: Math.min(head, drop), tail: Math.min(tail, drop), visible: flowing && this.streamHead >= 0 });
    this.bubbles.update(dt, { flow: this.flow, levelY: this.levelY, radius: this.waves.uRadius.value, floorY: FLOOR_MM / 1000 });

    const away = store.get().lidMode === 'dragging' || this.lidOverMouth();
    this.nozzleLift = damp(this.nozzleLift, away ? 1 : 0, 3.5, dt);
    this.nozzle.position.y = this.nozzleLift * 0.05;
    this.nozzle.traverse((o) => { if (o.isMesh) o.material.opacity = 1 - this.nozzleLift * 0.999; });
  }

  // ---- lid ----
  ndc(e) {
    const b = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
  }

  hitsLid(e) {
    if (!this.lid) return false;
    const p = this.lid.position;
    const touch = e.pointerType !== 'mouse';
    this.lidHit.position.set(p.x, p.y + 0.008, p.z);
    this.lidHit.scale.setScalar(touch ? 0.062 : 0.046);
    this.lidHit.updateMatrixWorld();
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    return this.raycaster.intersectObject(this.lidHit).length > 0;
  }

  pointerToWorld(e, z = 0) {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -z);
    const out = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, out) ? out : null;
  }

  canTouchLid() {
    const s = store.get();
    return s.hasPoured && !this.pour;
  }

  down(e) {
    e.preventDefault();
    const s = store.get();
    const p = this.pointer;
    if (p.id !== null) return;
    if (s.lidMode === 'aligned') {
      // on touch the whole stage turns the lid, so a finger never has to hide it
      if (e.pointerType === 'mouse' && !this.hitsLid(e)) return;
      Object.assign(p, { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, intent: 'turn', onLid: this.hitsLid(e) });
    } else if (this.canTouchLid() && (s.lidMode === 'home' || s.lidMode === 'returning') && this.hitsLid(e)) {
      Object.assign(p, { id: e.pointerId, x: e.clientX, y: e.clientY, intent: 'drag' });
      this.startDrag(e);
    } else return;
    this.renderer.domElement.setPointerCapture?.(e.pointerId);
  }

  startDrag(e) {
    store.set({ lidMode: 'dragging', lidAligned: false, step: 2 });
    const w = this.pointerToWorld(e);
    if (w) this.dragTarget.copy(w);
  }

  move(e) {
    const p = this.pointer;
    if (p.id === null) {
      const can = this.lid && e.pointerType === 'mouse' && this.hitsLid(e) && (this.canTouchLid() || store.get().lidAligned);
      this.renderer.domElement.style.cursor = can ? 'grab' : '';
      return;
    }
    if (e.pointerId !== p.id) return;
    e.preventDefault();
    if (p.intent === 'drag') {
      const w = this.pointerToWorld(e);
      if (w) this.dragTarget.copy(w);
      this.renderer.domElement.style.cursor = 'grabbing';
    } else if (p.intent === 'turn') {
      const dx = e.clientX - p.x;
      p.x = e.clientX; p.y = e.clientY;
      // the fingertip stays on the lid's near face: half a turn is one lid width of travel × π/2
      const px = this.lidScreenWidth();
      this.addTurns((dx / (Math.PI * px)));
      // a lid that has not bitten yet can be lifted straight off
      if (p.onLid && this.turnsTarget >= FREE_TURNS - 0.04) {
        const up = p.sy - e.clientY, side = Math.abs(e.clientX - p.sx);
        if (up > 18 && up > side * 1.3) { p.intent = 'drag'; this.startDrag(e); }
      }
    }
  }

  lidScreenWidth() {
    const a = this.lid.position.clone().add(new THREE.Vector3(-LID_R, 0, 0)).project(this.camera);
    const b = this.lid.position.clone().add(new THREE.Vector3(LID_R, 0, 0)).project(this.camera);
    return Math.max(40, (Math.abs(a.x - b.x) / 2) * this.renderer.domElement.clientWidth);
  }

  up(e) {
    const p = this.pointer;
    if (e.pointerId !== p.id) return;
    const was = p.intent;
    p.id = null; p.intent = null;
    this.renderer.domElement.style.cursor = '';
    if (was === 'drag') {
      const pos = this.lid.position;
      const near = Math.hypot(pos.x, pos.z) < 0.042 && pos.y > 0.178 && pos.y < 0.262;
      if (near) {
        this.turns = this.turnsTarget = FREE_TURNS;
        store.set({ lidMode: 'seating' });
      } else store.set({ lidMode: 'returning', step: store.get().hasPoured ? 2 : 1 });
    }
  }

  addTurns(d) { this.turnsTarget = clamp(this.turnsTarget + d, 0, FREE_TURNS); }

  wheel(e) {
    e.preventDefault();
    if (!store.get().lidAligned) return;
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 32; else if (e.deltaMode === 2) dy *= 400;
    this.addTurns(-clamp(dy, -160, 160) * 0.0011);   // wheel down closes, up opens
  }

  updateLid(dt) {
    const lid = this.lid;
    if (!lid) return;
    const s = store.get();
    const pos = lid.position;
    if (s.lidMode === 'dragging') {
      const t = this.dragTarget;
      const x = clamp(t.x, -0.3, 0.3);
      const y = clamp(t.y, REST_Y, 0.31);
      const overBody = y < 0.218 && Math.abs(x) < 0.09;   // pass in front of the glass, never through it
      let tx = x, ty = y;
      const tz = overBody ? 0.095 : 0;
      const nearMouth = Math.hypot(x, y - 0.21) < 0.05;
      if (nearMouth) { tx = x * 0.35; ty = Math.max(y, 0.206); }    // the mouth gently draws it in
      pos.x = damp(pos.x, tx, 18, dt);
      pos.y = damp(pos.y, ty, 18, dt);
      pos.z = damp(pos.z, nearMouth ? 0 : tz, 10, dt);
    } else if (s.lidMode === 'returning') {
      pos.x = damp(pos.x, this.home.x, 5.5, dt);
      pos.z = damp(pos.z, this.home.z, 5.5, dt);
      pos.y = damp(pos.y, this.home.y, 6.5, dt);
      if (pos.distanceTo(this.home) < 0.0006) { pos.copy(this.home); store.set({ lidMode: 'home' }); }
    } else if (s.lidMode === 'home') {
      pos.copy(this.home);
    } else if (s.lidMode === 'seating') {
      const y = CLOSED_Y + PITCH * FREE_TURNS;
      pos.x = damp(pos.x, 0, 9, dt);
      pos.z = damp(pos.z, 0, 9, dt);
      pos.y = damp(pos.y, y, 7, dt);
      if (Math.hypot(pos.x, pos.z) < 0.0002 && Math.abs(pos.y - y) < 0.0002) {
        pos.set(0, y, 0);
        store.set({ lidMode: 'aligned', lidAligned: true, step: 2 });
      }
    } else if (s.lidMode === 'aligned') {
      this.turns = damp(this.turns, this.turnsTarget, 11, dt);
      if (Math.abs(this.turns - this.turnsTarget) < 1e-4) this.turns = this.turnsTarget;
      pos.set(0, CLOSED_Y + PITCH * this.turns, 0);
      lid.rotation.y = this.turns * Math.PI * 2;
    }
    store.set({
      lidTurns: this.turns,
      lidRotation: lid.rotation.y,
      lidLock: s.lidMode === 'aligned' ? 1 - this.turns / FREE_TURNS : 0,
      lidPosition: pos.x + ',' + pos.y + ',' + pos.z,
    });
  }

  // ---- frame ----
  resize() {
    const w = this.host.clientWidth || innerWidth, h = this.host.clientHeight || innerHeight;
    this.renderer.setSize(w, h);
    const a = w / h;
    const cam = this.camera;
    cam.aspect = a;
    const narrow = a < 0.85;
    // lid sits beside the tumbler on wide screens, in front of it on phones
    this.home.set(narrow ? 0.056 : 0.135, REST_Y, narrow ? 0.098 : 0);
    const tan = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const hNeed = 0.235, wNeed = narrow ? 0.098 : 0.19;
    const dist = Math.max(hNeed / tan, wNeed / (tan * a));
    const cy = narrow ? 0.092 : 0.1;
    cam.position.set(0, cy + dist * 0.09, dist);
    cam.lookAt(0, cy, 0);
    cam.updateProjectionMatrix();
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.clock.elapsedTime;
    this.updateLid(dt);
    this.updateWater(dt, t);
    this.floor.material.uniforms.uLid.value.set(this.lid.position.x, this.lid.position.z, clamp(1 - this.lid.position.y / 0.09, 0, 1));
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    removeEventListener('resize', this.onResize);
    removeEventListener('wheel', this.block);
    document.removeEventListener('gesturestart', this.block);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
