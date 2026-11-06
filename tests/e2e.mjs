// Drives the real page in Chromium as a mouse user, a trackpad user and a phone user.
// usage: node tests/e2e.mjs [url]
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const url = process.argv[2] || 'http://localhost:4173/';
const shots = new URL('./shots/', import.meta.url).pathname; fs.mkdirSync(shots, { recursive: true });
const args = ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'];
let fails = 0;
const ok = (c, m, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + m, x); if (!c) fails++; };
const st = (p) => p.evaluate(() => { const s = { ...window.__PRAGMA.get() }; return s; });
const wait = (p, ms) => p.waitForTimeout(ms);
const until = (p, fn, arg, t = 60000) => p.waitForFunction(fn, arg, { timeout: t, polling: 150 });

// screen position of a world point, read from the running camera
const screen = (p, world) => p.evaluate(([x, y, z]) => {
  const s = window.__PRAGMA_STAGE; const v = s.lid.position.clone().set(x, y, z).project(s.camera);
  const b = s.renderer.domElement.getBoundingClientRect();
  return [(v.x + 1) / 2 * b.width + b.left, (1 - v.y) / 2 * b.height + b.top];
}, world);
const lidScreen = async (p) => { const s = await p.evaluate(() => { const q = window.__PRAGMA_STAGE.lid.position; return [q.x, q.y + 0.008, q.z]; }); return screen(p, s); };

async function pc(browser, name, wheelSteps) {
  console.log('\n== ' + name);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.goto(url); await until(p, () => window.__PRAGMA?.get().ready);
  await wait(p, 1800);
  await p.screenshot({ path: shots + name + '-1-start.png' });
  let s = await st(p);
  ok(s.waterLevel === 0 && s.lidMode === 'home' && s.step === 1, 'starts empty, lid off');
  ok((await p.textContent('.prompt')).includes('사랑을 원하는 만큼'), 'step 1 prompt');

  // lid cannot be taken before pouring
  let [lx, ly] = await lidScreen(p);
  await p.mouse.move(lx, ly); await p.mouse.down(); await p.mouse.move(lx - 100, ly - 100, { steps: 4 }); await p.mouse.up();
  ok((await st(p)).lidMode === 'home', 'lid locked before first pour');

  const btn = await p.locator('.pour').boundingBox();
  const bx = btn.x + btn.width / 2, by = btn.y + btn.height / 2;
  await p.mouse.move(bx, by); await p.mouse.down();
  await until(p, () => window.__PRAGMA.get().waterLevel > 0.2);
  await p.screenshot({ path: shots + name + '-2-pouring.png' });
  ok((await st(p)).isPouring, 'pouring while held');
  await p.mouse.up(); await wait(p, 120);
  const a = await st(p); await wait(p, 900); const b = await st(p);
  ok(!a.isPouring && Math.abs(a.waterLevel - b.waterLevel) < 1e-6, 'stops on release', a.waterLevel.toFixed(3));
  await wait(p, 300);
  await p.screenshot({ path: shots + name + '-3-settled.png' });
  ok((await p.textContent('.prompt')).includes('뚜껑을 가져와'), 'step 2 prompt');

  await p.mouse.move(bx, by); await p.mouse.down(); await wait(p, 1500);
  await p.mouse.up(); await wait(p, 200);
  const c = await st(p);
  ok(c.waterLevel > b.waterLevel + 0.005, 'second pour continues from previous level', c.waterLevel.toFixed(3));

  await p.mouse.move(bx, by); await p.mouse.down();
  await until(p, () => window.__PRAGMA.get().waterLevel >= 1, undefined, 120000);
  await wait(p, 600);
  const d = await st(p);
  ok(d.waterLevel === 1 && !d.isPouring, 'auto stop at maximum while still held');
  await p.mouse.up();
  await wait(p, 900);
  await p.screenshot({ path: shots + name + '-4-full.png' });

  // wrong drop goes home
  [lx, ly] = await lidScreen(p);
  await p.mouse.move(lx, ly); await p.mouse.down();
  await p.mouse.move(lx + 60, ly - 200, { steps: 6 }); await wait(p, 300); await p.mouse.up();
  await until(p, () => window.__PRAGMA.get().lidMode === 'home');
  ok(true, 'wrong drop returns home');

  // right drop aligns
  [lx, ly] = await lidScreen(p);
  const [mx, my] = await screen(p, [0, 0.215, 0]);
  await p.mouse.move(lx, ly); await p.mouse.down();
  await p.mouse.move(lx, my - 40, { steps: 8 }); await wait(p, 300);
  await p.mouse.move(mx, my, { steps: 8 }); await wait(p, 900);
  await p.screenshot({ path: shots + name + '-5-carrying.png' });
  await p.mouse.up();
  await until(p, () => window.__PRAGMA.get().lidAligned);
  await wait(p, 300);
  await p.screenshot({ path: shots + name + '-6-aligned.png' });
  const e = await st(p);
  ok(e.lidAligned && e.lidLock < 0.01, 'aligned on the mouth, not auto closed', e.lidLock);
  await wait(p, 1200);
  ok((await st(p)).lidLock < 0.01, 'stays where it is without input');

  await p.mouse.move(640, 300);
  const y0 = (await st(p)).lidPosition.split(',')[1];
  await wheelSteps(p, 1, 0.35);
  await wait(p, 1000);
  const f = await st(p);
  const y1 = f.lidPosition.split(',')[1];
  ok(f.lidLock > 0.05 && f.lidLock < 0.9 && +y1 < +y0, 'scroll down turns and lowers the lid', f.lidLock.toFixed(3));
  // let the easing finish first: software rendering runs at a few frames per second here
  await until(p, () => { const s = window.__PRAGMA_STAGE; return s.turns === s.turnsTarget; });
  const f2 = await st(p); await wait(p, 2000);
  ok(Math.abs((await st(p)).lidLock - f2.lidLock) < 1e-6, 'stops where the visitor stops', f2.lidLock.toFixed(3));
  const scroll = await p.evaluate(() => [scrollY, document.documentElement.scrollTop, window.visualViewport.scale]);
  ok(scroll[0] === 0 && scroll[2] === 1, 'no page scroll or zoom');
  await p.screenshot({ path: shots + name + '-7-part.png' });
  await wheelSteps(p, -1, 0.15); await wait(p, 700);
  ok((await st(p)).lidLock < f.lidLock - 0.02, 'scroll up loosens');
  await wheelSteps(p, 1, 4); await wait(p, 1500);
  const g = await st(p);
  ok(Math.abs(g.lidLock - 1) < 1e-3 && Math.abs(+g.lidPosition.split(',')[1] - 0.183) < 2e-5, 'hard stop at fully closed', g.lidPosition);
  await wheelSteps(p, 1, 1); await wait(p, 500);
  ok(Math.abs((await st(p)).lidLock - 1) < 1e-3, 'cannot pass closed');
  await p.screenshot({ path: shots + name + '-8-closed.png' });
  await wheelSteps(p, -1, 4); await wait(p, 1500);
  ok((await st(p)).lidLock < 1e-3, 'hard stop at fully open');
  ok(errs.length === 0, 'no console errors', errs.slice(0, 3).join(' | '));
  await ctx.close();
}

