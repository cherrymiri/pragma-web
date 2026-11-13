// how far a visitor has to pull before the check starts, and that the verdict comes exactly once
import { createRequire } from 'module';
const require = createRequire(import.meta.url); const { chromium, devices } = require('playwright');
const b = await chromium.launch({ args: ['--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
let fails = 0; const ok = (c, m, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + m, x); if (!c) fails++; };
async function run(name, opts, mm, lock, touch) {
  const ctx = await b.newContext(opts); const p = await ctx.newPage(); p.setDefaultTimeout(120000);
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:4176/'); await p.waitForFunction(() => window.__PRAGMA?.get().ready);
  await p.click('.op-btn'); await p.waitForTimeout(1200);
  await p.evaluate(([mm, lock]) => { const s = window.__PRAGMA_STAGE, g = window.__PRAGMA; s.speed = 3; s.volume = s.cavity.volume(mm / 1000, 1, 0); s.applyLevel();
    g.set({ hasPoured: true, step: 2, lidMode: 'seating' }); window.__lock = lock; window.__verdicts = 0; g.subscribe(() => { const st = g.get().step; if (st !== window.__last && (st === 4 || st === 6)) window.__verdicts++; window.__last = st; }); }, [mm, lock]);
  await p.waitForFunction(() => window.__PRAGMA.get().lidAligned);
  await p.evaluate(() => { const s = window.__PRAGMA_STAGE; s.turns = s.turnsTarget = 2.25 * (1 - window.__lock); });
  await p.waitForTimeout(500);
  await p.getByRole('button', { name: '기울여 확인하기' }).click();
  const [cx, cy] = await p.evaluate(() => { const s = window.__PRAGMA_STAGE; const v = s.lid.position.clone().set(0, 0.1, 0).project(s.camera); const r = s.renderer.domElement.getBoundingClientRect(); return [(v.x + 1) / 2 * r.width, (1 - v.y) / 2 * r.height]; });
  const cdp = touch ? await ctx.newCDPSession(p) : null;
  const tp = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  if (touch) await tp('touchStart', cx, cy); else { await p.mouse.move(cx, cy); await p.mouse.down(); }
  let px = 0;
  for (px = 10; px <= 400; px += 10) {
    if (touch) await tp('touchMove', cx + px, cy); else await p.mouse.move(cx + px, cy);
    await p.waitForTimeout(250);
    if (await p.evaluate(() => window.__PRAGMA.get().checking)) break;
  }
  const at = await p.evaluate(() => { const s = window.__PRAGMA_STAGE; return { angle: s.tilt.length(), check: s.checkAngle }; });
  if (touch) await tp('touchEnd'); else await p.mouse.up();
  const shortSide = Math.min(opts.viewport.width, opts.viewport.height);
  ok(px <= 0.25 * shortSide, `${name}: check starts after a short pull`, `${px}px of ${shortSide}px, at ${(at.angle * 57.3).toFixed(0)}° of ${(at.check * 57.3).toFixed(0)}°`);
  await p.waitForFunction(() => { const st = window.__PRAGMA.get().step; return st === 4 || st === 6; });
  const reached = await p.evaluate(() => window.__PRAGMA_STAGE.tilt.length() / window.__PRAGMA_STAGE.checkAngle);
  ok(reached > 0.97, `${name}: glides on to the check angle by itself`, (reached * 100).toFixed(0) + '%');
  const want = lock >= 0.995 ? 6 : 4;
  ok((await p.evaluate(() => window.__PRAGMA.get().step)) === want, `${name}: verdict ${want === 6 ? 'sealed' : 'leak'}`);
  await p.waitForTimeout(2500);
  ok((await p.evaluate(() => window.__verdicts)) === 1, `${name}: verdict runs once`);
  ok(errs.length === 0, `${name}: no errors`, errs.join('|'));
  await ctx.close();
}
await run('pc little water loose', { viewport: { width: 1280, height: 720 } }, 14, 0.3, false);
await run('pc little water sealed', { viewport: { width: 1280, height: 720 } }, 14, 1, false);
await run('iphone half water loose', { ...devices['iPhone 14'], deviceScaleFactor: 1 }, 90, 0.5, true);
await b.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
