import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
const files=process.argv.slice(2),out=files.pop();
const percentile=(a,p)=>a.length?a.slice().sort((x,y)=>x-y)[Math.ceil(a.length*p)-1]:null;
const results=files.map(file=>{
 const report=JSON.parse(file.endsWith('.gz')?gunzipSync(readFileSync(file)):readFileSync(file,'utf8'));
 if(!report.summary)throw Error('Incomplete report '+file);
 const timing={};
 for(const side of ['a','b']){
  const turns=report.boards.flatMap(b=>b.games.flatMap(g=>g.turnMetrics.filter(t=>t.side===side)));
  timing[side]={turns:turns.length,meanMs:turns.reduce((s,t)=>s+t.elapsedMs,0)/turns.length,p95Ms:percentile(turns.map(t=>t.elapsedMs),.95),byBoard:report.boards.map(b=>{
   const times=b.games.flatMap(g=>g.turnMetrics.filter(t=>t.side===side).map(t=>t.elapsedMs));
   return {board:b.kind+b.size,p95Ms:percentile(times,.95),meanMs:times.reduce((s,t)=>s+t,0)/times.length};
  })};
 }
 return {file,seed:report.seed,configuration:report.configurations,provenance:report.provenance,summary:report.summary,timing,warmInference:report.warmInference};
});
writeFileSync(out,JSON.stringify({schemaVersion:1,results},null,2)+'\n');
console.log(JSON.stringify(results.map(r=>({file:r.file,wins:r.summary.wins,losses:r.summary.losses,interval:r.summary.pairedBootstrap?.interval95,timing:r.timing}))));
