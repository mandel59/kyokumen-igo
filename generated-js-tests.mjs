import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createJSAI} from './dist/ai-js.js';
import {createWasmAI} from './dist/ai-wasm.js';
import {createV2AI} from './dist/ai-v2.js';
import {instantiate} from './dist/ai-engine.generated.js';
import {createAIAdapter} from './dist/ai-api.js';
const bytes=readFileSync(new URL('./dist/ai-engine.wasm',import.meta.url));
const wasm=await createWasmAI({load:async()=>bytes}),a=await createJSAI(),b=await createJSAI();
const fixture=JSON.parse(readFileSync(new URL('./tests/fixtures/ai/v1-parity.json',import.meta.url)));
let comparisons=0;
try{
 for(const c of fixture.cases){
  const p={kind:c.kind,size:c.size,komi:6.5,moves:Int32Array.from(c.moves)};
  assert.equal(a.chooseMove(p,{randomize:false}),c.expected);
  assert.equal(b.chooseMove(p,{randomize:false}),wasm.chooseMove(p,{randomize:false}));comparisons+=2;
 }
 const positions=JSON.parse(readFileSync(new URL('./dist/ai-benchmark-positions.json',import.meta.url))).positions;
 for(const p of positions)for(const depth of[1,2,3,4])for(const seed of[0,3,0xffffffff]){
  const before=JSON.stringify(p),expected=wasm.chooseMove(p,{depth,seed});
  assert.equal(a.chooseMove(p,{depth,seed}),expected,p.kind+p.size+' '+p.phase+' depth '+depth+' seed '+seed);
  assert.equal(b.chooseMove(positions[(comparisons+7)%positions.length],{depth:1,seed}),wasm.chooseMove(positions[(comparisons+7)%positions.length],{depth:1,seed}));
  assert.equal(a.chooseMove(p,{depth,seed}),expected,'Interleaving another instance must not corrupt memory');
  assert.equal(JSON.stringify(p),before);comparisons+=3;
 }
 for(const bad of[{kind:'torus',size:7,komi:6.5,moves:[0,0]},{kind:'torus',size:7,komi:6.5,moves:[-2]}])assert.throws(()=>a.chooseMove(bad),/AI history|AI move/);
 const x=instantiate(),y=instantiate();assert.notEqual(x.memory.buffer,y.memory.buffer);
 const old=y.memory.buffer.byteLength;x.memory.grow(4);assert.equal(y.memory.buffer.byteLength,old);
 const grown=createAIAdapter(x),fresh=createAIAdapter(y);
 assert.equal(grown.chooseMove(positions[0],{depth:4,seed:19}),fresh.chooseMove(positions[0],{depth:4,seed:19}));
 grown.dispose();fresh.dispose();
 const fallback=await createV2AI({load:async()=>{throw new Error('Network unavailable');}});
 assert.equal(fallback.backend,'generated-js');
 assert.equal(await fallback.chooseMove(positions[0],{seed:19}),wasm.chooseMove(positions[0],{depth:4,seed:19}),'v2 wrapper defaults to depth 4');
 assert.equal(await fallback.chooseMove(positions[0],{depth:4,seed:19}),wasm.chooseMove(positions[0],{depth:4,seed:19}));fallback.dispose();
 await assert.rejects(fallback.chooseMove(positions[0]),/disposed/);
 // Simulate a genuine WASM execution failure, independently of malformed input.
 const normal=WebAssembly.instantiate;
 try{
  WebAssembly.instantiate=async()=>{const {instance}=await normal(bytes,{});return{instance:{exports:{...instance.exports,ai_search(){throw new Error('Execution failed');}}}};};
  const recovering=await createV2AI({load:async()=>bytes});assert.equal(recovering.backend,'wasm');
  assert.equal(await recovering.chooseMove(positions[0],{depth:4,seed:19}),wasm.chooseMove(positions[0],{depth:4,seed:19}));
  assert.equal(recovering.backend,'generated-js');recovering.dispose();
  await assert.rejects(recovering.chooseMove(positions[0]),/disposed/);
 }finally{WebAssembly.instantiate=normal;}
}finally{wasm.dispose();a.dispose();b.dispose();}
assert.throws(()=>a.chooseMove({}),/disposed/);
const native=globalThis.WebAssembly;
try{
 globalThis.WebAssembly=undefined;
 const pure=await createJSAI(),c=fixture.cases[0];
 assert.equal(pure.chooseMove({...c,komi:6.5},{randomize:false}),c.expected);pure.dispose();
}finally{globalThis.WebAssembly=native;}
console.log('Generated JS: '+comparisons+' move comparisons, depth 0..4, all six boards, seeded parity, isolated/growing memory, invalid input, initialization/runtime fallback and disposal passed.');
