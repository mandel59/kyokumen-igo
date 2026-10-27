// Matched policy targets on the same legal roots and exact completed-game outcomes.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {gzipSync,gunzipSync} from 'node:zlib';
import {join,resolve} from 'node:path';
import {Game,createTopology} from '../../dist/engine.js';
import {aiPosition} from '../../dist/ai-position.js';
import {createV3Search} from '../../dist/ai-v3-search.js';
import {adjacencyFor} from '../../dist/ai-v3-inference.js';
import {createNodeInference} from './node-inference.mjs';
import {runTrainingSearch,trainingTarget} from './training-search.mjs';
import {createRandom,exploreRoot,sampleVisits} from './selfplay-policy.mjs';
import {finishGame,validateSavedGame,invariant} from './selfplay-records.mjs';
import {createKataGoAnalysis,analysisPosition,analysisPolicy} from './katago-analysis.mjs';
const args=process.argv.slice(2),directory=resolve(args[0]),phase=args[1];
if(!['screen','generate'].includes(phase))throw Error('Expected DIRECTORY screen|generate');
const provenance=JSON.parse(readFileSync(join(directory,'provenance.json'))),plan=JSON.parse(readFileSync(join(directory,'plan.json')));
const config=join(directory,phase==='generate'?'analysis-generation.cfg':'analysis.cfg');
const engine=createKataGoAnalysis({exe:provenance.engine.path,model:provenance.model.path,config,log:join(directory,phase+'-engine.log'),overrides:['forDeterministicTesting=true']});
const inference=await createNodeInference(join(directory,'baseline')),wasm=readFileSync(join(directory,'search.wasm'));
const dest=join(directory,phase);mkdirSync(dest,{recursive:true});
const jobs=[7,9,11].flatMap(size=>Array.from({length:phase==='screen'?4:32},(_,index)=>({kind:'plane',size,index,komi:6.5,
 gameId:`katago-distill-v1:${phase}:${size}:${index}`,seed:(plan.seeds[phase]+size*10000+index*1009)>>>0,
 mode:phase==='screen'?'match':index<16?'katago-selfplay':'v3-selfplay',teacherColour:index%2+1})));
