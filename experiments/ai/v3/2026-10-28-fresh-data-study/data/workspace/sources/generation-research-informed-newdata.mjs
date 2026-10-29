// Registered NewData generation; teacher pilot must pass before workspace creation.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,mkdirSync,copyFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {Game,createTopology} from '../../dist/engine.js';
import {aiPosition} from '../../dist/ai-position.js';
import {createV3Search} from '../../dist/ai-v3-search.js';
import {adjacencyFor} from '../../dist/ai-v3-inference.js';
import {createNodeInference} from './node-inference.mjs';
import {createKataGoAnalysis,analysisPosition,analysisPolicy} from './katago-analysis.mjs';
import {runTrainingSearch} from './training-search.mjs';
import {createRandom,exploreRoot,sampleVisits} from './selfplay-policy.mjs';
import {finishGame,fnv1a} from './selfplay-records.mjs';
import {readRows} from './browser-data-host.mjs';
const planPath='experiments/ai/plans/v3-fresh-data-study/plan.json',plan=JSON.parse(readFileSync(planPath)),dir=plan.workspace;
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
assert.equal(JSON.parse(readFileSync(plan.prerequisites.pilotDecision)).proceedToNewData,true,'Teacher pilot did not pass');
assert.equal(hash(plan.baseline.model),plan.baseline.modelSha256);assert.equal(hash(plan.baseline.wasm),plan.baseline.wasmSha256);assert.equal(hash(plan.legacyData),plan.legacySha256);
if(existsSync(dir))throw Error('Fresh workspace required');
mkdirSync(dir+'/results',{recursive:true});mkdirSync(dir+'/sources');mkdirSync(dir+'/baseline');mkdirSync(dir+'/generate');
copyFileSync(planPath,dir+'/plan.json');
for(const p of ['model.onnx','weights.f32','manifest.json','KataGo-NN-LICENSE.txt'])copyFileSync('dist/models/v3/'+p,dir+'/baseline/'+p);
copyFileSync('experiments/ai/v3/2026-10-27-katago-distillation/data/teacher-model/weights.pt',dir+'/baseline/weights.pt');
copyFileSync('tools/ai-gnn/target/research-informed-study-20261028/topologies.json',dir+'/topologies.json');copyFileSync(plan.baseline.wasm,dir+'/search.wasm');
copyFileSync('tools/ai-tuner/target/katago-distillation-20261027/analysis.cfg',dir+'/analysis.cfg');
for(const p of ['research-informed-newdata.mjs','katago-analysis.mjs','training-search.mjs','selfplay-policy.mjs','selfplay-records.mjs','model.py','train.py'])copyFileSync('tools/ai-gnn/'+p,dir+'/sources/generation-'+p);
const save=(name,v)=>writeFileSync(dir+'/'+name,JSON.stringify(v,null,2)+'\n');
const pinned=JSON.parse(readFileSync(dir+'/baseline/manifest.json')),legacy=await readRows(plan.legacyData),oldGames=new Map();
for(const r of legacy)if(r.kind==='plane'){if(!oldGames.has(r.gameId))oldGames.set(r.gameId,{kind:r.kind,size:r.size,rows:[]});oldGames.get(r.gameId).rows.push({ply:r.ply,action:r.playedAction??r.action});}
const specs=plan.data.boards.flatMap(size=>Array.from({length:8},(_,index)=>{
 const validation=plan.data.validationIndices.includes(index),branch=plan.data.branchIndices.includes(index),prefixPly=Math.floor(size*size/3);
 const origins=[...oldGames.entries()].filter(([id,g])=>g.size===size&&(validation?pinned.validationGames:pinned.trainGames).includes(id)&&g.rows.length>=prefixPly+8).sort(([a],[b])=>a.localeCompare(b));
 assert.ok(origins.length);const origin=branch?origins[fnv1a(plan.data.generationSeed+'|plane'+size+'|'+index+'|origin')%origins.length]:null;
 const prefix=origin?origin[1].rows.sort((a,b)=>a.ply-b.ply).slice(0,prefixPly).map(r=>r.action===160?-1:r.action):[];
 return{kind:'plane',size,key:'plane'+size,index,gameId:'v3-newdata-20261028:plane'+size+':'+index,originGameId:origin?.[0]??'v3-newdata-20261028:plane'+size+':'+index,validation,branch,prefix,mode:index<4?'katago-selfplay':'v3-selfplay',seed:fnv1a(plan.data.generationSeed+'|plane'+size+'|'+index),komi:6.5};
}));
save('spec.json',{schemaVersion:1,games:specs,legacyHash:hash(plan.legacyData)});
const provenance=JSON.parse(readFileSync(plan.teacher.provenance));assert.equal(hash(provenance.model.path),plan.teacher.modelSha256);
save('registration.json',{started:new Date().toISOString(),plan:hash(planPath),driver:hash('tools/ai-gnn/research-informed-newdata.mjs'),pilotDecision:hash(plan.prerequisites.pilotDecision),teacher:provenance,sourceHashes:Object.fromEntries(['train.py','model.py','research-informed-newdata.mjs','training-search.mjs'].map(p=>[p,hash('tools/ai-gnn/'+p)]))});
const engine=createKataGoAnalysis({exe:provenance.engine.path,model:provenance.model.path,config:dir+'/analysis.cfg',log:dir+'/generation-engine-log.txt',overrides:['forDeterministicTesting=true']});
const inference=await createNodeInference(dir+'/baseline'),bytes=readFileSync(dir+'/search.wasm');let next=0;
try{
 await Promise.all(Array.from({length:3},async()=>{while(next<specs.length){
  const spec=specs[next++],game=new Game(createTopology('plane',spec.size),6.5),search=await createV3Search({load:async()=>bytes}),random=createRandom(spec.seed),samples=[],queries=[],start=performance.now();
  try{
   for(const move of spec.prefix)assert.ok((move<0?game.pass():game.play(move)).ok);assert.ok(!game.ended);
   while(!game.ended&&game.moves<6*game.board.length){
    const searchSeed=(random()*4294967296)>>>0;search.start(aiPosition(game),{seed:searchSeed,fpu:1,tactics:true});
    const [baseline,answer]=await Promise.all([runTrainingSearch(search,inference,adjacencyFor(game.topology),{visits:64}),engine.query(analysisPosition(game),{maxVisits:512,includePolicy:true,analysisPVLen:1})]);
    assert.ok(baseline.provenLoss||baseline.simulations===64);const policy=analysisPolicy(answer,game,{uniformMix:.02});
    let sampling=Float32Array.from(spec.mode==='katago-selfplay'?policy:baseline.policy),early=game.moves<Math.min(18,game.board.length/3);
    if(early){const logits=Float32Array.from(sampling,v=>Math.log(Math.max(1e-30,v)));exploreRoot(logits,baseline.root.legal,random);sampling=Float32Array.from(logits,(v,p)=>baseline.root.legal[p]?Math.exp(v):0);}
    const action=sampleVisits(sampling,random,early?1:game.moves<game.board.length/2?.25:0),root=baseline.root;
    samples.push({source:'selfplay',replayGeneration:1,ply:game.moves,turn:game.turn,action,playedAction:action,x:Array.from(root.x.subarray(0,game.board.length*32)),global:Array.from(root.global_features),legal:Array.from(root.legal,Boolean),policy:Array.from(policy),validationPolicy:Array.from(policy),decisionReason:baseline.decisionReason,policyEligible:!baseline.provenLoss,teacherModel:plan.teacher.modelSha256,generatorModelHash:plan.baseline.modelSha256,policyOrigin:'fresh-katago512',uniformTeacherMix:.02,targetSearch:{engine:'katago',requestedVisits:512,completedVisits:answer.rootInfo.visits,provenLoss:false},searchDiagnostics:baseline.diagnostics,rootWdlLogits:baseline.rootWdlLogits,visits:baseline.simulations,requestedVisits:64,searchSeed});
    queries.push({ply:game.moves,rootInfo:answer.rootInfo,best:answer.moveInfos.find(m=>m.order===0)?.move});
    assert.ok((action===160?game.pass():game.play(action)).ok);
   }
   const score=game.score(),saved={spec,ended:game.ended,capped:!game.ended,margin:score.black-score.white,moves:game.history.slice(1).map(s=>s.lastMove??-1),seconds:(performance.now()-start)/1000,queries,rows:game.ended?finishGame(game,samples,spec).map(r=>({...r,originGameId:spec.originGameId})):[],unlabelledPositions:game.ended?0:samples.length};
   const path='generate/plane'+spec.size+'-'+spec.index+'.json.gz';writeFileSync(dir+'/'+path,gzipSync(JSON.stringify(saved)+'\n',{level:6}));
   console.log(JSON.stringify({game:spec.gameId,branch:spec.branch,validation:spec.validation,mode:spec.mode,ended:game.ended,rows:saved.rows.length,moves:game.moves,seconds:saved.seconds}));
  }finally{search.dispose();}
 }}));
 const games=specs.map(s=>JSON.parse(gunzipSync(readFileSync(dir+'/generate/plane'+s.size+'-'+s.index+'.json.gz')))),positions=games.reduce((s,g)=>s+g.queries.length,0);
 assert.ok(positions<=plan.data.maximumTeacherQueries);
 const passed=games.every(g=>g.ended),report={games:games.length,positions,teacherVisits:positions*512,passed,capped:games.filter(g=>!g.ended).length,trainGames:games.filter(g=>!g.spec.validation).length,validationGames:games.filter(g=>g.spec.validation).length};
 save('results/generation.json',report);console.log('Generation',JSON.stringify(report));if(!passed)throw Error('Registered data completion gate failed');
}finally{await engine.dispose();await inference.dispose();}
