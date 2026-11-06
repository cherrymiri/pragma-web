import * as THREE from 'three';
import { CAVITY_N, CAVITY_Y0, CAVITY_Y1 } from './liquid.js';

// ---------- studio reflections: the dark-field rig from the Blender scene ----------
export function buildEnvironment(renderer) {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x050506);
  const panel = (x, y, z, w, h, power, tint = 0xffffff) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(tint).multiplyScalar(power), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); s.add(m);
  };
  panel(-5.5, 1, 1.0, 0.34, 9, 5.5, 0xf0f5ff);  // thin tall strip, left
  panel(5.5, 1, 1.0, 0.26, 9, 4, 0xf0f5ff);     // thin tall strip, right
  panel(-3.6, 0.5, 5, 2.2, 7, 1.6);            // broad key for the steel
  panel(3.8, 0.5, 4.6, 1.4, 7, 1.1);           // broad fill
  panel(0, 0.3, 6, 2.4, 6, 0.42);                // front wash, keeps the lid from going dark
  panel(0, -6, 2, 6, 5, 0.5);                    // low bounce for the lid when it is laid over
  panel(0, 7, 0, 7, 5, 0.9);                    // overhead
  panel(-3.5, 1, -4.5, 0.3, 8, 3, 0xeaf3ff);    // back edge lights
  panel(3.5, 1, -4.5, 0.3, 8, 3, 0xeaf3ff);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(s, 0.012, 0.1, 30).texture;
  pmrem.dispose();
  return tex;
}

// ---------- glass: only what a clean surface adds (reflection), on top of what is behind it ----------
export const sheen = { uSheen: { value: -1 } };   // the slow band of light in the closing moment

export function glassMaterial({ veil = 0.03 } = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0x000000, metalness: 0, roughness: 0.03, ior: 1.5, envMapIntensity: 0.42,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide,
  });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uVeil = { value: veil };
    sh.uniforms.uSheen = sheen.uSheen;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vW; uniform float uVeil, uSheen;')
      .replace('#include <emissivemap_fragment>', `
        float ndv = abs(dot(normalize(normal), normalize(vViewPosition)));
        float edge = pow(1.0 - ndv, 2.6);
        // the wall's thickness catching light, plus a faint soft card behind the body
        float card = exp(-pow(vW.x / 0.05, 2.0)) * smoothstep(0.0, 0.1, vW.y) * smoothstep(0.26, 0.1, vW.y);
        float band = exp(-pow((vW.y + vW.x * 0.55 - uSheen) / 0.035, 2.0));
        totalEmissiveRadiance += vec3(0.8, 0.86, 0.93) * (edge * 0.1 + card * uVeil + band * (0.07 + edge * 0.5));`);
  };
  return m;
}

// ---------- the surface function shared by the water body rim and the fine surface mesh ----------
const WAVE = /* glsl */ `
  uniform float uTime, uAgit, uFlow;
  float pragmaWave(vec2 p) {
    float t = uTime, r = length(p);
    float a = 0.00016 + 0.00085 * uAgit;
    float w = sin(p.x * 150.0 + t * 1.5) * 0.55 + sin(p.y * 190.0 - t * 1.9 + 1.2) * 0.35
            + sin((p.x + p.y) * 310.0 + t * 3.1) * 0.16 + sin((p.x - p.y * 0.6) * 520.0 - t * 4.6) * 0.07 * uAgit;
    // rings spreading from where the stream lands
    float ring = sin(r * 760.0 - t * 30.0) * exp(-r * 62.0) * 0.00085 * uFlow
               + sin(r * 420.0 - t * 19.0) * exp(-r * 30.0) * 0.00042 * uFlow;
    return w * a + ring - exp(-r * r * 180000.0) * 0.0013 * uFlow;
  }`;

// the water surface in world space: a plane kept level by gravity, plus the small waves
const SURFACE = /* glsl */ `
  uniform float uLevelY; uniform vec2 uSlope;
  float pragmaSurface(vec2 p) { return uLevelY + dot(uSlope, p) + pragmaWave(p); }`;

const CAVITY = /* glsl */ `
  uniform mat4 uInv; uniform float uR[${CAVITY_N}];
  bool inCavity(vec3 w) {
    vec3 l = (uInv * vec4(w, 1.0)).xyz;
    if (l.y < ${CAVITY_Y0.toFixed(5)} || l.y > ${CAVITY_Y1.toFixed(5)}) return false;
    float f = (l.y - ${CAVITY_Y0.toFixed(5)}) / ${(CAVITY_Y1 - CAVITY_Y0).toFixed(5)} * ${(CAVITY_N - 1).toFixed(1)};
    int i = int(floor(f)); int j = min(i + 1, ${CAVITY_N - 1});
    return length(l.xz) < mix(uR[i], uR[j], fract(f));
  }`;

