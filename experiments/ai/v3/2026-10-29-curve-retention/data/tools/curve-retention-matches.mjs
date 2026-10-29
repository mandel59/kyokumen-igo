// Registered NewData round: shared openings within replicas, full trajectories, fixed64 visits.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,createWriteStream,copyFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createGzip} from 'node:zlib';
import {once} from 'node:events';
import {Game,createTopology} from '../../dist/engine.js';
import {aiPosition} from '../../dist/ai-position.js';
import {createV3Search} from '../../dist/ai-v3-search.js';
import {adjacencyFor} from '../../dist/ai-v3-inference.js';
import {createNodeInference} from './node-inference.mjs';
import {matchStatistics} from './match-statistics.mjs';
const dir='tools/ai-gnn/target/curve-retention-study-20261029',plan=JSON.parse(readFileSync(dir+'/plan.json')),phase=process.argv[2];
const boards=plan.boards.map(key=>{const[,kind,size]=key.match(/^([a-z]+)(\d+)$/);return{key,kind,size:Number(size)};});
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const save=(name,value)=>writeFileSync(dir+'/'+name,JSON.stringify(value,null,2)+'\n');
assert.equal(hash(plan.baseline.model),plan.baseline.modelSha256);assert.equal(hash(plan.baseline.wasm),plan.baseline.wasmSha256);
export function fnv(text){let h=2166136261;for(const c of text){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0||1;}
function rng(seed){let s=seed>>>0||1;return()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return s>>>0;};}
function openings(seed,pairs){return{seed,pairsPerBoard:pairs,boards:boards.map(board=>({...board,pairs:Array.from({length:pairs},(_,pair)=>{const random=rng(fnv(seed+'|'+board.key+'|'+pair+'|opening')),g=new Game(createTopology(board.kind,board.size),6.5),moves=[];for(let k=0;k<4;k++){const legal=Array.from(g.board,(_,p)=>p).filter(p=>g.analyze(p).ok),move=legal[random()%legal.length];assert.ok(g.play(move).ok);moves.push(move);}return{pair,moves};})}))};}
function sink(path){const file=createWriteStream(path,{flags:'wx'}),gzip=createGzip();gzip.pipe(file);return{async push(v){if(!gzip.write(JSON.stringify(v)+'\n'))await once(gzip,'drain');},async close(){gzip.end();await once(file,'close');}};}
async function choose(search,inference,game,seed){
 search.start(aiPosition(game),{seed,fpu:1,tactics:true});const adjacency=adjacencyFor(game.topology);let stalled=0;
 while(search.result().simulations<64){const before=search.result().simulations,left=64-before,request=search.collect(Math.min(8,left),left);
  if(request.count)search.submit(request,await inference.evaluate(request,adjacency));
  const out=search.result();if(out.provenLoss)break;
  if(out.simulations===before){if(++stalled>16)throw Error('Stalled search');}else stalled=0;
 }
 const out=search.result({diagnostics:true});assert.ok(out.provenLoss||out.simulations===64);assert.ok(out.move===null||game.analyze(out.move).ok);return out;
}
async function job({id,board,manifest,seed}){
 const path='results/'+phase+'-'+id+'-'+board.key+'.json';
 if(existsSync(dir+'/'+path)){const old=JSON.parse(readFileSync(dir+'/'+path));if(old.status==='complete')return old;throw Error('Incomplete prior report: '+path);}
 const inference=await createNodeInference(dir+'/'+id+'-model'),baseline=await createNodeInference(dir+'/baseline');
 const bytes=readFileSync(dir+'/search.wasm'),a=await createV3Search({load:async()=>bytes}),b=await createV3Search({load:async()=>bytes});
 const trace=sink(dir+'/'+path+'.trace.jsonl.gz'),report={schemaVersion:1,phase,id,board,seed,status:'running',games:[],pairScores:[],provenance:{aModel:inference.manifest.sha256,bModel:baseline.manifest.sha256,wasm:hash(dir+'/search.wasm'),driver:hash('tools/ai-gnn/curve-retention-matches.mjs')}};
 try{
  for(const opening of manifest.pairs){let pairScore=0;
   for(const aColor of [1,2]){const g=new Game(createTopology(board.kind,board.size),6.5),n=g.board.length;for(const m of opening.moves)assert.ok(g.play(m).ok);
    while(!g.ended&&g.moves<6*n){const side=g.turn===aColor?'a':'b',searchSeed=fnv(seed+'|'+board.key+'|'+opening.pair+'|'+g.moves),out=await choose(side==='a'?a:b,side==='a'?inference:baseline,g,searchSeed);
     await trace.push({pair:opening.pair,aColor,ply:g.moves,side,searchSeed,move:out.move,simulations:out.simulations,reason:out.decisionReason,...out.diagnostics});
     assert.ok((out.move===null?g.pass():g.play(out.move)).ok);
    }
    const score=g.score(),aScore=score.winner===0?.5:score.winner===aColor?1:0;pairScore+=aScore;
    report.games.push({pair:opening.pair,aColor,ended:g.ended,capped:!g.ended,aScore,score,moves:g.history.slice(1).map(s=>s.lastMove??-1)});save(path,report);
    console.log(phase,id,board.key,'pair',opening.pair,'colour',aColor,'score',aScore,'moves',g.moves);
   }report.pairScores.push(pairScore/2);
  }report.status='complete';
 }catch(e){report.status='failed';report.error=e.stack;throw e;}
 finally{await trace.close();a.dispose();b.dispose();await inference.dispose();await baseline.dispose();save(path,report);}
 return report;
}
function stats(reports,predicate=()=>true){
 const chosen=reports.filter(r=>predicate(r.board)),actual=chosen.flatMap(r=>r.games);
 const result=matchStatistics({boards:chosen.map(r=>({kind:r.board.kind,size:r.board.size,games:r.games.map(g=>({...g,ended:true})),pairScores:r.pairScores}))},{seed:plan.seeds.bootstrap,iterations:10000});
 result.completed=actual.filter(g=>g.ended).length;result.capped=actual.filter(g=>!g.ended).length;result.capPolicy='Retained and scored actual Game area at6N; included in pair CI.';return result;
}
async function run(){
 const preflight=JSON.parse(readFileSync(dir+'/results/preflight.json'));assert.ok(preflight.candidateIds.length,'No candidate passes preflight');
 const ids=phase==='development'?preflight.results.filter(r=>r.arm==='Control'||preflight.candidateIds.includes(r.id)).map(r=>r.id):[JSON.parse(readFileSync(dir+'/results/selection.json')).selected];assert.ok(ids.every(Boolean));
 for(const id of ids){const r=JSON.parse(readFileSync(dir+'/results/browser-'+id+'.json'));assert.equal(r.environment.modelSha256,JSON.parse(readFileSync(dir+'/'+id+'-model/manifest.json')).sha256);}
 const registration='results/'+phase+'-registration.json';if(!existsSync(dir+'/'+registration)){copyFileSync('tools/ai-gnn/curve-retention-matches.mjs',dir+'/sources/'+phase+'-matches.mjs');save(registration,{started:new Date().toISOString(),plan:hash(dir+'/plan.json'),driver:hash('tools/ai-gnn/curve-retention-matches.mjs'),models:ids.map(id=>({id,sha256:JSON.parse(readFileSync(dir+'/'+id+'-model/manifest.json')).sha256}))});}
 const manifests={};
 for(const id of ids){const replica=Number(id.slice(-1)),seed=phase==='development'?plan.seeds.development:plan.seeds.independent;
  const pairs=phase==='development'?4:24,key=String(seed);if(!manifests[key]){manifests[key]=openings(seed,pairs);const p='results/'+phase+'-openings-'+key+'.json';if(existsSync(dir+'/'+p))assert.deepEqual(JSON.parse(readFileSync(dir+'/'+p)),manifests[key]);else save(p,manifests[key]);}
 }
 const tasks=ids.flatMap(id=>boards.map(board=>{const replica=Number(id.slice(-1)),seed=phase==='development'?plan.seeds.development:plan.seeds.independent;return{id,board,seed,manifest:manifests[String(seed)].boards.find(b=>b.key===board.key)};}));
 let index=0;await Promise.all(Array.from({length:3},async()=>{while(index<tasks.length)await job(tasks[index++]);}));
 const results=ids.map(id=>{const reports=boards.map(b=>JSON.parse(readFileSync(dir+'/results/'+phase+'-'+id+'-'+b.key+'.json')));return{id,all:stats(reports),plane:stats(reports,b=>b.kind==='plane'),curves:stats(reports,b=>b.kind!=='plane')};});
 save('results/'+phase+'-summary.json',{phase,results});console.log(JSON.stringify(results.map(r=>({id:r.id,score:r.all.score,games:r.all.games,plane:r.plane.scoreRate,curves:r.curves.scoreRate}))));
}
function select(){
 const results=JSON.parse(readFileSync(dir+'/results/development-summary.json')).results,control=results.find(r=>r.id==='Control-r0');
 assert.ok(control);
 const candidates=results.filter(r=>r.id!=='Control-r0').map(r=>{
  const gates={overall:r.all.score>=40,everyBoard:r.all.boards.every(b=>b.score>=3),plane:r.plane.scoreRate>=.5,curves:r.curves.scoreRate>=.5,higherThanControl:r.all.score>control.all.score,curveRetention:r.curves.score>=control.curves.score};
  return {...r,gates,eligible:Object.values(gates).every(Boolean)};
 });
 const order=['CurveGuard-r0','CompletedQ-r0'];
 candidates.sort((a,b)=>b.all.score-a.all.score||b.curves.score-a.curves.score||order.indexOf(a.id)-order.indexOf(b.id));
 const selected=candidates.find(r=>r.eligible)?.id??null;
 save('results/selection.json',{selected,candidates,control,independentConsumed:false});console.log(JSON.stringify({selected,candidates:candidates.map(r=>({id:r.id,score:r.all.score,gates:r.gates}))}));
}
function assess(){
 const r=JSON.parse(readFileSync(dir+'/results/independent-summary.json')).results[0],gates={overall:r.all.scoreRate>=.55&&r.all.pairedBootstrap.interval95[0]>.5,everyBoard:r.all.boards.every(b=>b.score>=19),plane:r.plane.scoreRate>=.5,curves:r.curves.scoreRate>=.5};
 save('results/independent-decision.json',{id:r.id,passesStrength:Object.values(gates).every(Boolean),gates,result:r,productionUpdated:false});console.log(JSON.stringify(gates));
}
if(phase==='development'||phase==='independent')await run();else if(phase==='select')select();else if(phase==='assess')assess();else throw Error('development|select|independent|assess');
