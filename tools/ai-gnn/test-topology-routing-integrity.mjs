// Loaders must reject a valid model that is not the model pinned by the route.
import test from 'node:test';
import assert from 'node:assert/strict';
import{readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync}from'node:fs';
import{join}from'node:path';
import{createV3Inference}from'../../dist/ai-v3-inference.js';
import{createNodeInference}from'./node-inference.mjs';
const base=process.argv[2]??'tools/ai-gnn/target/topology-routing-study-20261029';
const manifest=JSON.parse(readFileSync(base+'/Routed-r0-model/manifest.json'));
test('browser loader rejects the wrong pinned child before importing an inference runtime',async()=>{
 let imported=false;
 for(const backend of['wasm','webgpu'])await assert.rejects(createV3Inference({manifestURL:'https://local.test/manifest.json',manifest,expectedModelSha256:'0'.repeat(64),backend,importRuntime(){imported=true;throw Error('Unexpected runtime import');}}),/routed model checksum mismatch/);
 assert.equal(imported,false);
});
test('native loader rejects missing topology and valid wrong child model',async()=>{
 await assert.rejects(createNodeInference(base+'/Routed-r0-model'),/explicit board kind/);
 const fixture=base+'/integrity-fixture';
 assert.equal(existsSync(fixture),false,'Use a fresh test output');
 mkdirSync(fixture+'/plane',{recursive:true});
 const altered={...manifest,modelRoutes:{plane:{manifest:'plane/manifest.json',sha256:'0'.repeat(64)}}};
 writeFileSync(fixture+'/manifest.json',JSON.stringify(altered));
 for(const f of['manifest.json','model.onnx'])copyFileSync(join(base,'Routed-r0-model/plane',f),join(fixture,'plane',f));
 await assert.rejects(createNodeInference(fixture,{kind:'plane'}),/Routed child checksum mismatch/);
});
