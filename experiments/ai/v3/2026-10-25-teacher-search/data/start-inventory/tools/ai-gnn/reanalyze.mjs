// Reanalyse the same phase-stratified positions for all three teacher recipes.
import assert from 'node:assert/strict';
import {createReadStream,createWriteStream,readFileSync,writeFileSync} from 'node:fs';
import {createGunzip,createGzip} from 'node:zlib';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {Game,createTopology} from '../../dist/engine.js';
import {aiPosition} from '../../dist/ai-position.js';
import {createV3Search} from '../../dist/ai-v3-search.js';
import {adjacencyFor} from '../../dist/ai-v3-inference.js';
import {createNodeInference} from './node-inference.mjs';
import {createRandom} from './selfplay-policy.mjs';
import {runTrainingSearch,trainingTarget} from './training-search.mjs';
const args=process.argv.slice(2),arg=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const input=arg('--input'),prefix=arg('--output-prefix'),seed=Number(arg('--seed','2026102221')),fpu=Number(arg('--fpu','1')),searchMode=arg('--search-mode','halving');
const requestedRecipe=arg('--recipe','all'),recipes=requestedRecipe==='all'?[0,1,2]:[Number(requestedRecipe)];
if(!['halving','puct'].includes(searchMode))throw new Error('Invalid search mode');
if(!recipes.every(r=>[0,1,2].includes(r)))throw new Error('Invalid teacher recipe');
const validationManifest=arg('--validation-manifest'),validationIds=validationManifest?new Set(JSON.parse(readFileSync(validationManifest,'utf8')).validationGames):null;
if(!input||!prefix||!Number.isInteger(seed)||![0,1,2].includes(fpu))throw new Error('Expected --input, --output-prefix, --seed and --fpu');
const random=createRandom(seed),inference=await createNodeInference(arg('--model','dist/models/v3'));
const wasm=readFileSync('dist/ai-v3.wasm'),searchHash=createHash('sha256').update(wasm).digest('hex');
const search=await createV3Search({load:async()=>wasm});
const outputs=recipes.map(recipe=>{const file=createWriteStream(prefix+'-t'+recipe+'.jsonl.gz'),gzip=createGzip();gzip.pipe(file);return{recipe,file,gzip};});
const report={schemaVersion:1,input,seed,fpu,searchMode,recipes,teacherModel:inference.manifest.sha256,searchHash,positions:0,eligible:0,selected:0,games:0,selectedByPhase:{},excludedCertified:0,budgetPositions:{128:0,512:0}};
async function evaluate(game,visits,searchSeed){
 search.start(aiPosition(game),{seed:searchSeed,fpu,rootNoise:false});
 return runTrainingSearch(search,inference,adjacencyFor(game.topology),{visits,mode:searchMode});
}

async function family(rows){
 if(!rows.length)return;
 const first=rows[0],n=first.x.length/32,game=new Game(createTopology(first.kind,first.size),Math.round(-first.global[0]*n*2)/2),selected=new Set();
 const phases=new Map();
 for(let i=0;i<rows.length;i++){
  const r=rows[i];assert.equal(r.ply,i);assert.equal(r.source,'selfplay');
  if(r.decisionReason==='certified-loss'){report.excludedCertified++;continue;}
  const phase=r.ply<n/2?'opening':r.ply<n?'middle':'late';
  if(!phases.has(phase))phases.set(phase,[]);phases.get(phase).push(i);report.eligible++;
 }
 for(const [phase,indices]of phases){
  for(let k=indices.length-1;k>0;k--){const j=Math.floor(random()*(k+1));[indices[k],indices[j]]=[indices[j],indices[k]];}
  const count=Math.ceil(indices.length*.25);for(const i of indices.slice(0,count))selected.add(i);
  report.selectedByPhase[phase]=(report.selectedByPhase[phase]??0)+count;
 }
 for(let i=0;i<rows.length;i++){
  const r=rows[i],chosen=selected.has(i);let low,high;
  if(chosen){
   if(recipes.includes(1)){low=await evaluate(game,128,r.searchSeed);report.budgetPositions[128]++;}
   if(recipes.includes(2)||!validationIds||validationIds.has(r.gameId)){high=await evaluate(game,512,r.searchSeed);report.budgetPositions[512]++;}
   const checked=high??low;
   if(checked){
    assert.ok(!checked.provenLoss);
    assert.ok(r.x.every((v,k)=>Math.abs(v-checked.root.x[k])<2e-5),'Reanalysis root differs from stored features');
    assert.deepEqual(Array.from(checked.root.legal,Boolean),r.legal);
   }
   report.selected++;
  }
  for(const output of outputs){
   const recipe=output.recipe;
   const target=recipe===1?low:recipe===2?high:null;
   const result={...r,policyEligible:chosen,policy:chosen&&target?Array.from(target.policy):r.policy,
    ...(chosen&&high?{validationPolicy:Array.from(high.policy)}:{}),policyOrigin:recipe===0?'original-record':searchMode+'-noise-free-'+(recipe===1?128:512),
    ...(chosen?{targetSearch:{model:inference.manifest.sha256,wasm:searchHash,mode:searchMode,fpu,seed:r.searchSeed,noise:recipe===0?r.rootNoiseApplied:false,
      requestedVisits:recipe===0?r.requestedVisits:recipe===1?128:512,completedVisits:target?.simulations??r.visits,
      diagnostics:target?.diagnostics??r.searchDiagnostics}}:{})};
   if(!output.gzip.write(JSON.stringify(result)+'\n'))await once(output.gzip,'drain');
  }
  const action=r.playedAction??r.action;assert.ok((action===160?game.pass():game.play(action)).ok);report.positions++;
 }
 assert.equal(game.ended,true);report.games++;console.log('Reanalysed',first.gameId,report.selected,'selected');
}
try{
 const file=createReadStream(input),stream=input.endsWith('.gz')?file.pipe(createGunzip()):file;let group=[];
 for await(const line of createInterface({input:stream,crlfDelay:Infinity})){
  const r=JSON.parse(line);if(group.length&&r.gameId!==group[0].gameId){await family(group);group=[];}group.push(r);
 }
 await family(group);
}finally{
 search.dispose();await inference.dispose();
 await Promise.all(outputs.map(({file,gzip})=>new Promise((resolve,reject)=>{file.once('finish',resolve);file.once('error',reject);gzip.end();})));
}
writeFileSync(prefix+'-report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