async function phone(browser, name, device) {
  console.log('\n== ' + name);
  const ctx = await browser.newContext({ ...device });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(url); await until(p, () => window.__PRAGMA?.get().ready); await wait(p, 1800);
  await p.screenshot({ path: shots + name + '-1-start.png' });
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  const drag = async (x0, y0, x1, y1, n = 14, hold = 300) => {
    await touch('touchStart', x0, y0); await wait(p, 60);
    for (let i = 1; i <= n; i++) { await touch('touchMove', x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n); await wait(p, 30); }
    await wait(p, hold); await touch('touchEnd');
  };
  const btn = await p.locator('.pour').boundingBox();
  await touch('touchStart', btn.x + btn.width / 2, btn.y + btn.height / 2);
  await until(p, () => window.__PRAGMA.get().waterLevel > 0.25);
  await p.screenshot({ path: shots + name + '-2-pouring.png' });
  await touch('touchEnd'); await wait(p, 300);
  const a = await st(p); ok(!a.isPouring && a.waterLevel > 0.25, 'touch hold pours, release stops', a.waterLevel.toFixed(3));
  const [lx, ly] = await lidScreen(p);
  const [mx, my] = await screen(p, [0, 0.215, 0]);
  await drag(lx, ly, mx, my, 18, 900);
  await until(p, () => window.__PRAGMA.get().lidAligned);
  ok(true, 'finger drag aligns the lid');
  await wait(p, 300);
  await p.screenshot({ path: shots + name + '-3-aligned.png' });
  const vw = device.viewport.width;
  await drag(vw * 0.75, 420, vw * 0.25, 420, 12, 100); await wait(p, 900);
  const b = await st(p);
  ok(b.lidLock > 0.03, 'swipe left closes', b.lidLock.toFixed(3));
  await drag(vw * 0.25, 420, vw * 0.7, 420, 12, 100); await wait(p, 900);
  ok((await st(p)).lidLock < b.lidLock, 'swipe right loosens');
  for (let i = 0; i < 16; i++) await drag(vw * 0.85, 420, vw * 0.15, 420, 6, 10);
  await wait(p, 1000);
  const c = await st(p);
  ok(Math.abs(c.lidLock - 1) < 1e-3, 'can close fully by repeated swipes', c.lidLock.toFixed(3));
  await p.screenshot({ path: shots + name + '-4-closed.png' });
  ok((await p.evaluate(() => scrollY)) === 0, 'no scroll');
  ok(errs.length === 0, 'no page errors', errs.slice(0, 3).join(' | '));
  await ctx.close();
}

const browser = await chromium.launch({ args });
const mouseWheel = async (p, dir, amount) => { for (let i = 0; i < Math.round(amount * 12); i++) { await p.mouse.wheel(0, dir * 100); await wait(p, 25); } };
const trackpad = async (p, dir, amount) => { for (let i = 0; i < Math.round(amount * 80); i++) { await p.mouse.wheel(0, dir * 15); await wait(p, 8); } };
const which = process.argv[3] || 'all';
if (which === 'all' || which === 'mouse') await pc(browser, 'pc-mouse', mouseWheel);
if (which === 'all' || which === 'trackpad') await pc(browser, 'pc-trackpad', trackpad);
if (which === 'all' || which === 'iphone') await phone(browser, 'iphone', devices['iPhone 14']);
if (which === 'all' || which === 'android') await phone(browser, 'android', devices['Pixel 7']);
await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
