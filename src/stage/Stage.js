import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { store } from '../store.js';
import { buildEnvironment, glassMaterial, waterBodyMaterial, waterSurface, createStream, createBubbles, createNozzle, floorShader, sheen } from './materials.js';
import { Cavity, CAVITY_Y0, CAVITY_Y1 } from './liquid.js';
import { createLeak, createSeamGlow } from './leak.js';
import { sound } from '../sound.js';

// Values fixed by the Blender model (metres, Y up)
const CLOSED_Y = 0.183;
const PITCH = 0.004;
const FREE_TURNS = 2.25;      // thread fully disengaged
const FULL_MM = 165;
const FLOOR_MM = 10.45;
const FLOW = 3.4e-5;          // m³/s, about 13 seconds from empty to full
const GRAVITY = 9.8 * 0.42;   // the model is small: slowed so a fall reads at human scale
const NOZZLE_Y = 0.238;
const REST_Y = 0.0021;
const LID_R = 0.0385;

// Tilt and seal
const MAX_TILT = 1.85;        // past horizontal, so even a little water can run down to the lid
const MAX_TOWARD = 1.0;       // leaning toward or away from the viewer is limited, the object stays readable
const SEAL_LOCK = 0.995;     // a real screw lid only seals once it is turned all the way to its stop
const WET_TO_LEAK = 0.45;     // seconds the seal stays under water before a loose lid weeps
const WET_TO_HOLD = 1.9;      // seconds under water that prove a closed lid holds
const PIVOT_Y = 0.1;          // the middle of the tumbler
const up = new THREE.Vector3(0, 1, 0);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class Stage {
  constructor(host) {
    this.host = host;
    this.clock = new THREE.Clock();
    this.pour = false;
    this.flow = 0;           // 0…1 stream reaching the water
    this.agitation = 0;
    this.volume = 0;         // m³ of water: the one source of truth for the level
    this.levelY = FLOOR_MM / 1000;
    this.tilt = new THREE.Vector2();        // lean direction × angle (x: sideways, y: toward the viewer)
    this.tiltTarget = new THREE.Vector2();
    this.tiltVel = new THREE.Vector2();
    this.tiltK = 7;
    this.slosh = new THREE.Vector2();
    this.sloshVel = new THREE.Vector2();
    this.plane = { d: FLOOR_MM / 1000, c: 1, s: 0, key: '' };
    this.wetTime = 0;
    this.seq = 0;            // clock of the current automatic moment (leak, success)
    this.dripsLeft = 0; this.dripClock = 0; this.leak = 0;
    this.zoom = 1;
    this.speed = 1;
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
    this.pivot = new THREE.Group();
    this.pivot.position.y = PIVOT_Y;
    root.position.y = -PIVOT_Y;
    this.pivot.add(root);
    this.scene.add(this.pivot);
    this.pivot.updateMatrixWorld(true);
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

    this.leakFx = createLeak(this.root, GRAVITY, sound); this.scene.add(this.leakFx.group);
    this.glow = createSeamGlow(this.root);
    this.emph = 0; this.endK = 0; this.lockWas = 0;
    this.bodyHit = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.056, 0.235, 12), new THREE.MeshBasicMaterial({ visible: false }));
    this.pivot.add(this.bodyHit);
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
    // the shapes come from the inner wall itself; the exported Water mesh stays in the file, hidden
    const inner = this.root.getObjectByName('Tumbler_InnerWall');
    this.root.position.y = 0; this.pivot.position.y = 0; this.pivot.updateMatrixWorld(true);
    this.cavity = new Cavity(inner);
    this.root.position.y = -PIVOT_Y; this.pivot.position.y = PIVOT_Y; this.pivot.updateMatrixWorld(true);
    this.water.visible = false;
    this.maxVolume = this.cavity.volume(FULL_MM / 1000, 1, 0);

    this.waves = {
      uTime: { value: 0 }, uAgit: { value: 0 }, uFlow: { value: 0 },
      uLevelY: { value: 0 }, uSlope: { value: new THREE.Vector2() },
      uRadius: { value: 0.03 }, uCenter: { value: new THREE.Vector2() },
      uInv: { value: new THREE.Matrix4() }, uR: { value: Array.from(this.cavity.table) },
    };
    const body = (this.body = new THREE.Mesh(this.cavity.geometry(), waterBodyMaterial(this.waves)));
    body.name = 'Water_Web';
    body.frustumCulled = false;
    body.renderOrder = 2;
    this.water.parent.add(body);
    this.surface = waterSurface(this.waves);
    this.surface.renderOrder = 3;
    this.scene.add(this.surface);
    this.applyLevel();
    this.updateSurface();
  }

  // upright level, from the volume
  applyLevel() {
    this.uprightY = this.volume > 0 ? this.cavity.solve(this.volume, 1, 0) : CAVITY_Y0;
    const level = this.volume >= this.maxVolume ? 1 : clamp((this.uprightY - CAVITY_Y0) / (FULL_MM / 1000 - CAVITY_Y0), 0, 1);
    const on = this.volume > 1e-7;
    this.body.visible = on;
    this.surface.visible = on;
    store.set({ waterLevel: level });
  }

  // the level plane in world space, kept flat by gravity and holding exactly this.volume
  updateSurface() {
    const w = this.waves;
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(this.pivot.quaternion);
    const n = new THREE.Vector3(this.slosh.x, 1, this.slosh.y).normalize();
    const c = clamp(n.dot(axis), -1, 1), s = Math.sqrt(1 - c * c);
    const key = c.toFixed(4) + this.volume.toFixed(10);
    if (key !== this.plane.key) {
      this.plane.d = this.volume > 0 ? this.cavity.solve(this.volume, c, s) : CAVITY_Y0;
      this.plane.c = c; this.plane.s = s; this.plane.key = key;
    }
    const d = this.plane.d;
    this.root.getWorldPosition(this._o ??= new THREE.Vector3());
    const D = d + n.dot(this._o);
    w.uLevelY.value = D / n.y;
    w.uSlope.value.set(-n.x / n.y, -n.z / n.y);
    w.uInv.value.copy(this.root.matrixWorld).invert();
    // centre the fine surface mesh on the part of the plane that lies inside the tumbler
    const along = clamp(c > 0.2 ? d / c : 0.1 + d * c, 0.03, 0.18);
    const p = this._o.clone().addScaledVector(axis, along);
    w.uCenter.value.set(p.x, p.z);
    w.uRadius.value = Math.min(0.15, 0.0425 / Math.max(Math.abs(c), 0.27));
    this.levelY = w.uLevelY.value;
  }

  // ---- pouring ----
  setPour(on) {
    const s = store.get();
    if (on && (s.waterLevel >= 1 || !s.ready || s.step !== 1)) return;
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
      this.volume = Math.min(this.maxVolume, this.volume + FLOW * dt);
      this.applyLevel();
      if (!store.get().hasPoured) store.set({ hasPoured: true });
      if (this.volume >= this.maxVolume) this.setPour(false);
    }
    this.flow = damp(this.flow, landed ? 1 : 0, landed ? 9 : 4, dt);
    sound.pour(this.pour || this.flow > 0.05, store.get().waterLevel);
    const moving = clamp(this.tiltVel.length() * 0.6, 0, 1);
    const stir = Math.max(landed ? 1 : 0, moving);
    this.agitation = damp(this.agitation, stir, stir > this.agitation ? 3 : 0.8, dt);
    this.waves.uTime.value = t;
    this.waves.uAgit.value = this.agitation;
    this.waves.uFlow.value = this.flow;

    const flowing = this.pour || (this.streamTail >= 0 && tail < drop);
    this.stream.update({ t, tipY: NOZZLE_Y, bottomY: fallTo, head: Math.min(head, drop), tail: Math.min(tail, drop), visible: flowing && this.streamHead >= 0 });
    this.bubbles.points.visible = store.get().step === 1;
    this.bubbles.update(dt, { flow: this.flow, levelY: this.levelY, radius: 0.03, floorY: FLOOR_MM / 1000 });

    const away = store.get().step > 1;
    this.nozzleLift = damp(this.nozzleLift, away ? 1 : 0, 3.5, dt);
    this.nozzle.position.y = this.nozzleLift * 0.05;
    this.nozzle.visible = this.nozzleLift < 0.97;
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

  hitsBody(e) {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    return this.raycaster.intersectObject(this.bodyHit).length > 0;
  }

  canTouchLid() {
    return store.get().step === 2 && !this.pour;
  }

  canAdjust() {
    const s = store.get();
    return s.lidAligned && (s.step === 2 || s.step === 5);
  }

  // ---- the flow between steps ----
  closeLid() {
    if (store.get().step !== 1) return;
    this.setPour(false);
    store.set({ step: 2 });
  }

  startTilt() {
    if (!this.canAdjust() || store.get().lidLock < 0.02) return;
    this.turnsTarget = this.turns;
    this.bubbles.clear();
    this.wetTime = 0;
    this.tiltK = 7;
    this.pointer.id = null; this.pointer.intent = null;
    store.set({ step: 3, verdict: 'none' });
  }

  reset() {
    this.setPour(false);
    this.streamHead = -1; this.streamTail = -1;
    this.volume = 0;
    this.turns = this.turnsTarget = FREE_TURNS;
    this.tiltTarget.set(0, 0); this.tilt.set(0, 0); this.tiltVel.set(0, 0);
    this.slosh.set(0, 0); this.sloshVel.set(0, 0);
    this.wetTime = 0; this.seq = 0; this.dripsLeft = 0; this.leak = 0;
    this.pointer.id = null; this.pointer.intent = null;
    this.leakFx.clear();
    this.bubbles.clear();
    this.glow.set(-1, 0);
    this.emph = 0; this.endK = 0; this.lockWas = 0; this.sheenStart = 0; this.uprightAt = 0; this.glowStart = 0;
    sheen.uSheen.value = -1;
    sound.quiet();
    this.lid.position.copy(this.home);
    this.lid.rotation.y = FREE_TURNS * Math.PI * 2;
    store.set({ step: 1, hasPoured: false, lidMode: 'home', lidAligned: false, lidLock: 0, verdict: 'none', ended: false, ending: false, canTilt: false, leakage: 0 });
    this.applyLevel();
  }

  down(e) {
    e.preventDefault();
    const s = store.get();
    const p = this.pointer;
    if (p.id !== null) return;
    if (s.step === 3) {
      if (e.pointerType === 'mouse' && !this.hitsBody(e)) return;
      Object.assign(p, { id: e.pointerId, x: e.clientX, y: e.clientY, sx: this.tiltTarget.x, sy: this.tiltTarget.y, downX: e.clientX, downY: e.clientY, intent: 'tilt' });
      this.renderer.domElement.style.cursor = 'grabbing';
    } else if (this.canAdjust()) {
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
    store.set({ lidMode: 'dragging', lidAligned: false });
    const w = this.pointerToWorld(e);
    if (w) this.dragTarget.copy(w);
  }

  move(e) {
    const p = this.pointer;
    if (p.id === null) {
      if (!this.lid || e.pointerType !== 'mouse') return;
      const can = store.get().step === 3 ? this.hitsBody(e) : this.hitsLid(e) && (this.canTouchLid() || this.canAdjust());
      this.renderer.domElement.style.cursor = can ? 'grab' : '';
      return;
    }
    if (e.pointerId !== p.id) return;
    e.preventDefault();
    if (p.intent === 'tilt') {
      // the same pull gives the same lean on any screen
      const b = this.renderer.domElement.getBoundingClientRect();
      const per = MAX_TILT / (0.46 * Math.min(b.width, b.height));
      let x = p.sx + (e.clientX - p.downX) * per;
      let y = clamp(p.sy + (e.clientY - p.downY) * per, -MAX_TOWARD, MAX_TOWARD);
      const len = Math.hypot(x, y);
      if (len > MAX_TILT) { x *= MAX_TILT / len; y *= MAX_TILT / len; }
      this.tiltTarget.set(x, y);
    } else if (p.intent === 'drag') {
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
      } else store.set({ lidMode: 'returning' });
    }
  }

  addTurns(d) { this.turnsTarget = clamp(this.turnsTarget + d, 0, FREE_TURNS); }

  wheel(e) {
    e.preventDefault();
    if (!this.canAdjust()) return;
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
        store.set({ lidMode: 'aligned', lidAligned: true });
      }
    } else if (s.lidMode === 'aligned') {
      this.turns = damp(this.turns, this.turnsTarget, 11, dt);
      if (Math.abs(this.turns - this.turnsTarget) < 1e-4) this.turns = this.turnsTarget;
      sound.twist(Math.abs(this.turns - (this.turnsPrev ?? this.turns)) / Math.max(dt, 1e-3));
      this.turnsPrev = this.turns;
      const l = 1 - this.turns / FREE_TURNS;
      if (l >= SEAL_LOCK && this.lockWas < SEAL_LOCK) sound.click();      // the gasket seats
      this.lockWas = l;
      pos.set(0, CLOSED_Y + PITCH * this.turns, 0);
      lid.rotation.y = this.turns * Math.PI * 2;
    }
    const lock = s.lidMode === 'aligned' ? 1 - this.turns / FREE_TURNS : 0;
    store.set({
      canTilt: s.lidMode === 'aligned' && (s.step === 2 || s.step === 5) && lock >= 0.02,
      lidTurns: this.turns,
      lidRotation: lid.rotation.y,
      lidLock: lock,
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
    this.look = new THREE.Vector3(0, cy, 0);
    this.camBase = new THREE.Vector3(0, cy + dist * 0.09, dist);
    this.narrow = narrow;
    this.placeCamera();
    cam.updateProjectionMatrix();
  }

  placeCamera() {
    this.camera.position.copy(this.look).addScaledVector(this.camBase.clone().sub(this.look), this.zoom);
    this.camera.lookAt(this.look);
  }

  // ---- tilting, judging, and what follows ----
  seat(angle, out) {
    // a point on the gap between gasket and shoulder, in world space
    const gapY = (this.lid.position.y - 0.002 + 0.181) / 2;
    out.set(Math.cos(angle) * 0.0381, gapY, Math.sin(angle) * 0.0381);
    return this.root.localToWorld(out);
  }

  downhill() {
    const d = new THREE.Vector3(0, -1, 0).applyQuaternion(this.pivot.quaternion.clone().invert());
    return Math.atan2(d.z, d.x);
  }

  updateTilt(dt) {
    const s = store.get();
    const prevX = this.tilt.x, prevY = this.tilt.y;
    const free = s.step === 3 && this.pointer.intent !== 'tilt';
    if (free) this.tiltTarget.multiplyScalar(Math.exp(-1.6 * dt));    // let go and it eases back upright
    this.tilt.x = damp(this.tilt.x, this.tiltTarget.x, this.tiltK, dt);
    this.tilt.y = damp(this.tilt.y, this.tiltTarget.y, this.tiltK, dt);
    this.tiltVel.set((this.tilt.x - prevX) / Math.max(dt, 1e-3), (this.tilt.y - prevY) / Math.max(dt, 1e-3));

    const angle = this.tilt.length();
    const axis = new THREE.Vector3(this.tilt.y, 0, -this.tilt.x);
    if (angle > 1e-5) this.pivot.quaternion.setFromAxisAngle(axis.normalize(), angle); else this.pivot.quaternion.identity();
    // lifted off the table as it leans; it never dips below the floor
    const contact = 0.1 * Math.abs(Math.cos(angle)) + 0.0385 * Math.sin(Math.min(angle, Math.PI / 2));
    this.pivot.position.y = Math.max(PIVOT_Y + 0.042 * smooth(0.1, 1.2, angle), angle > 0.001 ? contact : PIVOT_Y);

    // the water lags behind the glass, then swings back
    const w = 7.5, z = 0.2;
    const tx = clamp(-this.tiltVel.x * 0.16, -0.3, 0.3), ty = clamp(-this.tiltVel.y * 0.16, -0.3, 0.3);
    const steps = Math.ceil(dt / 0.012), h = dt / Math.max(steps, 1);   // stays stable on slow devices
    for (let i = 0; i < steps; i++) {
      this.sloshVel.x += (-(this.slosh.x - tx) * w * w - this.sloshVel.x * 2 * z * w) * h;
      this.sloshVel.y += (-(this.slosh.y - ty) * w * w - this.sloshVel.y * 2 * z * w) * h;
      this.slosh.addScaledVector(this.sloshVel, h);
    }
    this.slosh.x = clamp(this.slosh.x, -0.36, 0.36); this.slosh.y = clamp(this.slosh.y, -0.36, 0.36);

    const wet = this.volume > 0 && this.cavity.sealWet(this.plane.d, this.plane.c, this.plane.s);
    store.set({ tiltAngle: angle, sealWet: wet });

    if (s.step === 3) {
      this.wetTime = wet ? this.wetTime + dt : Math.max(0, this.wetTime - dt * 2);
      if (s.lidLock < SEAL_LOCK) {
        if (this.wetTime > WET_TO_LEAK) this.beginLeak(s.lidLock);
      } else if (this.wetTime > WET_TO_HOLD) {
        this.tiltTarget.copy(this.tilt);
        this.pointer.intent = null; this.pointer.id = null;
        this.seq = 0;
        store.set({ step: 6, verdict: 'sealed' });
      }
    } else if (s.step === 4) {
      this.seq += dt;
      // a looser lid empties faster; a nearly closed one weeps for longer before it is set down
      const hold = this.leakHold;
      if (this.seq > hold) { this.tiltTarget.set(0, 0); this.tiltK = 1.9; }
      if (this.seq > hold && angle < 0.015 && !this.leakFx.busy()) { this.tilt.set(0, 0); store.set({ step: 5 }); this.tiltK = 7; }
    } else if (s.step === 6) {
      this.seq += dt;
      const q = this.seq;
      // 01 hold it there; 02 a line of light runs once round the joint; 03 set it down and rest
      if (q > 0.8 && q < 0.8 + dt * 1.5) sound.click(true);
      if (!this.glowStart) { const c = this.root.worldToLocal(this.camera.position.clone()); this.glowStart = Math.atan2(c.z, c.x) - 1.1; }
      this.glow.set(q > 0.8 ? Math.min(1.0001, (q - 0.8) / 1.9) : -1, this.glowStart);       // begins on the side facing the visitor
      if (q > 2.9 && !s.ending) { this.tiltTarget.set(0, 0); this.tiltK = 1.25; }
      if (q > 2.9 && angle < 0.01 && !this.uprightAt) this.uprightAt = q;
      if (this.uprightAt && q > this.uprightAt + 0.3 && !this.sheenStart) this.sheenStart = q;
      if (this.sheenStart) {
        const k = (q - this.sheenStart) / 3.2;
        sheen.uSheen.value = k < 1 ? -0.05 + k * 0.42 : -1;
        if (k >= 1 && !s.ended) store.set({ ended: true });
      }
      if (this.uprightAt && q > this.uprightAt + 0.7 && !s.ending) store.set({ ending: true });
    }
    // the leak follows the real state: lid openness, how deep the seal sits, and gravity in the tumbler's frame
    const gLocal = new THREE.Vector3(0, -1, 0).applyQuaternion(this.pivot.quaternion.clone().invert());
    this.leakFx.update(dt, {
      on: s.step === 4 && this.seq < this.leakHold && s.lidLock < SEAL_LOCK,   // once it has found the gap it keeps coming while held
      open: clamp(1 - s.lidLock / SEAL_LOCK, 0, 1),
      depth: Math.max(0.003, this.cavity.sealDepth(this.plane.d, this.plane.c, this.plane.s)),
      gLocal, lidY: this.lid.position.y, t: this.clock.elapsedTime, fade: s.step === 5 || s.step === 1 || s.step === 2,
    });
    const lost = this.leakFx.takeLost();
    if (lost > 0) { this.volume = Math.max(this.leakStartVol * 0.88, this.volume - lost); this.applyLevel(); }
  }

  beginLeak(lock) {
    this.leak = clamp(1 - lock / SEAL_LOCK, 0, 1);
    this.leakStartVol = this.volume;
    this.leakHold = 3.0 + 1.0 * (1 - this.leak);   // a looser lid empties faster; a nearly closed one weeps for longer
    this.leakFx.resetTrail();
    this.seq = 0;
    this.tiltTarget.copy(this.tilt);
    this.pointer.intent = null; this.pointer.id = null;
    this.renderer.domElement.style.cursor = '';
    store.set({ step: 4, verdict: 'leak', leakage: this.leak });
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1) * this.speed;
    const t = this.clock.elapsedTime;
    this.updateLid(dt);
    this.updateTilt(dt);
    this.scene.updateMatrixWorld();
    this.updateSurface();
    this.updateWater(dt, t);
    const step = store.get().step;
    const st = store.get();
    const wide = this.narrow && (step === 3 || step === 4 || (step === 6 && !st.ending));
    // success: lean in toward the joint, then step back; ending: make room for the words
    this.emph = damp(this.emph, step === 6 && this.seq < 2.9 ? 1 : 0, step === 6 && this.seq < 2.9 ? 1.4 : 1.1, dt);
    this.endK = damp(this.endK, st.ending ? 1 : 0, 1.1, dt);
    this.zoom = damp(this.zoom, wide ? 1.22 : 1, 2.4, dt);
    this.placeCamera();
    if (this.emph > 0.001 || this.endK > 0.001) {
      const seam = this.root.localToWorld(new THREE.Vector3(0, 0.182, 0));
      const look = this.look.clone().lerp(seam, 0.38 * this.emph);
      if (this.narrow) look.y -= 0.075 * this.endK; else look.x += 0.072 * this.endK;
      const z = this.zoom * (1 - 0.16 * this.emph) * (this.narrow ? 1 + 0.32 * this.endK : 1);
      this.camera.position.copy(look).addScaledVector(this.camBase.clone().sub(this.look), z);
      this.camera.lookAt(look);
    }
    const u = this.floor.material.uniforms;
    const lifted = store.get().lidAligned ? 0 : clamp(1 - this.lid.position.y / 0.09, 0, 1);
    u.uLid.value.set(this.lid.position.x, this.lid.position.z, lifted);
    u.uBody.value = clamp(1 - (this.pivot.position.y - PIVOT_Y) / 0.03, 0, 1);
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
