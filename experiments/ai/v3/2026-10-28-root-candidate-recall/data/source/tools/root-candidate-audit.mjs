import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {Game,createTopology} from '../../dist/engine.js';
const dir='tools/ai-gnn/target/root-candidate-recall-20261028',data=dir+'/results',plan=JSON.parse(readFileSync(dir+'/plan.json'));
const rows=[];let games=0,turns=0,changedRoots=0,tacticalAddedRoots=0,tacticalSelected=0;
for(const file of readdirSync(data).filter(x=>/^(canary|development|corpus|independent)-(A8|B16|C8plus4|sphere|torus|plane)/.test(x)&&x.endsWith('.json'))){
 const report=JSON.parse(readFileSync(data+'/'+file));if(!report.board||!report.games)continue;assert.equal(report.status,'complete',file);
 const trace=gunzipSync(readFileSync(data+'/'+file+'.trace.jsonl.gz')).toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
 for(const record of report.games){const game=new Game(createTopology(report.board.kind,report.board.size),6.5);for(const move of record.moves)assert.ok((move<0?game.pass():game.play(move)).ok,file+' illegal replay');assert.equal(game.ended,record.ended);assert.deepEqual(game.score(),record.score);games++;
  const tt=trace.filter(r=>r.pair===record.pair&&r.aColor===record.aColor);assert.equal(tt.length,game.moves-4);
  for(const t of tt){assert.equal(t.move??-1,record.moves[t.ply]);assert.ok(t.simulations===64||t.reason==='certified-loss');assert.equal(t.rootVisits,t.simulations);assert.ok(t.rawVisits.every(x=>Number.isInteger(x)&&x>=0));assert.ok(t.rootPriors.every(Number.isFinite)&&t.rootQ.every(Number.isFinite));
   if(t.study){assert.equal(t.study.version,1);const count=t.study.members.reduce((a,b)=>a+b,0),added=t.study.added.reduce((a,b)=>a+b,0);if(count>8)changedRoots++;if(added)tacticalAddedRoots++;if(t.study.added[t.move??160])tacticalSelected++;
    assert.ok(count<=(t.side==='a'?({A8:8,B16:16,C8plus4:12}[report.variant]):8));assert.ok(added<=4);
    for(let a=0;a<161;a++)if(t.study.added[a])assert.ok(t.study.members[a]&&t.rootPriors[a]>0);
   }turns++;
  }
 }
 rows.push({file,games:report.games.length,turns:trace.length,driverSha256:report.provenance.driver});
}
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');assert.equal(hash('dist/ai-v3.wasm'),plan.baseline.wasmSha256);assert.equal(hash('dist/models/v3/model.onnx'),plan.baseline.modelSha256);
const result={schemaVersion:1,passed:true,games,turns,changedRoots,tacticalAddedRoots,tacticalSelected,productionModelAndWasmUnchanged:true,rows};writeFileSync(dir+'/results/replay-audit.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
