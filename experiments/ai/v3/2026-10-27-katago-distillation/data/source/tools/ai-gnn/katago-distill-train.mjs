import {readFileSync,writeFileSync,copyFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {runStudyCommand} from './study-commands.mjs';
const directory=resolve(process.argv[2]),plan=JSON.parse(readFileSync(join(directory,'plan.json')));
await runStudyCommand(directory,'paired-tensor-audit','tools/ai-gnn/.venv/Scripts/python.exe',[
 'tools/ai-gnn/validate_paired_training.py','--control',join(directory,'control.jsonl.gz'),'--teacher',join(directory,'teacher.jsonl.gz'),
 '--split',join(directory,'game-split.json'),'--output',join(directory,'paired-tensor-audit.json')]);
const args=['tools/ai-gnn/train.py','--topologies',join(directory,'topologies.json'),'--resume',join(directory,'baseline/weights.pt'),
 '--split-manifest',join(directory,'game-split.json'),'--epochs',String(plan.training.epochs),'--batch-size',String(plan.training.batchSize),
 '--seed',String(plan.seeds.training),'--device','cuda','--learning-rate',String(plan.training.learningRate),
 '--minimum-learning-rate',String(plan.training.minimumLearningRate),'--balanced','--normal-training','--normal-selection','--normalize-policy',
 '--require-validation-policy','--checkpoint-every',String(plan.training.checkpointEvery),'--best-validation','--cosine','--ema-decay',String(plan.training.emaDecay)];
for(const arm of ['control','teacher']){
 if(existsSync(join(directory,arm+'-train-command.json')))throw Error('Training record already exists: '+arm);
 await runStudyCommand(directory,arm+'-train','tools/ai-gnn/.venv/Scripts/python.exe',[...args,'--data',join(directory,arm+'.jsonl.gz'),'--output',join(directory,arm+'-model')]);
 const path=join(directory,arm+'-model/manifest.json'),manifest=JSON.parse(readFileSync(path));
 manifest.search={fpu:1};manifest.teacherProvenance=JSON.parse(readFileSync(join(directory,'provenance.json'))).model;
 manifest.researchRole=arm==='teacher'?'KataGo search-policy distillation candidate':'Matched v3-policy extra-training control';
 manifest.planId=plan.id;writeFileSync(path,JSON.stringify(manifest,null,2)+'\n');
 copyFileSync(join(directory,'KataGo-NN-LICENSE.txt'),join(directory,arm+'-model/KataGo-NN-LICENSE.txt'));
 console.log(arm,'selected epoch',manifest.selectedEpoch,'model',manifest.sha256);
}
