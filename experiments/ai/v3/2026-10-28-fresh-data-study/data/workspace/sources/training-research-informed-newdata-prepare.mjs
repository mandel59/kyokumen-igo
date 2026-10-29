// Replay every fresh root before allowing any training.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {Game,createTopology} from '../../dist/engine.js';
import {aiPosition} from '../../dist/ai-position.js';
import {createV3Search} from '../../dist/ai-v3-search.js';
import {finalOwners,assertSameFeatures} from './selfplay-records.mjs';
import {rowWriter} from './browser-data-host.mjs';
const dir='tools/ai-gnn/target/fresh-data-study-20261028',plan=JSON.parse(readFileSync(dir+'/plan.json')),spec=JSON.parse(readFileSync(dir+'/spec.json'));
assert.equal(JSON.parse(readFileSync(dir+'/results/generation.json')).passed,true);
for(const f of ['fresh-all.jsonl.gz','fresh-validation.jsonl.gz','split.json','results/data-audit.json'])if(existsSync(dir+'/'+f))throw Error('Prepared output exists: '+f);
const pinned=JSON.parse(readFileSync(dir+'/baseline/manifest.json')),bytes=readFileSync(dir+'/search.wasm'),encoder=await createV3Search({load:async()=>bytes});
const writers={all:rowWriter(dir+'/fresh-all.jsonl.gz'),validation:rowWriter(dir+'/fresh-validation.jsonl.gz')};
let rows=0,validationRows=0,trainingRows=0,totalTeacherVisits=0;const origins=new Map(),reports=[];
try{
 for(const s of spec.games){
  const saved=JSON.parse(gunzipSync(readFileSync(dir+'/generate/plane'+s.size+'-'+s.index+'.json.gz')));assert.deepEqual(saved.spec,s);assert.ok(saved.ended);
  const g=new Game(createTopology('plane',s.size),6.5),byPly=new Map(saved.rows.map(r=>[r.ply,r]));assert.equal(saved.rows.length,saved.moves.length-s.prefix.length);
  for(let ply=0;ply<saved.moves.length;ply++){
   if(ply<s.prefix.length)assert.equal(saved.moves[ply],s.prefix[ply]);
   else{
    const r=byPly.get(ply);assert.ok(r);assert.equal(r.gameId,s.gameId);assert.equal(r.originGameId,s.originGameId);assert.equal(r.toPlay,g.turn);assert.equal(r.replayGeneration,1);
    encoder.start(aiPosition(g),{fpu:1});const root=encoder.collect(1,1);assert.equal(root.count,1);assertSameFeatures(r,root,g.board.length);
    assert.equal(r.playedAction,saved.moves[ply]<0?160:saved.moves[ply]);
    for(const p of ['policy','validationPolicy']){assert.equal(r[p].length,161);assert.ok(r[p].every((v,i)=>Number.isFinite(v)&&v>=0&&(r.legal[i]||v===0)));assert.ok(Math.abs(r[p].reduce((a,b)=>a+b,0)-1)<1e-5);}
    assert.deepEqual(r.policy,r.validationPolicy);assert.equal(r.targetSearch.completedVisits,512);totalTeacherVisits+=r.targetSearch.completedVisits;
   }
   assert.ok((saved.moves[ply]<0?g.pass():g.play(saved.moves[ply])).ok);
  }
  assert.ok(g.ended);assert.equal(saved.margin,g.score().black-g.score().white);const score=g.score(),owners=finalOwners(g);
  for(const r of saved.rows){
   assert.equal(r.wdl,score.winner===0?1:score.winner===r.toPlay?0:2);
   assert.equal(r.score,(score.black-score.white)*(r.toPlay===1?1:-1));
   assert.deepEqual(r.ownership,owners.map(v=>v===0?1:v===r.toPlay?0:2));
  }
  if(s.branch)assert.ok((s.validation?pinned.validationGames:pinned.trainGames).includes(s.originGameId));
  const partition=s.validation?'validation':'train';
  if(origins.has(s.originGameId))assert.equal(origins.get(s.originGameId),partition);else origins.set(s.originGameId,partition);
  (s.validation?pinned.validationGames:pinned.trainGames).push(s.gameId);
  await writers.all.write(saved.rows);rows+=saved.rows.length;
  if(s.validation){await writers.validation.write(saved.rows);validationRows+=saved.rows.length;}else trainingRows+=saved.rows.length;
  reports.push({game:s.gameId,origin:s.originGameId,partition,branch:s.branch,prefix:s.prefix.length,rows:saved.rows.length,moves:saved.moves.length,replayed:true});
 }
 assert.ok(totalTeacherVisits<=plan.data.maximumTeacherVisits);assert.ok(!pinned.trainGames.some(id=>pinned.validationGames.includes(id)));
}finally{encoder.dispose();await Promise.all(Object.values(writers).map(w=>w.close()));}
writeFileSync(dir+'/split.json',JSON.stringify(pinned,null,2)+'\n');
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const result={passed:true,games:reports.length,rows,trainingRows,validationRows,totalTeacherVisits,originSplitOverlap:0,allRootFeaturesReplayed:true,allLabelsVerified:true,reports,files:Object.fromEntries(['fresh-all.jsonl.gz','fresh-validation.jsonl.gz','split.json'].map(p=>[p,hash(dir+'/'+p)])),driver:hash('tools/ai-gnn/research-informed-newdata-prepare.mjs')};
writeFileSync(dir+'/results/data-audit.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:true,games:reports.length,rows,trainingRows,validationRows,totalTeacherVisits}));
