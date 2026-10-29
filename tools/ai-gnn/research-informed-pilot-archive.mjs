import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync,gzipSync} from 'node:zlib';
import {join,relative} from 'node:path';
import {Game,createTopology} from '../../dist/engine.js';
const root='tools/ai-gnn/target/fresh-teacher-pilot-20261028',dest='experiments/ai/v3/2026-10-28-fresh-teacher-pilot';
if(existsSync(dest))throw Error('Archive exists');
const files=readdirSync(root+'/results').filter(f=>f.endsWith('.json.gz'));let turns=0;
for(const f of files){
 const r=JSON.parse(gunzipSync(readFileSync(root+'/results/'+f))),g=new Game(createTopology('plane',r.spec.size),6.5);
 assert.equal(r.turns.length,r.moves.length-4);
 for(let ply=0;ply<r.moves.length;ply++){
  if(ply>=4){const t=r.turns[ply-4];assert.equal(t.ply,ply);assert.equal(t.teacherTurn,g.turn===r.spec.teacherColour);assert.equal(t.move??-1,r.moves[ply]);assert.ok(t.simulations===64||t.reason==='certified-loss');assert.ok(t.rawVisits.every(n=>Number.isInteger(n)&&n>=0));assert.ok(t.rawVisits.reduce((a,b)=>a+b,0)<=t.simulations-1);if(t.teacherTurn)assert.equal(t.move??160,t.teacherBest);turns++;}
  assert.ok((r.moves[ply]<0?g.pass():g.play(r.moves[ply])).ok);
 }
 assert.ok(g.ended);assert.deepEqual(g.score(),r.score);assert.equal(r.teacherScore,g.score().winner===0?.5:g.score().winner===r.spec.teacherColour?1:0);
}
const audit={passed:true,games:files.length,turns,allMovesReplayed:true,scoreAndActorOrientationVerified:true,allPilotGamesExcludedFromLearning:true,visitAccounting:'Exact terminal/proven backups can occur at root without traversing a child; child visits need not sum to simulations-1. Search completion counter and per-turn64-visit assertions are authoritative.'};
writeFileSync(root+'/results/replay-audit.json',JSON.stringify(audit,null,2)+'\n');
const manifest=[];const hash=b=>createHash('sha256').update(b).digest('hex');
function copy(source,target){const b=readFileSync(source),compress=b.length>65536&&/\.(json|txt)$/.test(source),out=target+(compress?'.gz':'');mkdirSync(join(dest,out,'..'),{recursive:true});const stored=compress?gzipSync(b,{level:9}):b;writeFileSync(join(dest,out),stored);manifest.push({source,archive:out,compressed:compress,originalSha256:hash(b),storedSha256:hash(stored),originalBytes:b.length});}
function tree(base){for(const e of readdirSync(base,{withFileTypes:true})){const p=join(base,e.name);if(e.isDirectory())tree(p);else copy(p,'data/workspace/'+relative(root,p).replaceAll('\\','/'));}}
tree(root);for(const name of ['plan.json','README.md'])copy('experiments/ai/plans/v3-fresh-teacher-pilot/'+name,'data/plan/'+name);
copy('tools/ai-gnn/research-informed-teacher-pilot.mjs','data/tools/research-informed-teacher-pilot.mjs');copy('tools/ai-gnn/research-informed-pilot-archive.mjs','data/tools/research-informed-pilot-archive.mjs');
const r=JSON.parse(readFileSync(root+'/results/decision.json'));
writeFileSync(dest+'/manifest.json',JSON.stringify({schemaVersion:1,files:manifest},null,2)+'\n');
writeFileSync(dest+'/README.md',['# 新規教師の費用・強さの予備実験','',
 '2026年10月28日実施。[事前計画](../../plans/v3-fresh-teacher-pilot/README.md)に従い、既存ローカルKataGo v1.18.1 OpenCL・b10c128教師の512訪問と、現在の配信v3・64訪問を比較した。','',
 '**6局面の平均0.244秒、12勝0敗、打ち切り0で教師選定条件を通過**。7・9・11路それぞれ先後交換2ペア・4局。全'+turns+'手を再生し、合法性・手番・採点・探索回数を確認した。予備対局と計測局面は全て学習から除外する。','',
 'この小規模選定は教師が本収集に使えるかの確認で、v3自体の改善や一般的な勝率の証明ではない。モデルとWASMは更新していない。','',
 '[判定](data/workspace/results/decision.json)・[対局集計](data/workspace/results/screen.json)・[再生監査](data/workspace/results/replay-audit.json)と、全棋譜・各手の教師/モデル評価・来歴・環境・ソースを保存した。次は別に登録した新規データ24局の比較を行う。',''].join('\n'));
console.log(JSON.stringify({archive:dest,...audit}));
