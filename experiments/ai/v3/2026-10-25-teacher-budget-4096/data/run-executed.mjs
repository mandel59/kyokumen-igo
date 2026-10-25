import fs from 'node:fs';import {createHash} from 'node:crypto';import {runStudyCommand} from '../../study-commands.mjs';import {teacherBudgetStatistics} from '../../teacher-budget-statistics.mjs';
const dir='tools/ai-gnn/target/teacher-budget-4096',plan=JSON.parse(fs.readFileSync(dir+'/plan.json')),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const jobs=plan.boards.flatMap(board=>plan.variants.map(variant=>({board,variant,name:variant+'-'+board.key}))),errors=[];let next=0;
async function worker(){while(next<jobs.length){const job=jobs[next++],{variant,board,name}=job;try{await runStudyCommand(dir,name,process.execPath,['tools/ai-gnn/browser-match.mjs','--a',plan.model,'--b',plan.model,'--a-wasm',dir+'/'+variant+'.wasm','--b-wasm',dir+'/sh8.wasm','--a-simulations','4096','--b-simulations','64','--a-fpu','1','--b-fpu','1','--pairs','8','--board',board.key,'--seed',String(board.seed),'--bootstrap-seed',String(plan.bootstrap.seed),'--player','offline','--role','offline-teacher-budget-development','--output',dir+'/'+name+'.json']);}catch(error){errors.push({name,error:String(error)});}}}
await Promise.all(Array.from({length:6},worker));
for(const[p,h]of Object.entries({...plan.sourceHashes,...plan.baselineFiles}))if(sha(p)!==h)errors.push({source:p,error:'Source/input changed during study'});
if(errors.length){fs.writeFileSync(dir+'/failures.json',JSON.stringify(errors,null,2)+'\n');throw Error('Study incomplete; inspect failures.json');}
const summary=[];
for(const variant of plan.variants){
 const shards=plan.boards.map(b=>({board:b,path:dir+'/'+variant+'-'+b.key+'.json',report:JSON.parse(fs.readFileSync(dir+'/'+variant+'-'+b.key+'.json'))}));
 const report={...shards[0].report,seed:null,pairsPerBoard:8,seedsByBoard:Object.fromEntries(plan.boards.map(b=>[b.key,b.seed])),boards:shards.flatMap(s=>s.report.boards),environment:shards.map(s=>({board:s.board.key,...s.report.environment})),shards:shards.map(s=>({board:s.board.key,path:s.path,sha256:sha(s.path)}))};
 for(const s of shards){if(s.report.summary.games!==16||s.report.summary.capped!==0)throw Error('Incomplete shard '+s.path);}
 report.summary=teacherBudgetStatistics(report,plan.bootstrap);const s=report.summary,eligible=s.games===96&&s.scoreRate>=.6&&s.pairedBootstrap.interval97_5[0]>.5&&s.boards.every(b=>b.score>=8);
 fs.writeFileSync(dir+'/'+variant+'-aggregate.json',JSON.stringify(report,null,2)+'\n');summary.push({variant,eligible,summary:s});console.log(variant,JSON.stringify(s));
}
const eligible=summary.filter(r=>r.eligible).sort((a,b)=>b.summary.score-a.summary.score||plan.variants.indexOf(a.variant)-plan.variants.indexOf(b.variant));
fs.writeFileSync(dir+'/selection.json',JSON.stringify({schemaVersion:1,rule:plan.gate,candidates:summary,selected:eligible[0]?.variant??null,teacherAdopted:false,browserAdopted:false,next:eligible.length?'Candidate cleared relative-strength screen; collect new independent teacher data and test distillation separately.':'No candidate qualified. Do not expand teacher data or distill these settings.'},null,2)+'\n');console.log('Selected',eligible[0]?.variant??'none');
