// Generate MCTS visit-distribution targets using the exported model, without a browser.
import {createWriteStream,readFileSync,writeFileSync} from 'node:fs';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {createTopology,Game} from '../../dist/engine.js';
import {aiPosition} from '../../dist/ai-position.js';
import {createV3Search} from '../../dist/ai-v3-search.js';
import {adjacencyFor} from '../../dist/ai-v3-inference.js';
import {createNodeInference} from './node-inference.mjs';
import {createRandom,exploreRoot,sampleVisits} from './selfplay-policy.mjs';
import {runTrainingSearch,trainingTarget} from './training-search.mjs';
const args=process.argv.slice(2),value=(flag,fallback)=>args.includes(flag)?args[args.indexOf(flag)+1]:fallback;
const games=Number(value('--games','2')),simulations=Number(value('--simulations','64')),seed=Number(value('--seed','20261022'));
const fpu=Number(value('--fpu','1')),searchMode=value('--search-mode','halving');
if(!['halving','puct'].includes(searchMode))throw new Error('Invalid search mode');
if(!Number.isInteger(fpu)||fpu<0||fpu>2)throw new Error('Invalid FPU');
if(!Number.isInteger(games)||games<1||!Number.isInteger(simulations)||simulations<2||!Number.isInteger(seed))throw new Error('Invalid selfplay options');
const random=createRandom(seed);
const inference=await createNodeInference(value('--model','tools/ai-gnn/target/model'));
const wasm=readFileSync(value('--wasm','dist/ai-v3.wasm')),searchHash=createHash('sha256').update(wasm).digest('hex');
const search=await createV3Search({load:async()=>wasm});
const out=createWriteStream(value('--output','tools/ai-gnn/target/selfplay.jsonl'));
let written=0,capped=0,completedGames=0;const boardReports=[];
try{
 for(const [kind,size] of [['sphere',3],['sphere',4],['sphere',5],['torus',7],['torus',9],['torus',11]]){
  if(value('--board','all')!=='all'&&value('--board','all')!==kind+size)continue;
  const topology=createTopology(kind,size),adjacency=adjacencyFor(topology);
  const boardReport={kind,size,attempted:games,completed:0,capped:0};boardReports.push(boardReport);
  for(let k=0;k<games;k++){
   const game=new Game(topology,[0,3.5,6.5,9.5][k%4]),samples=[];
   while(!game.ended&&game.moves<game.board.length*20){
    const searchSeed=(random()*4294967296)>>>0,rootNoiseApplied=game.moves<Math.min(24,game.board.length/2);
    search.start(aiPosition(game),{seed:searchSeed,fpu,rootNoise:rootNoiseApplied});
    const result=await runTrainingSearch(search,inference,adjacency,{visits:simulations,mode:searchMode,
     onRoot:(evaluation,batch)=>{if(rootNoiseApplied)exploreRoot(evaluation.policy,batch.legal,random);}});
    const {root,prior}=result;let move=result.move;
    const target=trainingTarget(result.policy,prior);
    const temperature=game.moves<Math.min(18,game.board.length/3)?1:game.moves<game.board.length/2?.25:0;
    const action=sampleVisits(result.policy,random,temperature);move=action===160?null:action;
    samples.push({x:Array.from(root.x.subarray(0,game.board.length*32)),global:Array.from(root.global_features),
     legal:Array.from(root.legal,Boolean),policy:target.policy,policySurprise:target.policySurprise,policyOrigin:searchMode,priorMix:.25,turn:game.turn,ply:game.moves,
     action,playedAction:action,visits:result.simulations,source:'selfplay',decisionReason:result.decisionReason,
     policyEligible:!result.provenLoss,generatorModelHash:inference.manifest.sha256,searchHash,searchSeed,
     rootNoiseApplied,requestedVisits:simulations,searchConfig:{mode:searchMode,fpu,tactics:true,endgame:true,puct:1.5},searchDiagnostics:result.diagnostics});
    if(!(move===null?game.pass():game.play(move)).ok)throw new Error('Illegal MCTS move');
   }
   if(!game.ended){capped++;boardReport.capped++;continue;}
   completedGames++;boardReport.completed++;
   const score=game.score(),owners=Array.from(game.board),seen=new Set();
   for(let p=0;p<owners.length;p++)if(!owners[p]&&!seen.has(p)){
    const region=[p],border=new Set();seen.add(p);
    for(let i=0;i<region.length;i++)for(const q of topology.neighbors[region[i]]){
     if(game.board[q])border.add(game.board[q]);else if(!seen.has(q)){seen.add(q);region.push(q);}
    }
    const owner=border.size===1?[...border][0]:0;for(const q of region)owners[q]=owner;
   }
   for(const sample of samples){
    const {turn,...features}=sample;
    const record={schemaVersion:1,gameId:'selfplay-'+inference.manifest.sha256.slice(0,12)+'-'+seed+'-'+kind+size+'-'+k,
     kind,size,...features,positionId:'selfplay-'+inference.manifest.sha256.slice(0,12)+'-'+seed+'-'+kind+size+'-'+k+':'+features.ply,wdl:score.winner===0?1:score.winner===turn?0:2,
     score:(score.black-score.white)*(turn===1?1:-1),ownership:owners.map(s=>s===0?1:s===turn?0:2)};
    if(!out.write(JSON.stringify(record)+'\n'))await once(out,'drain');written++;
   }
   console.log(kind,size,k+1,game.moves,'moves');
  }
 }
}finally{search.dispose();await inference.dispose();out.end();await once(out,'finish');}
const report={schemaVersion:1,positions:written,capped,completedGames,seed,model:inference.manifest.sha256,searchHash,fpu,searchMode,boards:boardReports};
if(value('--report'))writeFileSync(value('--report'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
if(args.includes('--require-complete')&&capped)throw new Error('Selfplay hit the move cap; completed games were saved but the study must stop');
