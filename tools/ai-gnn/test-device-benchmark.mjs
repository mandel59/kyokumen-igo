import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {Game,createTopology} from '../../dist/engine.js';
import {recommendVisits} from '../../dist/ai-benchmark.js';
import {createDeviceBenchmarkServer} from './device-benchmark-server.mjs';
assert.equal(recommendVisits([{visits:8,worstBoardP95Ms:80},{visits:16,worstBoardP95Ms:300},{visits:32,worstBoardP95Ms:301}]),16);
assert.equal(recommendVisits([{visits:8,worstBoardP95Ms:301}]),0);
assert.equal(recommendVisits([{visits:32,worstBoardP95Ms:175.8},{visits:64,worstBoardP95Ms:269.8}]),64,'300ms already includes the headroom from 400ms');
assert.equal(recommendVisits([{visits:8,worstBoardP95Ms:90},{visits:16,worstBoardP95Ms:110},{visits:32,worstBoardP95Ms:1000},{visits:64,worstBoardP95Ms:100}]),16,'Do not skip a failed budget');
assert.throws(()=>recommendVisits([{visits:8,worstBoardP95Ms:NaN}]));assert.throws(()=>recommendVisits([],300,0));
for(const file of['chrome-webgpu.json','firefox-wasm.json']){
 const r=JSON.parse(readFileSync('experiments/ai/v3/2026-10-22-pixel8a-visits/data/'+file));
 assert.equal(recommendVisits(r.runs,r.targetMs),64,'Use the 300ms target for the real Pixel 8a measurements');
 assert.equal(recommendVisits(r.runs,r.targetMs,r.margin),r.recommendedVisits,'Preserve the original report when explicitly auditing its superseded margin');
}
const fixture=JSON.parse(readFileSync('dist/ai-benchmark-positions.json','utf8'));
assert.equal(fixture.positions.length,18);
for(const p of fixture.positions){const g=new Game(createTopology(p.kind,p.size),p.komi);for(const move of p.moves)assert.ok((move===-1?g.pass():g.play(move)).ok);assert.equal(g.ended,false);}
const server=createDeviceBenchmarkServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.EDGE_PATH??'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-webgpu','--no-first-run']});
try{
 assert.equal((await fetch(base+'/app.js')).status,404);
 const page=await browser.newPage();await page.goto(base);
 assert.equal(await page.title(),'AIの探索速度を測る');
 await page.evaluate(()=>{document.getElementById('start').click();document.getElementById('stop').click();});
 assert.match(await page.locator('#status').textContent(),/中止/);assert.equal(await page.locator('#start').isEnabled(),true);
 const results=[];
 for(const backend of['wasm','webgpu']){
  const report=await page.evaluate(({base,backend})=>new Promise((resolve,reject)=>{
   const worker=new Worker(base+'/ai-benchmark-worker.js',{type:'module'});
   worker.onmessage=({data})=>{if(data.progress)return;worker.terminate();data.error?reject(new Error(data.error)):resolve(data.result);};
   worker.onerror=e=>{worker.terminate();reject(new Error(e.message));};worker.postMessage({backend,candidates:[8,16],repeats:1});
  }),{base,backend});
  assert.equal(report.backend,'v3-'+backend);assert.equal(report.runs[0].samples.length,18);assert.equal(report.runs[0].perBoard.length,6);
  assert.equal(report.margin,1,'Do not subtract a second timing margin');
  assert.ok(report.runs.every(r=>r.samples.every(s=>s.provenLoss||s.simulations===r.visits)));
  assert.equal(report.recommendedVisits,recommendVisits(report.runs));results.push(report);
 }
 await page.setViewportSize({width:393,height:852});await page.locator('#start').click();
 await page.waitForFunction(()=>!document.getElementById('copy').disabled||document.getElementById('status').textContent.startsWith('測定できませんでした'),{},{timeout:90000});
 assert.equal(await page.locator('#copy').isEnabled(),true,await page.locator('#status').textContent());
 const shared=JSON.parse(await page.locator('#result').inputValue());
 assert.ok(Number.isInteger(shared.recommendedVisits));assert.ok(shared.runs.length>0);assert.match(await page.locator('#recommendation').textContent(),/訪問|目標を超え/);
 assert.ok(shared.runs.every(r=>r.samples===undefined&&r.sampleCount===36));
 writeFileSync('tools/ai-gnn/target/device-benchmark-verification.json',JSON.stringify({fixturePositions:18,referenceDeviceNotMeasured:true,results},null,2)+'\n');
 console.log(JSON.stringify(results.map(r=>({backend:r.backend,recommendedVisits:r.recommendedVisits,runs:r.runs.map(x=>({visits:x.visits,worstBoardP95Ms:x.worstBoardP95Ms}))}))));
console.log('Device benchmark: 300ms reference selection, 18 legal positions, isolated page, cancellation and real CPU/WebGPU Worker measurements passed.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
