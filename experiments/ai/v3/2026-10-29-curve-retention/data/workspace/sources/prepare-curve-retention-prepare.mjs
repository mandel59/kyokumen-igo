// Freeze a new round and derive completed-Q training targets from immutable cached traces.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,copyFileSync,mkdirSync,existsSync,createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {createGunzip,gunzipSync} from 'node:zlib';
import {createInterface} from 'node:readline';
import {rowWriter} from './browser-data-host.mjs';
import {completedQPolicy,wdlValue} from './completed-q-target.mjs';
const planPath='experiments/ai/plans/v3-curve-retention/plan.json',plan=JSON.parse(readFileSync(planPath)),dir=plan.workspace;
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
if(existsSync(dir))throw Error('Fresh workspace required');
for(const [p,h]of [[plan.baseline.model,plan.baseline.modelSha256],[plan.baseline.weights,plan.baseline.weightsSha256],[plan.baseline.wasm,plan.baseline.wasmSha256],[plan.data.legacy,plan.data.legacySha256],[plan.data.fresh,plan.data.freshSha256]])assert.equal(hash(p),h,p);
assert.equal(hash(plan.data.split),plan.data.splitStoredSha256);
const splitBytes=gunzipSync(readFileSync(plan.data.split));assert.equal(createHash('sha256').update(splitBytes).digest('hex'),plan.data.splitSha256);
mkdirSync(dir+'/results',{recursive:true});mkdirSync(dir+'/sources');mkdirSync(dir+'/baseline');
copyFileSync(planPath,dir+'/plan.json');copyFileSync('experiments/ai/plans/v3-curve-retention/README.md',dir+'/registered-plan.md');
for(const name of ['model.onnx','weights.f32','manifest.json','KataGo-NN-LICENSE.txt'])copyFileSync('dist/models/v3/'+name,dir+'/baseline/'+name);
copyFileSync(plan.data.checkpoint,dir+'/baseline/weights.pt');writeFileSync(dir+'/split.json',splitBytes);copyFileSync(plan.baseline.wasm,dir+'/search.wasm');
copyFileSync('experiments/ai/v3/2026-10-28-fresh-data-study/data/workspace/topologies.json',dir+'/topologies.json');
copyFileSync('experiments/ai/v3/2026-10-28-research-informed-study/data/workspace/reported-game.json',dir+'/reported-game.json');
const source=['curve-retention-prepare.mjs','completed-q-target.mjs','train.py','model.py','test_curve_retention.py','test-completed-q-target.mjs'];
for(const f of source)copyFileSync('tools/ai-gnn/'+f,dir+'/sources/prepare-'+f);
const save=(name,v)=>writeFileSync(dir+'/'+name,JSON.stringify(v,null,2)+'\n');
save('registration.json',{started:new Date().toISOString(),clientDate:plan.date,planSha256:hash(planPath),baselineCheckpointSha256:hash(plan.data.checkpoint),sourceHashes:Object.fromEntries(source.map(f=>[f,hash('tools/ai-gnn/'+f)])),inputs:plan.data});
const pin=JSON.parse(readFileSync(dir+'/split.json')),train=new Set(pin.trainGames),val=new Set(pin.validationGames);
assert.ok(![...train].some(id=>val.has(id)));
const writer=rowWriter(dir+'/completed-q-legacy.jsonl.gz'),before=createHash('sha256'),after=createHash('sha256');
let positions=0,changed=0;const counts={},teachers={},stats=[];
const invariantFields=['schemaVersion','gameId','originGameId','positionId','kind','size','toPlay','ply','x','global','legal','validationPolicy','policyEligible','decisionReason','wdl','score','ownership','action','playedAction','source'];
try{
 for await(const line of createInterface({input:createReadStream(plan.data.legacy).pipe(createGunzip()),crlfDelay:Infinity})){
  if(!line)continue;const r=JSON.parse(line);positions++;assert.ok(train.has(r.gameId)||val.has(r.gameId));
  const fingerprint=JSON.stringify(invariantFields.map(k=>r[k]));before.update(fingerprint);
  if(r.kind!=='plane'&&train.has(r.gameId)&&r.policyEligible&&r.decisionReason!=='certified-loss'){
   const t=r.targetSearch;assert.ok(t&&!t.noise&&t.requestedVisits===4096);assert.ok(t.diagnostics);
   const prior=t.prior,q=t.diagnostics.rootQ,visits=t.diagnostics.rawVisits;
   assert.equal(visits.length,161);assert.ok(visits.reduce((a,b)=>a+b,0)<=t.completedVisits-1);
   const result=completedQPolicy({prior,q,visits,legal:r.legal,rawValue:wdlValue(t.rootWdlLogits),valueScale:.1,maxvisitInit:50});
   const old=r.policy,entropy=p=>-p.reduce((s,v)=>s+(v>0?v*Math.log(v):0),0);
   assert.ok(result.policy.every((p,i)=>Number.isFinite(p)&&p>=0&&(r.legal[i]||p===0)));
   stats.push({board:r.kind+r.size,entropyBefore:entropy(old),entropyAfter:entropy(result.policy),changedL1:old.reduce((s,p,i)=>s+Math.abs(p-result.policy[i]),0),scale:result.scale,unvisitedMass:result.policy.reduce((s,p,i)=>s+(!visits[i]?p:0),0),float32Support:result.policy.filter(p=>Math.fround(p)>0).length});
   counts[r.kind+r.size]=(counts[r.kind+r.size]??0)+1;teachers[t.model+'|'+t.wasm]=(teachers[t.model+'|'+t.wasm]??0)+1;
   r.policy=result.policy;r.policyOrigin='completed-q-cached4096';r.priorMix=0;
   r.completedQTarget={mixedValue:result.mixedValue,scale:result.scale,valueScale:.1,maxvisitInit:50,rescale:false,unvisitedLegal:result.unvisitedLegal,sourceModel:t.model,sourceWasm:t.wasm};
   changed++;
  }
  after.update(JSON.stringify(invariantFields.map(k=>r[k])));await writer.write([r]);
 }
}finally{await writer.close();}
assert.equal(before.digest('hex'),after.digest('hex'));assert.equal(positions,12453);assert.equal(changed,3534);
const summary={};
for(const key of ['all',...Object.keys(counts)]){const group=key==='all'?stats:stats.filter(r=>r.board===key);summary[key]=Object.fromEntries(['entropyBefore','entropyAfter','changedL1','scale','unvisitedMass','float32Support'].map(k=>[k,group.reduce((s,r)=>s+r[k],0)/group.length]));}
const audit={passed:true,positions,changedTrainingCurvePolicies:changed,perBoard:counts,sourceTeachers:teachers,commonValidationAndAllNonPolicyFieldsIdentical:true,originalValidationUntouched:true,extraTeacherQueries:0,derivedSha256:hash(dir+'/completed-q-legacy.jsonl.gz'),summary};
save('results/target-audit.json',audit);console.log(JSON.stringify(audit));
