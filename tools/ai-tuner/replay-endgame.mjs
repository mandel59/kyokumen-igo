// Compare v2 binaries on the reported record; do not alter the stored game.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Game} from '../../dist/engine.js';
import {decodeRecord} from '../../dist/record.js';
import {aiPosition} from '../../dist/ai-position.js';
import {createWasmAI} from '../../dist/ai-wasm.js';
const args=process.argv.slice(2),arg=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
if(!arg('--baseline'))throw new Error('Specify --baseline path/to/previous.wasm');
const beforeBytes=readFileSync(arg('--baseline')),afterBytes=readFileSync(arg('--model','dist/ai-engine.wasm'));
const fixture=readFileSync(new URL('../../tests/fixtures/ai/v3-endgame.json',import.meta.url));
const {game:record}=decodeRecord(JSON.parse(fixture).code),game=new Game(record.topology,record.komi);
const before=await createWasmAI({load:async()=>beforeBytes}),after=await createWasmAI({load:async()=>afterBytes});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={schemaVersion:1,seed:3,depths:[1,2,3,4],baselineSha256:sha(beforeBytes),modelSha256:sha(afterBytes),fixtureSha256:sha(fixture),
 condition:'Same recorded positions and seed; 33 certified-loss white roots, plus the preceding unproven white root. Actual game rules and v1 remain unchanged.',positions:[]};
try{
 for(let ply=1;ply<record.history.length;ply++){
  if(game.turn===2&&(ply===164||ply>=166)){
   const original=JSON.stringify(game.toJSON()),position={ply,depths:[]};
   for(const depth of report.depths){
    const old=before.chooseMove(aiPosition(game),{depth,seed:report.seed});
    const current=after.chooseMove(aiPosition(game),{depth,seed:report.seed});
    if(ply>=166)assert.equal(current,null,'Lost root must pass at '+ply);
    else assert.equal(current,old,'The preceding unproven root must retain its choice');
    assert.equal(JSON.stringify(game.toJSON()),original);position.depths.push({depth,before:old,after:current});
   }
   report.positions.push(position);
  }
  const move=record.history[ply].lastMove;assert.equal((move===null?game.pass():game.play(move)).ok,true);
 }
}finally{before.dispose();after.dispose();}
report.summary={certifiedRoots:report.positions.filter(p=>p.ply>=166).length,depths:report.depths.map(depth=>({depth,
 beforeContinuations:report.positions.filter(p=>p.ply>=166&&p.depths.find(d=>d.depth===depth).before!==null).length,
 afterContinuations:report.positions.filter(p=>p.ply>=166&&p.depths.find(d=>d.depth===depth).after!==null).length}))};
assert.equal(report.summary.certifiedRoots,33);
if(arg('--output'))writeFileSync(arg('--output'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.summary));
