import fs from 'node:fs';
import {reportOptions,writeReport} from './experiment-paths.mjs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=new URL('./',import.meta.url);
const {data:dir,output,context}=reportOptions('v2/2026-10-21-tuning');
const read=p=>JSON.parse(fs.readFileSync(new URL(p,dir),'utf8'));
function estimate(values) {
 const value=values.reduce((s,x)=>s+x,0)/values.length;
 const variance=values.reduce((s,x)=>s+(x-value)**2,0)/(values.length-1);
 const se=Math.sqrt(variance/values.length);
 return {value,se,ci95:[Math.max(0,value-1.96*se),Math.min(1,value+1.96*se)]};
}
function summarize(data,file) {
 const boards=data.boards.map(b=>{
  const pairMeans=[];
  for(let i=0;i<b.rawMargins.length;i+=2){
   const score=(j)=>{const k=b.komis?.[j]??data.komi,x=b.rawMargins[j];return x===k?.5:((x>k)===(j%2===0)?1:0);};
   pairMeans.push((score(i)+score(i+1))/2);
  }
  assert.equal(b.games,b.rawMargins.length);
  const scoreA=estimate(pairMeans);
  assert.ok(Math.abs(scoreA.value-(b.winsA+b.draws*.5)/b.games)<1e-12);
  return {kind:b.kind,size:b.size,games:b.games,winsA:b.winsA,draws:b.draws,capped:b.capped,
   scoreA,meanMoves:b.moves/b.games,meanNodes:b.nodes/b.games};
 });
 const value=boards.reduce((s,b)=>s+b.scoreA.value,0)/6;
 const se=Math.sqrt(boards.reduce((s,b)=>s+b.scoreA.se**2,0))/6;
 return {file,seed:data.seed,komi:data.komi,games:boards.reduce((s,b)=>s+b.games,0),
  capped:boards.reduce((s,b)=>s+b.capped,0),elapsedSeconds:data.elapsedSeconds,
  playerA:data.playerA,playerB:data.playerB,
  scoreA:{value,se,ci95:[value-1.96*se,value+1.96*se]},boards};
}
const plan=read('plan.json'),initial=read('tune.json'),robust=read('robust/tune.json');
assert.ok(initial.generations.length>0&&robust.generations.length>0);
const chosenParams=robust.generations.at(-1).champion.values;
function phase(t){
 const generations=t.generations.map(g=>({generation:g.generation,bestTrainingFitness:g.fitness[g.bestIndex],bestIndex:g.bestIndex,promoted:g.promoted,champion:g.champion,elapsedSeconds:g.elapsedSeconds,
 trainingGames:g.training.reduce((s,m)=>s+m.boards.reduce((t,b)=>t+b.games,0),0),trainingCapped:g.training.reduce((s,m)=>s+m.boards.reduce((t,b)=>t+b.capped,0),0),
 validation:g.validation.map((m,i)=>summarize(m,'gen-'+g.generation+'-validation-'+i))}));
 return {seed:t.seed,elapsedSeconds:t.elapsedSeconds,generations,
 games:generations.reduce((s,g)=>s+g.trainingGames+g.validation.reduce((t,v)=>t+v.games,0),0),
 capped:generations.reduce((s,g)=>s+g.trainingCapped+g.validation.reduce((t,v)=>t+v.capped,0),0)};
}
const heldout=plan.heldout.map(spec=>{
 const data=read(spec.file);assert.equal(data.seed,spec.seed);assert.equal(data.komi,spec.komi);assert.equal(data.pairsPerBoard,spec.pairsPerBoard);
 assert.deepEqual(data.playerA.values,spec.control?initial.generations[0].training[0].playerB.values:chosenParams);
 assert.equal(data.depthA,4);assert.equal(data.depthB,spec.opponent==='greedy'?0:4);
 return summarize(data,spec.file);
});
const diagnostics=read('plan-global.json').heldout.map(spec=>{const file=spec.file.replace('heldout-','diagnostic-');return summarize(read(file),file);});
const ablations=fs.readdirSync(new URL('robust/',dir)).filter(p=>/^ablation-.*\.json$/.test(p)).map(p=>summarize(read('robust/'+p),'robust/'+p));
const adoption=read('adoption.json');assert.deepEqual(adoption.params,chosenParams);
const performance={baseline:read('performance-baseline.json'),tuned:read('performance-tuned.json')};
const sha256={};
for(const p of ['src/search.rs','src/endgame.rs','src/board.rs','src/rng.rs','src/ai.rs','src/wasm.rs','experiment-paths.mjs','search-tune.rs','search-study.rs','apply-search-tuning.mjs','search-tuning-summary.mjs','bench-search.mjs','build-wasm.mjs','../../search-tests.mjs','../../dist/ai-engine.wasm','../../dist/ai-worker.js','../../dist/ai-wasm.js'])sha256[p]=createHash('sha256').update(fs.readFileSync(new URL(p,root))).digest('hex');
const report={analysisContext:context,date:'2026-10-21',baseCommit:plan.baseCommit,rustc:execFileSync('rustc',['--version'],{encoding:'utf8'}).trim(),node:process.version,
 methodology:{optimizer:'Initial 13-weight CEM (8x12) then static-evaluation-only CEM (6x8) with greedy opponent and control',
 robust:'5 static weights; ordering fixed to original; original4/incumbent4/greedy opponents, 36 training games each per candidate. Validation 120 games each vs 3 opponents plus original-vs-greedy control. Promotion >53% vs incumbent, >52% vs original, greedy >= control-1pp, no capped games.',
 confidence:'normal approximation of independent colour-swapped pair means, stratified by board; draws count half',depth:4,rootWidth:12,childWidth:6,
 heldoutUse:'Coefficients frozen before final seeds. Board adoption follows the predeclared Bonferroni primary tests and matched-greedy guard; aggregate candidate rates describe the global candidate, not the routed deployed policy.'},
 parameterNames:robust.parameters,chosenParams,initialTuning:phase(initial),robustTuning:phase(robust),diagnostics,ablations,heldout,adoption,performance,sha256};
writeReport(output,report);
console.log(JSON.stringify({initial:report.initialTuning.games,robust:report.robustTuning.games,
 heldout:heldout.map(h=>({file:h.file,games:h.games,capped:h.capped,scoreA:h.scoreA})),tunedPoints:adoption.tunedPoints},null,2));
