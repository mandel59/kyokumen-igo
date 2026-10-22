// First generation of the predeclared revision study. Gates stop expensive downstream work.
import {spawn} from 'node:child_process';
import {createReadStream,createWriteStream,readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createGunzip,createGzip} from 'node:zlib';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {pipeline} from 'node:stream/promises';
const directory='experiments/ai/v3/2026-10-22-learning-revision',data=directory+'/data',target='tools/ai-gnn/target/learning-revision';
mkdirSync(data,{recursive:true});mkdirSync(target,{recursive:true});
const plan=JSON.parse(readFileSync(directory+'/plan.json','utf8')),stage=plan.stages.find(s=>s.id==='teacher_and_first_training');
const baseline=data+'/baseline-model';
if(existsSync(data+'/execution.json'))throw new Error('Execution record already exists; preserve it before starting a separate run');
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const tools=['tools/ai-gnn/train.py','tools/ai-gnn/model.py','tools/ai-gnn/selfplay.mjs','tools/ai-gnn/reanalyze.mjs','tools/ai-gnn/match.mjs','dist/ai-v3-search.js','dist/ai-v3.wasm'];
const state={schemaVersion:1,started:new Date().toISOString(),planSha256:sha(directory+'/plan.json'),toolHashes:Object.fromEntries(tools.map(p=>[p,sha(p)])),stages:{measurement:'passed',search:'running'},promoted:false};
function save(){writeFileSync(data+'/execution.json',JSON.stringify(state,null,2)+'\n');}
async function run(name,command,args){
 const log=createWriteStream(data+'/'+name+'-log.txt'),start=new Date();
 const record={command,args,started:start.toISOString(),toolHashes:Object.fromEntries(tools.map(p=>[p,sha(p)]))};
 writeFileSync(data+'/'+name+'-command.json',JSON.stringify(record,null,2)+'\n');
 console.log('Starting',name,start.toISOString());
 const child=spawn(command,args,{stdio:['ignore','pipe','pipe']});child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
 await new Promise(resolve=>log.end(resolve));
 record.finished=new Date().toISOString();record.elapsedSeconds=(Date.now()-start.getTime())/1000;record.exitCode=code;
 writeFileSync(data+'/'+name+'-command.json',JSON.stringify(record,null,2)+'\n');
 if(code!==0)throw new Error(name+' exited '+code+'; inspect '+data+'/'+name+'-log.txt');
 console.log('Completed',name,record.elapsedSeconds,'seconds');
}
save();
try{
 let search;
 for(;;){
  if(existsSync(data+'/search-selection.json')){
   search=JSON.parse(readFileSync(data+'/search-selection.json','utf8'));
   if(['ready-for-selfplay','stopped-at-teacher-budget-gate'].includes(search.status))break;
  }
  await new Promise(resolve=>setTimeout(resolve,10000));
 }
 state.search=search;state.stages.search='completed';
 if(!search.teacherBudget.passed){state.status='stopped-at-teacher-budget-gate';state.finished=new Date().toISOString();save();process.exitCode=0;}
 else{
  if(JSON.parse(readFileSync(baseline+'/manifest.json','utf8')).sha256!==plan.baseline.modelSha256)throw new Error('Baseline model changed');
  if(!existsSync(data+'/measurement.json')||!existsSync(data+'/search-verification.json'))throw new Error('Measurement and search verification must pass first');
  // Keep the old teacher; the previous experiment's selfplay is not silently mixed into this trial.
  const teacher=data+'/teacher-annotated.jsonl.gz',file=createWriteStream(teacher),gzip=createGzip();gzip.pipe(file);
  for await(const line of createInterface({input:createReadStream('tools/ai-gnn/target/revision-annotated.jsonl.gz').pipe(createGunzip()),crlfDelay:Infinity})){
   const r=JSON.parse(line);if(r.source!=='selfplay'&&!gzip.write(line+'\n'))await once(gzip,'drain');
  }
  gzip.end();await once(file,'finish');
  const raw=target+'/round1-selfplay.jsonl',packed=data+'/round1-selfplay.jsonl.gz';
  state.status='first-generation-selfplay';save();
  await run('teacher-target-audit',process.execPath,['tools/ai-gnn/audit-teacher-targets.mjs']);
  await run('teacher-policy-filter',process.execPath,['tools/ai-gnn/filter-teacher-policy.mjs']);
  await run('round1-selfplay',process.execPath,['tools/ai-gnn/selfplay.mjs','--model',baseline,'--games','16','--simulations','128','--seed',String(stage.selfplay.seed),'--fpu',String(search.selectedFpu),'--require-complete','--report',data+'/round1-selfplay-report.json','--output',raw]);
  const generated=JSON.parse(readFileSync(data+'/round1-selfplay-report.json','utf8'));
  if(generated.completedGames!==96||generated.capped!==0)throw new Error('Incomplete selfplay corpus');
  state.selfplay=generated;save();
  await pipeline(createReadStream(raw),createGzip(),createWriteStream(packed));
  state.status='first-generation-reanalysis';save();
  await run('round1-reanalysis',process.execPath,['tools/ai-gnn/reanalyze.mjs','--input',packed,'--model',baseline,'--fpu',String(search.selectedFpu),'--seed',String(stage.reanalysis.selectionSeed),'--output-prefix',data+'/round1']);
  const candidates=[];
  for(let recipe=0;recipe<3;recipe++){
   state.status='first-generation-training-t'+recipe;save();
   const model=data+'/round1-t'+recipe,training=['run','--project','tools/ai-gnn','--extra','cuda','python','tools/ai-gnn/train.py',
    '--data',teacher,data+'/round1-t'+recipe+'.jsonl.gz','--resume',plan.baseline.checkpoint,
    '--split-manifest','experiments/ai/v3/2026-10-22-learning/data/baseline-model-manifest.json',
    '--device','cuda','--epochs','12','--batch-size','128','--seed',String(stage.training.seed),
    '--learning-rate','0.0001','--minimum-learning-rate','0.00001','--cosine','--ema-decay','0.99',
    '--balanced','--selfplay-mass','0.5','--policy-temperature','1','--minimum-policy-confidence','0',
    '--policy-anchor',plan.baseline.checkpoint,'--policy-anchor-weight','0.5','--best-validation',
    '--normal-training','--normal-selection','--normalize-policy','--require-validation-policy','--checkpoint-every','4','--output',model];
   await run('round1-t'+recipe+'-training','uv',training);
   const manifest=JSON.parse(readFileSync(model+'/manifest.json','utf8'));
   if(candidates.length&&manifest.selectionCorpusSha256!==candidates[0].selectionCorpusSha256)throw new Error('Candidates have different validation corpora or targets');
   manifest.search={fpu:search.selectedFpu};
   writeFileSync(model+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');
   await run('round1-t'+recipe+'-onnx',process.execPath,['tools/ai-gnn/test-onnx.mjs',model]);
   const candidate={recipe,model,sha256:manifest.sha256,selectedEpoch:manifest.selectedEpoch,selectionCorpusSha256:manifest.selectionCorpusSha256,
    initialSelection:manifest.initialSelectionMetrics,selection:manifest.selectionMetrics,eligible:false};
   if(manifest.selectedEpoch===0){candidate.noMatchReason='Epoch zero: checkpoint remains the baseline';}
   else{
    await run('round1-t'+recipe+'-endgame',process.execPath,['tools/ai-gnn/replay-endgame.mjs','--model',model,'--output',data+'/round1-t'+recipe+'-endgame.json']);
    const output=data+'/round1-t'+recipe+'-development.json';
    await run('round1-t'+recipe+'-development',process.execPath,['tools/ai-gnn/match.mjs','--a',model,'--b',baseline,
     '--a-fpu',String(search.selectedFpu),'--b-fpu',String(search.selectedFpu),'--pairs','8',
     '--simulations','128','--seed',String(stage.development.seed),'--output',output]);
    const match=JSON.parse(readFileSync(output,'utf8'));
    candidate.score=match.summary.score;candidate.capped=match.summary.capped;
    candidate.boards=match.boards.map(b=>({board:b.kind+b.size,score:b.games.reduce((s,g)=>s+(g.aScore??0),0)}));
    candidate.eligible=match.summary.completed===96&&candidate.capped===0&&candidate.score>=54&&candidate.boards.every(b=>b.score>=6);
   }
   candidates.push(candidate);state.candidates=candidates;save();
  }
  const accepted=candidates.filter(c=>c.eligible).sort((a,b)=>b.score-a.score||a.recipe-b.recipe)[0];
  state.stages.teacher_and_first_training='completed';state.selected=accepted??null;
  state.status=accepted?'ready-for-second-generation':'stopped-at-first-generation-gate';
  state.finished=new Date().toISOString();save();console.log('FIRST GENERATION',JSON.stringify({status:state.status,selected:state.selected,candidates:state.candidates}));
 }
}catch(error){state.status='error';state.error=error.stack;save();throw error;}
