import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {AI_BOARDS} from '../../dist/ai-position.js';
import {matchStatistics} from './match-statistics.mjs';
import {runStudyCommand} from './study-commands.mjs';
const directory=resolve(process.argv[2]),stage=process.argv[3];
if(!['development','independent'].includes(stage))throw Error('Expected DIRECTORY development|independent');
const plan=JSON.parse(readFileSync(join(directory,'plan.json'))),jobs=[];
const pairs=stage==='development'?plan.evaluation.developmentPairsPerBoard:plan.evaluation.independentBaselinePairsPerBoard;
for(const [index,[kind,size]]of AI_BOARDS.entries())jobs.push({name:`${stage}-baseline-${kind}${size}`,kind,size,pairs,
 a:join(directory,'teacher-model'),b:join(directory,'baseline'),seed:plan.seeds[stage==='development'?'development':'independentBaseline']+index*1009,comparison:'baseline'});
if(stage==='independent')for(const [index,size]of [7,9,11].entries())jobs.push({name:`independent-control-plane${size}`,kind:'plane',size,
 pairs:plan.evaluation.independentControlPairsPerPlaneBoard,a:join(directory,'teacher-model'),b:join(directory,'control-model'),
 seed:plan.seeds.independentControl+index*1009,comparison:'control'});
let next=0;
await Promise.all(Array.from({length:3},async()=>{
 while(next<jobs.length){
  const job=jobs[next++],output=join(directory,job.name+'.json');
  if(existsSync(output)){
   const saved=JSON.parse(readFileSync(output));if(!saved.summary||saved.summary.games!==job.pairs*2)throw Error('Incomplete evaluation exists: '+job.name);
  }else await runStudyCommand(directory,job.name,process.execPath,['tools/ai-gnn/match.mjs','--player','offline',
   '--a',job.a,'--b',job.b,'--a-wasm',join(directory,'search.wasm'),'--b-wasm',join(directory,'search.wasm'),
   '--a-fpu','1','--b-fpu','1','--simulations','64','--pairs',String(job.pairs),'--board',job.kind+job.size,'--seed',String(job.seed),'--output',output]);
 }
}));
const results=jobs.map(job=>({job,report:JSON.parse(readFileSync(join(directory,job.name+'.json')))}));
const aggregate=(comparison,kind)=>{
 const selected=results.filter(r=>r.job.comparison===comparison&&(!kind||r.job.kind===kind)),report={boards:selected.flatMap(r=>r.report.boards)};
 if(!report.boards.length)return null;
 return matchStatistics(report,{seed:plan.seeds.independentBaseline});
};
const summary={schemaVersion:1,stage,planeVsBaseline:aggregate('baseline','plane'),sphereVsBaseline:aggregate('baseline','sphere'),
 allCurvesVsBaseline:matchStatistics({boards:results.filter(r=>r.job.comparison==='baseline'&&r.job.kind!=='plane').flatMap(r=>r.report.boards)},{seed:plan.seeds.independentBaseline}),
 planeVsControl:aggregate('control'),allVsBaseline:aggregate('baseline'),jobs:jobs.map(j=>j.name)};
if(stage==='independent'){
 const gates=plan.evaluation.adoption,check=(result,gate)=>result.capped===0&&result.scoreRate>=gate.minScore&&
  (gate.minBoardScore===undefined||result.boards.every(b=>b.score/b.games>=gate.minBoardScore))&&result.pairedBootstrap.interval95[0]>=(gate.minLower95??0);
 summary.strengthGates={planeVsBaseline:check(summary.planeVsBaseline,gates.planeVsBaseline),planeVsControl:check(summary.planeVsControl,gates.planeVsControl),
  curvesVsBaseline:check(summary.allCurvesVsBaseline,gates.curveVsBaseline)};
 summary.passesStrength=Object.values(summary.strengthGates).every(Boolean);
}
writeFileSync(join(directory,stage+'-summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