const SKY_DEEP = 'vec3(0.40, 0.70, 0.88)';
const SKY_LIGHT = 'vec3(0.74, 0.90, 0.98)';

export function waterBodyMaterial(waves) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0x06141c, metalness: 0, roughness: 0.04, ior: 1.33, envMapIntensity: 0.3,
    transparent: true, opacity: 0.82, depthWrite: false, side: THREE.FrontSide,
  });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, waves, sheen);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vW; uniform float uSheen; ${WAVE} ${SURFACE}`)
      .replace('#include <emissivemap_fragment>', `
        float top = pragmaSurface(vW.xz);
        if (vW.y > top) discard;
        float ndv = abs(dot(normalize(normal), normalize(vViewPosition)));
        float depth = clamp((top - vW.y) / 0.15, 0.0, 1.0);
        // light carried through the water: paler toward the glass, deeper through the middle
        vec3 c = mix(${SKY_LIGHT}, ${SKY_DEEP}, 0.34 + 0.34 * ndv + 0.12 * depth);
        float cx = sin(vW.x * 210.0 + vW.y * 60.0 + uTime * 0.7) * sin(vW.x * 120.0 - vW.y * 95.0 - uTime * 0.5);
        c *= 0.86 + 0.05 * cx + 0.16 * (1.0 - depth);
        float band = exp(-pow((vW.y + vW.x * 0.55 - uSheen) / 0.035, 2.0));
        totalEmissiveRadiance += c * (0.27 + band * 0.1) + vec3(0.8, 0.92, 1.0) * pow(1.0 - ndv, 3.0) * 0.1;`);
  };
  return m;
}

export function waterSurface(waves) {
  // polar grid: fine at the middle where the stream lands
  const rings = 44, seg = 96;
  const pos = [0, 0, 0], idx = [];
  for (let i = 1; i <= rings; i++) {
    const r = Math.pow(i / rings, 1.5);
    for (let j = 0; j < seg; j++) { const a = (j / seg) * Math.PI * 2; pos.push(Math.cos(a) * r, 0, Math.sin(a) * r); }
  }
  for (let j = 0; j < seg; j++) idx.push(0, 1 + ((j + 1) % seg), 1 + j);
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = 1 + i * seg + j, b = 1 + i * seg + ((j + 1) % seg), c = a + seg, d = b + seg;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.MeshPhysicalMaterial({
    color: 0x0a1a24, metalness: 0, roughness: 0.03, ior: 1.33, envMapIntensity: 1.5,
    transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide,
  });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, waves);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uRadius; uniform vec2 uCenter; varying vec2 vP; varying vec3 vW; ${WAVE} ${SURFACE}`)
      .replace('#include <begin_vertex>', `
        vec3 transformed = vec3(position.x * uRadius + uCenter.x, 0.0, position.z * uRadius + uCenter.y);
        vP = transformed.xz;
        transformed.y = pragmaSurface(vP);
        vW = transformed;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vP; varying vec3 vW; ${WAVE} ${SURFACE} ${CAVITY}`)
      .replace('#include <normal_fragment_begin>', `
        if (!inCavity(vW)) discard;
        float e = 0.00035;
        float h0 = pragmaSurface(vP);
        vec3 wn = normalize(vec3(h0 - pragmaSurface(vP + vec2(e, 0.0)), e, h0 - pragmaSurface(vP + vec2(0.0, e))));
        vec3 normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
        if (!gl_FrontFacing) normal = -normal;
        vec3 nonPerturbedNormal = normal;`)
      .replace('#include <emissivemap_fragment>', `
        float r = length(vP);
        vec3 c = mix(${SKY_LIGHT}, ${SKY_DEEP}, 0.42);
        totalEmissiveRadiance += c * 0.3 + vec3(0.9, 0.97, 1.0) * exp(-r * r * 90000.0) * uFlow * 0.16;`);
  };
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  return mesh;
}

