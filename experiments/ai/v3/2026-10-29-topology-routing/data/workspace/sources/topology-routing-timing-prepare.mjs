// Freeze all timing roots before baseline-only calibration; never inspect search outputs.
import assert from 'node:assert/strict';
import{readFileSync,writeFileSync,existsSync}from'node:fs';
import{createHash}from'node:crypto';
import{Game,createTopology}from'../../dist/engine.js';
const dir='tools/ai-gnn/target/topology-routing-study-20261029',plan=JSON.parse(readFileSync(dir+'/plan.json'));
assert.ok(JSON.parse(readFileSync(dir+'/results/independent-decision.json')).passesStrength);
assert.ok(!existsSync(dir+'/results/timing-positions.json'));
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),positions=[],sources=[];
for(const key of plan.boards){
 const path=dir+'/results/development-Routed-r0-'+key+'.json',r=JSON.parse(readFileSync(path)),g=r.games.find(g=>g.pair===0&&g.aColor===1);
 const topology=createTopology(r.board.kind,r.board.size),n=topology.neighbors.length;
 for(const [phase,fraction]of[['quarter',.25],['half',.5],['three-quarters',.75]]){
  const ply=Math.min(Math.floor(n*fraction),g.moves.length-1),moves=g.moves.slice(0,ply),game=new Game(topology,6.5);
  for(const m of moves)assert.ok((m<0?game.pass():game.play(m)).ok);
  assert.equal(game.ended,false);positions.push({kind:r.board.kind,size:r.board.size,komi:6.5,moves,phase:'ordinary-'+phase,source:{file:path,pair:0,aColor:1,ply}});
 }sources.push({file:path,sha256:hash(path)});
}
const stressPath='experiments/ai/v3/2026-10-28-fresh-data-study/data/workspace/results/latency-protocol.json',old=JSON.parse(readFileSync(stressPath));
assert.equal(old.stress.length,3);positions.push(...old.stress);
const protocol={registered:new Date().toISOString(),plan:hash(dir+'/plan.json'),ordinary:27,stress:3,sources,stressSource:{file:stressPath,sha256:hash(stressPath)},rules:plan.latency};
writeFileSync(dir+'/results/timing-positions.json',JSON.stringify({schemaVersion:1,positions},null,2)+'\n');
protocol.fixturesSha256=hash(dir+'/results/timing-positions.json');
writeFileSync(dir+'/results/latency-protocol.json',JSON.stringify(protocol,null,2)+'\n');console.log(JSON.stringify({frozen:true,positions:positions.length,sha256:protocol.fixturesSha256}));
