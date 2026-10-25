import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
const dir='tools/ai-gnn/target/onpolicy-distillation';
const report=JSON.parse(readFileSync(dir+'/selfplay-report.json'));if(report.capped||report.completedGames!==96)throw Error('Incomplete selfplay');
for(const [name,fraction]of [['candidate',0]]){
 const output=dir+'/'+name;if(existsSync(output+'/manifest.json'))throw Error('Existing model');
 const args=['tools/ai-gnn/train.py','--data','experiments/ai/v3/2026-10-22-learning-revision/data/teacher-annotated.jsonl.gz',dir+'/selfplay.jsonl','--resume','experiments/ai/v3/2026-10-22-learning-revision/data/round1-t0/weights.pt','--split-manifest','experiments/ai/v3/2026-10-22-learning-revision/data/round2-split.json','--device','cuda','--epochs','16','--batch-size','128','--seed','2026102602','--learning-rate','0.00003','--minimum-learning-rate','0.000003','--cosine','--ema-decay','0.99','--balanced','--selfplay-mass','0.6','--policy-anchor','experiments/ai/v3/2026-10-22-learning-revision/data/round1-t0/weights.pt','--policy-anchor-weight','0.25','--best-validation','--normal-training','--normal-selection','--normalize-policy','--require-validation-policy','--checkpoint-every','4','--policy-surprise-fraction',String(fraction),'--output',output];
 const command={command:'tools/ai-gnn/.venv/Scripts/python.exe',args,started:new Date().toISOString()},commandPath=dir+'/'+name+'-command.json';writeFileSync(commandPath,JSON.stringify(command,null,2)+'\n');
 const log=dir+'/'+name+'-training.log';if(existsSync(log))throw Error('Existing log');
 const start=Date.now(),child=spawn(command.command,args,{stdio:['ignore','pipe','pipe'],windowsHide:true});
 child.stdout.on('data',chunk=>{appendFileSync(log,chunk);for(const line of String(chunk).split('\n'))try{const r=JSON.parse(line);if(r.epoch!==undefined)console.log(name,'epoch',r.epoch,'selection loss',r.selectionLoss??r.selection?.loss??r.validation?.loss);}catch{}});
 child.stderr.on('data',chunk=>appendFileSync(log,chunk));
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
 command.finished=new Date().toISOString();command.elapsedSeconds=(Date.now()-start)/1000;command.exitCode=code;writeFileSync(commandPath,JSON.stringify(command,null,2)+'\n');
 if(code!==0)throw Error('Training failed: '+name+' '+code);
 const manifest=JSON.parse(readFileSync(output+'/manifest.json'));manifest.search={fpu:1};writeFileSync(output+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');console.log(name,'selected',manifest.selectedEpoch,'model',manifest.sha256);
}
