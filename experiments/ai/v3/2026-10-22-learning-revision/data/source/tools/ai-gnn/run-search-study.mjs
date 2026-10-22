// Execute the predeclared search comparison before generating training data.
import {spawn} from 'node:child_process';
import {createWriteStream,readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2),arg=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const directory='experiments/ai/v3/2026-10-22-learning-revision',data=arg('--output-directory',directory+'/data');
mkdirSync(data,{recursive:true});
const plan=JSON.parse(readFileSync(directory+'/plan.json','utf8'));
const stage=plan.stages.find(s=>s.id==='search');
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const baseline=arg('--baseline-model','dist/models/v3'),baselineWasm=directory+'/data/baseline-search.wasm',manifest=JSON.parse(readFileSync(baseline+'/manifest.json','utf8'));
if(manifest.sha256!==plan.baseline.modelSha256)throw new Error('Baseline model changed');
for(const name of['search-s1','search-s2','teacher-budget'])if(existsSync(data+'/'+name+'.json')||existsSync(data+'/'+name+'.json.gz')||existsSync(data+'/'+name+'-log.txt'))throw new Error('Study output already exists: '+name);
const provenance={started:new Date().toISOString(),baselineModel:manifest.sha256,
 baselineWasm:hash(baselineWasm),candidateWasm:hash('dist/ai-v3.wasm')};
async function match(name,extra,seed,pairs){
 const output=data+'/'+name+'.json',log=createWriteStream(data+'/'+name+'-log.txt');
 const args=['tools/ai-gnn/match.mjs','--a',baseline,'--b',baseline,'--pairs',String(pairs),
  '--seed',String(seed),'--simulations','128','--output',output,...extra];
 console.log('Starting',name,new Date().toISOString());
 writeFileSync(data+'/'+name+'-command.json',JSON.stringify({command:process.execPath,args,provenance},null,2)+'\n');
 const child=spawn(process.execPath,args,{stdio:['ignore','pipe','pipe']});
 child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
 await new Promise(resolve=>log.end(resolve));
 if(code!==0)throw new Error(name+' exited '+code);
 const result=JSON.parse(readFileSync(output,'utf8'));
 console.log('Completed',name,JSON.stringify(result.summary));
 return result;
}
const results=[];
for(const mode of [1,2]){
 const result=await match('search-s'+mode,['--a-fpu',String(mode),'--b-fpu','0','--b-wasm',baselineWasm,'--diagnostics','true'],stage.development.seed,stage.development.pairsPerBoard);
 const boards=result.boards.map(b=>({board:b.kind+b.size,score:b.games.reduce((s,g)=>s+(g.aScore??0),0),games:b.games.length}));
 results.push({mode,score:result.summary.score,capped:result.summary.capped,boards,
  eligible:result.summary.completed===96&&result.summary.capped===0&&result.summary.score>=54&&boards.every(b=>b.score>=6)});
}
const eligible=results.filter(r=>r.eligible).sort((a,b)=>b.score-a.score||a.mode-b.mode);
const selectedFpu=eligible[0]?.mode??0;
const selection={...provenance,finishedSearch:new Date().toISOString(),results,selectedFpu,
 rule:stage.selection,status:'teacher-budget-check-running'};
writeFileSync(data+'/search-selection.json',JSON.stringify(selection,null,2)+'\n');
const budget=stage.teacherBudgetCheck;
const result=await match('teacher-budget',['--a-fpu',String(selectedFpu),'--b-fpu',String(selectedFpu),
 '--a-simulations','512','--b-simulations','128'],budget.seed,budget.pairsPerBoard);
selection.teacherBudget={score:result.summary.score,games:result.summary.games,capped:result.summary.capped,
 passed:result.summary.completed===48&&result.summary.capped===0&&result.summary.score>=24};
selection.status=selection.teacherBudget.passed?'ready-for-selfplay':'stopped-at-teacher-budget-gate';
selection.finished=new Date().toISOString();
writeFileSync(data+'/search-selection.json',JSON.stringify(selection,null,2)+'\n');
console.log('SELECTION',JSON.stringify(selection));
