import { createRequire } from 'module';
const require = createRequire(import.meta.url); const { chromium, devices } = require('playwright');
const url=process.argv[2]||'http://localhost:4176/';
const b = await chromium.launch({ args: ['--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const c = await b.newContext({viewport:{width:900,height:640}}); const p = await c.newPage();
p.on('pageerror',e=>console.log('E',e.message)); p.on('console',m=>m.type()==='error'&&console.log('C',m.text().slice(0,400)));
await p.goto(url); await p.waitForFunction(()=>window.__PRAGMA?.get().ready,{timeout:60000});
const setup=(mm)=>p.evaluate((mm)=>{const s=window.__PRAGMA_STAGE,g=window.__PRAGMA;s.speed=4;s.volume=s.cavity.volume(mm/1000,1,0);s.applyLevel();g.set({hasPoured:true,step:2,lidMode:'seating'});},mm);
const tilt=(x,y)=>p.evaluate(([x,y])=>{const s=window.__PRAGMA_STAGE;s.tiltTarget.set(x,y);},[x,y]);
await setup(95); await p.waitForFunction(()=>window.__PRAGMA.get().lidAligned,{timeout:60000});
await p.evaluate(()=>{const s=window.__PRAGMA_STAGE;s.turns=s.turnsTarget=0;s.speed=1;}); await p.waitForTimeout(800);
await p.screenshot({path:'tests/shots/t-0.png'});
const hold=(a)=>p.evaluate((a)=>{const s=window.__PRAGMA_STAGE;s.pointer.intent='tilt';s.tiltTarget.set(a,0);s.wetTime=0;s.speed=4;},a);
for (const [i,a] of [[1,.6],[2,1.2],[3,1.75]]) { await hold(a); await p.waitForTimeout(5000); await p.evaluate(()=>{window.__PRAGMA_STAGE.speed=.01});await p.waitForTimeout(600); await p.screenshot({path:`tests/shots/t-${i}.png`}); console.log(await p.evaluate(()=>{const s=window.__PRAGMA_STAGE;return [s.tilt.x,s.plane.d,s.levelY]})); }
await b.close();
