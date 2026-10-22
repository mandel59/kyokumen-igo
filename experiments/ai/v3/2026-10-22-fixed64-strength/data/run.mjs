// Run from the repository root. This study is deliberately immutable once started.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync,copyFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {runStudyCommand} from '../../../../../tools/ai-gnn/study-commands.mjs';
import {Game,createTopology} from '../../../../../dist/engine.js';
const directory='experiments/ai/v3/2026-10-22-fixed64-strength',data=directory+'/data';
const plan=JSON.parse(readFileSync(directory+'/plan.json'));
if(existsSync(data+'/execution.json'))throw new Error('This study already has an execution record');
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const sources=['dist/engine.js','dist/board-analysis.js','dist/ai-position.js','dist/ai-wasm.js','dist/ai-engine.wasm',
 'dist/ai-v3.js','dist/ai-v3-search.js','dist/ai-v3-inference.js','dist/ai-v3-webgpu.js','dist/ai-v3.wasm',
 'dist/models/v3/manifest.json','dist/models/v3/model.onnx','dist/models/v3/weights.f32',
 'tools/ai-gnn/browser-match.mjs','tools/ai-gnn/match-statistics.mjs','tools/ai-gnn/study-commands.mjs',data+'/run.mjs'];
const hashes=Object.fromEntries(sources.map(p=>[p,hash(p)]));
assert.equal(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),plan.sourceBaseCommit);
assert.equal(hashes['dist/models/v3/model.onnx'],plan.modelSha256);
assert.equal(hashes['dist/ai-v3.wasm'],plan.wasmSha256.v3);assert.equal(hashes['dist/ai-engine.wasm'],plan.wasmSha256.v2);
const state={schemaVersion:1,started:new Date().toISOString(),status:'preflight',baseCommit:plan.sourceBaseCommit,planSha256:hash(directory+'/plan.json'),hashes};
const save=()=>writeFileSync(data+'/execution.json',JSON.stringify(state,null,2)+'\n');
const unchanged=()=>{for(const[p,h]of Object.entries(hashes))assert.equal(hash(p),h,'Inputs changed: '+p);assert.equal(hash(directory+'/plan.json'),state.planSha256);};
for(const p of sources.filter(p=>!p.startsWith(data+'/'))){const dest=data+'/source/'+p;mkdirSync(dirname(dest),{recursive:true});copyFileSync(p,dest);}
writeFileSync(data+'/source.patch',execFileSync('git',['diff','--binary',plan.sourceBaseCommit,'--',...sources.filter(p=>!p.startsWith(data+'/'))],{maxBuffer:8e6}));
save();
const args=['tools/ai-gnn/browser-match.mjs','--a',plan.players.v3.model,'--b','v2','--simulations','64','--a-fpu','1'];
try{
 await runStudyCommand(data,'preflight',process.execPath,[...args,'--board',plan.evaluation.preflightBoard,'--pairs','1','--seed',String(plan.evaluation.preflightSeed),'--output',data+'/preflight.json']);
 const preflight=JSON.parse(readFileSync(data+'/preflight.json'));assert.equal(preflight.summary.games,2);
 assert.equal(preflight.budgetMsPerMove,null);assert.equal(preflight.configurations.a.maxSimulations,64);
 for(const b of preflight.boards)for(const record of b.games){
  const game=new Game(createTopology(b.kind,b.size),preflight.komi);
  for(const move of record.moves)assert.ok((move===-1?game.pass():game.play(move)).ok);
  for(const t of record.turnMetrics.filter(t=>t.side==='a'))assert.ok(t.provenLoss||t.simulations===64);
 }
 unchanged();state.status='evaluation';save();
 await runStudyCommand(data,'primary-browser',process.execPath,[...args,'--pairs',String(plan.evaluation.pairsPerBoard),'--seed',String(plan.evaluation.seed),'--bootstrap-seed',String(plan.evaluation.bootstrapSeed),'--output',data+'/primary-browser.json']);
 unchanged();state.status='ready-for-summary';state.finished=new Date().toISOString();save();
 console.log('Completed the predeclared 64-visit evaluation.');
}catch(error){state.status='error';state.error=error.stack;save();throw error;}
