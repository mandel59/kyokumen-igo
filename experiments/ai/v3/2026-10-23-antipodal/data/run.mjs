import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync,execFileSync} from 'node:child_process';
import {runStudyCommand} from '../../../../../tools/ai-gnn/study-commands.mjs';
import {Game,createTopology} from '../../../../../dist/engine.js';
import {antipodalMap,colorAntipodal} from '../../../../../tools/ai-gnn/antipodal.mjs';
const dir='experiments/ai/v3/2026-10-23-antipodal',data=dir+'/data',plan=JSON.parse(readFileSync(dir+'/plan.json'));
if(existsSync(data+'/execution.json'))throw new Error('Study already started');
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const paths=['dist/engine.js','dist/board-analysis.js','dist/ai-position.js','dist/ai-api.js','dist/ai-wasm.js','dist/ai-engine.wasm',
 'dist/ai-v3.js','dist/ai-v3-search.js','dist/ai-v3-inference.js','dist/ai-v3-webgpu.js','dist/ai-v3.wasm',
 'dist/models/v3/manifest.json','dist/models/v3/model.onnx','dist/models/v3/weights.f32',
 'tools/ai-gnn/antipodal.mjs','tools/ai-gnn/mirror-match.mjs','tools/ai-gnn/study-commands.mjs'];
const hashes=Object.fromEntries([...paths,data+'/run.mjs'].map(p=>[p,hash(p)]));
const base=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();assert.equal(base,plan.sourceBaseCommit);
for(const p of paths){const dest=data+'/source/'+p;mkdirSync(dirname(dest),{recursive:true});copyFileSync(p,dest);}
let patch=execFileSync('git',['diff','--binary',base,'--',...paths],{encoding:'utf8'});
for(const p of ['tools/ai-gnn/antipodal.mjs','tools/ai-gnn/mirror-match.mjs']){
 const r=spawnSync('git',['diff','--no-index','--binary','--','/dev/null',p],{encoding:'utf8'});assert.ok([0,1].includes(r.status));patch+=r.stdout;
}
writeFileSync(data+'/source.patch',patch);
const state={schemaVersion:1,baseCommit:base,planSha256:hash(dir+'/plan.json'),hashes,started:new Date().toISOString(),status:'preflight'};
const save=()=>writeFileSync(data+'/execution.json',JSON.stringify(state,null,2)+'\n');save();
const unchanged=()=>{assert.equal(hash(dir+'/plan.json'),state.planSha256);for(const[p,h]of Object.entries(hashes))assert.equal(hash(p),h,p);};
try{
 const policyChecks=[];
 for(const size of[3,4,5]){
  const t=createTopology('sphere',size),map=antipodalMap(t),half=new Set(t.vertices.flatMap((p,i)=>(p.cx!==0?p.cx>0:p.cy!==0?p.cy>0:p.cz>0)?[i]:[]));
  const eye=[...half].find(p=>t.neighbors[p].every(q=>half.has(q))),order=[t.neighbors[eye][0]],seen=new Set([eye,order[0]]);
  for(let i=0;i<order.length;i++)for(const q of t.neighbors[order[i]])if(half.has(q)&&!seen.has(q)){seen.add(q);order.push(q);}
  assert.equal(order.length,t.vertices.length/2-1);const g=new Game(t,6.5);
  for(const p of order){assert.ok(g.play(p).ok);assert.ok(g.play(map[p]).ok);assert.ok(colorAntipodal(g.board,map));}
  const captured=g.play(map[eye]);assert.ok(captured.ok);assert.equal(captured.captured,order.length);assert.equal(g.analyze(eye).reason,'suicide');
  policyChecks.push({size,points:g.board.length,blackCapture:captured.captured,illegalCopy:'suicide'});
 }
 writeFileSync(data+'/policy-checks.json',JSON.stringify(policyChecks,null,2)+'\n');
 await runStudyCommand(data,'preflight',process.execPath,['tools/ai-gnn/mirror-match.mjs','--games','1','--size','3','--seed',String(plan.evaluation.preflight.seed),'--output',data+'/preflight.json']);
 const probe=JSON.parse(readFileSync(data+'/preflight.json'));assert.equal(probe.games.length,2);
 unchanged();state.status='evaluation';save();
 await runStudyCommand(data,'primary-browser',process.execPath,['tools/ai-gnn/mirror-match.mjs','--games',String(plan.evaluation.gamesPerPlayerAndBoard),'--seed',String(plan.evaluation.seed),'--output',data+'/primary-browser.json']);
 unchanged();state.status='ready-for-summary';state.finished=new Date().toISOString();save();console.log('Ready to replay and summarize.');
}catch(error){state.status='error';state.error=error.stack;save();throw error;}
