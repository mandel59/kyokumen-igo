import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {Game,createTopology} from '../../dist/engine.js';
import {aiPosition} from '../../dist/ai-position.js';
import {createV3Search} from '../../dist/ai-v3-search.js';
import {assertSameFeatures,validateSavedGame} from './selfplay-records.mjs';
import {analysisPolicy} from './katago-analysis.mjs';
const directory=resolve(process.argv[2]),plan=JSON.parse(readFileSync(join(directory,'plan.json')));
if(existsSync(join(directory,'data-audit.json')))throw Error('Data already prepared');
const baseline=JSON.parse(readFileSync(join(directory,'baseline/manifest.json'))),split={trainGames:[...baseline.trainGames],validationGames:[...baseline.validationGames]};
const readRows=path=>gunzipSync(readFileSync(path)).toString().trim().split('\n').map(line=>JSON.parse(line));
const curve=readRows(plan.data.curveReplay),teacher=[...curve],control=[...curve],origins=new Set(),positions=new Set();
const search=await createV3Search({load:async()=>readFileSync(join(directory,'search.wasm'))});
let changed=0,planePositions=0;
try{
 for(const size of plan.data.boards)for(let index=0;index<plan.data.gamesPerBoard;index++){
  const saved=JSON.parse(gunzipSync(readFileSync(join(directory,'generate',`plane${size}-${String(index).padStart(2,'0')}.json.gz`))));
  assert.equal(saved.spec.size,size);assert.equal(saved.spec.index,index);assert.ok(!origins.has(saved.spec.gameId));origins.add(saved.spec.gameId);
  validateSavedGame(saved,saved.teacherRows);validateSavedGame(saved,saved.controlRows);
  split[plan.data.validationIndices.includes(index)?'validationGames':'trainGames'].push(saved.spec.gameId);
  const game=new Game(createTopology('plane',size),saved.spec.komi);
  for(let ply=0;ply<saved.moves.length;ply++){
   const left=saved.teacherRows[ply],right=saved.controlRows[ply];assert.ok(!positions.has(left.positionId));positions.add(left.positionId);
   for(const key of ['x','global','legal','wdl','score','ownership','gameId','positionId','validationPolicy','policyEligible','decisionReason','playedAction'])assert.deepEqual(left[key],right[key],key);
   search.start(aiPosition(game),{tactics:false,endgame:false});const root=search.collect(1);assert.equal(root.count,1);assertSameFeatures(left,root,size*size);search.cancel();
   assert.deepEqual(left.policy,Array.from(analysisPolicy(saved.analyses[ply],game)),'Teacher policy differs from saved search statistics');
   assert.deepEqual(left.validationPolicy,left.policy,'Common teacher validation target differs');
   for(const row of [left,right]){
    assert.equal(row.policy.length,161);assert.ok(row.policy.every((v,p)=>Number.isFinite(v)&&v>=0&&(row.legal[p]||v===0)));
    assert.ok(Math.abs(row.policy.reduce((a,b)=>a+b,0)-1)<1e-5);
   }
   changed+=Number(left.policy.some((v,p)=>v!==right.policy[p]));planePositions++;
   assert.ok((saved.moves[ply]<0?game.pass():game.play(saved.moves[ply])).ok);
  }
  teacher.push(...saved.teacherRows);control.push(...saved.controlRows);
 }
}finally{search.dispose();}
const trainIds=new Set(split.trainGames),valIds=new Set(split.validationGames);
assert.ok([...trainIds].every(id=>!valIds.has(id)));assert.equal(planePositions,positions.size);
for(const row of curve)assert.ok(trainIds.has(row.gameId)||valIds.has(row.gameId),'Unknown curve origin');
for(const [name,rows]of [['teacher',teacher],['control',control]])writeFileSync(join(directory,name+'.jsonl.gz'),gzipSync(rows.map(r=>JSON.stringify(r)).join('\n')+'\n',{level:9}));
writeFileSync(join(directory,'game-split.json'),JSON.stringify(split,null,2)+'\n');
const speed=JSON.parse(readFileSync('dist/ai-benchmark-positions.json'));
for(const size of [7,9,11]){
 const saved=JSON.parse(gunzipSync(readFileSync(join(directory,'generate',`plane${size}-03.json.gz`))));
 for(const [phase,ply]of [['opening',0],['middle',Math.floor(saved.moves.length/2)],['endgame',Math.max(0,saved.moves.length-4)]])
  speed.positions.push({kind:'plane',size,komi:6.5,phase,moves:saved.moves.slice(0,ply)});
}
writeFileSync(join(directory,'speed-positions.json'),JSON.stringify(speed,null,2)+'\n');
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const audit={schemaVersion:1,games:origins.size,planePositions,curvePositions:curve.length,positions:teacher.length,changedPolicies:changed,
 matchedFeaturesOutcomesValidation:true,replayedEveryPlaneRoot:true,reconstructedEveryTeacherPolicy:true,legalPolicies:true,trainGames:trainIds.size,validationGames:valIds.size,
 boards:[...new Set(teacher.map(r=>r.kind+r.size))],inputs:{curve:hash(plan.data.curveReplay),plan:hash(join(directory,'plan.json'))},
 outputs:Object.fromEntries(['teacher.jsonl.gz','control.jsonl.gz','game-split.json'].map(file=>[file,hash(join(directory,file))]))};
writeFileSync(join(directory,'data-audit.json'),JSON.stringify(audit,null,2)+'\n');console.log(JSON.stringify(audit));
