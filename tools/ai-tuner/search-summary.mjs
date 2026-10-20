import fs from 'node:fs';
import {experimentDir,reportOptions,writeReport} from './experiment-paths.mjs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=new URL('./',import.meta.url);
const {data:folder,output,context}=reportOptions('v2/2026-10-21-initial');
function estimate(values) {
 const value=values.reduce((s,x)=>s+x,0)/values.length;
 const variance=values.reduce((s,x)=>s+(x-value)**2,0)/(values.length-1);
 const se=Math.sqrt(variance/values.length);
 return {value,se,ci95:[value-1.96*se,value+1.96*se]};
}
function paired(margins,fn) {
 const values=[];
 for(let i=0;i<margins.length;i+=2)values.push((fn(margins[i],i)+fn(margins[i+1],i+1))/2);
 return estimate(values);
}
function summarize(data,file){
 const rows=data.boards.map(b=>{
  assert.equal(b.capped,0,file+' capped games');
  const a=[...b.rawMargins].sort((a,b)=>a-b);
  const n=a.length,komi=data.komi;
  const scoreA=(x,i)=>x===komi?.5:(x>komi)===(i%2===0)?1:0;
  const row={kind:b.kind,size:b.size,games:n,capped:b.capped,meanMoves:b.moves/n,
   scoreA:paired(b.rawMargins,scoreA),blackWin:paired(b.rawMargins,x=>Number(x>komi)),
   blackScore:paired(b.rawMargins,x=>x>komi?1:x===komi?.5:0),
   drawRate:a.filter(x=>x===komi).length/n,
   meanRawMargin:paired(b.rawMargins,x=>x),medianRawMargin:(a[n/2-1]+a[n/2])/2,
   massAt0or1:a.filter(x=>x===0||x===1).length/n};
  return row;
 });
 const value=rows.reduce((s,b)=>s+b.scoreA.value,0)/rows.length;
 const se=Math.sqrt(rows.reduce((s,b)=>s+b.scoreA.se**2,0))/rows.length;
 return {file,depthA:data.depthA,depthB:data.depthB,komi:data.komi,seed:data.seed,
   games:rows.reduce((s,b)=>s+b.games,0),elapsedSeconds:data.elapsedSeconds,
   scoreA:{value,se,ci95:[value-1.96*se,value+1.96*se]},boards:rows};
}
const studies=fs.readdirSync(folder).filter(n=>/^(pilot-|heldout-|self-).*\.json$/.test(n))
 .map(name=>summarize(JSON.parse(fs.readFileSync(new URL(name,folder),'utf8')),name));
const old=JSON.parse(fs.readFileSync(new URL('data/komi-summary.json',experimentDir('v1/2026-10-21-komi')),'utf8'));
const oldRows=old.boards.map(b=>({kind:b.kind,size:b.size,games:b.games,
 blackWin6_5:b.komiRates.find(k=>k.komi===6.5).blackWin,medianRawMargin:b.medianMargin,
 fullAreaRate:b.histogram.filter(([x])=>Math.abs(x)===b.points).reduce((s,[,n])=>s+n,0)/b.games,
 massAt0or1:b.histogram.filter(([x])=>x===0||x===1).reduce((s,[,n])=>s+n,0)/b.games}));
const performance=JSON.parse(fs.readFileSync(new URL('wasm-performance.json',folder),'utf8'));
const sha256={};
for(const p of ['src/search.rs','src/wasm.rs','src/ai.rs','src/board.rs','src/rng.rs',
 'experiment-paths.mjs','search-study.rs','search-summary.mjs','bench-search.mjs','../../dist/ai-engine.wasm',
 '../../dist/ai-wasm.js','../../dist/ai-worker.js','../../search-tests.mjs'])
 sha256[p]=createHash('sha256').update(fs.readFileSync(new URL(p,root))).digest('hex');
const report={analysisContext:context,date:'2026-10-21',baseCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
 rustc:execFileSync('rustc',['--version'],{encoding:'utf8'}).trim(),node:process.version,
 methodology:{pairing:'colours and player noise streams swapped within pairs',
 confidence:'normal approximation of independent pair means; combined match CI stratified by board',
 draw:'half a win',komi:'self-play actually rerun at each komi, because search uses komi',
 selectionSeed:20261022,heldoutSeeds:[20261023,20261024],humanStrength:'not measured'},
 sha256,oldOnePly:oldRows,studies,performance};
writeReport(output,report);
const match=studies.find(s=>s.file==='heldout-d4-greedy.json');
const depthControl=studies.find(s=>s.file==='heldout-d4-d2.json');
const six=studies.find(s=>s.file==='self-d4-komi-6.5.json');
console.log(JSON.stringify({heldout:match.scoreA,depthControl:depthControl.scoreA,
 oldAndNew:six.boards.map((b,i)=>({kind:b.kind,size:b.size,old:oldRows[i].blackWin6_5.value,
 new:b.blackWin.value,newCI:b.blackWin.ci95})),
 performance:performance.boards.map(({board,medianMs,p95Ms,maxMs})=>({board,medianMs,p95Ms,maxMs}))},null,2));
