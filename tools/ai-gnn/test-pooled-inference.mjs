import assert from 'node:assert/strict';
import {createInferencePool} from './pooled-inference.mjs';
const request=(count,start=1)=>({count,x:Float32Array.from({length:count*5120},(_,i)=>start+Math.floor(i/5120)),mask:new Float32Array(count*160).fill(1),global_features:new Float32Array(count*8)});
const adjacency=new Float32Array(25600);adjacency[0]=1;
function fake(extra={}){const calls=[];return{calls,backend:'fake',manifest:{test:true},async evaluate(b,a,{auxiliary}){calls.push({count:b.count,graph:a[0],auxiliary});return Object.fromEntries((auxiliary?[['policy',161],['wdl',3],['score',1],['ownership',480]]:[['policy',161],['wdl',3]]).map(([k,w])=>[k,Float32Array.from({length:b.count*w},(_,i)=>b.x[Math.floor(i/w)*5120]+i%w+a[0])]));},async dispose(){calls.push('disposed');},...extra};}
const backend=fake(),pool=createInferencePool(backend,{capacity:16,maxRequest:8}),clients=Array.from({length:5},()=>pool.createClient());
const other=adjacency.slice();other[0]=2;
const outputs=await Promise.all([clients[0].evaluate(request(5,1),adjacency),clients[1].evaluate(request(8,10),adjacency.slice(),{auxiliary:true}),clients[2].evaluate(request(4,30),adjacency),clients[3].evaluate(request(8,50),other),clients[4].evaluate(request(1,80),other)]);
assert.deepEqual(backend.calls.map(c=>c.count),[13,9,4]);assert.deepEqual(pool.stats,{requests:5,positions:26,batches:3,maxBatch:13,graphs:2});
for(const[i,start]of [1,10,30,50,80].entries()){const graph=i<3?1:2;assert.equal(outputs[i].policy[0],start+graph);assert.equal(outputs[i].wdl[0],start+graph);}
assert.equal(outputs[1].ownership.length,8*480);assert.ok(!('ownership'in outputs[0]));assert.equal(outputs[1].score[7],18);
await assert.rejects(clients[0].evaluate(request(9),adjacency),/count/);await assert.rejects(clients[0].evaluate({...request(1),x:new Float32Array()},adjacency),/pooled x/);
await clients[0].dispose();await assert.rejects(clients[0].evaluate(request(1),adjacency),/client disposed/);await clients[1].evaluate(request(1),adjacency);
const reused=request(1,1234),captured=clients[2].evaluate(reused,adjacency);reused.x.fill(999);reused.count=8;assert.equal((await captured).policy[0],1235);
await pool.dispose();await pool.dispose();assert.equal(backend.calls.filter(c=>c==='disposed').length,1);assert.throws(()=>pool.createClient(),/disposed/);
const fatal=createInferencePool(fake({async evaluate(){throw Error('GPU failed');}})),fc=Array.from({length:9},()=>fatal.createClient());
const failures=await Promise.allSettled(fc.map(c=>c.evaluate(request(8),adjacency)));assert.ok(failures.every(r=>r.status==='rejected'&&/GPU failed/.test(r.reason)));await fatal.dispose();
let release;const blocked=createInferencePool(fake({async evaluate(){await new Promise(r=>release=r);return{policy:new Float32Array(8*161),wdl:new Float32Array(8*3)};}})),bc=blocked.createClient(),held=bc.evaluate(request(8),adjacency);held.catch(()=>{});await Promise.resolve();await assert.rejects(bc.evaluate(request(1),adjacency),/already running/);const closing=blocked.dispose();release();await assert.rejects(held,/disposed/);await closing;
console.log('Pooled inference: per-client batch limits, equal graphs merged, different graphs separated, output splitting/auxiliary, concurrency guards, disposal and fatal errors passed.');
