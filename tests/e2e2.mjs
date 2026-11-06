// Full visitor journeys for phase 2, driven with real mouse, wheel and touch input.
// usage: node tests/e2e2.mjs [url] [which]
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const url = process.argv[2] || 'http://localhost:4176/';
const which = process.argv[3] || 'all';
const SPEED = 3;     // software rendering is slow; simulated time runs faster so the suite finishes
const shots = new URL('./shots/', import.meta.url).pathname; fs.mkdirSync(shots, { recursive: true });
let fails = 0;
const ok = (c, m, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + m, x); if (!c) fails++; };
const st = (p) => p.evaluate(() => ({ ...window.__PRAGMA.get() }));
const wait = (p, ms) => p.waitForTimeout(ms);
const until = (p, fn, arg, t = 120000) => p.waitForFunction(fn, arg, { timeout: t, polling: 120 });
const step = (p, n) => until(p, (n) => window.__PRAGMA.get().step === n, n);
const screen = (p, w) => p.evaluate(([x, y, z]) => { const s = window.__PRAGMA_STAGE; const v = s.lid.position.clone().set(x, y, z).project(s.camera); const b = s.renderer.domElement.getBoundingClientRect(); return [(v.x + 1) / 2 * b.width + b.left, (1 - v.y) / 2 * b.height + b.top]; }, w);
const lidAt = async (p) => screen(p, await p.evaluate(() => { const q = window.__PRAGMA_STAGE.lid.position; return [q.x, q.y + 0.008, q.z]; }));
const prompt = async (p) => (await p.textContent('.prompt')).trim();
const texts = (p) => p.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent));
const noNumbers = async (p, tag) => { const t = await p.evaluate(() => document.body.innerText); ok(!/\d|mL|%/.test(t), 'no numbers on screen: ' + tag); };

async function open(browser, opts) {
  const ctx = await browser.newContext(opts);
  const p = await ctx.newPage();
  p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && p.errs.push(m.text()));
  await p.goto(url); await until(p, () => window.__PRAGMA?.get().ready);
  await p.evaluate((s) => { window.__PRAGMA_STAGE.speed = s; }, SPEED);
  await wait(p, 600);
  return { ctx, p };
}
async function pourMouse(p, untilLevel) {
  const b = await p.locator('.pour').boundingBox();
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down();
  await until(p, (l) => window.__PRAGMA.get().waterLevel >= l, untilLevel);
  await p.mouse.up(); await wait(p, 150);
}
async function bringLid(p) {
  const [lx, ly] = await lidAt(p); const [mx, my] = await screen(p, [0, 0.215, 0]);
  await p.mouse.move(lx, ly); await p.mouse.down();
  await p.mouse.move(lx, my - 40, { steps: 6 }); await wait(p, 250);
  await p.mouse.move(mx, my, { steps: 6 }); await wait(p, 500); await p.mouse.up();
  await until(p, () => window.__PRAGMA.get().lidAligned);
  await p.mouse.move(mx, my - 60);
}
const wheelTo = async (p, dir, n, dy = 100) => { await p.mouse.move(480, 200); for (let i = 0; i < n; i++) { await p.mouse.wheel(0, dir * dy); await wait(p, 15); } await until(p, () => { const s = window.__PRAGMA_STAGE; return s.turns === s.turnsTarget; }); };
async function tiltBy(p, px) {
  const [x, y] = await screen(p, [0, 0.1, 0]);
  await p.mouse.move(x, y); await p.mouse.down();
  await p.mouse.move(x + px, y, { steps: 10 });
}
const tiltBtn = (p) => p.getByRole('button', { name: '기울여 보기' }).click();

