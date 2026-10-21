// Generate MCTS visit-distribution targets using the exported model, without a browser.
import {createWriteStream,readFileSync} from 'node:fs';
import {once} from 'node:events';
import {createTopology,Game} from '../../dist/engine.js';
import {aiPosition} from '../../dist/ai-position.js';
import {createV3Search} from '../../dist/ai-v3-search.js';
import {adjacencyFor} from '../../dist/ai-v3-inference.js';
import {createNodeInference} from './node-inference.mjs';
const args=process.argv.slice(2),value=(flag,fallback)=>args.includes(flag)?args[args.indexOf(flag)+1]:fallback;
const games=Number(value('--games','2')),simulations=Number(value('--simulations','64')),seed=Number(value('--seed','20261022'));
if(!Number.isInteger(games)||games<1||!Number.isInteger(simulations)||simulations<2||!Number.isInteger(seed))throw new Error('Invalid selfplay options');
let state=seed>>>0;const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};
if(!state)state=1;
const inference=await createNodeInference(value('--model','tools/ai-gnn/target/model'));
const search=await createV3Search({load:async()=>readFileSync(new URL('../../dist/ai-v3.wasm',import.meta.url))});
const out=createWriteStream(value('--output','tools/ai-gnn/target/selfplay.jsonl'));
let written=0,capped=0;
try{
 for(const [kind,size] of [['sphere',3],['sphere',4],['sphere',5],['torus',7],['torus',9],['torus',11]]){
  if(value('--board','all')!=='all'&&value('--board','all')!==kind+size)continue;
  const topology=createTopology(kind,size),adjacency=adjacencyFor(topology);
  for(let k=0;k<games;k++){
   const game=new Game(topology,[0,3.5,6.5,9.5][k%4]),samples=[];
   while(!game.ended&&game.moves<game.board.length*20){
    search.start(aiPosition(game),{seed:(random()*4294967296)>>>0});
    let root;
    while(search.result().simulations<simulations){
     const batch=search.collect(8);
     if(!root&&batch.count)root=batch;
     if(!batch.count)continue;
     const evaluation=await inference.evaluate(batch,adjacency);
     if(game.moves<12&&search.result().simulations===0){
      // Seeded exploration noise on root priors during data generation only.
      for(let p=0;p<161;p++)if(batch.legal[p])evaluation.policy[p]+=0.5*(-Math.log(Math.max(1e-12,random()))-1);
     }
     search.submit(batch,evaluation);
    }
    const result=search.result();let move=result.move;
    if(game.moves<12){
     const draw=random();let cumulative=0;
     for(let p=0;p<161;p++){cumulative+=result.policy[p];if(draw<cumulative){move=p===160?null:p;break;}}
    }
    samples.push({x:Array.from(root.x.subarray(0,game.board.length*32)),global:Array.from(root.global_features),
     legal:Array.from(root.legal,Boolean),policy:Array.from(result.policy),turn:game.turn});
    if(!(move===null?game.pass():game.play(move)).ok)throw new Error('Illegal MCTS move');
   }
   if(!game.ended){capped++;continue;}
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
     kind,size,...features,wdl:score.winner===0?1:score.winner===turn?0:2,
     score:(score.black-score.white)*(turn===1?1:-1),ownership:owners.map(s=>s===0?1:s===turn?0:2)};
    if(!out.write(JSON.stringify(record)+'\n'))await once(out,'drain');written++;
   }
   console.log(kind,size,k+1,game.moves,'moves');
  }
 }
}finally{search.dispose();await inference.dispose();out.end();await once(out,'finish');}
console.log(JSON.stringify({positions:written,capped,seed,model:inference.manifest.sha256}));
