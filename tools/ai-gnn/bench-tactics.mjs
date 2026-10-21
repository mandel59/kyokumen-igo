// Root preparation only; this does not benchmark GNN inference or playing strength.
import {readFileSync,writeFileSync} from 'node:fs';
import {createV3Search} from '../../dist/ai-v3-search.js';
const search=await createV3Search({load:async()=>readFileSync(new URL('../../dist/ai-v3.wasm',import.meta.url))});
const twoLib=size=>{
 const target=Math.floor(size*size/2),region=new Set([target-1,target,target+1]),border=new Set();
 for(const p of region)for(const q of [(p-size+size*size)%(size*size),(p+size)%(size*size),Math.floor(p/size)*size+(p+size-1)%size,Math.floor(p/size)*size+(p+1)%size])if(!region.has(q))border.add(q);
 return {name:'two-liberty-torus'+size,kind:'torus',size,komi:6.5,moves:Int32Array.from([...border].flatMap(p=>[-1,p]))};
};
const holes=new Set([16,17,18,23,24,25,40]);
const positions=[{name:'empty-sphere-large',kind:'sphere',size:5,komi:6.5,moves:new Int32Array()},twoLib(7),twoLib(11),
 {name:'pass-alive-eyes',kind:'torus',size:7,komi:6.5,moves:Int32Array.from(Array.from({length:49},(_,p)=>p).filter(p=>!holes.has(p)).flatMap(p=>[-1,p]))}];
const rows=[];
try{
 for(const p of positions){
  const row={position:p.name};
  for(const tactics of [false,true]){
   const samples=[];let avoided=0;
   for(let i=0;i<25;i++){
    search.start(p,{seed:3,tactics});const begin=performance.now();search.collect(1);
    const elapsed=performance.now()-begin;avoided=search.result().avoidedInvasions;search.cancel();
    if(i>=5)samples.push(elapsed);
   }
   samples.sort((a,b)=>a-b);
   row[tactics?'guarded':'before']={medianMs:(samples[9]+samples[10])/2,maxMs:samples.at(-1),avoided};
  }
  rows.push(row);
 }
}finally{search.dispose();}
const result={note:'Development Node/WASM observations, 5 warmups and 20 measurements. Includes root history replay and all feature extraction; excludes GNN. Not a device-general benchmark.',rows};
const output=process.argv[2]??'tools/ai-gnn/target/tactics-root-timing.json';writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
