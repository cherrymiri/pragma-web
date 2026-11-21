// Sounds are made here in the browser from filtered noise and short tones, except pouring water:
// that is two real recordings (both CC0 on Freesound), trimmed into seamless loops and layered:
//   pour_stream.wav  "Foley_WaterDispenser_Pour.wav" by MrFossy        freesound.org/s/521901
//   pour_glass.wav   "water pour into glass_near_nm.wav" by Alex_hears_things  freesound.org/s/316686
// Nothing plays until start() runs from the visitor's tap; if audio is unavailable, every call is silent.
import { speakerOut } from './iosAudio.js';
let ctx = null, master = null, noise = null;
const ch = {};

function loop(filterType, freq, q, gain = 0) {
  const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.value = gain;
  src.connect(f).connect(g).connect(master);
  src.start(0, Math.random() * 2);
  return { f, g };
}
// A looping recording that sits silent until its gain is raised. Before it has loaded, it is simply quiet.
function recording(url) {
  const g = ctx.createGain(); g.gain.value = 0; g.connect(master);
  fetch(url).then((r) => r.arrayBuffer()).then((data) => new Promise((ok, fail) => {
    const p = ctx.decodeAudioData(data, ok, fail);
    if (p && p.then) p.then(ok, fail);
  })).then((buf) => {
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    src.connect(g); src.start(0, Math.random() * buf.duration);
  }).catch(() => {});
  return { g };
}
const to = (p, v, tau = 0.08) => { if (ctx) p.setTargetAtTime(v, ctx.currentTime, tau); };

export const sound = {
  start() {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain(); master.gain.value = 0.55; master.connect(speakerOut(ctx));
        noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const d = noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        // 정수기 물줄기(B) + 컵에 떨어지는 소리(D): 따르는 동안 끊김 없이 반복, 멈추면 부드럽게 꺼짐
        ch.pour = recording('sfx/pour_stream.wav');
        ch.pourLow = recording('sfx/pour_glass.wav');
        ch.twist = loop('bandpass', 4200, 2.2);
      }
      ctx.resume?.();
    } catch { ctx = null; }
  },
  // a steady stream from a water dispenser meeting the water in the cup: same pitch from start to finish
  pour(on, level) {
    if (!ctx) return;
    to(ch.pour.g.gain, on ? 0.35 : 0, on ? 0.06 : 0.15);
    to(ch.pourLow.g.gain, on ? 0.28 : 0, on ? 0.06 : 0.15);
  },

  twist(speed) {
    if (!ctx) return;
    to(ch.twist.g.gain, Math.min(1, speed * 1.3) * 0.075, 0.04);
  },
  // a leak is heard only as its drops: no continuous rushing noise under them
  leak() {},

  drip(big) {
    if (!ctx) return;
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    const f0 = (big ? 700 : 950) + Math.random() * 500;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 1.9, t + 0.05);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(big ? 0.07 : 0.045, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g).connect(master); o.start(t); o.stop(t + 0.1);
  },
  // two tiny metallic ticks, a lid finding its seat
  click(soft = false) {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    [0, 0.028].forEach((dt, i) => {
      const t = t0 + dt;
      const src = ctx.createBufferSource(); src.buffer = noise;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = i ? 5200 : 3600; f.Q.value = 6;
      const g = ctx.createGain(); const v = (soft ? 0.12 : 0.2) * (i ? 0.6 : 1);
      g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
      src.connect(f).connect(g).connect(master); src.start(t, Math.random()); src.stop(t + 0.04);
      const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.value = i ? 3100 : 2400;
      og.gain.setValueAtTime(v * 0.25, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      o.connect(og).connect(master); o.start(t); o.stop(t + 0.07);
    });
  },
  // a soft glass tick: the check angle has been reached
  tick() {
    if (!ctx) return;
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 1760;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(master); o.start(t); o.stop(t + 0.4);
  },
  // 엔딩: 살짝 어긋나 있던 두 음이 서로 맞춰져 맑은 완전5도가 되고, 끝에 유리 '팅' (맞춰가는 사랑)
  ending() {
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.08;
    const out = ctx.createGain(); out.gain.value = 0.155;   // ending at about -31 LUFS, the level shared by all six works;   // about as loud as the pouring water (was 0.55, ~14 dB louder than everything else)
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4800;
    const len = Math.floor(ctx.sampleRate * 1.2), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3) * 0.5; }
    const verb = ctx.createConvolver(); verb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.4;
    out.connect(lp); lp.connect(master); lp.connect(verb); verb.connect(wet); wet.connect(master);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0); env.gain.linearRampToValueAtTime(1, t0 + 0.25);
    env.gain.setValueAtTime(1, t0 + 0.6); env.gain.setTargetAtTime(0.0001, t0 + 0.6, 0.62);
    env.connect(out);
    const tone = (f, a, tune) => {
      const o = ctx.createOscillator(), g = ctx.createGain(); g.gain.value = a;
      if (tune) { o.frequency.setValueAtTime(f * 1.035, t0); o.frequency.setTargetAtTime(f, t0, 0.45); }
      else o.frequency.value = f;
      o.connect(g).connect(env); o.start(t0); o.stop(t0 + 3.2);
    };
    tone(293.66, 0.5); tone(587.33, 0.12); tone(440, 0.45, true);   // D4 + 그 옥타브, 어긋났다 맞춰지는 A4
    const tg = t0 + 1.0;                                              // 유리 '팅' (D5)
    [[587.33, 0.25, 2.2], [587.33 * 2.76, 0.05, 8]].forEach(([f, a, dec]) => {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, tg); g.gain.linearRampToValueAtTime(a, tg + 0.003); g.gain.setTargetAtTime(0.0001, tg + 0.003, 1 / dec);
      o.connect(g).connect(out); o.start(tg); o.stop(tg + 2);
    });
  },
  quiet() { if (!ctx) return; ['pour', 'pourLow', 'twist'].forEach((k) => to(ch[k].g.gain, 0, 0.1)); },
};
