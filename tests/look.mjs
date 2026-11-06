// quick look at key states without waiting for real-time filling
import { createRequire } from 'module';
const require = createRequire(import.meta.url); const { chromium, devices } = require('playwright');
const b = await chromium.launch({ args: ['--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const run = async (name, opts) => { const c = await b.newContext(opts); const p = await c.newPage(); p.on('pageerror',e=>console.log(e.message));
 await p.goto('http://localhost:4173/'); await p.waitForFunction(()=>window.__PRAGMA?.get().ready,{timeout:60000}); await p.waitForTimeout(1800);
 const set=(h,pour)=>p.evaluate(([h,pour])=>{const s=window.__PRAGMA_STAGE;s.heightMm=h;s.applyLevel();s.setPour(pour);},[h,pour]);
 await p.screenshot({path:`tests/shots/l-${name}-a.png`});
 await set(95,true); await p.waitForTimeout(3500); await p.screenshot({path:`tests/shots/l-${name}-b.png`});
 await p.evaluate(()=>{const s=window.__PRAGMA_STAGE;s.setPour(false);s.heightMm=120;s.applyLevel();window.__PRAGMA.set({hasPoured:true,lidMode:'seating'});}); await p.waitForTimeout(2600);
 await p.evaluate(()=>{const s=window.__PRAGMA_STAGE;s.turnsTarget=s.turns=0;}); await p.waitForTimeout(1500);
 await p.screenshot({path:`tests/shots/l-${name}-c.png`}); await c.close(); };
await run('pc',{viewport:{width:1280,height:800}}); await run('ph',devices['iPhone 14']); await b.close();
