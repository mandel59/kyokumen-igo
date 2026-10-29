// Fresh teacher pilot only: fixed time/strength gates, no data enters learning.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,copyFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {Game,createTopology} from '../../dist/engine.js';
import {aiPosition} from '../../dist/ai-position.js';
import {createV3Search} from '../../dist/ai-v3-search.js';
import {adjacencyFor} from '../../dist/ai-v3-inference.js';
import {createNodeInference} from './node-inference.mjs';
import {runTrainingSearch} from './training-search.mjs';
import {createKataGoAnalysis,analysisPosition,analysisPolicy} from './katago-analysis.mjs';
import {fnv1a} from './selfplay-records.mjs';
const sourcePlan='experiments/ai/plans/v3-fresh-teacher-pilot/plan.json',plan=JSON.parse(readFileSync(sourcePlan)),dir=plan.workspace;
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
if(existsSync(dir))throw Error('Fresh workspace required');
assert.equal(hash('dist/models/v3/model.onnx'),plan.baseline.modelSha256);assert.equal(hash('dist/ai-v3.wasm'),plan.baseline.wasmSha256);
const provenance=JSON.parse(readFileSync('tools/ai-tuner/target/katago-distillation-20261027/provenance.json'));
assert.equal(hash(provenance.model.path),plan.teacher.modelSha256);assert.equal(hash(provenance.engine.path),plan.teacher.engineSha256);
mkdirSync(dir+'/results',{recursive:true});mkdirSync(dir+'/sources');
copyFileSync(sourcePlan,dir+'/plan.json');copyFileSync('tools/ai-tuner/target/katago-distillation-20261027/analysis.cfg',dir+'/analysis.cfg');
for(const p of ['tools/ai-gnn/research-informed-teacher-pilot.mjs','tools/ai-gnn/katago-analysis.mjs','tools/ai-gnn/training-search.mjs','dist/ai-v3-search.js'])copyFileSync(p,dir+'/sources/'+p.split('/').at(-1));
const save=(name,v)=>writeFileSync(dir+'/'+name,JSON.stringify(v,null,2)+'\n');
save('registration.json',{started:new Date().toISOString(),planSha256:hash(sourcePlan),driverSha256:hash('tools/ai-gnn/research-informed-teacher-pilot.mjs'),provenance,baseline:plan.baseline});
function random(seed){let state=seed>>>0||1;return()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;};}
const manifest=[7,9,11].flatMap(size=>Array.from({length:2},(_,pair)=>{const rand=random(fnv1a(plan.seed+'|plane'+size+'|'+pair+'|opening')),g=new Game(createTopology('plane',size),6.5),moves=[];for(let k=0;k<4;k++){const legal=Array.from(g.board,(_,p)=>p).filter(p=>g.analyze(p).ok),move=legal[rand()%legal.length];assert.ok(g.play(move).ok);moves.push(move);}return{size,pair,moves};}));
save('openings.json',{seed:plan.seed,pairs:manifest});
const engine=createKataGoAnalysis({exe:provenance.engine.path,model:provenance.model.path,config:dir+'/analysis.cfg',log:dir+'/engine-log.txt',overrides:['forDeterministicTesting=true']});
const inference=await createNodeInference('dist/models/v3'),bytes=readFileSync('dist/ai-v3.wasm');
try{
 const begin=performance.now();await engine.query(analysisPosition(new Game(createTopology('plane',7),6.5)),{maxVisits:8});const startupSeconds=(performance.now()-begin)/1000;
 const roots=[7,9,11].flatMap(size=>[[],[1,0,size]].map(moves=>{const g=new Game(createTopology('plane',size),6.5);for(const m of moves)assert.ok(g.play(m).ok);return g;}));
 const start=performance.now(),answers=await Promise.all(roots.map(g=>engine.query(analysisPosition(g),{maxVisits:512,includePolicy:true}))),seconds=(performance.now()-start)/1000;
 answers.forEach((r,i)=>{analysisPolicy(r,roots[i]);assert.ok(r.rootInfo.visits>=512);});
 const timing={startupSeconds,seconds,secondsPerRoot:seconds/6,visits:512,roots:6,passes:seconds/6<=plan.timing.fullCollectionMaxSecondsPerRoot};save('results/timing.json',timing);console.log('Timing',JSON.stringify(timing));
 if(!timing.passes){save('results/decision.json',{adopted:false,proceedToNewData:false,reason:'Teacher cost failed pre-registered pilot gate',timing});}
 else{
  const tasks=manifest.flatMap(pair=>[1,2].map(teacherColour=>({...pair,teacherColour})));let next=0;
  await Promise.all(Array.from({length:3},async()=>{while(next<tasks.length){
   const spec=tasks[next++],g=new Game(createTopology('plane',spec.size),6.5),search=await createV3Search({load:async()=>bytes}),adjacency=adjacencyFor(g.topology),turns=[];
   try{for(const move of spec.moves)assert.ok(g.play(move).ok);
    while(!g.ended&&g.moves<6*g.board.length){
     const seed=fnv1a(plan.seed+'|plane'+spec.size+'|'+spec.pair+'|'+g.moves);
     search.start(aiPosition(g),{seed,fpu:1,tactics:true});
     const [baseline,answer]=await Promise.all([runTrainingSearch(search,inference,adjacency,{visits:64}),engine.query(analysisPosition(g),{maxVisits:512,includePolicy:true,analysisPVLen:1})]);
     const policy=analysisPolicy(answer,g),teacherMove=policy.reduce((best,v,i)=>v>policy[best]?i:best,0),teacherTurn=g.turn===spec.teacherColour,move=teacherTurn?(teacherMove===160?null:teacherMove):baseline.move;
     turns.push({ply:g.moves,teacherTurn,move,simulations:baseline.simulations,reason:baseline.decisionReason,teacherVisits:answer.rootInfo.visits,teacherBest:teacherMove,teacherRoot:answer.rootInfo,rootPriors:baseline.diagnostics.rootPriors,rootQ:baseline.diagnostics.rootQ,rawVisits:baseline.diagnostics.rawVisits});
     assert.ok(baseline.provenLoss||baseline.simulations===64);assert.ok((move===null?g.pass():g.play(move)).ok);
    }
    const score=g.score(),teacherScore=score.winner===0?.5:score.winner===spec.teacherColour?1:0;
    const result={spec:{kind:'plane',komi:6.5,...spec},ended:g.ended,capped:!g.ended,teacherScore,score,moves:g.history.slice(1).map(s=>s.lastMove??-1),turns,excludedFromLearning:true};
    const path='results/game-plane'+spec.size+'-'+spec.pair+'-'+spec.teacherColour+'.json.gz';writeFileSync(dir+'/'+path,gzipSync(JSON.stringify(result)+'\n'));
    console.log('Pilot plane'+spec.size,'pair',spec.pair,'teacherColour',spec.teacherColour,'score',teacherScore,'moves',g.moves);
   }finally{search.dispose();}
  }}));
  const {gunzipSync}=await import('node:zlib');
  const games=tasks.map(s=>JSON.parse(gunzipSync(readFileSync(dir+'/results/game-plane'+s.size+'-'+s.pair+'-'+s.teacherColour+'.json.gz'))));
  const boards=[7,9,11].map(size=>{const rows=games.filter(r=>r.spec.size===size);return{size,games:rows.length,teacherScore:rows.reduce((s,r)=>s+r.teacherScore,0),scoreRate:rows.reduce((s,r)=>s+r.teacherScore,0)/rows.length};});
  const scoreRate=games.reduce((s,r)=>s+r.teacherScore,0)/games.length,passes=scoreRate>=.75&&boards.every(b=>b.scoreRate>=.5)&&games.every(g=>g.ended);
  const queries=games.reduce((s,r)=>s+r.turns.length,0);assert.ok(queries<=plan.screen.maximumRootQueries);
  save('results/screen.json',{games:games.length,scoreRate,boards,passes,capped:games.filter(g=>!g.ended).length,teacherQueries:queries,baselineVisits:64,teacherVisits:512});
  save('results/decision.json',{adopted:false,proceedToNewData:passes,reason:passes?'Teacher timing/strength pilot passed; separate full NewData registration required.':'Teacher-strength gate failed; do not collect training data with this recipe.',timing,scoreRate,boards,screenGamesExcludedFromLearning:true});
  console.log('Pilot decision',JSON.stringify({passes,scoreRate,boards}));
 }
}finally{await engine.dispose();await inference.dispose();}
