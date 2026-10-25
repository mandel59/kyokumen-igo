import fs from 'node:fs';
import {runStudyCommand} from '../../study-commands.mjs';
const dir='tools/ai-gnn/target/teacher-search-study',plan=JSON.parse(fs.readFileSync(dir+'/plan.json')),model='experiments/ai/v3/2026-10-25-offline-teacher/data/baseline-model';
async function match(name,variant,pairs,seed,bootstrapSeed,role){
 await runStudyCommand(dir,name,process.execPath,['tools/ai-gnn/browser-match.mjs','--a',model,'--b',model,'--a-wasm',dir+'/'+variant+'.wasm','--b-wasm',dir+'/sh8.wasm','--simulations','1024','--a-fpu','1','--b-fpu','1','--pairs',String(pairs),'--seed',String(seed),'--bootstrap-seed',String(bootstrapSeed),'--player','offline','--role',role,'--output',dir+'/'+name+'.json']);
 return JSON.parse(fs.readFileSync(dir+'/'+name+'.json'));
}
const reports=await Promise.all(plan.development.variants.map(async variant=>{
 const r=await match('dev-'+variant,variant,plan.development.pairsPerBoard,plan.development.seed,plan.development.bootstrapSeed,'offline-teacher-development');
 console.log(variant,JSON.stringify(r.summary));return{variant,summary:r.summary};
}));
const order=plan.development.variants;reports.sort((a,b)=>b.summary.score-a.summary.score||order.indexOf(a.variant)-order.indexOf(b.variant));
const winner=reports[0],s=winner.summary,eligible=s.score>=17&&s.capped===0&&s.boards.every(b=>b.score>=1)&&s.pairedBootstrap.interval95[0]>.5;
fs.writeFileSync(dir+'/selection.json',JSON.stringify({schemaVersion:1,reports,selected:winner.variant,eligible,rule:plan.selection},null,2)+'\n');
if(eligible){const r=await match('confirmation',winner.variant,plan.confirmation.pairsPerBoard,plan.confirmation.seed,plan.confirmation.bootstrapSeed,'offline-teacher-confirmation');const s=r.summary;const passes=s.capped===0&&s.boards.every(b=>b.score>=3)&&s.pairedBootstrap.interval95[0]>.5;fs.writeFileSync(dir+'/confirmation-decision.json',JSON.stringify({schemaVersion:1,selected:winner.variant,passes,summary:s,gate:plan.confirmation.gate},null,2)+'\n');console.log('Confirmation',JSON.stringify(s));}
else console.log('No candidate passed the development threshold; confirmation skipped.');
