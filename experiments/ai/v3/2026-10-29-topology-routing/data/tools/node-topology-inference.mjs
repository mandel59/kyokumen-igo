// Serial native research clients explicitly select a topology before evaluating its roots.
import{readFileSync}from'node:fs';
import{resolve,join}from'node:path';
import{pathToFileURL}from'node:url';
import{v3ModelRoute}from'../../dist/ai-v3-routing.js';
import{createNodeInference}from'./node-inference.mjs';
export async function createTopologyNodeInference(directory,{initialKind='torus'}={}){
 directory=resolve(directory);const bundleManifest=JSON.parse(readFileSync(join(directory,'manifest.json'))),manifestURL=pathToFileURL(join(directory,'manifest.json'));
 let active=null,key=null,disposed=false,busy=false;
 async function setKind(kind){
  if(disposed)throw Error('Native model disposed');
  if(busy)throw Error('Cannot switch native model during evaluation');
  busy=true;try{
  const route=v3ModelRoute(manifestURL,bundleManifest,kind);
  if(active&&key===route.manifestURL.href)return;
  const previous=active;active=null;key=null;await previous?.dispose();
  active=await createNodeInference(directory,{kind});key=route.manifestURL.href;
  }finally{busy=false;}
 }
 await setKind(initialKind);
 return{
  bundleManifest,batchSize:8,backend:'onnx-cpu',
  get manifest(){return active?.manifest??bundleManifest;},
  setKind,
  async evaluate(...args){if(disposed||!active)throw Error('Native model unavailable');if(busy)throw Error('Native inference already running');busy=true;try{return await active.evaluate(...args);}finally{busy=false;}},
  async dispose(){if(disposed)return;if(busy)throw Error('Cannot dispose native model during evaluation');disposed=true;const previous=active;active=null;await previous?.dispose();}
 };
}
