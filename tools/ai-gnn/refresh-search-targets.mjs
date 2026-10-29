// Replay complete saved games and distill the currently deployed search, without using match evaluation games.
import assert from 'node:assert/strict';
import {createReadStream,createWriteStream,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createGunzip,createGzip} from 'node:zlib';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {Game,createTopology} from '../../dist/engine.js';
import {aiPosition} from '../../dist/ai-position.js';
import {createV3Search} from '../../dist/ai-v3-search.js';
import {adjacencyFor} from '../../dist/ai-v3-inference.js';
import {createTopologyNodeInference as createNodeInference} from './node-topology-inference.mjs';
import {createRandom} from './selfplay-policy.mjs';
import {runTrainingSearch,trainingTarget} from './training-search.mjs';
const args=process.argv.slice(2),arg=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const input=arg('--input'),output=arg('--output'),seed=Number(arg('--seed','2026102591')),perPhase=Number(arg('--per-phase','2'));
const visits=Number(arg('--simulations','64')),fpu=Number(arg('--fpu','1'));
if(!input||!output||existsSync(output)||existsSync(output+'.report.json')||!Number.isInteger(seed)||!Number.isInteger(perPhase)||perPhase<1||!Number.isInteger(visits)||visits<2||![0,1,2].includes(fpu))throw new Error('Invalid refresh options or existing output');
const random=createRandom(seed),inference=await createNodeInference(arg('--model','dist/models/v3'));
const wasm=readFileSync(arg('--wasm','dist/ai-v3.wasm')),searchHash=createHash('sha256').update(wasm).digest('hex');
const search=await createV3Search({load:async()=>wasm}),file=createWriteStream(output),gzip=createGzip();gzip.pipe(file);
const report={schemaVersion:1,input,inputSha256:createHash('sha256').update(readFileSync(input)).digest('hex'),seed,perPhase,visits,fpu,searchHash,model:inference.bundleManifest.sha256,modelRoutes:inference.bundleManifest.modelRoutes??null,games:0,positions:0,selected:0,excludedCertified:0,boards:{}};
async function family(rows){
 if(!rows.length)return;
 const first=rows[0],n=first.x.length/32,game=new Game(createTopology(first.kind,first.size),Math.round(-first.global[0]*n*2)/2),selected=new Set(),phases=new Map();
 await inference.setKind(first.kind);
 for(let i=0;i<rows.length;i++){
  const r=rows[i];assert.equal(r.ply,i);assert.equal(r.source,'selfplay');
  if(r.decisionReason==='certified-loss'){report.excludedCertified++;continue;}
  const phase=r.ply<n/2?'opening':r.ply<n?'middle':'late';
  if(!phases.has(phase))phases.set(phase,[]);phases.get(phase).push(i);
 }
 for(const indices of phases.values()){
  for(let k=indices.length-1;k>0;k--){const j=Math.floor(random()*(k+1));[indices[k],indices[j]]=[indices[j],indices[k]];}
  for(const i of indices.slice(0,perPhase))selected.add(i);
 }
 const board=first.kind+first.size;report.boards[board]??={games:0,positions:0,selected:0};
 for(const r of rows){
  const chosen=selected.has(r.ply);let target;
  if(chosen){
   search.start(aiPosition(game),{seed:r.searchSeed,fpu,rootNoise:false});
   const result=await runTrainingSearch(search,inference,adjacencyFor(game.topology),{visits});
   assert.ok(!result.provenLoss,'Previously normal root became certified loss');assert.ok(result.root);
   assert.ok(r.x.every((v,k)=>Math.abs(v-result.root.x[k])<2e-5),'Replayed root differs');
   assert.deepEqual(Array.from(result.root.legal,Boolean),r.legal);
   target={...trainingTarget(result.policy,result.prior),validationPolicy:Array.from(result.policy),
    policyOrigin:'halving-'+visits+'-clean-prior-mix',priorMix:.25,targetSearch:{model:inference.manifest.sha256,wasm:searchHash,mode:'halving',fpu,seed:r.searchSeed,noise:false,requestedVisits:visits,completedVisits:result.simulations,diagnostics:result.diagnostics}};
   report.selected++;report.boards[board].selected++;
  }
  const record={...r,policyEligible:chosen,policySurprise:0,...target};
  if(!gzip.write(JSON.stringify(record)+'\n'))await once(gzip,'drain');
  const action=r.playedAction??r.action;assert.ok((action===160?game.pass():game.play(action)).ok);
  report.positions++;report.boards[board].positions++;
 }
 assert.equal(game.ended,true);const score=game.score();
 for(const r of rows){const turn=r.ply%2?2:1;assert.equal(r.wdl,score.winner===0?1:score.winner===turn?0:2);assert.ok(r.score===(score.black-score.white)*(turn===1?1:-1));}
 report.games++;report.boards[board].games++;console.log('Refreshed',report.games,first.gameId,report.selected,'targets');
}
try{
 const source=createReadStream(input),stream=input.endsWith('.gz')?source.pipe(createGunzip()):source;let rows=[];
 for await(const line of createInterface({input:stream,crlfDelay:Infinity})){const r=JSON.parse(line);if(rows.length&&r.gameId!==rows[0].gameId){await family(rows);rows=[];}rows.push(r);}
 await family(rows);
}finally{search.dispose();await inference.dispose();gzip.end();await once(file,'finish');}
writeFileSync(output+'.report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