async function journeyMouse(browser) {
  console.log('\n== 1,3,4,6: little water, loose lid, leak, re-adjust, success, replay (mouse)');
  const { ctx, p } = await open(browser, { viewport: { width: 960, height: 600 } });
  ok((await prompt(p)).includes('사랑을 원하는 만큼'), 'prompt: pour');
  ok(!(await texts(p)).includes('뚜껑 닫기'), 'no close button before water');
  await pourMouse(p, 0.03);
  ok((await texts(p)).includes('뚜껑 닫기'), 'close button after a little water', (await st(p)).waterLevel.toFixed(3));
  await p.screenshot({ path: shots + 'a1-little.png' });
  await p.getByRole('button', { name: '뚜껑 닫기' }).click();
  ok((await st(p)).step === 2 && (await prompt(p)).includes('뚜껑을 가져와'), 'step 2 after 뚜껑 닫기');
  ok(!(await texts(p)).includes('사랑 따르기'), 'pour button gone');
  await until(p, () => window.__PRAGMA_STAGE.nozzleLift > 0.9);
  ok(true, 'nozzle retired');
  await bringLid(p);
  ok(!(await texts(p)).includes('기울여 보기'), 'no tilt button until turned');
  await wheelTo(p, 1, 4);
  ok((await texts(p)).includes('기울여 보기'), 'tilt button after a small turn', (await st(p)).lidLock.toFixed(3));
  const lockA = (await st(p)).lidLock, volA = await p.evaluate(() => window.__PRAGMA_STAGE.volume);
  await tiltBtn(p);
  ok((await prompt(p)).includes('텀블러를 기울여보세요'), 'prompt: tilt');
  await tiltBy(p, 130);                     // a modest lean
  await wait(p, 2200);
  let s = await st(p);
  ok(s.step === 3 && !s.sealWet, 'little water does not reach the lid at a modest lean', s.tiltAngle.toFixed(2));
  await p.screenshot({ path: shots + 'a2-modest.png' });
  await p.mouse.move(900, 300, { steps: 8 });
  await step(p, 4);
  await p.mouse.up();
  await until(p, () => document.querySelector('canvas') && window.__PRAGMA_STAGE.drips.active());
  await wait(p, 350);
  await p.screenshot({ path: shots + 'a3-leak.png' });
  s = await st(p);
  ok(s.verdict === 'leak', 'loose lid leaks with little water, past level', s.tiltAngle.toFixed(2));
  await step(p, 5);
  await wait(p, 300);
  await p.screenshot({ path: shots + 'a4-retry.png' });
  s = await st(p);
  const volB = await p.evaluate(() => window.__PRAGMA_STAGE.volume);
  ok(s.tiltAngle < 0.02 && (await prompt(p)).includes('조금 더 맞춰볼까요'), 'back upright with retry prompt');
  ok(Math.abs(s.lidLock - lockA) < 1e-6, 'lid rotation kept', s.lidLock.toFixed(3));
  ok(volB < volA && volB > volA * 0.5, 'water kept, small loss', (volB / volA).toFixed(3));
  await noNumbers(p, 'retry');
  await wheelTo(p, 1, 4);
  ok((await st(p)).lidLock > lockA, 'can keep turning from where it was');
  await tiltBtn(p);
  await tiltBy(p, 500);
  await step(p, 4);                        // still short of sealed: leaks again
  await p.mouse.up();
  await step(p, 5);
  ok(true, 'second attempt still loose leaks again');
  await wheelTo(p, 1, 20);
  ok(Math.abs((await st(p)).lidLock - 1) < 1e-6, 'hard stop fully closed');
  await tiltBtn(p);
  await tiltBy(p, 500);
  await step(p, 6);
  s = await st(p);
  ok(s.verdict === 'sealed', 'closed lid holds with little water', s.tiltAngle.toFixed(2));
  await p.screenshot({ path: shots + 'a5-hold.png' });
  ok(await p.evaluate(() => !window.__PRAGMA_STAGE.drips.active()), 'no drops on success');
  await p.mouse.up();
  await until(p, () => window.__PRAGMA_STAGE.sheenStart > 0);
  await until(p, () => window.__PRAGMA_STAGE.seq >= window.__PRAGMA_STAGE.sheenStart + 1.3);
  await p.screenshot({ path: shots + 'a6-sheen.png' });
  await until(p, () => window.__PRAGMA.get().ended);
  await wait(p, 400);
  await p.screenshot({ path: shots + 'a7-end.png' });
  await noNumbers(p, 'end');
  ok((await prompt(p)) === '', 'no ending text invented');
  await p.getByRole('button', { name: '다시 체험하기' }).click();
  await wait(p, 500);
  s = await st(p);
  ok(s.step === 1 && s.waterLevel === 0 && s.lidMode === 'home' && !s.lidAligned && s.lidLock === 0 && !s.hasPoured && !s.ended && s.tiltAngle < 1e-3, 'replay resets everything');
  await pourMouse(p, 0.03);
  ok((await texts(p)).includes('뚜껑 닫기'), 'second run works');
  ok(p.errs.length === 0, 'no console errors', p.errs.slice(0, 2).join(' | '));
  await ctx.close();
}

