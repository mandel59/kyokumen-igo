import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {Game,createTopology} from '../../dist/engine.js';
const dir='tools/ai-gnn/target/topology-routing-study-20261029',phase=process.argv[2]??'development',plan=JSON.parse(readFileSync(dir+'/plan.json'));
const seed=plan.seeds[phase],hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
function fnv(text){let h=2166136261;for(const c of text){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0||1;}
const registration=JSON.parse(readFileSync(dir+'/results/'+phase+'-registration.json'));
assert.equal(hash('tools/ai-gnn/topology-routing-matches.mjs'),registration.driver);assert.equal(hash(dir+'/plan.json'),registration.plan);
const opening=JSON.parse(readFileSync(dir+'/results/'+phase+'-openings-'+seed+'.json'));
const names=readdirSync(dir+'/results').filter(n=>n.startsWith(phase+'-')&&n.endsWith('.json')&&!n.includes('trace'));
let games=0,turns=0,capped=0;const rows=[];
for(const name of names){
 const r=JSON.parse(readFileSync(dir+'/results/'+name));if(!r.board||!r.games)continue;assert.equal(r.status,'complete');assert.equal(r.provenance.driver,registration.driver);
 const trace=gunzipSync(readFileSync(dir+'/results/'+name+'.trace.jsonl.gz')).toString().trim().split('\n').filter(Boolean).map(JSON.parse);
 const expectedModel=plan.models[r.board.kind==='plane'?'plane':'curves'].sha256;assert.equal(r.provenance.bundleManifest,hash(dir+'/'+r.id+'-model/manifest.json'));assert.equal(r.provenance.aModel,expectedModel);assert.equal(r.provenance.bModel,plan.baseline.modelSha256);assert.equal(r.provenance.wasm,plan.baseline.wasmSha256);
 const pairScores=[];
 for(const saved of r.games){
  const g=new Game(createTopology(r.board.kind,r.board.size),6.5),tt=trace.filter(t=>t.pair===saved.pair&&t.aColor===saved.aColor),op=opening.boards.find(b=>b.key===r.board.key).pairs[saved.pair];
  assert.deepEqual(saved.moves.slice(0,4),op.moves);assert.equal(tt.length,saved.moves.length-4);
  for(let ply=0;ply<saved.moves.length;ply++){
   if(ply>=4){
    const t=tt[ply-4];assert.equal(t.ply,ply);assert.equal(t.side,g.turn===saved.aColor?'a':'b');assert.equal(t.searchSeed,fnv(seed+'|'+r.board.key+'|'+saved.pair+'|'+ply));assert.equal(t.move??-1,saved.moves[ply]);
    assert.ok(t.simulations===64||t.reason==='certified-loss');assert.equal(t.rootVisits,t.simulations);
    assert.ok(t.rawVisits.every(v=>Number.isInteger(v)&&v>=0));assert.ok(t.rawVisits.reduce((a,b)=>a+b,0)<=t.simulations-1);
    assert.ok(t.rootQ.every(Number.isFinite)&&t.rootPriors.every(v=>Number.isFinite(v)&&v>=0));turns++;
   }
   assert.ok((saved.moves[ply]<0?g.pass():g.play(saved.moves[ply])).ok);
  }
  assert.equal(saved.ended,g.ended);assert.deepEqual(saved.score,g.score());
  assert.equal(saved.aScore,g.score().winner===0?.5:g.score().winner===saved.aColor?1:0);
  if(!g.ended){assert.equal(g.moves,6*g.board.length);capped++;}
  pairScores[saved.pair]=(pairScores[saved.pair]??0)+saved.aScore/2;games++;
 }
 assert.deepEqual(r.pairScores,pairScores);rows.push({file:name,id:r.id,board:r.board.key,games:r.games.length,turns:trace.length});
}
const expectedGames=phase==='development'?72:432;assert.equal(games,expectedGames);
assert.equal(hash(plan.baseline.model),plan.baseline.modelSha256);assert.equal(hash(plan.baseline.wasm),plan.baseline.wasmSha256);
const result={passed:true,phase,games,turns,capped,allMovesAndScoresReplayed:true,allActorsAndSeedsVerified:true,rootBudgetCountersVerified:true,childVisitAccounting:'Exact proven-root backups may bypass child edges',productionUnchanged:true,rows};
writeFileSync(dir+'/results/'+phase+'-replay-audit.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:true,phase,games,turns,capped}));
