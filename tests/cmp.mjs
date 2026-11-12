import { createRequire } from 'module';
const require = createRequire(import.meta.url); const { chromium, devices } = require('playwright');
const C = 'file:///tmp/claude-0/-home-claude/37e76a05-2064-5cf6-8ab2-e442cd900923/scratchpad/cmp/';
const b = await chromium.launch({ args: ['--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
for (const [n, opts] of [['ph', { ...devices['iPhone 14'], deviceScaleFactor: 1 }], ]) {
  for (const [k, u] of [['eros', C + 'eros.html'], ['ludus', C + 'ludus.html'], ['pragma', 'http://localhost:4176/']]) {
    if (k !== 'pragma') continue;
    const p = await (await b.newContext(opts)).newPage(); await p.goto(u); await p.waitForTimeout(3400);
    await p.screenshot({ path: `tests/shots/cmp-${n}-${k}.png` });
    if (k === 'pragma') console.log(n, JSON.stringify(await p.evaluate(() => { const d = document.querySelector('.op-desc'); const r = d.getBoundingClientRect(); return { h: Math.round(r.height), lh: parseFloat(getComputedStyle(d).lineHeight), w: Math.round(r.width), vw: innerWidth, overflowX: document.querySelector('.opening').scrollWidth > innerWidth }; })));
    await p.close();
  }
}
await b.close();