async function journeyFull(browser) {
  console.log('\n== 2,5,7: full water, sealed at first try (trackpad-style wheel)');
  const { ctx, p } = await open(browser, { viewport: { width: 960, height: 600 } });
  const b = await p.locator('.pour').boundingBox();
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down();
  await until(p, () => window.__PRAGMA.get().waterLevel >= 1);
  await wait(p, 300);
  let s = await st(p);
  ok(s.waterLevel === 1 && !s.isPouring, 'auto stop at maximum while held');
  await p.mouse.up();
  await p.getByRole('button', { name: '뚜껑 닫기' }).click();
  await bringLid(p);
  for (let i = 0; i < 30; i++) { await p.mouse.wheel(0, 4); await wait(p, 6); }
  await wait(p, 700);
  ok((await st(p)).lidLock > 0.005, 'small two-finger deltas turn the lid', (await st(p)).lidLock.toFixed(3));
  for (let i = 0; i < 260; i++) { await p.mouse.wheel(0, 14); await wait(p, 4); }
  await until(p, () => { const s = window.__PRAGMA_STAGE; return s.turns === s.turnsTarget; });
  ok((await st(p)).lidLock > 0.999, 'trackpad reaches the stop', (await st(p)).lidLock.toFixed(3));
  const y = (await st(p)).lidPosition.split(',')[1];
  ok(Math.abs(+y - 0.183) < 2e-5, 'lid seats at the model position');
  await tiltBtn(p);
  await tiltBy(p, -170);                    // leaning left this time
  await until(p, () => window.__PRAGMA.get().sealWet);
  s = await st(p);
  ok(s.tiltAngle < 1.2, 'full water reaches the lid sooner than a little water', s.tiltAngle.toFixed(2));
  await p.screenshot({ path: shots + 'b1-full-tilt.png' });
  await step(p, 6);
  await p.mouse.up();
  ok((await st(p)).verdict === 'sealed', 'sealed at first try');
  await until(p, () => window.__PRAGMA.get().ended);
  ok(p.errs.length === 0, 'no console errors', p.errs.slice(0, 2).join(' | '));
  await ctx.close();
}

async function journeyPhone(browser, name, device) {
  console.log('\n== 8: touch journey on ' + name);
  const { ctx, p } = await open(browser, { ...device });
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  const drag = async (x0, y0, x1, y1, n = 12, hold = 200, end = true) => { await touch('touchStart', x0, y0); await wait(p, 50); for (let i = 1; i <= n; i++) { await touch('touchMove', x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n); await wait(p, 25); } await wait(p, hold); if (end) await touch('touchEnd'); };
  const tap = async (name) => { const b = await p.getByRole('button', { name }).boundingBox(); await p.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); };
  const vw = device.viewport.width;
  const b = await p.locator('.pour').boundingBox();
  await touch('touchStart', b.x + b.width / 2, b.y + b.height / 2);
  await until(p, () => window.__PRAGMA.get().waterLevel >= 0.25);
  await touch('touchEnd'); await wait(p, 200);
  await p.screenshot({ path: shots + name + '-1.png' });
  await tap('뚜껑 닫기'); await wait(p, 300);
  const [lx, ly] = await lidAt(p); const [mx, my] = await screen(p, [0, 0.215, 0]);
  await drag(lx, ly, mx, my, 16, 800);
  await until(p, () => window.__PRAGMA.get().lidAligned);
  ok(true, 'finger drag aligns the lid');
  await drag(vw * 0.75, 420, vw * 0.45, 420);
  await until(p, () => window.__PRAGMA.get().canTilt);
  await p.screenshot({ path: shots + name + '-2.png' });
  await tap('기울여 보기'); await wait(p, 300);
  await drag(vw * 0.15, 420, vw * 0.95, 420, 14, 300, false);
  await step(p, 4);
  await touch('touchEnd');
  await until(p, () => window.__PRAGMA_STAGE.drips.active());
  await wait(p, 300);
  await p.screenshot({ path: shots + name + '-3-leak.png' });
  ok((await st(p)).verdict === 'leak', 'finger tilt leaks on a loose lid', (await st(p)).tiltAngle.toFixed(2));
  await step(p, 5);
  for (let i = 0; i < 18 && (await st(p)).lidLock < 0.999; i++) await drag(vw * 0.9, 420, vw * 0.1, 420, 6, 20);
  await until(p, () => { const s = window.__PRAGMA_STAGE; return s.turns === s.turnsTarget; });
  ok((await st(p)).lidLock > 0.999, 'swipes close it fully');
  await tap('기울여 보기'); await wait(p, 300);
  await drag(vw * 0.1, 420, vw * 0.95, 420, 14, 300, false);
  await step(p, 6);
  await p.screenshot({ path: shots + name + '-4-hold.png' });
  await touch('touchEnd');
  ok((await st(p)).verdict === 'sealed', 'sealed by touch');
  await until(p, () => window.__PRAGMA.get().ended);
  await p.screenshot({ path: shots + name + '-5-end.png' });
  ok((await p.evaluate(() => scrollY)) === 0, 'no page scroll');
  ok(p.errs.length === 0, 'no page errors', p.errs.slice(0, 2).join(' | '));
  await ctx.close();
}

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const run = async (n, f) => { if (which === 'all' || which === n) { try { await f(); } catch (e) { ok(false, n + ' crashed', e.message.slice(0, 300)); } } };
await run('mouse', () => journeyMouse(browser));
await run('full', () => journeyFull(browser));
await run('iphone', () => journeyPhone(browser, 'iphone', devices['iPhone 14']));
await run('android', () => journeyPhone(browser, 'android', devices['Pixel 7']));
await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
