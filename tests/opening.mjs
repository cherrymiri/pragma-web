import { createRequire } from 'module';
const require = createRequire(import.meta.url); const { chromium, devices } = require('playwright');
const b = await chromium.launch({ args: ['--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
for (const [w,h] of [[1024,640],[1280,720],[1366,768],[1440,900],[1920,1080]]) {
  const p = await (await b.newContext({viewport:{width:w,height:h}})).newPage();
  await p.goto('http://localhost:4176/'); await p.waitForTimeout(1800);
  const r = await p.evaluate(() => [...document.querySelectorAll('.opening-desc p')].map(e => { const rr = e.getBoundingClientRect(); const lh = parseFloat(getComputedStyle(e).lineHeight); return { lines: Math.round(rr.height / lh), right: Math.round(rr.right), vw: innerWidth, fs: getComputedStyle(e).fontSize }; }));
  const ov = await p.evaluate(() => document.querySelector('.opening').scrollWidth > innerWidth);
  console.log(w, h, JSON.stringify(r), 'overflow', ov);
  if (w===1280||w===1920) await p.screenshot({path:`tests/shots/op-${w}.png`});
  await p.close();
}
const p = await (await b.newContext({...devices['iPhone 14'], deviceScaleFactor:1})).newPage();
await p.goto('http://localhost:4176/'); await p.waitForTimeout(1800); await p.screenshot({path:'tests/shots/op-ph.png'});
console.log('ph overflow', await p.evaluate(() => document.querySelector('.opening').scrollWidth > innerWidth));
await b.close();
