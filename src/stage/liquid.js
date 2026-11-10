import * as THREE from 'three';

// The cavity is the inside of Tumbler_InnerWall, read straight off the model.
// Water is defined as a volume in that cavity, so it can never reach the air gap or the glass.
export const CAVITY_Y0 = 0.01045;
export const CAVITY_Y1 = 0.1955;     // top of the neck, under the lid
export const CAVITY_N = 48;          // table size used by the shaders
const FLUSH = 0.00005;               // water sits a hair into the glass, as in the Blender model
const SLICES = 110;

export class Cavity {
  constructor(innerWall) {
    const ray = new THREE.Raycaster();
    const dir = new THREE.Vector3(1, 0, 0);
    this.ys = []; this.rs = [];
    let last = 0.02;
    for (let i = 0; i <= SLICES; i++) {
      const y = CAVITY_Y0 + 0.00002 + ((CAVITY_Y1 - CAVITY_Y0 - 0.00004) * i) / SLICES;
      ray.set(new THREE.Vector3(0, y, 0), dir);
      const hit = ray.intersectObject(innerWall, false)[0];
      if (hit) last = hit.point.x + FLUSH;
      this.ys.push(y); this.rs.push(last);
    }
    this.dy = (CAVITY_Y1 - CAVITY_Y0) / SLICES;
    this.table = new Float32Array(CAVITY_N);
    for (let i = 0; i < CAVITY_N; i++) this.table[i] = this.radiusAt(CAVITY_Y0 + ((CAVITY_Y1 - CAVITY_Y0) * i) / (CAVITY_N - 1));
  }

  radiusAt(y) {
    const f = ((y - CAVITY_Y0) / (CAVITY_Y1 - CAVITY_Y0)) * SLICES;
    const i = Math.max(0, Math.min(SLICES - 1, Math.floor(f)));
    return this.rs[i] + (this.rs[i + 1] - this.rs[i]) * Math.max(0, Math.min(1, f - i));
  }

  // Volume on the low side of the plane  x·s + y·c = d  (axis coordinates; c, s = cos, sin of the tilt)
  volume(d, c, s) {
    let v = 0;
    for (let i = 0; i <= SLICES; i++) {
      const y = this.ys[i], r = this.rs[i];
      if (s < 1e-4) { if (y * c < d) v += Math.PI * r * r; continue; }
      const cx = (d - y * c) / s;
      if (cx >= r) v += Math.PI * r * r;
      else if (cx > -r) v += r * r * Math.acos(-cx / r) + cx * Math.sqrt(r * r - cx * cx);
    }
    return v * this.dy;
  }

  // The plane that holds exactly this much water
  solve(volume, c, s) {
    let lo = -0.32, hi = 0.32;
    for (let i = 0; i < 18; i++) {
      const m = (lo + hi) / 2;
      if (this.volume(m, c, s) < volume) lo = m; else hi = m;
    }
    return (lo + hi) / 2;
  }

  // Water reaches the lid's seal ring when the lowest point of the mouth is under the plane
  sealWet(d, c, s) {
    const r = this.radiusAt(CAVITY_Y1 - 0.0005);
    return -r * s + CAVITY_Y1 * c < d;
  }

  // how far the lowest point of the mouth sits under the water (m, negative when dry)
  sealDepth(d, c, s) {
    const r = this.radiusAt(CAVITY_Y1 - 0.0005);
    return d - (-r * s + CAVITY_Y1 * c);
  }

  // A solid of revolution matching the cavity: the visible body of water, cut by the surface in the shader
  geometry() {
    const pts = [new THREE.Vector2(0, CAVITY_Y0)];
    for (let i = 0; i <= SLICES; i++) if (i % 2 === 0 || i < 10) pts.push(new THREE.Vector2(this.rs[i], this.ys[i]));
    pts.push(new THREE.Vector2(0, CAVITY_Y1));
    return new THREE.LatheGeometry(pts, 72);
  }
}
