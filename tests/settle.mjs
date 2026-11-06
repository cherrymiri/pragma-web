import { createRequire } from 'module';
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const b = await chromium.launch({ args: ['--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader'] });
const p = await (await b.newContext({viewport:{width:800,height:500}})).newPage();
await p.goto(process.argv[2]); await p.waitForFunction(()=>window.__PRAGMA?.get().ready,{timeout:60000});
await p.evaluate(()=>{const s=window.__PRAGMA_STAGE;window.__PRAGMA.set({hasPoured:true,lidMode:'seating'});});
await p.waitForFunction(()=>window.__PRAGMA.get().lidAligned,{timeout:60000});
await p.mouse.move(400,200); for(let i=0;i<4;i++){await p.mouse.wheel(0,100);await p.waitForTimeout(30);}
await p.waitForFunction(()=>{const s=window.__PRAGMA_STAGE;return s.turns===s.turnsTarget&&s.turns<2.25},undefined,{timeout:90000});
const a=await p.evaluate(()=>window.__PRAGMA.get().lidLock); await p.waitForTimeout(2500); const c=await p.evaluate(()=>window.__PRAGMA.get().lidLock);
console.log('lock',a,c,a===c?'PASS stops where left':'FAIL'); await b.close();
