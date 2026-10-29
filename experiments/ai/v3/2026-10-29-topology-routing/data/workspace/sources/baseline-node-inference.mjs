import * as ort from 'onnxruntime-node';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {validateManifest} from '../../dist/ai-v3-inference.js';
export async function createNodeInference(directory){
 directory=resolve(directory);const manifest=JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8'));
 validateManifest(manifest);const bytes=readFileSync(join(directory,manifest.model));
 if(createHash('sha256').update(bytes).digest('hex')!==manifest.sha256)throw new Error('v3 model checksum mismatch');
 const session=await ort.InferenceSession.create(bytes,{executionProviders:['cpu'],intraOpNumThreads:4});
 return {manifest,async evaluate(request,adjacency,{auxiliary=false}={}){
  const n=request.count;
  const outputs=await session.run({x:new ort.Tensor('float32',request.x,[n,160,32]),
   adjacency:new ort.Tensor('float32',adjacency,[1,160,160]),mask:new ort.Tensor('float32',request.mask,[n,160,1]),
   global_features:new ort.Tensor('float32',request.global_features,[n,8])},auxiliary?['policy','wdl','score','ownership']:['policy','wdl']);
  const result=Object.fromEntries(Object.entries(outputs).map(([key,t])=>[key,Float32Array.from(t.data)]));
  for(const t of Object.values(outputs))t.dispose();return result;
 },async dispose(){await session.release();}};
}
