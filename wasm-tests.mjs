import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Worker} from 'node:worker_threads';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {createTopology,Game,chooseMove,AI_WEIGHTS} from './dist/engine.js';
import {aiPosition,restoreAIPosition} from './dist/ai-position.js';
import {createWasmAI} from './dist/ai-wasm.js';

const bytes=readFileSync(new URL('./dist/ai-engine.wasm',import.meta.url));
const fixture=JSON.parse(readFileSync(new URL('./tests/fixtures/ai/v1-parity.json',import.meta.url),'utf8'));
assert.deepEqual(fixture.params,AI_WEIGHTS);
const ai=await createWasmAI({load:async()=>bytes});
for(const c of fixture.cases) {
  const position={kind:c.kind,size:c.size,komi:6.5,moves:Int32Array.from(c.moves)};
  assert.equal(ai.chooseMove(position,{randomize:false}),c.expected);
  const game=restoreAIPosition(position);
  const before=JSON.stringify(game.toJSON());
  const request=aiPosition(game);
  assert.equal(ai.chooseMove(request,{randomize:false}),chooseMove(game,{random:()=>0}));
  assert.equal(JSON.stringify(game.toJSON()),before,'AI request does not mutate the saved match');
}
const ko=new Game(createTopology('torus',7),.5);
for(const move of [17,24,31,18,23,32,0,26,25])assert.equal(ko.play(move).ok,true);
const koPosition=aiPosition(ko);
assert.equal(ai.chooseMove(koPosition,{randomize:false}),chooseMove(ko,{random:()=>0}));
assert.throws(()=>ai.chooseMove({...koPosition,moves:[...koPosition.moves,24]}),/Illegal AI history/);
ko.undo();ko.play(Array.from(ko.board,(_,i)=>i).find(i=>i!==25&&ko.analyze(i).ok)); // Undo and a different continuation rebuild a new superko history.
assert.equal(ai.chooseMove(aiPosition(ko),{randomize:false}),chooseMove(ko,{random:()=>0}));
ko.pass();
assert.equal(ai.chooseMove(aiPosition(ko),{randomize:false}),chooseMove(ko,{random:()=>0}));
ko.pass();
assert.equal(ai.chooseMove(aiPosition(ko)),null,'two passes end the game');
assert.throws(()=>ai.chooseMove({...aiPosition(ko),moves:[...aiPosition(ko).moves,0]}),/Illegal AI history/);
const empty=aiPosition(new Game(createTopology('sphere',3),9.5));
assert.throws(()=>ai.chooseMove({...empty,moves:[0,0]}),/Illegal AI history/);
for(const bad of [
  {...empty,kind:'plane'}, {...empty,size:40}, {...empty,komi:NaN},
  {...empty,moves:[-2]}, {...empty,moves:[999]}, {...empty,moves:[.5]},
  {...empty,moves:new Int32Array(10001)},
])assert.throws(()=>ai.chooseMove(bad),/Invalid AI/);
const choices=new Set();
for(let seed=0;seed<32;seed++) {
  const chosen=ai.chooseMove(empty,{seed});
  assert.equal(chosen,ai.chooseMove(empty,{seed}),'seeded noise is reproducible');
  assert.equal(restoreAIPosition(empty).analyze(chosen).ok,true);
  choices.add(chosen);
}
assert.ok(choices.size>1,'production AI retains random variation');
assert.equal(ai.chooseMove(empty,{randomize:false}),chooseMove(restoreAIPosition(empty),{random:()=>0}));
ai.dispose();ai.dispose();
assert.throws(()=>ai.chooseMove(empty),/disposed/);
await assert.rejects(createWasmAI({load:async()=>new Uint8Array([0,1,2])}));
console.log('WASM parity passed: 300 positions, captures/superko, undo branches, passes/end, noise, input validation and disposal.');

// Run the production Worker module with real WASM in an isolated Worker thread.
// The shim only supplies browser messaging and fetch; the actual handler is unchanged.
async function workerFor(mode) {
  const worker=new Worker(`
    const {parentPort,workerData}=require('node:worker_threads');
    const fs=require('node:fs');
    let loads=0;
    globalThis.self={postMessage:data=>parentPort.postMessage({...data,loads})};
    if(workerData.mode==='unsupported')globalThis.WebAssembly=undefined;
    globalThis.fetch=async()=>{
      loads++;
      if(workerData.mode==='missing')return new Response('',{status:404});
      if(workerData.mode==='corrupt')return new Response(new Uint8Array([0,1,2]));
      return new Response(fs.readFileSync(workerData.wasm));
    };
    import(workerData.module).then(()=>{
      parentPort.on('message',data=>self.onmessage({data}));
      parentPort.postMessage({ready:true});
    }).catch(error=>{throw error});
  `,{eval:true,workerData:{mode,module:new URL('./dist/ai-worker.js',import.meta.url).href,
    wasm:fileURLToPath(new URL('./dist/ai-engine.wasm',import.meta.url))}});
  await once(worker,'message');
  let id=0;
  return {worker,async request(position){
    const response=once(worker,'message');
    worker.postMessage({id:++id,position});
    const [result]=await response;
    assert.equal(result.id,id);
    return result;
  }};
}
for(const mode of ['wasm','missing','corrupt','unsupported']) {
  const {worker,request}=await workerFor(mode);
  try {
    for(let i=0;i<2;i++) {
      const response=await request(empty);
      assert.equal(response.backend,mode==='wasm'?'wasm':'js');
      assert.equal(response.error,undefined);
      assert.equal(restoreAIPosition(empty).analyze(response.move).ok,true);
      assert.equal(response.loads,mode==='unsupported'?0:1,'WASM is loaded only once');
    }
    const invalid=await request({...empty,moves:Int32Array.from([0,0])});
    assert.match(invalid.error,/Illegal AI history/);
    const recovered=await request(empty);
    assert.equal(recovered.backend,'js','runtime failure keeps a usable JS fallback');
  } finally {await worker.terminate();}
}
console.log('Production Worker passed: WASM selection/reuse, 404/corrupt/unsupported fallbacks and recovery after invalid input.');
