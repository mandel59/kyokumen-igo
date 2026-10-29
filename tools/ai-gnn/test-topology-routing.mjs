import test from 'node:test';
import assert from 'node:assert/strict';
import {createV3ModelRouter,v3ModelRoute} from '../../dist/ai-v3-routing.js';
const manifestURL=new URL('https://local.test/models/v3/manifest.json'),manifest={sha256:'a'.repeat(64),search:{fpu:1},modelRoutes:{plane:{manifest:'plane/manifest.json',sha256:'b'.repeat(64)}}};
const defer=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
function factory({initGate=null,chooseGate=null,failPlane=false}={}){
 const state={live:0,maxLive:0,created:[],disposed:[],entered:defer(),choosing:defer()};
 const create=async options=>{
  const key=options.manifestURL.href.includes('/plane/')?'plane':'curve';
  if(key==='plane'){state.entered.resolve();if(initGate)await initGate.promise;if(failPlane)throw Error('model load failed');}
  state.live++;state.maxLive=Math.max(state.maxLive,state.live);state.created.push(key);
  let epoch=0,running=0,disposed=false;
  return{backend:'v3-wasm',async chooseMove(position,budget){
   const e=epoch;running++;state.choosing.resolve();
   try{if(key==='curve'&&chooseGate)await chooseGate.promise;if(e!==epoch)throw Error('v3 cancelled');return{move:key==='plane'?115:4,simulations:budget.maxSimulations??64,backend:'v3-wasm',seed:budget.seed};}finally{running--;}
  },cancel(){epoch++;},async dispose(){assert.equal(running,0,'dispose must wait for active search');assert.equal(disposed,false);disposed=true;state.live--;state.disposed.push(key);}};
 };
 return{state,create};
}
const options={manifestURL,manifest,discoverModels:false};
test('only the known topology and pinned same-directory child is selected',()=>{
 const p=v3ModelRoute(manifestURL,manifest,'plane'),c=v3ModelRoute(manifestURL,manifest,'sphere');
 assert.equal(p.manifestURL.href,'https://local.test/models/v3/plane/manifest.json');assert.equal(p.expectedModelSha256,'b'.repeat(64));assert.equal(p.manifest,undefined);
 assert.equal(c.expectedModelSha256,'a'.repeat(64));assert.equal(c.manifest,manifest);
 assert.throws(()=>v3ModelRoute(manifestURL,manifest,'other'));
 for(const route of [{manifest:'../outside.json',sha256:'b'.repeat(64)},{manifest:'https://remote.test/m.json',sha256:'b'.repeat(64)},{manifest:'plane/manifest.json',sha256:'bad'}])assert.throws(()=>v3ModelRoute(manifestURL,{...manifest,modelRoutes:{plane:route}},'plane'));
});
test('switches retain one player, reuse same-domain model, preserve budget and child identity',async()=>{
 const f=factory(),r=await createV3ModelRouter(options,f.create);
 assert.equal(r.backend,'v3-wasm');
 let result=await r.chooseMove({kind:'plane'},{seed:7,maxSimulations:64});
 assert.equal(result.modelSha256,'b'.repeat(64));assert.equal(result.move,115);assert.equal(result.seed,7);assert.equal(result.simulations,64);
 await r.chooseMove({kind:'sphere'});await r.chooseMove({kind:'torus'});await r.chooseMove({kind:'plane'});
 assert.deepEqual(f.state.created,['curve','plane','curve','plane']);assert.equal(f.state.maxLive,1);
 await r.dispose();await r.dispose();assert.equal(f.state.live,0);
});
test('cancel during child initialization drops stale request while keeping the initialized model usable',async()=>{
 const gate=defer(),f=factory({initGate:gate}),r=await createV3ModelRouter(options,f.create);
 const pending=r.chooseMove({kind:'plane'});const rejected=assert.rejects(pending,/cancelled/);await f.state.entered.promise;r.cancel();gate.resolve();await rejected;
 assert.equal((await r.chooseMove({kind:'plane'})).modelSha256,'b'.repeat(64));await r.dispose();assert.equal(f.state.live,0);assert.equal(f.state.maxLive,1);
});
test('dispose during child initialization waits and releases it exactly once',async()=>{
 const gate=defer(),f=factory({initGate:gate}),r=await createV3ModelRouter(options,f.create);
 const pending=r.chooseMove({kind:'plane'}),rejected=assert.rejects(pending,/cancelled/);await f.state.entered.promise;
 const disposal=r.dispose(),again=r.dispose();gate.resolve();await rejected;await disposal;await again;
 assert.equal(f.state.live,0);assert.equal(f.state.maxLive,1);await assert.rejects(r.chooseMove({kind:'sphere'}),/cancelled/);
});
test('switch waits for an in-flight search before disposing or allocating the new model',async()=>{
 const gate=defer(),f=factory({chooseGate:gate}),r=await createV3ModelRouter(options,f.create);
 const first=r.chooseMove({kind:'sphere'}),rejected=assert.rejects(first,/cancelled/);await f.state.choosing.promise;
 const next=r.chooseMove({kind:'plane'});await new Promise(resolve=>setTimeout(resolve,0));
 assert.deepEqual(f.state.created,['curve']);assert.equal(f.state.live,1);
 gate.resolve();await rejected;assert.equal((await next).move,115);await r.dispose();assert.equal(f.state.maxLive,1);
});
test('rapid switches retire unused initialization and run only the last request',async()=>{
 const gate=defer(),f=factory({initGate:gate}),r=await createV3ModelRouter(options,f.create);
 const first=r.chooseMove({kind:'plane'}),rejected=assert.rejects(first,/cancelled/);await f.state.entered.promise;
 const last=r.chooseMove({kind:'torus'});gate.resolve();await rejected;
 assert.equal((await last).move,4);await r.dispose();assert.equal(f.state.live,0);assert.equal(f.state.maxLive,1);
});
test('failed model load can be disposed without leaking a previous player',async()=>{
 const f=factory({failPlane:true}),r=await createV3ModelRouter(options,f.create);
 await assert.rejects(r.chooseMove({kind:'plane'}),/load failed/);await r.dispose();assert.equal(f.state.live,0);
});
