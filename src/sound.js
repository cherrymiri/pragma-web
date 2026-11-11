// Every sound is made here in the browser from filtered noise and short tones: no recordings, no licences.
// Nothing plays until start() runs from the visitor's tap; if audio is unavailable, every call is silent.
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
const to = (p, v, tau = 0.08) => { if (ctx) p.setTargetAtTime(v, ctx.currentTime, tau); };

export const sound = {
  start() {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);
        noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const d = noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        ch.pour = loop('bandpass', 700, 0.9);
        ch.pourLow = loop('lowpass', 380, 1.2);
        ch.twist = loop('bandpass', 4200, 2.2);
        ch.leak = loop('bandpass', 1900, 1.4);
      }
      ctx.resume?.();
    } catch { ctx = null; }
  },
  // the pitch of a filling vessel rises as the air column above the water shortens
  pour(on, level) {
    if (!ctx) return;
    const wob = 0.85 + Math.random() * 0.3;
    to(ch.pour.g.gain, on ? 0.32 * wob : 0, on ? 0.05 : 0.12);
    to(ch.pour.f.frequency, 560 + 1500 * level, 0.2);
    to(ch.pourLow.g.gain, on ? 0.22 : 0, on ? 0.05 : 0.15);
  },
  twist(speed) {
    if (!ctx) return;
    to(ch.twist.g.gain, Math.min(1, speed * 1.3) * 0.075, 0.04);
  },
  leak(q) {
    if (!ctx) return;
    const gurgle = 0.75 + Math.random() * 0.5;
    to(ch.leak.g.gain, Math.min(1, q * 1.4) * 0.16 * gurgle, 0.06);
    to(ch.leak.f.frequency, 1400 + 900 * q + Math.random() * 300, 0.1);
  },
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
  quiet() { if (!ctx) return; ['pour', 'pourLow', 'twist', 'leak'].forEach((k) => to(ch[k].g.gain, 0, 0.1)); },
};