// ---------- falling stream ----------
export function createStream() {
  const g = new THREE.CylinderGeometry(1, 1, 1, 18, 56, true);
  g.translate(0, -0.5, 0);                    // y: 0 at the nozzle, -1 at the water
  const u = {
    uT: { value: 0 }, uDrop: { value: 0.2 }, uHead: { value: 0 }, uTail: { value: 0 }, uTipY: { value: 0.26 },
  };
  const m = new THREE.MeshPhysicalMaterial({
    color: 0x0a1820, roughness: 0.05, ior: 1.33, envMapIntensity: 1.6, transparent: true, opacity: 0.74, depthWrite: false,
  });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uT, uDrop, uTipY; varying float vFall; varying float vA;`)
      .replace('#include <begin_vertex>', `
        float fall = -position.y * uDrop;            // metres below the nozzle
        vFall = fall;
        // the column thins as it speeds up, and wanders a little more the further it has fallen
        float rad = 0.0032 / pow(1.0 + fall / 0.012, 0.25);
        rad *= 1.0 + 0.09 * sin(fall * 420.0 - uT * 30.0) * smoothstep(0.02, 0.12, fall);
        vec2 sway = vec2(sin(fall * 62.0 - uT * 13.0), cos(fall * 47.0 - uT * 10.5)) * 0.0006 * smoothstep(0.03, 0.2, fall);
        vec3 transformed = vec3(position.x * rad + sway.x, uTipY - fall, position.z * rad + sway.y);
        vA = atan(position.z, position.x);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uT, uHead, uTail; varying float vFall; varying float vA;`)
      .replace('#include <emissivemap_fragment>', `
        if (vFall > uHead || vFall < uTail) discard;
        float ndv = abs(dot(normalize(normal), normalize(vViewPosition)));
        float streak = 0.5 + 0.5 * sin(vFall * 700.0 - uT * 62.0 + vA * 3.0);
        vec3 c = vec3(0.62, 0.84, 0.95);
        totalEmissiveRadiance += c * (0.26 + 0.1 * streak) + vec3(0.92, 0.97, 1.0) * pow(1.0 - ndv, 2.0) * 0.5;`);
  };
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.visible = false;
  return {
    mesh,
    update({ t, tipY, bottomY, head, tail, visible }) {
      mesh.visible = visible;
      u.uT.value = t; u.uTipY.value = tipY; u.uDrop.value = tipY - bottomY; u.uHead.value = head; u.uTail.value = tail;
    },
  };
}

// ---------- air carried down by the stream ----------
export function createBubbles() {
  const N = 90;
  const p = new Float32Array(N * 3), size = new Float32Array(N);
  const live = Array.from({ length: N }, () => ({ on: false, vy: 0, phase: 0 }));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uScale: { value: 900 } },
    vertexShader: `attribute float aSize; uniform float uScale;
      void main() { vec4 v = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * v;
        gl_PointSize = aSize * uScale / -v.z; }`,
    fragmentShader: `void main() { float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard;
        float ring = smoothstep(0.55, 0.85, d) * smoothstep(1.0, 0.86, d) + smoothstep(0.42, 0.0, length(gl_PointCoord - vec2(0.36))) * 0.5;
        gl_FragColor = vec4(vec3(0.88, 0.96, 1.0) * ring * 0.6, 1.0); }`,
  });
  const points = new THREE.Points(g, m);
  points.frustumCulled = false;
  points.renderOrder = 5;
  let carry = 0;
  return {
    points,
    update(dt, { flow, levelY, radius, floorY }) {
      carry += flow * dt * 42;
      const depthRoom = Math.max(levelY - floorY, 0);
      for (let i = 0; i < N; i++) {
        const b = live[i];
        if (!b.on && carry >= 1 && depthRoom > 0.006) {
          carry -= 1;
          const a = Math.random() * Math.PI * 2, r = Math.random() * radius * 0.22;
          const d = Math.min(depthRoom * 0.92, 0.012 + Math.random() ** 2 * 0.075);
          b.on = true; b.vy = 0.022 + Math.random() * 0.03; b.phase = Math.random() * 6;
          p[i * 3] = Math.cos(a) * r; p[i * 3 + 1] = levelY - d; p[i * 3 + 2] = Math.sin(a) * r;
          size[i] = 0.00055 + Math.random() ** 2 * 0.0011;
        }
        if (b.on) {
          b.phase += dt * 9;
          p[i * 3 + 1] += b.vy * dt;
          p[i * 3] += Math.sin(b.phase) * 0.00045 * dt * 9;
          p[i * 3] *= 1 + dt * 0.5; p[i * 3 + 2] *= 1 + dt * 0.5;       // drifts outward from the stream
          if (p[i * 3 + 1] > levelY - 0.0004) { b.on = false; size[i] = 0; }
        }
      }
      g.attributes.position.needsUpdate = true;
      g.attributes.aSize.needsUpdate = true;
    },
    clear() { live.forEach((b, i) => { b.on = false; size[i] = 0; }); carry = 0; g.attributes.aSize.needsUpdate = true; },
  };
}

// ---------- leak: beads form on the seal, swell, let go, and land ----------
export function createDrips() {
  const MAX = 14;
  const geo = new THREE.SphereGeometry(1, 16, 12);
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x10242e, roughness: 0.04, ior: 1.33, envMapIntensity: 1.7, transparent: true, opacity: 0.9, depthWrite: false,
    emissive: new THREE.Color(0.44, 0.66, 0.78), emissiveIntensity: 0.55,
  });
  const group = new THREE.Group();
  const up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3();
  const drops = Array.from({ length: MAX }, () => {
    const m = new THREE.Mesh(geo, mat); m.visible = false; m.renderOrder = 9; group.add(m);
    return { m, on: false, stuck: true, age: 0, grow: 1, size: 0.001, ang: 0, vel: new THREE.Vector3() };
  });
  const rings = Array.from({ length: 6 }, () => {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 40), new THREE.MeshBasicMaterial({ color: 0x9fd3ee, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.visible = false; m.renderOrder = 1; group.add(m);
    return { m, age: 0 };
  });
  return {
    group,
    active: () => drops.some((d) => d.on) || rings.some((r) => r.m.visible),
    spawn(angle, big) {
      const d = drops.find((x) => !x.on);
      if (!d) return;
      Object.assign(d, { on: true, stuck: true, age: 0, grow: 0.5 + Math.random() * 0.4, size: 0.0011 + big * 0.0006 + Math.random() * 0.0003, ang: angle });
      d.vel.set(0, 0, 0); d.m.visible = true;
    },
    // seat(angle, out) gives the world point on the seal; g is the on-screen gravity
    update(dt, seat, g, onDetach) {
      for (const d of drops) {
        if (!d.on) continue;
        d.age += dt;
        if (d.stuck) {
          seat(d.ang, d.m.position);
          const k = Math.min(1, d.age / d.grow);
          d.m.scale.setScalar(d.size * (0.3 + 0.7 * k));
          d.m.position.y -= d.size * 0.5 * k;
          if (k >= 1) { d.stuck = false; onDetach(); }
        } else {
          d.vel.y -= g * dt;
          d.m.position.addScaledVector(d.vel, dt);
          const stretch = 1 + Math.min(0.7, -d.vel.y * 0.55);
          d.m.scale.set(d.size / Math.sqrt(stretch), d.size * stretch, d.size / Math.sqrt(stretch));
          if (d.m.position.y < 0.0012) {
            d.on = false; d.m.visible = false;
            const r = rings.find((x) => !x.m.visible);
            if (r) { r.age = 0; r.m.visible = true; r.m.position.set(d.m.position.x, 0.0006, d.m.position.z); }
          }
        }
      }
      for (const r of rings) {
        if (!r.m.visible) continue;
        r.age += dt;
        const k = r.age / 0.7;
        r.m.scale.setScalar(0.0015 + 0.012 * k);
        r.m.material.opacity = 0.34 * (1 - k);
        if (k >= 1) r.m.visible = false;
      }
    },
    clear() { drops.forEach((d) => { d.on = false; d.m.visible = false; }); rings.forEach((r) => { r.m.visible = false; }); },
  };
}

// ---------- nozzle: a short clear tube that fades out upward ----------
export function createNozzle(tipY) {
  const group = new THREE.Group();
  const prof = [
    [0.0028, 0], [0.0040, 0], [0.0044, 0.0006], [0.0044, 0.010], [0.0050, 0.013], [0.0050, 0.055],
    [0.0043, 0.055], [0.0043, 0.013], [0.0037, 0.010], [0.0032, 0.0006],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  prof.push(prof[0].clone());
  const g = new THREE.LatheGeometry(prof, 32);
  g.computeVertexNormals();
  const m = glassMaterial({ veil: 0 });
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    base(sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
      gl_FragColor.rgb *= smoothstep(${(tipY + 0.052).toFixed(3)}, ${(tipY + 0.016).toFixed(3)}, vW.y) * 0.8;`);
  };
  const mesh = new THREE.Mesh(g, m);
  mesh.position.y = tipY;
  mesh.renderOrder = 6;
  group.add(mesh);
  return group;
}

