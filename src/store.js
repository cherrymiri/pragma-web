// Interaction state lives outside React so the render loop can read and write it every frame.
// Phase 2 (tilt, leak check, ending) reads lidLock and waterLevel from here.
const state = {
  step: 1,               // 1 따르기, 2 뚜껑 조절, 3 기울이기, 4 누수, 5 다시 맞추기, 6 성공
  waterLevel: 0,         // 0 empty … 1 maximum (height, continuous)
  isPouring: false,      // water is leaving the nozzle right now
  hasPoured: false,      // water has reached the tumbler at least once
  lidPosition: [0, 0, 0],
  lidMode: 'home',       // home | dragging | returning | seating | aligned
  lidAligned: false,
  lidRotation: 0,        // radians about the screw axis, 0 = fully closed
  lidTurns: 2.25,        // turns left before fully closed
  lidLock: 0,            // 0 just resting on the thread … 1 fully closed (continuous)
  canTilt: false,       // lid is on the mouth and has been turned at least a little
  tiltAngle: 0,          // radians from upright
  sealWet: false,        // water is touching the lid's seal right now
  verdict: 'none',       // none | leak | sealed
  leakage: 0,            // 0 … 1, how loose the lid was at the last leak
  ended: false,          // the closing moment has finished
  ready: false,
  error: false,
};
const listeners = new Set();
export const store = {
  get: () => state,
  set(patch) {
    let changed = false;
    for (const k in patch) if (state[k] !== patch[k]) { state[k] = patch[k]; changed = true; }
    if (changed) { snap = { ...state }; listeners.forEach((l) => l()); }
  },
  subscribe(l) { listeners.add(l); return () => listeners.delete(l); },
  snapshot: () => snap,
};
let snap = { ...state };
if (typeof window !== 'undefined') window.__PRAGMA = store;
