import {Game,createTopology} from '../../dist/engine.js';
import {aiPosition} from '../../dist/ai-position.js';
import {createV3Search} from '../../dist/ai-v3-search.js';
import {createV3Inference,adjacencyFor} from '../../dist/ai-v3-inference.js';
import {createPooledV3Inference} from './pooled-inference.mjs';
import {createRandom,exploreRoot,sampleVisits} from './selfplay-policy.mjs';
import {runTrainingSearch,trainingTarget} from './training-search.mjs';
import {fnv1a,invariant,finishGame,validateSavedGame,assertSameFeatures} from './selfplay-records.mjs';
let sequence=0;const acknowledgements=new Map();
function emit(event){return new Promise((resolve,reject)=>{const id=++sequence;acknowledgements.set(id,{resolve,reject});self.postMessage({kind:'event',id,event});});}
async function context(config,mode=config.mode){
 if(mode==='pooled'){
  const pool=await createPooledV3Inference({manifestURL:config.manifestURL,capacity:64,maxRequest:8}),probe=pool.createClient(),manifest=probe.manifest;await probe.dispose();
  return{manifest,client:()=>pool.createClient(),stats:()=>pool.stats,dispose:()=>pool.dispose()};
 }
 invariant(mode==='serial','Invalid inference mode');const inference=await createV3Inference({manifestURL:config.manifestURL,backend:'webgpu',batchSize:8});invariant(inference.backend==='webgpu'&&inference.runtime==='wgsl','Dedicated WGSL required');
 return{manifest:inference.manifest,client:()=>({manifest:inference.manifest,backend:'webgpu',batchSize:8,evaluate:(...args)=>inference.evaluate(...args),async dispose(){}}),stats:()=>null,dispose:()=>inference.dispose()};
}
async function wasm(config,key){const r=await fetch(config.base+'/study-wasm/'+key);invariant(r.ok,'Missing '+key+' WASM');return r.arrayBuffer();}
async function searchRoot(search,inference,position,adjacency,{seed,visits,noise=false,random}){
 search.start(position,{seed,fpu:1,rootNoise:noise});let rootWdlLogits;
 try{
  const result=await runTrainingSearch(search,inference,adjacency,{visits,mode:'halving',onRoot:(evaluation,batch)=>{rootWdlLogits=Array.from(evaluation.wdl.subarray(0,3));if(noise)exploreRoot(evaluation.policy,batch.legal,random);}});
  invariant(result.root&&rootWdlLogits,'Missing root evaluation');return{...result,rootWdlLogits};
 }finally{search.cancel();}
}
function sample(result,game,searchSeed,noise,config,modelHash){
 const target=trainingTarget(result.policy,result.prior),n=game.board.length;
 return{x:Array.from(result.root.x.subarray(0,n*32)),global:Array.from(result.root.global_features),legal:Array.from(result.root.legal,Boolean),policy:target.policy,validationPolicy:Array.from(result.policy),policySurprise:target.policySurprise,priorMix:.25,policyOrigin:'halving-selfplay',source:'selfplay',turn:game.turn,ply:game.moves,visits:result.simulations,requestedVisits:config.visits,policyEligible:!result.provenLoss,decisionReason:result.decisionReason,generatorModelHash:modelHash,generatorFormat:'v3-wgsl',searchHash:config.wasmHash,searchSeed,rootNoiseApplied:noise,searchConfig:{mode:'halving',fpu:1,tactics:true,endgame:true,puct:1.5},searchDiagnostics:result.diagnostics,rootWdlLogits:result.rootWdlLogits};
}
async function selfplay(config){
 invariant(Number.isInteger(config.concurrency)&&config.concurrency>=1&&config.concurrency<=8,'Invalid game concurrency');invariant(config.mode!=='serial'||config.concurrency===1,'Serial mode requires concurrency1');
 const ctx=await context(config),bytes=await wasm(config,'teacher'),games=[],totals={positions:0,capped:0,completed:0};
 try{
  for(const board of config.boards){const specs=config.games.filter(s=>s.kind===board.kind&&s.size===board.size),topology=createTopology(board.kind,board.size),adjacency=adjacencyFor(topology);
   for(let start=0;start<specs.length;start+=config.concurrency){
    const actors=await Promise.all(specs.slice(start,start+config.concurrency).map(async spec=>({spec,search:await createV3Search({load:async()=>bytes}),inference:ctx.client()})));
    const results=await Promise.all(actors.map(async({spec,search,inference})=>{
     const game=new Game(topology,spec.komi),random=createRandom(spec.seed),samples=[];let actualVisits=0,proofLosses=0;
     try{
      while(!game.ended&&game.moves<game.board.length*20){
       const searchSeed=(random()*4294967296)>>>0,noise=game.moves<Math.min(24,game.board.length/2),result=await searchRoot(search,inference,aiPosition(game),adjacency,{seed:searchSeed,visits:config.visits,noise,random});
       const row=sample(result,game,searchSeed,noise,config,ctx.manifest.sha256),temperature=game.moves<Math.min(18,game.board.length/3)?1:game.moves<game.board.length/2?.25:0,action=sampleVisits(result.policy,random,temperature);
       row.action=row.playedAction=action;samples.push(row);actualVisits+=result.simulations;if(result.provenLoss)proofLosses++;invariant((action===160?game.pass():game.play(action)).ok,'Illegal selfplay move');
      }
      const score=game.score(),saved={schemaVersion:1,spec,ended:game.ended,moves:game.history.slice(1).map(s=>s.lastMove??-1),margin:score.black-score.white,winner:score.winner,requestedVisits:config.visits,actualVisits,proofLosses},records=game.ended?finishGame(game,samples,spec):[];
      if(game.ended)validateSavedGame(saved,records);await emit({kind:'progress',message:'Finished '+spec.gameId,ended:game.ended,plies:game.moves});return{saved,records};
     }finally{search.dispose();await inference.dispose();}
    }));
    for(const {saved,records}of results){games.push({gameId:saved.spec.gameId,board:saved.spec.key,ended:saved.ended,plies:saved.moves.length,actualVisits:saved.actualVisits});if(saved.ended){totals.completed++;totals.positions+=records.length;}else totals.capped++;await emit({kind:'game',game:saved,records});}
    if(totals.capped)return{schemaVersion:1,operation:'selfplay',mode:config.mode,visits:config.visits,model:ctx.manifest.sha256,plannedGames:config.games.length,...totals,games,pooling:ctx.stats(),passes:false};
   }
  }
  return{schemaVersion:1,operation:'selfplay',mode:config.mode,visits:config.visits,model:ctx.manifest.sha256,plannedGames:config.games.length,...totals,games,pooling:ctx.stats(),passes:totals.completed===config.games.length&&totals.capped===0};
 }finally{await ctx.dispose();}
}
function comparable(r){return{move:r.move,policy:Array.from(r.policy),prior:r.prior,visits:r.simulations,provenLoss:r.provenLoss,decisionReason:r.decisionReason,diagnostics:r.diagnostics,rootWdlLogits:r.rootWdlLogits,x:Array.from(r.root.x),global:Array.from(r.root.global_features),legal:Array.from(r.root.legal)};}
async function verify(config){
 const ordinary=await context(config,'serial'),pool=await context(config,'pooled'),rows=[];
 try{for(const recipe of config.recipes){const bytes=await wasm(config,recipe.name);
  for(const board of config.boards){
   const topology=createTopology(board.kind,board.size),game=new Game(topology,6.5),positions=[aiPosition(game)],adjacency=adjacencyFor(topology);
   for(let i=0;i<8;i++){const legal=Array.from(game.board,(_,p)=>p).filter(p=>game.analyze(p).ok);invariant(game.play(legal[(i*17+3)%legal.length]).ok,'Verification setup');}positions.push(aiPosition(game));
   const reference=await createV3Search({load:async()=>bytes}),client=ordinary.client(),expected=[];
   try{for(const position of positions)expected.push(comparable(await searchRoot(reference,client,position,adjacency,{seed:18,visits:recipe.visits})));}finally{reference.dispose();await client.dispose();}
   const actors=await Promise.all(positions.map(async()=>({search:await createV3Search({load:async()=>bytes}),client:pool.client()})));
   try{const actual=await Promise.all(actors.map((a,i)=>searchRoot(a.search,a.client,positions[i],adjacency,{seed:18,visits:recipe.visits})));actual.forEach((r,i)=>invariant(JSON.stringify(comparable(r))===JSON.stringify(expected[i]),'Pooled search differs: '+recipe.name+' '+board.key));}finally{for(const a of actors){a.search.dispose();await a.client.dispose();}}
   rows.push({recipe:recipe.name,board:board.key,visits:recipe.visits,positions:positions.length,bitIdentical:true});await emit({kind:'progress',message:'Verified '+recipe.name+' '+board.key+' '+recipe.visits});
  }
 }
 return{schemaVersion:1,operation:'verify',allBitIdentical:true,rows,pooling:pool.stats()};
 }finally{await ordinary.dispose();await pool.dispose();}
}
async function reanalyze(config){
 const ctx=await context(config),loaded=Object.fromEntries(await Promise.all(config.recipes.map(async r=>[r.name,await wasm(config,r.name)]))),actors=[];let positions=0,eligiblePositions=0,completedGames=0;
 try{
  for(let i=0;i<config.concurrency;i++)actors.push(await Promise.all(config.recipes.map(async recipe=>({recipe,search:await createV3Search({load:async()=>loaded[recipe.name]}),client:ctx.client()}))));
  for(const input of config.games){
   validateSavedGame(input.game,input.rows);const spec=input.game.spec,game=new Game(createTopology(spec.kind,spec.size),spec.komi),adjacency=adjacencyFor(game.topology);
   for(let start=0;start<input.rows.length;start+=config.concurrency){
    const batch=[];
    for(const row of input.rows.slice(start,start+config.concurrency)){invariant(row.ply===game.moves,'Reanalysis ply mismatch');batch.push({row,position:aiPosition(game),seed:fnv1a(`${config.seed}|${spec.gameId}|${row.ply}`)});const action=row.playedAction??row.action;invariant((action===160?game.pass():game.play(action)).ok,'Illegal reanalysis move');}
    const pairs=await Promise.all(batch.map(async(item,index)=>{
     let results;if(config.mode==='serial'){results=[];for(const a of actors[index])results.push(await searchRoot(a.search,a.client,item.position,adjacency,{seed:item.seed,visits:a.recipe.visits}));}else results=await Promise.all(actors[index].map(a=>searchRoot(a.search,a.client,item.position,adjacency,{seed:item.seed,visits:a.recipe.visits})));
     for(const r of results)assertSameFeatures(item.row,r.root,game.board.length);
     invariant(JSON.stringify(results[0].prior)===JSON.stringify(results[1].prior)&&JSON.stringify(results[0].rootWdlLogits)===JSON.stringify(results[1].rootWdlLogits),'Different base NN roots');
     const targets=results.map(r=>trainingTarget(r.policy,r.prior)),eligible=results.every(r=>!r.provenLoss),reason=!eligible?'certified-loss':results.some(r=>r.avoidedInvasions)?'tactics-pruned':'normal';
     if(eligible)eligiblePositions++;
     return results.map((r,i)=>({...item.row,policy:targets[i].policy,validationPolicy:targets[1].policy,policyEligible:eligible,decisionReason:reason,originDecisionReason:item.row.decisionReason,originRootNoiseApplied:item.row.rootNoiseApplied,rootNoiseApplied:false,policySurprise:targets[i].policySurprise,policyOrigin:'paired-halving-'+config.recipes[i].visits,searchHash:config.recipes[i].wasmHash,searchSeed:item.seed,visits:r.simulations,requestedVisits:config.recipes[i].visits,searchDiagnostics:r.diagnostics,rootWdlLogits:r.rootWdlLogits,targetSearch:{model:ctx.manifest.sha256,wasm:config.recipes[i].wasmHash,seed:item.seed,noise:false,requestedVisits:config.recipes[i].visits,completedVisits:r.simulations,decisionReason:r.decisionReason,provenLoss:r.provenLoss,policy:Array.from(r.policy),prior:r.prior,diagnostics:r.diagnostics,rootWdlLogits:r.rootWdlLogits}}));
    }));
    await emit({kind:'pairedRows',arms:Object.fromEntries(config.recipes.map((r,i)=>[r.name,pairs.map(pair=>pair[i])]))});positions+=pairs.length;
   }
   invariant(game.ended,'Reanalysis did not finish game');completedGames++;await emit({kind:'progress',message:'Reanalyzed '+completedGames+'/'+config.games.length+' '+spec.gameId,positions});
  }
  return{schemaVersion:1,operation:'reanalyze',positions,eligiblePositions,completedGames,recipes:config.recipes,mode:config.mode,pooling:ctx.stats(),passes:completedGames===config.games.length};
 }finally{for(const pair of actors)for(const a of pair){a.search.dispose();await a.client.dispose();}await ctx.dispose();}
}
self.onmessage=async event=>{
 if(Object.hasOwn(event.data,'ack')){acknowledgements.get(event.data.ack)?.resolve();acknowledgements.delete(event.data.ack);return;}
 try{const config=event.data.config;invariant(config,'Missing worker config');const report=await({selfplay,verify,reanalyze}[config.operation])(config);self.postMessage({kind:'done',report});}catch(error){self.postMessage({kind:'error',error:error.stack??String(error)});}
};
