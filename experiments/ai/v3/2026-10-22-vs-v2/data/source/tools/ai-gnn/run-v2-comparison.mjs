// Freeze current application configurations before the declared v2/v3 comparison.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,mkdirSync,copyFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {runStudyCommand} from './study-commands.mjs';
const directory='experiments/ai/v3/2026-10-22-vs-v2',data=directory+'/data';
const plan=JSON.parse(readFileSync(directory+'/plan.json','utf8'));
mkdirSync(data,{recursive:true});
if(existsSync(data+'/execution.json'))throw new Error('Comparison already has an execution record');
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const paths=['dist/engine.js','dist/ai-position.js','dist/ai-engine.wasm','dist/ai-wasm.js','dist/ai-v3.wasm',
 'dist/ai-v3.js','dist/ai-v3-search.js','dist/ai-v3-inference.js','dist/models/v3/manifest.json','dist/models/v3/model.onnx','dist/models/v3/weights.f32',
 'tools/ai-gnn/match.mjs','tools/ai-gnn/browser-match.mjs','tools/ai-gnn/match-statistics.mjs','tools/ai-gnn/run-v2-comparison.mjs'];
const hashes=Object.fromEntries(paths.map(p=>[p,hash(p)]));
assert.equal(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),plan.sourceBaseCommit);
assert.equal(hashes['dist/models/v3/model.onnx'],plan.modelSha256);
assert.equal(hashes['dist/ai-engine.wasm'],plan.wasmSha256.v2);assert.equal(hashes['dist/ai-v3.wasm'],plan.wasmSha256.v3);
const state={schemaVersion:1,started:new Date().toISOString(),status:'primary',baseCommit:plan.sourceBaseCommit,
 planSha256:hash(directory+'/plan.json'),hashes,selectionOrPromotion:false};
const save=()=>writeFileSync(data+'/execution.json',JSON.stringify(state,null,2)+'\n');
const unchanged=()=>{for(const[p,h]of Object.entries(hashes))assert.equal(hash(p),h,'Configuration changed: '+p);};
copyFileSync('tools/ai-gnn/target/v3-vs-v2/preflight.json',data+'/preflight.json');save();
try{
 unchanged();
 await runStudyCommand(data,'primary-browser',process.execPath,['tools/ai-gnn/browser-match.mjs','--a',plan.v3.model,'--b','v2',
  '--pairs',String(plan.primary.pairsPerBoard),'--budget-ms',String(plan.primary.v3BudgetMs),'--seed',String(plan.primary.seed),
  '--bootstrap-seed',String(plan.primary.bootstrapSeed),'--a-fpu',String(plan.v3.fpu),'--output',data+'/primary-browser.json']);
 unchanged();state.status='secondary';save();
 await runStudyCommand(data,'secondary-fixed',process.execPath,['tools/ai-gnn/match.mjs','--a',plan.v3.model,'--b','v2',
  '--a-fpu',String(plan.v3.fpu),'--pairs',String(plan.secondary.pairsPerBoard),'--simulations',String(plan.secondary.v3Visits),
  '--seed',String(plan.secondary.seed),'--output',data+'/secondary-fixed.json']);
 unchanged();state.status='ready-for-summary';state.finished=new Date().toISOString();save();console.log(state.status);
}catch(error){state.status='error';state.error=error.stack;save();throw error;}
