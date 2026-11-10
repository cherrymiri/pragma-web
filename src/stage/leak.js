import * as THREE from 'three';

// One continuous leak system, driven by how open the lid is (o: 0 sealed … 1 wide open),
// how deep the seal sits under the water, and which way gravity points in the tumbler's frame.
// Everything starts at the seam between the gasket and the glass shoulder, in the tumbler's own space.

const SEAM_Y = 0.1814;        // shoulder under the gasket
const R_SEAM = 0.0386;
const R_LID = 0.0388;
const OFF = 0.00022;          // water sits on the glass, not in it
const FLOOR = 0.0008;

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const bodyR = (y) => { const t = clamp((y * 1000 - 6) / 168, 0, 1); return (31.6 + 6.6 * Math.pow(t, 0.9)) / 1000; };

const NOISE = /* glsl */ `
  float h1(float n) { return fract(sin(n) * 43758.5453); }
  float vn(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f); }`;

// thin water: reflective, pale sky blue, broken up by a moving noise when the flow is not continuous
function streamMaterial() {
  const u = { uT: { value: 0 }, uC: { value: 1 }, uSpeed: { value: 0.1 } };
  const m = new THREE.MeshPhysicalMaterial({
    color: 0x0a1820, roughness: 0.04, ior: 1.33, envMapIntensity: 1.7, transparent: true, opacity: 0.9, depthWrite: false,
  });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aS; attribute float aFall; varying float vS; varying float vFall;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvS = aS; vFall = aFall;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uT, uC, uSpeed; varying float vS; varying float vFall; ${NOISE}`)
      .replace('#include <emissivemap_fragment>', `
        float n = vn(vS * 260.0 - uT * uSpeed * 260.0) * 0.65 + vn(vS * 710.0 - uT * uSpeed * 610.0 + 7.0) * 0.35;
        float thr = mix(0.62, -0.1, uC) + vFall * mix(7.0, 3.2, uC);
        if (n < thr) discard;
        float ndv = abs(dot(normalize(normal), normalize(vViewPosition)));
        totalEmissiveRadiance += vec3(0.6, 0.83, 0.95) * 0.3 + vec3(0.92, 0.97, 1.0) * pow(1.0 - ndv, 2.0) * 0.55;`);
  };
  return { m, u };
}

// a tube whose rings follow a path; on glass it is flattened into a rivulet
class Tube {
  constructor(maxRings, sides, material) {
    this.max = maxRings; this.sides = sides;
    const n = maxRings * sides;
    const g = (this.geo = new THREE.BufferGeometry());
    this.pos = new Float32Array(n * 3); this.nor = new Float32Array(n * 3);
    this.aS = new Float32Array(n); this.aF = new Float32Array(n);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aS', new THREE.BufferAttribute(this.aS, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aFall', new THREE.BufferAttribute(this.aF, 1).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < maxRings - 1; i++) for (let j = 0; j < sides; j++) {
      const a = i * sides + j, b = i * sides + ((j + 1) % sides), c = a + sides, d = b + sides;
      idx.push(a, c, b, b, c, d);
    }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  // rings: [{ p, n (surface normal or null), rn, rb, s, fall }]
  build(rings) {
    const k = Math.min(rings.length, this.max);
    if (k < 2) { this.mesh.visible = false; return; }
    const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), c = new THREE.Vector3(), v = new THREE.Vector3(), nn = new THREE.Vector3();
    for (let i = 0; i < k; i++) {
      const r = rings[i];
      T.subVectors(rings[Math.min(i + 1, k - 1)].p, rings[Math.max(i - 1, 0)].p).normalize();
      if (r.n) N.copy(r.n); else N.set(1, 0, 0);
      B.crossVectors(T, N).normalize(); N.crossVectors(B, T).normalize();
      c.copy(r.p).addScaledVector(N, r.n ? r.rn : 0);
      for (let j = 0; j < this.sides; j++) {
        const a = (j / this.sides) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        v.copy(c).addScaledVector(N, ca * r.rn).addScaledVector(B, sa * r.rb);
        nn.copy(N).multiplyScalar(ca / Math.max(r.rn, 1e-6)).addScaledVector(B, sa / Math.max(r.rb, 1e-6)).normalize();
        const o = i * this.sides + j;
        this.pos[o * 3] = v.x; this.pos[o * 3 + 1] = v.y; this.pos[o * 3 + 2] = v.z;
        this.nor[o * 3] = nn.x; this.nor[o * 3 + 1] = nn.y; this.nor[o * 3 + 2] = nn.z;
        this.aS[o] = r.s; this.aF[o] = r.fall;
      }
    }
    const g = this.geo;
    for (const n of ['position', 'normal', 'aS', 'aFall']) g.attributes[n].needsUpdate = true;
    g.setDrawRange(0, (k - 1) * this.sides * 6);
    this.mesh.visible = true;
  }
}

export function createLeak(root, gravity, sounds = {}) {
  const group = new THREE.Group();
  const wall = streamMaterial(), fall = streamMaterial();
  const wallTube = new Tube(48, 8, wall.m), fallTube = new Tube(40, 8, fall.m);
  wallTube.mesh.renderOrder = 9; fallTube.mesh.renderOrder = 9;
  group.add(wallTube.mesh, fallTube.mesh);

  // wet trail left on the glass
  const filmMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uA: { value: 0 } },
    vertexShader: `attribute float aS; varying float vS; varying vec3 vN; varying vec3 vV;
      void main() { vS = aS; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uA; varying float vS; varying vec3 vN; varying vec3 vV; ${NOISE}
      void main() { float ndv = abs(dot(normalize(vN), normalize(vV)));
        float streak = 0.45 + 0.55 * vn(vS * 140.0) * vn(vS * 37.0 + 3.0);
        gl_FragColor = vec4(vec3(0.62, 0.82, 0.95) * uA * streak * (0.16 + 0.5 * pow(1.0 - ndv, 2.0)), 1.0); }`,
  });
  const filmTube = new Tube(48, 6, filmMat);
  filmTube.mesh.renderOrder = 8;
  group.add(filmTube.mesh);

  // wet seam: a band on the joint that darkens and glints where water is pushing through
  const seamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uWet: { value: 0 }, uDown: { value: 0 }, uSpread: { value: 0.4 }, uT: { value: 0 } },
    vertexShader: `varying vec3 vL; void main() { vL = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uWet, uDown, uSpread, uT; varying vec3 vL; ${NOISE}
      void main() {
        float az = atan(vL.z, vL.x);
        float d = abs(mod(az - uDown + 3.14159265, 6.2831853) - 3.14159265);
        float spread = exp(-pow(d / uSpread, 2.0));
        float bead = smoothstep(0.45, 0.85, vn(az * 34.0 + 3.0) * 0.7 + vn(az * 90.0 - uT * 0.3) * 0.3);
        float band = 1.0 - abs(vL.y - ${SEAM_Y.toFixed(4)}) / 0.0013;
        float a = uWet * spread * clamp(band, 0.0, 1.0) * (0.35 + 0.65 * bead);
        gl_FragColor = vec4(vec3(0.58, 0.82, 0.96) * a * 0.55, 1.0); }`,
  });
  const seam = new THREE.Mesh(new THREE.CylinderGeometry(R_SEAM + 0.0001, R_SEAM + 0.0001, 0.0026, 128, 1, true), seamMat);
  seam.geometry.translate(0, SEAM_Y, 0);
  seam.renderOrder = 8;
  root.add(seam);

  // beads and drops
  const dropGeo = new THREE.SphereGeometry(1, 14, 10);
  const dropMat = new THREE.MeshPhysicalMaterial({
    color: 0x10242e, roughness: 0.04, ior: 1.33, envMapIntensity: 1.7, transparent: true, opacity: 0.94, depthWrite: false,
    emissive: new THREE.Color(0.56, 0.78, 0.9), emissiveIntensity: 0.9,
  });
  const drops = Array.from({ length: 44 }, () => {
    const m = new THREE.Mesh(dropGeo, dropMat); m.visible = false; m.renderOrder = 10; group.add(m);
    return { m, state: 'off', az: 0, t: 0, life: 1, size: 0.001, dist: 0, slideTo: 0, slideV: 0, dir: 1, local: new THREE.Vector3(), vel: new THREE.Vector3() };
  });

  // landing: rings and a thin pool on the floor
  const rings = Array.from({ length: 8 }, () => {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 40), new THREE.MeshBasicMaterial({ color: 0x9fd3ee, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.visible = false; m.renderOrder = 1; group.add(m);
    return { m, age: 0 };
  });
  const poolMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uA: { value: 0 } },
    vertexShader: 'varying vec2 vU; void main() { vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uA; varying vec2 vU;
      void main() { float r = length(vU - 0.5) * 2.0; float a = (1.0 - smoothstep(0.55, 1.0, r)) * (0.6 + 0.4 * smoothstep(0.75, 0.95, r));
        gl_FragColor = vec4(vec3(0.45, 0.66, 0.8) * a * uA, 1.0); }`,
  });
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), poolMat);
  pool.rotation.x = -Math.PI / 2; pool.position.y = 0.0005; pool.visible = false; pool.renderOrder = 1;
  group.add(pool);

  const st = {
    q: 0, run: 0, lmax: 0, dir: 0, az: 0, seamWet: 0, film: 0, filmLen: 0, filmAz: 0, filmDir: 1,
    fallOn: false, head: 0, headV: 0, tail: 0, tailV: 0, beadClock: 0, dropClock: 0, ringClock: 0,
    pool: 0, poolA: 0, lost: 0, seed: Math.random() * 10,
  };
  const L = new THREE.Vector3(), W = new THREE.Vector3(), Nw = new THREE.Vector3();

  // a point on the outside of the glass (dir 1: down the body, -1: over the lid), in tumbler space
  function onWall(az, dist, dir, out) {
    const w = 0.011 * Math.sin(dist * 170 + st.seed) + 0.005 * Math.sin(dist * 420 + st.seed * 2.3);
    const a = az + w * smooth(0, 0.01, dist);
    if (dir >= 0) { const y = Math.max(0.006, SEAM_Y - dist); const r = bodyR(y) + OFF; return out.set(r * Math.cos(a), y, r * Math.sin(a)); }
    const y = Math.min(SEAM_Y + 0.0012 + dist, st.lidTop); return out.set((R_LID + OFF) * Math.cos(a), y, (R_LID + OFF) * Math.sin(a));
  }
  const toWorld = (v) => root.localToWorld(v);
  const normalW = (az, out) => out.set(Math.cos(az), 0, Math.sin(az)).transformDirection(root.matrixWorld);

  function spawnBead(o) {
    const d = drops.find((x) => x.state === 'off');
    if (!d) return;
    const g = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.3;
    d.az = st.az + g() * (0.22 + 0.55 * o);
    d.state = 'grow'; d.t = 0; d.life = 0.5 + Math.random() * 1.3;
    d.size = 0.0007 + Math.random() * 0.0011 + Math.min(st.q, 0.4) * 0.0012;
    d.m.visible = true;
  }
  function release(d, fromWorld, v0) {
    d.state = 'fall'; d.m.position.copy(fromWorld); d.vel.copy(v0);
  }
  function spawnDrop(at, v0, size) {
    const d = drops.find((x) => x.state === 'off');
    if (!d) return;
    d.size = size; d.m.visible = true; d.m.scale.setScalar(size); release(d, at, v0);
  }
  function landed(x, z, big) {
    const r = rings.find((k) => !k.m.visible);
    if (r) { r.age = 0; r.big = big; r.m.visible = true; r.m.position.set(x, 0.0006, z); }
    if (!pool.visible || st.pool < 1e-6) { pool.position.x = x; pool.position.z = z; }
    st.pool += big ? 0.6 : 0.25; pool.visible = true;
    sounds.drip?.(big);
  }

  return {
    group,
    get q() { return st.q; },
    busy: () => st.q > 0.02 || st.fallOn || drops.some((d) => d.state === 'fall' || d.state === 'slide' || d.state === 'grow'),
    takeLost() { const l = st.lost; st.lost = 0; return l; },

    // P: { on, open, depth, gLocal, lidY, t }
    update(dt, P) {
      const o = P.open;
      st.lidTop = P.lidY + 0.0172;
      const g = P.gLocal;
      if (P.on) st.az = Math.atan2(g.z, g.x);
      const ga = -g.y;                                  // > 0 pulls down the body, < 0 toward the lid
      const qT = P.on ? Math.pow(o, 1.1) * (0.6 + 0.4 * clamp(Math.sqrt(Math.max(P.depth, 0) / 0.025), 0, 1)) : 0;
      st.q = damp(st.q, qT, qT > st.q ? 0.8 + 3.5 * o : 2.4, dt);
      const q = st.q;
      st.lost += q * 2.4e-6 * dt;
      sounds.leak?.(q);

      const fed = q > 0.12;
      // where the rivulet runs, and how far it can go before it lets go of the glass
      st.dir = ga > 0.12 ? 1 : ga < -0.12 ? -1 : 0;
      const pull = smooth(0.12, 0.6, Math.abs(ga));
      st.lmax = st.dir === 1 ? (0.012 + 0.13 * q) * pull : st.dir === -1 ? Math.max(0, st.lidTop - SEAM_Y - 0.0012) * pull : 0;
      if (fed) st.run = Math.min(st.lmax, st.run + (0.03 + 0.17 * q) * Math.max(Math.abs(ga), 0.3) * dt);
      else st.run = Math.max(0, st.run - 0.02 * dt);

      // the joint itself
      st.seamWet = damp(st.seamWet, q > 0.003 ? 0.45 + 0.55 * Math.min(1, q * 4) : 0, q > 0.003 ? 1.6 : 0.35, dt);
      seamMat.uniforms.uWet.value = st.seamWet;
      seamMat.uniforms.uDown.value = st.az;
      seamMat.uniforms.uSpread.value = 0.3 + 0.9 * o;
      seamMat.uniforms.uT.value = P.t;
      seam.visible = st.seamWet > 0.004;

      // rivulet on the glass
      const r0 = 0.00028 + 0.0012 * q;
      const wallRings = [];
      const nW = Math.max(2, Math.min(46, Math.ceil(st.run / 0.003) + 1));
      if (st.run > 0.0015 && q > 0.04) {
        for (let i = 0; i < nW; i++) {
          const dist = (st.run * i) / (nW - 1);
          const p = toWorld(onWall(st.az, dist, st.dir, L).clone());
          const a = st.az;
          const k = 1 + 0.18 * Math.sin(dist * 380 - P.t * 40) + 0.08 * Math.sin(dist * 900 - P.t * 70);
          const front = smooth(0, 0.004, st.run - dist + 0.0005);
          const rr = r0 * k * (0.55 + 0.45 * front);
          wallRings.push({ p, n: normalW(a, new THREE.Vector3()), rn: rr * 0.7, rb: rr * 1.5, s: dist, fall: 0 });
        }
        wallTube.build(wallRings);
      } else wallTube.mesh.visible = false;
      wall.u.uT.value = P.t; wall.u.uC.value = smooth(0.05, 0.55, q); wall.u.uSpeed.value = 0.04 + 0.2 * q;
      wall.m.opacity = 0.9 * smooth(0.04, 0.14, q);

      // where it leaves the glass
      const D = toWorld(onWall(st.az, st.run, st.dir, L).clone());
      D.addScaledVector(normalW(st.az, Nw), r0 * 0.9);
      if (st.dir === 0) D.copy(toWorld(L.set(R_SEAM * Math.cos(st.az), SEAM_Y, R_SEAM * Math.sin(st.az)))).addScaledVector(normalW(st.az, Nw), 0.0005);

      // falling column: grows from its head, and when the feed stops its tail falls away
      const reach = st.run >= st.lmax - 0.0005;
      const floorDist = Math.max(0, D.y - FLOOR);
      if (fed && reach) {
        if (!st.fallOn) { st.fallOn = true; st.head = 0; st.headV = 0.04; st.tail = 0; st.tailV = 0; }
        st.tail = 0; st.tailV = 0;
      } else if (st.fallOn) { st.tailV += gravity * dt; st.tail += st.tailV * dt; }
      if (st.fallOn) {
        st.headV += gravity * dt; st.head = Math.min(floorDist, st.head + st.headV * dt);
        if (st.tail >= st.head - 0.001) st.fallOn = false;
      }
      if (st.fallOn) {
        const rf = [];
        const n = 36;
        for (let i = 0; i < n; i++) {
          const f = st.tail + (st.head - st.tail) * Math.pow(i / (n - 1), 1.35);
          const p = D.clone(); p.y -= f;
          const thin = Math.pow(1 + f / 0.01, -0.25);
          const rr = r0 * 0.9 * thin * (1 + 0.1 * Math.sin(f * 500 - P.t * 55));
          rf.push({ p, n: null, rn: rr, rb: rr, s: st.run + f, fall: f });
        }
        fallTube.build(rf);
        fall.u.uT.value = P.t; fall.u.uC.value = smooth(0.05, 0.55, q); fall.u.uSpeed.value = 0.5 + 0.6 * q;
        fall.m.opacity = 0.9;
        if (st.head >= floorDist - 0.0005) {
          st.ringClock -= dt;
          if (st.ringClock <= 0) { landed(D.x, D.z, q > 0.4); st.ringClock = 0.18 + Math.random() * 0.25 - q * 0.1; }
          st.pool += q * dt * 0.8;
        }
      } else fallTube.mesh.visible = false;

      // separate drops letting go where the rivulet leaves the glass (thin, broken flows)
      const dropRate = q > 0.08 ? (1.5 + 6 * q) * (1 - smooth(0.5, 0.78, q)) + (q > 0.5 ? 1.2 : 0) : 0;
      st.dropClock -= dt;
      if (dropRate > 0 && st.dropClock <= 0 && reach) {
        spawnDrop(D.clone(), new THREE.Vector3(0, -0.02, 0), 0.0009 + Math.random() * 0.0012 + q * 0.0006);
        st.dropClock = (-Math.log(1 - Math.random()) / dropRate) * 0.9 + 0.04;       // irregular, never metronomic
      }
      // beads swelling on the joint (all the time it is wet, most visible when the lid is nearly closed)
      st.beadClock -= dt;
      const beadRate = q > 0.004 ? 0.7 + 2.6 * Math.min(q, 0.4) : 0;
      if (beadRate > 0 && st.beadClock <= 0) { spawnBead(o); st.beadClock = -Math.log(1 - Math.random()) / beadRate; }

      // wet trail
      if (fed || q > 0.04) { st.filmLen = Math.max(st.filmLen, st.run); st.filmAz = st.az; st.filmDir = st.dir; }
      st.film = damp(st.film, q > 0.04 ? 0.55 + 0.45 * q : 0, q > 0.04 ? 2.5 : 0.3 * (P.fade ? 2.5 : 1), dt);
      if (st.filmLen > 0.002 && st.film > 0.01) {
        const fr = []; const n = Math.max(2, Math.min(46, Math.ceil(st.filmLen / 0.003) + 1));
        for (let i = 0; i < n; i++) {
          const dist = (st.filmLen * i) / (n - 1);
          const p = toWorld(onWall(st.filmAz, dist, st.filmDir, L).clone());
          const w = 0.0016 * (0.8 + 0.4 * Math.sin(dist * 160 + st.seed)) * smooth(st.filmLen + 0.001, st.filmLen - 0.004, dist);
          fr.push({ p, n: normalW(st.filmAz, new THREE.Vector3()), rn: 0.00006, rb: w + 0.0002, s: dist, fall: 0 });
        }
        filmTube.build(fr);
        filmMat.uniforms.uA.value = st.film;
      } else filmTube.mesh.visible = false;

      // drops and beads
      for (const d of drops) {
        if (d.state === 'off') continue;
        d.t += dt;
        if (d.state === 'grow' || d.state === 'rest') {
          const k = Math.min(1, d.t / d.life);
          const s = d.state === 'grow' ? d.size * (0.25 + 0.75 * k) : d.size * Math.max(0, 1 - d.t / 2.6);
          L.set(R_SEAM * Math.cos(d.az), SEAM_Y - 0.0002 - s * 0.3, R_SEAM * Math.sin(d.az));
          L.addScaledVector(Nw.set(Math.cos(d.az), 0, Math.sin(d.az)), s * 0.55);
          d.m.position.copy(toWorld(L));
          d.m.scale.set(s, s * 0.8, s);
          if (d.state === 'grow' && k >= 1) {
            const near = Math.abs(((d.az - st.az + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
            if (near < 0.5 && Math.random() < 0.45 + 0.5 * st.q) {
              // merges and runs a short way before letting go
              d.state = 'slide'; d.dist = 0; d.slideV = 0.008; d.dir = st.dir; d.t = 0;
              d.slideTo = st.dir === 0 ? 0 : 0.005 + Math.random() * 0.016 * (st.dir === 1 ? 1 : 0.6);
              d.size *= 1.25;
              if (st.dir !== 0) { st.filmAz = st.az; st.filmDir = st.dir; st.filmLen = Math.max(st.filmLen, d.slideTo * 0.8); }
            } else { d.state = 'rest'; d.t = 0; }
          }
          if (d.state === 'rest' && d.t > 2.6) { d.state = 'off'; d.m.visible = false; }
        } else if (d.state === 'slide') {
          d.slideV = Math.min(0.07, d.slideV + 0.05 * dt);
          d.dist += d.slideV * dt;
          onWall(d.az, Math.min(d.dist, d.slideTo), d.dir, L);
          L.addScaledVector(Nw.set(Math.cos(d.az), 0, Math.sin(d.az)), d.size * 0.5);
          d.m.position.copy(toWorld(L));
          d.m.scale.set(d.size * 0.85, d.size, d.size * 0.85);
          if (d.dist >= d.slideTo) release(d, d.m.position.clone(), new THREE.Vector3(0, -0.01, 0));
        } else if (d.state === 'fall') {
          d.vel.y -= gravity * dt;
          d.m.position.addScaledVector(d.vel, dt);
          const stretch = 1 + Math.min(0.6, -d.vel.y * 0.5);
          d.m.scale.set(d.size / Math.sqrt(stretch), d.size * stretch, d.size / Math.sqrt(stretch));
          if (d.m.position.y < FLOOR + d.size) { d.state = 'off'; d.m.visible = false; landed(d.m.position.x, d.m.position.z, false); }
        }
      }
      for (const r of rings) {
        if (!r.m.visible) continue;
        r.age += dt;
        const k = r.age / (r.big ? 0.8 : 0.6);
        r.m.scale.setScalar(0.0015 + (r.big ? 0.016 : 0.01) * k);
        r.m.material.opacity = 0.28 * (1 - k);
        if (k >= 1) r.m.visible = false;
      }
      // the pool spreads a little, and dries away once the tumbler is upright again
      st.poolA = damp(st.poolA, P.fade ? 0 : Math.min(1, st.pool * 0.35), P.fade ? 0.5 : 2, dt);
      const pr = 0.006 + 0.022 * Math.sqrt(Math.min(st.pool, 6) / 6);
      pool.scale.set(pr * 2, pr * 2, 1);
      poolMat.uniforms.uA.value = st.poolA * 0.5;
      if (P.fade && st.poolA < 0.01) { st.pool = 0; pool.visible = false; }
    },

    clear() {
      Object.assign(st, { q: 0, run: 0, seamWet: 0, film: 0, filmLen: 0, fallOn: false, head: 0, tail: 0, pool: 0, poolA: 0, lost: 0 });
      drops.forEach((d) => { d.state = 'off'; d.m.visible = false; });
      rings.forEach((r) => { r.m.visible = false; });
      [wallTube, fallTube, filmTube].forEach((t) => { t.mesh.visible = false; });
      seam.visible = false; pool.visible = false;
    },
    resetTrail() { st.filmLen = 0; st.film = 0; },
  };
}

// the light that runs once around the joint when the lid holds
export function createSeamGlow(root) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uP: { value: -1 }, uStart: { value: 0 } },
    vertexShader: 'varying float vH; varying vec2 vXZ; void main() { vH = uv.y; vXZ = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uP, uStart; varying float vH; varying vec2 vXZ;
      void main() {
        if (uP < 0.0) discard;
        float az = atan(vXZ.y, vXZ.x);
        float travelled = uP * 6.2831853;
        float behind = mod(uStart + travelled - az + 12.566370, 6.2831853);
        float lit = behind < travelled ? exp(-behind / 1.1) : 0.0;
        float fade = (1.0 - smoothstep(0.82, 1.0, uP)) * smoothstep(0.0, 0.05, uP);
        float edge = exp(-pow((vH - 0.5) / 0.14, 2.0)) + 0.22 * exp(-pow((vH - 0.5) / 0.45, 2.0));
        gl_FragColor = vec4(vec3(0.7, 0.83, 0.95) * lit * fade * edge * 2.3, 1.0); }`,
  });
  const g = new THREE.CylinderGeometry(0.03892, 0.03892, 0.0018, 160, 1, true);   // tall enough to rasterise, drawn as a fine line
  g.translate(0, SEAM_Y + 0.0006, 0);
  const m = new THREE.Mesh(g, mat);
  m.renderOrder = 11;
  root.add(m);
  return { set(p, start) { mat.uniforms.uP.value = p; mat.uniforms.uStart.value = start; } };
}
