import { createRequire } from 'module';
const require = createRequire(import.meta.url); const { chromium, devices } = require('playwright');
const url='http://localhost:4176/', out='tests/shots/';
const b = await chromium.launch({ args: ['--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const page = async (opts) => { const c = await b.newContext(opts); const p = await c.newPage(); p.setDefaultTimeout(120000); p.on('pageerror',e=>console.log('E',e.message)); p.on('console',m=>m.type()==='error'&&console.log('C',m.text().slice(0,300)));
  await p.goto(url); await p.waitForFunction(()=>window.__PRAGMA?.get().ready,{timeout:60000}); return p; };
const seqAt = (p, t) => p.waitForFunction((t)=>window.__PRAGMA_STAGE.seq>=t,t,{timeout:90000,polling:50});
const prep = (p, lock, mm=95) => p.evaluate(([lock,mm])=>{const s=window.__PRAGMA_STAGE,g=window.__PRAGMA;s.speed=3;s.volume=s.cavity.volume(mm/1000,1,0);s.applyLevel();g.set({hasPoured:true,step:2,lidMode:'seating'});window.__lock=lock;},[lock,mm]);
const go = (p, a) => p.evaluate((a)=>{const s=window.__PRAGMA_STAGE;s.turns=s.turnsTarget=2.25*(1-window.__lock);s.wetTime=0;window.__PRAGMA.set({step:3});s.pointer.intent='tilt';s.tiltTarget.set(a,0);},a);
// opening
let p = await page({viewport:{width:1280,height:800}}); await p.waitForTimeout(1500); await p.screenshot({path:out+'o-pc.png'});
let ph = await page({...devices['iPhone 14'], deviceScaleFactor: 1}); await ph.waitForTimeout(1500); await ph.screenshot({path:out+'o-ph.png'}); await ph.close();
await p.click('.opening-start'); await p.waitForTimeout(1300); await p.screenshot({path:out+'o-after.png'});
for (const [name,lock] of (process.argv[2]==='end'?[]:[['A',0.05],['B',0.5],['C',0.94]])) {
  await prep(p, lock); await p.waitForFunction(()=>window.__PRAGMA.get().lidAligned,{timeout:60000}); await go(p,1.25);
  await p.waitForFunction(()=>window.__PRAGMA.get().step===4,{timeout:60000});
  await p.evaluate(()=>{window.__PRAGMA_STAGE.speed=0.6});
  for (const t of [0.7,1.5,2.4]) { await seqAt(p,t); await p.screenshot({path:`${out}k-${name}-${t}.png`, clip:{x:420,y:120,width:560,height:440}}); }
  await p.evaluate(()=>{window.__PRAGMA_STAGE.speed=3}); await p.waitForFunction(()=>window.__PRAGMA.get().step===5,{timeout:90000});
  console.log(name, JSON.stringify(await p.evaluate(()=>({lost:1-window.__PRAGMA_STAGE.volume/window.__PRAGMA_STAGE.leakStartVol}))));
}
// success
await p.evaluate(()=>{const s=window.__PRAGMA_STAGE;s.turns=s.turnsTarget=0;window.__lock=1;});
if (process.argv[2]==='end') { await prep(p,1); await p.waitForFunction(()=>window.__PRAGMA.get().lidAligned,{timeout:60000}); }
await p.waitForTimeout(400); await go(p,1.65);
await p.waitForFunction(()=>window.__PRAGMA.get().step===6,{timeout:90000});
await p.evaluate(()=>{window.__PRAGMA_STAGE.speed=0.6});
for (const t of [0.6,1.3,1.9,2.4]) { await seqAt(p,t); await p.screenshot({path:`${out}s-${t}.png`}); }
await p.evaluate(()=>{window.__PRAGMA_STAGE.speed=2});
await p.waitForFunction(()=>window.__PRAGMA.get().ending,{timeout:90000}); await p.waitForTimeout(3500); await p.screenshot({path:out+'e-pc.png'});
ph = await page({...devices['iPhone 14'], deviceScaleFactor: 1});
await ph.click('.opening-start'); await prep(ph,1); await ph.waitForFunction(()=>window.__PRAGMA.get().lidAligned,{timeout:60000}); await go(ph,1.65);
await ph.waitForFunction(()=>window.__PRAGMA.get().ending,{timeout:120000}); await ph.evaluate(()=>{window.__PRAGMA_STAGE.speed=1}); await ph.waitForTimeout(6000); await ph.screenshot({path:out+'e-ph.png'});
await b.close();
