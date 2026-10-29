import {readFileSync,writeFileSync,existsSync,copyFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runStudyCommand} from './study-commands.mjs';
const dir='tools/ai-gnn/target/fresh-data-study-20261028',plan=JSON.parse(readFileSync(dir+'/plan.json'));
if(!JSON.parse(readFileSync(dir+'/results/data-audit.json')).passed)throw Error('Data audit did not pass');
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),source=['train.py','model.py','test_fresh_replay.py','research-informed-newdata-train.mjs','research-informed-newdata-prepare.mjs'];
if(existsSync(dir+'/training-registration.json'))throw Error('Training already registered');
for(const p of source)copyFileSync('tools/ai-gnn/'+p,dir+'/sources/training-'+p);
writeFileSync(dir+'/training-registration.json',JSON.stringify({started:new Date().toISOString(),sourceHashes:Object.fromEntries(source.map(p=>[p,hash('tools/ai-gnn/'+p)])),plan:hash(dir+'/plan.json'),audit:hash(dir+'/results/data-audit.json')},null,2)+'\n');
for(const arm of plan.training.arms){
 const id=arm.id+'-r0',output=dir+'/'+id+'-model',fresh=arm.freshTraining?'fresh-all.jsonl.gz':'fresh-validation.jsonl.gz';
 const args=['tools/ai-gnn/train.py','--data',plan.legacyData,dir+'/'+fresh,'--topologies',dir+'/topologies.json','--output',output,'--resume',dir+'/baseline/weights.pt','--split-manifest',dir+'/split.json','--trainable','all','--epochs','16','--batch-size','64','--seed',String(plan.training.seed),'--device','cuda','--learning-rate','0.0001','--minimum-learning-rate','0.00001','--cosine','--ema-decay','0.99','--balanced','--normal-training','--normal-selection','--normalize-policy','--checkpoint-every','4','--best-validation','--require-validation-policy','--samples-per-epoch','9263','--fresh-generation-fraction','0.3'];
 await runStudyCommand(dir,'train-'+id,'tools/ai-gnn/.venv/Scripts/python.exe',args);
 const p=output+'/manifest.json',m=JSON.parse(readFileSync(p)),baseline=JSON.parse(readFileSync(dir+'/baseline/manifest.json'));m.search={fpu:1};m.planId=plan.id;m.baseModel=plan.baseline.modelSha256;m.teacherProvenance=baseline.teacherProvenance;m.researchRole='New data availability: '+arm.id;
 if(m.history.some(r=>r.sampledPositions!==9263||r.optimizerSteps!==145))throw Error('Update count differs from registered budget');
 writeFileSync(p,JSON.stringify(m,null,2)+'\n');copyFileSync(dir+'/baseline/KataGo-NN-LICENSE.txt',output+'/KataGo-NN-LICENSE.txt');
 const gp=output+'/golden.json',golden=JSON.parse(readFileSync(gp));golden.modelSha256=m.sha256;writeFileSync(gp,JSON.stringify(golden)+'\n');
 console.log(JSON.stringify({id,epoch:m.selectedEpoch,relativeGain:1-m.selectionMetrics.loss/m.initialSelectionMetrics.loss}));
}
