import fs from 'node:fs';
import {runStudyCommand} from '../../study-commands.mjs';
const dir='tools/ai-gnn/target/offline-teacher',plan=JSON.parse(fs.readFileSync(dir+'/plan.json'));
for(const study of plan.studies){
 const aWasm=dir+'/'+(study.root===8?'sh8':'sh32')+'.wasm';
 await runStudyCommand(dir,study.id,process.execPath,['tools/ai-gnn/browser-match.mjs','--a','dist/models/v3','--b','dist/models/v3','--a-wasm',aWasm,'--b-wasm',dir+'/sh8.wasm','--a-simulations',String(study.visits),'--b-simulations',String(study.opponentVisits),'--a-fpu','1','--b-fpu','1','--pairs',String(study.pairsPerBoard),'--seed',String(study.seed),'--bootstrap-seed',String(study.bootstrapSeed),'--role','offline-teacher-pilot','--output',dir+'/'+study.id+'.json']);
 const r=JSON.parse(fs.readFileSync(dir+'/'+study.id+'.json'));console.log(study.id,JSON.stringify(r.summary));
}