let next=0,completed=0;
async function run(spec){
 const path=join(dest,`plane${spec.size}-${String(spec.index).padStart(2,'0')}.json.gz`);
 if(existsSync(path)){const saved=JSON.parse(gunzipSync(readFileSync(path)));validateSavedGame(saved,saved.teacherRows);validateSavedGame(saved,saved.controlRows);return;}
 const game=new Game(createTopology('plane',spec.size),spec.komi),search=await createV3Search({load:async()=>wasm}),adjacency=adjacencyFor(game.topology),random=createRandom(spec.seed);
 const teacherSamples=[],controlSamples=[],analyses=[],started=Date.now();
 try{
  while(!game.ended&&game.moves<game.board.length*6){
   const query=engine.query(analysisPosition(game),{maxVisits:plan.teacherVisits,includePolicy:true,analysisPVLen:1});
   search.start(aiPosition(game),{seed:(random()*4294967296)>>>0,fpu:1});
   const [baseline,analysis]=await Promise.all([runTrainingSearch(search,inference,adjacency,{visits:64}),query]);
   invariant(baseline.root?.count===1,'Missing root features');
   const policy=analysisPolicy(analysis,game),control=trainingTarget(baseline.policy,baseline.prior).policy;
   const playingTeacher=spec.mode==='katago-selfplay'||spec.mode==='match'&&game.turn===spec.teacherColour;
   let action;
   if(spec.mode==='match')action=playingTeacher?sampleVisits(policy,random,0):baseline.move??160;
   else{
    let sampling=Float32Array.from(playingTeacher?policy:baseline.policy);
    const opening=game.moves<Math.min(18,game.board.length/3);
    if(opening){
     const logits=Float32Array.from(sampling,v=>Math.log(Math.max(1e-30,v)));exploreRoot(logits,baseline.root.legal,random);
     sampling=Float32Array.from(logits,(v,p)=>baseline.root.legal[p]?Math.exp(v):0);
    }
    action=sampleVisits(sampling,random,opening?1:game.moves<game.board.length/2?.25:0);
   }
   const root=baseline.root,common={source:'selfplay',ply:game.moves,turn:game.turn,action,playedAction:action,
    x:Array.from(root.x.subarray(0,game.board.length*32)),global:Array.from(root.global_features),legal:Array.from(root.legal,Boolean),
    validationPolicy:Array.from(policy),decisionReason:baseline.decisionReason,policyEligible:!baseline.provenLoss,
    teacherModel:provenance.model.sha256,baselineModel:provenance.baseline};
   teacherSamples.push({...common,policy:Array.from(policy),targetSearch:{engine:'katago',requestedVisits:plan.teacherVisits,completedVisits:analysis.rootInfo.visits,provenLoss:false}});
   controlSamples.push({...common,policy:control,targetSearch:{engine:'v3',requestedVisits:64,completedVisits:baseline.simulations,provenLoss:baseline.provenLoss}});
   analyses.push({ply:game.moves,rootInfo:analysis.rootInfo,moveInfos:analysis.moveInfos.map(({move,visits,edgeVisits,prior,order,winrate,scoreLead,isSymmetryOf})=>({move,visits,edgeVisits,prior,order,winrate,scoreLead,isSymmetryOf}))});
   invariant((action===160?game.pass():game.play(action)).ok,'Illegal selected training move');search.cancel();
  }
  invariant(game.ended,'Game reached move cap: '+spec.gameId);
  const score=game.score(),saved={spec,ended:true,margin:score.black-score.white,moves:game.history.slice(1).map(s=>s.lastMove??-1),
   elapsedSeconds:(Date.now()-started)/1000,teacherRows:finishGame(game,teacherSamples,spec),controlRows:finishGame(game,controlSamples,spec),analyses,
   teacherScore:score.winner===0?.5:score.winner===spec.teacherColour?1:0};
  validateSavedGame(saved,saved.teacherRows);validateSavedGame(saved,saved.controlRows);
  writeFileSync(path,gzipSync(JSON.stringify(saved)+'\n',{level:6}));
  console.log(JSON.stringify({phase,board:'plane'+spec.size,index:spec.index,mode:spec.mode,moves:game.moves,seconds:saved.elapsedSeconds,teacherScore:phase==='screen'?saved.teacherScore:undefined}));
 }finally{search.dispose();}
}
try{
 await Promise.all(Array.from({length:4},async()=>{while(next<jobs.length){const spec=jobs[next++];await run(spec);completed++;}}));
 const games=jobs.map(spec=>JSON.parse(gunzipSync(readFileSync(join(dest,`plane${spec.size}-${String(spec.index).padStart(2,'0')}.json.gz`)))));
 const report={schemaVersion:1,phase,teacherVisits:plan.teacherVisits,games:completed,positions:games.reduce((s,g)=>s+g.moves.length,0),
  boards:[7,9,11].map(size=>{const rows=games.filter(g=>g.spec.size===size);return{size,games:rows.length,positions:rows.reduce((s,g)=>s+g.moves.length,0),teacherScore:rows.reduce((s,g)=>s+g.teacherScore,0)/rows.length};})};
 if(phase==='screen'){report.passes=report.boards.every(b=>b.teacherScore>=.5)&&report.boards.reduce((s,b)=>s+b.teacherScore,0)/3>=.75;}
 writeFileSync(join(directory,phase+'-report.json'),JSON.stringify(report,null,2)+'\n');
 if(phase==='generate'){
  for(const arm of ['teacher','control']){
   const rows=games.flatMap(g=>g[arm+'Rows']);writeFileSync(join(directory,arm+'-plane.jsonl.gz'),gzipSync(rows.map(r=>JSON.stringify(r)).join('\n')+'\n',{level:9}));
  }
 }
 console.log(JSON.stringify(report));
}finally{await engine.dispose();await inference.dispose();}
