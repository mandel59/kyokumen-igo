// Audit the frozen v2 labels against the v3 rule mask; never modifies study labels.
import assert from 'node:assert/strict';
import {createReadStream,readFileSync,writeFileSync} from 'node:fs';
import {createGunzip} from 'node:zlib';
import {createInterface} from 'node:readline';
import {Game,createTopology} from '../../dist/engine.js';
import {aiPosition} from '../../dist/ai-position.js';
import {createV3Search} from '../../dist/ai-v3-search.js';
const data='experiments/ai/v3/2026-10-22-learning-revision/data';
const search=await createV3Search({load:async()=>readFileSync('dist/ai-v3.wasm')});
const report={schemaVersion:1,role:'Rule-mask audit before candidate training',normalTargets:0,blockedTargets:0,certifiedExcluded:0,groups:{},examples:[],blockedPositionIds:[]};
let game,id;
try{
 for await(const line of createInterface({input:createReadStream(data+'/teacher-annotated.jsonl.gz').pipe(createGunzip()),crlfDelay:Infinity})){
  const r=JSON.parse(line),n=r.x.length/32;
  if(id!==r.gameId){if(game)assert.equal(game.ended,true);game=new Game(createTopology(r.kind,r.size),Math.round(-r.global[0]*n*2)/2);id=r.gameId;}
  if(r.decisionReason==='certified-loss')report.certifiedExcluded++;
  else{
   search.start(aiPosition(game));const request=search.collect(1);
   assert.equal(request.count,1);
   search.submit(request,{policy:new Float32Array(161),wdl:new Float32Array(3)});
   const result=search.result();assert.equal(result.provenLoss,false);
   const blocked=result.policy[r.action]===0;
   report.normalTargets++;if(blocked)report.blockedTargets++;
   const phase=r.ply<n/2?'opening':r.ply<n?'middle':'late',key=r.kind+r.size+'/'+phase;
   const group=report.groups[key]??={normalTargets:0,blockedTargets:0};group.normalTargets++;group.blockedTargets+=Number(blocked);
   if(blocked&&report.examples.length<100)report.examples.push({gameId:r.gameId,board:r.kind+r.size,ply:r.ply,action:r.action});
   if(blocked)report.blockedPositionIds.push(r.positionId);
  }
  const action=r.playedAction;assert.ok((action===160?game.pass():game.play(action)).ok);
 }
 if(game)assert.equal(game.ended,true);
}finally{search.dispose();}
report.blockedFraction=report.blockedTargets/report.normalTargets;
writeFileSync(data+'/teacher-target-audit.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({normalTargets:report.normalTargets,blockedTargets:report.blockedTargets,blockedFraction:report.blockedFraction}));
