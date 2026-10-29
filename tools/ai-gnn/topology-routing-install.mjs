// Local v3-slot integration is conditional on every pre-registered gate.
import assert from'node:assert/strict';
import{readFileSync,writeFileSync,copyFileSync,mkdirSync,existsSync}from'node:fs';
import{createHash}from'node:crypto';
import{validateManifest}from'../../dist/ai-v3-inference.js';
const d='tools/ai-gnn/target/topology-routing-study-20261029',read=p=>JSON.parse(readFileSync(d+'/'+p)),hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const plan=read('plan.json'),ind=read('results/independent-decision.json'),latency=read('results/latency-decision.json');
assert.ok(ind.passesStrength&&latency.passed&&read('results/independent-replay-audit.json').passed);
assert.equal(hash(plan.baseline.model),plan.baseline.modelSha256);assert.equal(hash(plan.baseline.wasm),plan.baseline.wasmSha256);
assert.equal(existsSync('dist/models/v3/plane'),false,'Unexpected existing destination');
const parent=read('Routed-r0-model/manifest.json'),child=read('Routed-r0-model/plane/manifest.json');
assert.equal(hash(d+'/Routed-r0-model/manifest.json'),read('registration.json').bundleManifestSha256);
for(const [suffix,m,spec]of[['',parent,plan.models.curves],['/plane',child,plan.models.plane]]){
 validateManifest(m);assert.equal(hash(d+'/Routed-r0-model'+suffix+'/model.onnx'),spec.sha256);assert.equal(hash(d+'/Routed-r0-model'+suffix+'/weights.f32'),spec.weightsSha256);
}
const acceptance={study:plan.id,scope:'Only the registered kind-based composition; component acceptance does not apply to other topologies.',independentGames:432,wins:ind.result.all.wins,scoreRate:ind.result.all.scoreRate,paired95:ind.result.all.pairedBootstrap.interval95,latencyPassed:true};
mkdirSync('dist/models/v3/plane',{recursive:true});
for(const [suffix,m]of[['',parent],['/plane',child]]){
 for(const f of['model.onnx','weights.f32','KataGo-NN-LICENSE.txt'])copyFileSync(d+'/Routed-r0-model'+suffix+'/'+f,'dist/models/v3'+suffix+'/'+f);
 const installed={...m,accepted:true,acceptance,...(suffix?{acceptedTopologies:['plane']}:{})};
 writeFileSync('dist/models/v3'+suffix+'/manifest.json',JSON.stringify(installed,null,2)+'\n');
}
const golden=read('Routed-r0-model/golden.json');assert.equal(golden.modelSha256,parent.sha256);
writeFileSync('tests/fixtures/ai/v3-golden.json',JSON.stringify(golden)+'\n');
const files=['dist/models/v3/model.onnx','dist/models/v3/weights.f32','dist/models/v3/manifest.json','dist/models/v3/plane/model.onnx','dist/models/v3/plane/weights.f32','dist/models/v3/plane/manifest.json','tests/fixtures/ai/v3-golden.json'];
writeFileSync(d+'/results/local-integration.json',JSON.stringify({passed:false,installed:new Date().toISOString(),scope:'Local experimental v3 slot only; no push or hosted deployment.',previousModel:plan.baseline.modelSha256,models:plan.models,files:Object.fromEntries(files.map(f=>[f,hash(f)])),browserVerificationPending:true},null,2)+'\n');
console.log(JSON.stringify({installed:true,verificationPending:true,rootModel:parent.sha256,planeModel:child.sha256}));
