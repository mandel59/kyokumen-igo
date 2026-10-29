// Single registered timing round after independent strength; no simultaneous matches/training.
import assert from 'node:assert/strict';
import{readFileSync,writeFileSync,copyFileSync,existsSync}from'node:fs';
import{createHash}from'node:crypto';
import{runStudyCommand}from'./study-commands.mjs';
const d='tools/ai-gnn/target/topology-routing-study-20261029';
const read=p=>JSON.parse(readFileSync(d+'/'+p)),hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
assert.ok(read('results/independent-decision.json').passesStrength);
assert.ok(read('results/independent-replay-audit.json').passed);
assert.ok(!existsSync(d+'/results/latency-registration.json'));
const sources=['topology-routing-timing-prepare.mjs','topology-routing-latency.mjs','topology-routing-cold-bench.mjs','topology-routing-equal-time.mjs','search-campaign-bench.mjs'];
for(const f of sources)copyFileSync('tools/ai-gnn/'+f,d+'/sources/'+f);
writeFileSync(d+'/results/latency-registration.json',JSON.stringify({started:new Date().toISOString(),sources:Object.fromEntries(sources.map(f=>[f,hash('tools/ai-gnn/'+f)])),rules:read('plan.json').latency},null,2)+'\n');
await runStudyCommand(d,'timing-fixture-preparation','node',['tools/ai-gnn/topology-routing-timing-prepare.mjs']);
const common=['--a-wasm',d+'/search.wasm','--b-wasm',d+'/search.wasm','--positions',d+'/results/timing-positions.json'];
await runStudyCommand(d,'baseline-only-calibration','node',['tools/ai-gnn/search-campaign-bench.mjs',...common,'--a-model',d+'/baseline','--b-model',d+'/baseline','--output',d+'/results/baseline-only-calibration.json']);
const calibration=read('results/baseline-only-calibration.json'),budgets={};
for(const run of calibration.runs){
 budgets[run.backend]={};
 for(const board of new Set(run.results.filter(r=>!r.phase.startsWith('stress')).map(r=>r.board))){
  const samples=run.results.filter(r=>r.board===board&&!r.phase.startsWith('stress')).flatMap(r=>r.b.map(s=>s.ms)).sort((a,b)=>a-b);
  budgets[run.backend][board]=Math.max(10,samples[Math.floor(samples.length/2)]);
 }
}
writeFileSync(d+'/results/equal-time-budgets.json',JSON.stringify({frozen:new Date().toISOString(),method:'Median B baseline-only fixed64 wall duration per backend and board, floor10ms; before any candidate timing',calibrationSha256:hash(d+'/results/baseline-only-calibration.json'),fixturesSha256:hash(d+'/results/timing-positions.json'),budgets},null,2)+'\n');
const models=['--a-model',d+'/Routed-r0-model','--b-model',d+'/baseline'];
await runStudyCommand(d,'fixed64-latency','node',['tools/ai-gnn/search-campaign-bench.mjs',...common,...models,'--output',d+'/results/fixed64-latency.json']);
await runStudyCommand(d,'equal-time-root-diagnostic','node',['tools/ai-gnn/topology-routing-equal-time.mjs',...common,...models,'--budgets',d+'/results/equal-time-budgets.json','--output',d+'/results/equal-time.json']);
await runStudyCommand(d,'cold-switch-latency','node',['tools/ai-gnn/topology-routing-cold-bench.mjs',...common,...models,'--output',d+'/results/cold-switch-latency.json']);
const warm=read('results/fixed64-latency.json'),cold=read('results/cold-switch-latency.json');
const result={passed:warm.passes&&cold.passes,warmAndStressPass:warm.passes,coldAndSwitchPass:cold.passes,warmSummary:warm.summary,coldSummary:cold.summary,noConcurrentMatchesOrTraining:true,perMoveParameters:120905,storedModels:2,totalNNBytes:1972042,baselineNNBytes:986021,equalTimeDiagnostic:'results/equal-time.json',mobileMeasured:false};
writeFileSync(d+'/results/latency-decision.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