// ---------- floor: soft pool of light, contact shadow and a quiet reflection ----------
export const floorShader = {
  name: 'PragmaFloor',
  uniforms: {
    color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null },
    uLid: { value: new THREE.Vector3() }, uBody: { value: 1 },
  },
  vertexShader: `uniform mat4 textureMatrix; varying vec4 vUv4; varying vec3 vW;
    void main() { vUv4 = textureMatrix * vec4(position, 1.0); vW = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec3 uLid; uniform float uBody; varying vec4 vUv4; varying vec3 vW;
    void main() {
      vec3 bg = vec3(0.0033, 0.0037, 0.0044);
      float r = length(vW.xz);
      vec3 base = bg + vec3(0.012, 0.0135, 0.016) * exp(-r * r / 0.05);
      float shade = 1.0 - 0.75 * uBody * smoothstep(0.075, 0.018, r);
      float rl = length(vW.xz - uLid.xy);
      shade *= 1.0 - 0.7 * uLid.z * smoothstep(0.075, 0.02, rl);
      vec4 refl = texture2DProj(tDiffuse, vUv4);
      float fade = exp(-r * r / 0.018);
      gl_FragColor = vec4(base * shade + max(refl.rgb - bg, 0.0) * 0.1 * fade, 1.0);
      #include <colorspace_fragment>
    }`,
};
