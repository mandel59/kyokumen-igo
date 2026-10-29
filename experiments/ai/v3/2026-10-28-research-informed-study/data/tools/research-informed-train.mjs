import {readFileSync,writeFileSync,copyFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runStudyCommand} from './study-commands.mjs';
const dir='tools/ai-gnn/target/research-informed-study-20261028',plan=JSON.parse(readFileSync(dir+'/plan.json'));
const coverage=JSON.parse(readFileSync(dir+'/results/coverage.json')),audit=JSON.parse(readFileSync(dir+'/results/data-audit.json'));
if(!audit.passed||coverage.skipSoftHead)throw Error('Registered phase0 gate did not pass');
const sourcePaths=['tools/ai-gnn/train.py','tools/ai-gnn/model.py','tools/ai-gnn/test_soft_policy.py','tools/ai-gnn/research-informed-train.mjs','tools/ai-gnn/research-informed-coverage.py'];
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const snapshot=dir+'/training-registration.json';
if(existsSync(snapshot))throw Error('Training already registered; do not rerun silently');
for(const p of sourcePaths)copyFileSync(p,dir+'/sources/training-'+p.split('/').at(-1));
writeFileSync(snapshot,JSON.stringify({started:new Date().toISOString(),planSha256:hash(dir+'/plan.json'),dataAuditSha256:hash(dir+'/results/data-audit.json'),coverageSha256:hash(dir+'/results/coverage.json'),sourceHashes:Object.fromEntries(sourcePaths.map(p=>[p,hash(p)])),runs:plan.phase1.training.seeds.flatMap((seed,replica)=>plan.phase1.arms.map(arm=>({id:arm.id+'-r'+replica,seed,weight:arm.auxiliaryWeight})))},null,2)+'\n');
for(const [replica,seed] of plan.phase1.training.seeds.entries())for(const arm of plan.phase1.arms){
 const id=arm.id+'-r'+replica,output=dir+'/'+id+'-model';if(existsSync(output))throw Error('Training output exists');
 const args=['tools/ai-gnn/train.py','--data',plan.phase0.input,'--topologies',dir+'/topologies.json','--output',output,'--resume',dir+'/baseline/weights.pt','--split-manifest',dir+'/baseline/manifest.json','--trainable','all','--epochs','8','--batch-size','64','--seed',String(seed),'--device','cuda','--learning-rate','0.00003','--minimum-learning-rate','0.000003','--cosine','--ema-decay','0.99','--balanced','--normal-training','--normal-selection','--normalize-policy','--checkpoint-every','2','--best-validation','--require-validation-policy','--auxiliary-soft-policy','--auxiliary-policy-temperature','4','--auxiliary-policy-weight',String(arm.auxiliaryWeight)];
 await runStudyCommand(dir,'train-'+id,'tools/ai-gnn/.venv/Scripts/python.exe',args);
 const path=output+'/manifest.json',m=JSON.parse(readFileSync(path)),baseline=JSON.parse(readFileSync(dir+'/baseline/manifest.json'));
 m.search={fpu:1};m.planId=plan.id;m.baseModel=plan.baseline.modelSha256;m.teacherProvenance=baseline.teacherProvenance;m.researchRole='Soft-policy auxiliary: '+id;
 writeFileSync(path,JSON.stringify(m,null,2)+'\n');copyFileSync(dir+'/baseline/KataGo-NN-LICENSE.txt',output+'/KataGo-NN-LICENSE.txt');
 const gp=output+'/golden.json',golden=JSON.parse(readFileSync(gp));golden.modelSha256=m.sha256;writeFileSync(gp,JSON.stringify(golden)+'\n');
 console.log(JSON.stringify({id,epoch:m.selectedEpoch,initial:m.initialSelectionMetrics.loss,selected:m.selectionMetrics.loss,relativeGain:1-m.selectionMetrics.loss/m.initialSelectionMetrics.loss}));
}
