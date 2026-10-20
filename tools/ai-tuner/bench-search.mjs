import fs from 'node:fs';
import os from 'node:os';
import {createWasmAI} from '../../dist/ai-wasm.js';
const root=new URL('./',import.meta.url);
const cases=JSON.parse(fs.readFileSync(new URL('parity.json',root),'utf8')).cases;
const ai=await createWasmAI({load:async()=>fs.readFileSync(new URL('../../dist/ai-engine.wasm',root))});
const groups=new Map();
for(const c of cases){
 const key=c.kind+'-'+c.size;
 if(!groups.has(key))groups.set(key,[]);
 groups.get(key).push({kind:c.kind,size:c.size,komi:6.5,moves:Int32Array.from(c.moves)});
}
const rows=[];
for(const [board,positions]of groups){
 for(let warm=0;warm<2;warm++)for(const p of positions)ai.chooseMove(p,{depth:4,seed:42});
 const times=[];let checksum=0;
 for(let round=0;round<5;round++)for(let i=0;i<positions.length;i++){
  const start=performance.now();
  checksum+=ai.chooseMove(positions[i],{depth:4,seed:42+round*positions.length+i})??-1;
  times.push(performance.now()-start);
 }
 const sorted=[...times].sort((a,b)=>a-b);
 const row={board,samples:times.length,medianMs:sorted[sorted.length>>1],
  p95Ms:sorted[Math.floor(sorted.length*.95)],maxMs:sorted.at(-1),checksum,times};
 rows.push(row);console.log(JSON.stringify({...row,times:undefined}));
}
ai.dispose();
const report={date:'2026-10-21',node:process.version,v8:process.versions.v8,cpu:os.cpus()[0].model,
 method:'4-ply WASM; includes input validation/copy and history replay; excludes Worker messaging/rendering; 2 warmup rounds, 5 measured rounds over 50 positions per board',
 wasmBytes:fs.statSync(new URL('../../dist/ai-engine.wasm',root)).size,boards:rows};
fs.writeFileSync(new URL('target/search-study/wasm-performance.json',root),JSON.stringify(report,null,2)+'\n');
