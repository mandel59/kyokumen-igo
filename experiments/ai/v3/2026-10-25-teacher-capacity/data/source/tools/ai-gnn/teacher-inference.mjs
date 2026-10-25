import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
const encoded=value=>Buffer.from(value.buffer,value.byteOffset,value.byteLength).toString('base64');
const valid=(value,length,name)=>{if(!(value instanceof Float32Array)||value.length!==length||!value.every(Number.isFinite))throw Error('Invalid teacher '+name);};

// Native-only adapter for createOfflineAI({createInference:()=>createTeacherInference(...)}).
export async function createTeacherInference({directory,device='cuda',python=join(here,'.venv','Scripts','python.exe'),timeoutMs=300000,threads=4}={}){
 if(!directory||!['cpu','cuda'].includes(device)||!Number.isInteger(threads)||threads<1||!Number.isFinite(timeoutMs)||timeoutMs<=0)throw Error('Invalid teacher inference options');
 const child=spawn(python,[join(here,'teacher_server.py'),'--directory',resolve(directory),'--device',device,'--threads',String(threads)],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 let sequence=0,closed=false,stderr='',readyResolve,readyReject;
 const pending=new Map(),adjacencies=new WeakMap();
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 let readyTimer=setTimeout(()=>fail(Error('Teacher startup timeout')),timeoutMs);
 const lines=createInterface({input:child.stdout});
 function fail(error){if(closed)return;closed=true;clearTimeout(readyTimer);readyReject(error);for(const {reject,timer}of pending.values()){clearTimeout(timer);reject(error);}pending.clear();child.stdin.destroy();child.kill();lines.close();}
 child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-8000);});
 child.on('error',fail);child.stdin.on('error',fail);
 child.on('exit',(code,signal)=>fail(Error('Teacher process exited '+(signal??code)+(stderr?'\n'+stderr:''))));
 lines.on('line',line=>{
  try{
   const response=JSON.parse(line);
   if(response.ready){clearTimeout(readyTimer);readyResolve(response);return;}
   const item=pending.get(response.id);if(!item)throw Error('Unexpected teacher response');pending.delete(response.id);clearTimeout(item.timer);
   if(response.error)item.reject(Error('Teacher inference: '+response.error));else item.resolve(response);
  }catch(error){fail(error);}
 });
 function request(message){
  if(closed)return Promise.reject(Error('Teacher inference disposed'));
  const id=++sequence;
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>fail(Error('Teacher inference timeout')),timeoutMs);pending.set(id,{resolve,reject,timer});
   child.stdin.write(JSON.stringify({id,...message})+'\n',error=>{if(error)fail(error);});
  });
 }
 const info=await ready;
 if(info.backend!==device||info.manifest?.format!=='offline-teacher-v1'){const error=Error('Invalid teacher handshake');fail(error);throw error;}
 let graphSequence=0;
 return {
  manifest:info.manifest,backend:info.backend,batchSize:8,
  async evaluate(batch,adjacency,{auxiliary=false}={}){
   if(closed)throw Error('Teacher inference disposed');
   const n=batch.count;if(!Number.isInteger(n)||n<1||n>64)throw Error('Invalid teacher batch size');
   valid(batch.x,n*160*32,'features');valid(batch.mask,n*160,'mask');valid(batch.global_features,n*8,'globals');valid(adjacency,160*160,'adjacency');
   if(!adjacencies.has(adjacency)){
    const key=String(++graphSequence),registration=request({op:'adjacency',key,adjacency:encoded(adjacency)}).then(()=>key);
    adjacencies.set(adjacency,registration);
   }
   const key=await adjacencies.get(adjacency);
   const response=await request({op:'evaluate',key,count:n,x:encoded(batch.x),mask:encoded(batch.mask),global_features:encoded(batch.global_features),auxiliary});
   const names=auxiliary?['policy','wdl','score','ownership']:['policy','wdl'],sizes={policy:n*161,wdl:n*3,score:n,ownership:n*160*3};
   const bytes=Buffer.from(response.data,'base64'),total=names.reduce((sum,name)=>sum+sizes[name],0);
   if(JSON.stringify(names)!==JSON.stringify(response.names)||bytes.byteLength!==total*4)throw Error('Invalid teacher output shape');
   const values=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));if(!values.every(Number.isFinite))throw Error('Nonfinite teacher output');
   let offset=0;return Object.fromEntries(names.map(name=>{const value=values.slice(offset,offset+sizes[name]);offset+=sizes[name];return[name,value];}));
  },
  async dispose(){if(closed)return;try{await request({op:'close'});}finally{fail(Error('Teacher inference disposed'));}}
 };
}
