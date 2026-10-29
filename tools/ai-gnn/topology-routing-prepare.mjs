import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,copyFileSync,existsSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {validateManifest} from '../../dist/ai-v3-inference.js';
const planPath='experiments/ai/plans/v3-topology-routing/plan.json',plan=JSON.parse(readFileSync(planPath)),dir=plan.workspace;
const hash=b=>createHash('sha256').update(b).digest('hex');
if(existsSync(dir))throw Error('Fresh workspace required');
assert.equal(hash(readFileSync(plan.baseline.model)),plan.baseline.modelSha256);assert.equal(hash(readFileSync(plan.baseline.wasm)),plan.baseline.wasmSha256);
mkdirSync(dir+'/results',{recursive:true});mkdirSync(dir+'/sources');mkdirSync(dir+'/baseline');mkdirSync(dir+'/baseline-runtime');mkdirSync(dir+'/Routed-r0-model/plane',{recursive:true});
copyFileSync(planPath,dir+'/plan.json');
for(const f of ['model.onnx','weights.f32','manifest.json','KataGo-NN-LICENSE.txt'])copyFileSync('dist/models/v3/'+f,dir+'/baseline/'+f);
copyFileSync('tests/fixtures/ai/v3-golden.json',dir+'/baseline/golden.json');copyFileSync(plan.baseline.wasm,dir+'/search.wasm');
const runtime=['ai-v3.js','ai-v3-inference.js','ai-v3-webgpu.js','ai-v3-search.js','ai-worker.js','engine.js','ai-position.js'];
for(const f of runtime)copyFileSync('dist/'+f,dir+'/baseline-runtime/'+f);
function archived(spec,name){
 const catalog=JSON.parse(readFileSync(spec.archive+'/manifest.json')),key=spec.prefix+name;
 const item=catalog.files.find(f=>f.archive===key||f.archive===key+'.gz');assert.ok(item,key);
 const stored=readFileSync(spec.archive+'/'+item.archive);assert.equal(hash(stored),item.storedSha256);
 const bytes=item.compressed?gunzipSync(stored):stored;assert.equal(hash(bytes),item.originalSha256);return bytes;
}
function compact(m){
 const keys=['architecture','featureVersion','points','channels','globals','hidden','blocks','parameters','model','sha256','status','accepted','trainPositions','webgpu','search','teacherProvenance'];
 return Object.fromEntries(keys.filter(k=>m[k]!==undefined).map(k=>[k,m[k]]));
}
const sources={};
for(const key of ['plane','curves']){
 const spec=plan.models[key],m=JSON.parse(archived(spec,'manifest.json')),model=archived(spec,'model.onnx'),weights=archived(spec,'weights.f32');
 assert.equal(m.sha256,spec.sha256);assert.equal(hash(model),spec.sha256);assert.equal(hash(weights),spec.weightsSha256);assert.equal(m.parameters,120905);assert.equal(m.search.fpu,1);
 const target=dir+'/Routed-r0-model'+(key==='plane'?'/plane':'');writeFileSync(target+'/model.onnx',model);writeFileSync(target+'/weights.f32',weights);writeFileSync(target+'/golden.json',archived(spec,'golden.json'));writeFileSync(target+'/KataGo-NN-LICENSE.txt',archived(spec,'KataGo-NN-LICENSE.txt'));
 const out=compact(m);out.accepted=false;out.planId=plan.id;
 if(key==='curves'){out.modelRoutes={plane:{manifest:'plane/manifest.json',sha256:plan.models.plane.sha256}};out.routingVersion=1;out.packageParameters=241810;out.sourceComponents=plan.models;}
 validateManifest(out);writeFileSync(target+'/manifest.json',JSON.stringify(out,null,2)+'\n');sources[key]={model:hash(model),weights:hash(weights),bytes:model.length+weights.length};
}
writeFileSync(dir+'/registration.json',JSON.stringify({started:new Date().toISOString(),planSha256:hash(readFileSync(planPath)),components:sources,baselineRuntime:Object.fromEntries(runtime.map(f=>[f,hash(readFileSync('dist/'+f))])),bundleManifestSha256:hash(readFileSync(dir+'/Routed-r0-model/manifest.json')),newTrainingRuns:0},null,2)+'\n');
console.log(JSON.stringify({prepared:true,components:sources,bundleNNBytes:Object.values(sources).reduce((s,r)=>s+r.bytes,0)}));
