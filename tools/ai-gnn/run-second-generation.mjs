import {readFileSync,writeFileSync,createReadStream,createWriteStream,existsSync} from 'node:fs';
import {createGzip} from 'node:zlib';
import {pipeline} from 'node:stream/promises';
import {runStudyCommand} from './study-commands.mjs';
const directory='experiments/ai/v3/2026-10-22-learning-revision',data=directory+'/data',target='tools/ai-gnn/target/learning-revision';
const plan=JSON.parse(readFileSync(directory+'/plan.json','utf8')),first=JSON.parse(readFileSync(data+'/execution.json','utf8'));
if(first.status!=='ready-for-second-generation'||!first.selected?.eligible)throw new Error('First generation did not pass');
if(existsSync(data+'/second-generation.json')||existsSync(data+'/final-candidate.json'))throw new Error('Second generation already has a record');
const stage=plan.stages.find(s=>s.id==='second_generation'),{recipe,model}=first.selected,fpu=first.search.selectedFpu;
const run=(name,command,args)=>runStudyCommand(data,name,command,args);
const state={schemaVersion:1,started:new Date().toISOString(),status:'selfplay',recipe,fpu,previous:first.selected};
const save=()=>writeFileSync(data+'/second-generation.json',JSON.stringify(state,null,2)+'\n');save();
try{
 const raw=target+'/round2-selfplay.jsonl',packed=data+'/round2-selfplay.jsonl.gz';
 await run('round2-selfplay',process.execPath,['tools/ai-gnn/selfplay.mjs','--model',model,'--games','32','--simulations','128',
  '--seed',String(stage.selfplay.seed),'--fpu',String(fpu),'--require-complete','--report',data+'/round2-selfplay-report.json','--output',raw]);
 const generated=JSON.parse(readFileSync(data+'/round2-selfplay-report.json','utf8'));
 if(generated.completedGames!==192||generated.capped)throw new Error('Incomplete second-generation selfplay');
 state.selfplay=generated;save();await pipeline(createReadStream(raw),createGzip(),createWriteStream(packed));
 const previous=data+'/round2-previous.jsonl.gz';
 await run('round2-tag-previous',process.execPath,['tools/ai-gnn/tag-generation.mjs','--input',data+'/round1-t'+recipe+'.jsonl.gz','--output',previous,'--generation','1']);
 const split=data+'/round2-split.json';
 await run('round2-split','uv',['run','--project','tools/ai-gnn','--extra','cuda','python','tools/ai-gnn/prepare-split.py',
  '--data',data+'/teacher-annotated.jsonl.gz',previous,packed,'--pinned',model+'/manifest.json','--seed',String(stage.training.seed),'--output',split]);
 state.status='reanalysis';save();
 await run('round2-reanalysis',process.execPath,['tools/ai-gnn/reanalyze.mjs','--input',packed,'--model',model,'--fpu',String(fpu),
  '--recipe',String(recipe),'--validation-manifest',split,'--seed',String(stage.policyReanalysis.selectionSeed),'--output-prefix',data+'/round2']);
 const latest=data+'/round2-latest.jsonl.gz';
 await run('round2-tag-latest',process.execPath,['tools/ai-gnn/tag-generation.mjs','--input',data+'/round2-t'+recipe+'.jsonl.gz','--output',latest,'--generation','2']);
 const next=data+'/round2-model';state.status='training';save();
 await run('round2-training','uv',['run','--project','tools/ai-gnn','--extra','cuda','python','tools/ai-gnn/train.py',
  '--data',data+'/teacher-annotated.jsonl.gz',previous,latest,'--resume',model+'/weights.pt','--split-manifest',split,
  '--device','cuda','--epochs','12','--batch-size','128','--seed',String(stage.training.seed),'--learning-rate','0.0001',
  '--minimum-learning-rate','0.00001','--cosine','--ema-decay','0.99','--balanced','--balance-generations','--selfplay-mass','0.5',
  '--policy-temperature','1','--minimum-policy-confidence','0','--policy-anchor',plan.baseline.checkpoint,'--policy-anchor-weight','0.5',
  '--best-validation','--normal-training','--normal-selection','--normalize-policy','--require-validation-policy','--checkpoint-every','4','--output',next]);
 const manifest=JSON.parse(readFileSync(next+'/manifest.json','utf8'));manifest.search={fpu};writeFileSync(next+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');
 state.candidate={model:next,sha256:manifest.sha256,selectedEpoch:manifest.selectedEpoch,selection:manifest.selectionMetrics,eligible:false};save();
 await run('round2-onnx',process.execPath,['tools/ai-gnn/test-onnx.mjs',next]);
 await run('round2-endgame',process.execPath,['tools/ai-gnn/replay-endgame.mjs','--model',next,'--output',data+'/round2-endgame.json']);
 if(manifest.selectedEpoch!==0){
  state.status='development';save();
  await run('round2-development',process.execPath,['tools/ai-gnn/match.mjs','--a',next,'--b',model,'--a-fpu',String(fpu),
   '--b-fpu',String(fpu),'--pairs','8','--simulations','128','--seed',String(stage.development.seed),'--output',data+'/round2-development.json']);
  const match=JSON.parse(readFileSync(data+'/round2-development.json','utf8'));
  state.candidate.score=match.summary.score;
  state.candidate.boards=match.boards.map(b=>({board:b.kind+b.size,score:b.games.reduce((s,g)=>s+(g.aScore??0),0)}));
  state.candidate.eligible=match.summary.completed===96&&match.summary.capped===0&&match.summary.score>=54&&state.candidate.boards.every(b=>b.score>=6);
 }else state.candidate.noMatchReason='Epoch zero: unchanged first-generation checkpoint';
 state.selected=state.candidate.eligible?state.candidate:first.selected;state.generation=state.candidate.eligible?2:1;
 const final={schemaVersion:1,selectedAt:new Date().toISOString(),model:state.selected.model,sha256:state.selected.sha256,
  fpu,generation:state.generation,recipe,developmentEligible:true,source:'second-generation.json'};
 writeFileSync(data+'/final-candidate.json',JSON.stringify(final,null,2)+'\n');
 state.status='ready-for-final-evaluation';state.finished=new Date().toISOString();save();console.log(JSON.stringify(final));
}catch(error){state.status='error';state.error=error.stack;save();throw error;}
