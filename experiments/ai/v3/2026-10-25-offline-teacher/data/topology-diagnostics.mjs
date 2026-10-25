import fs from 'node:fs';
import {createTopology} from '../../../../dist/engine.js';
const rows=[];
for(const[kind,size]of [['sphere',3],['sphere',4],['sphere',5],['torus',7],['torus',9],['torus',11]]){
 const t=createTopology(kind,size),n=t.vertices.length;let diameter=0,beyondSix=0;
 for(let p=0;p<n;p++){
  const distances=new Array(n).fill(-1),queue=[p];distances[p]=0;
  for(let k=0;k<queue.length;k++)for(const q of t.neighbors[queue[k]])if(distances[q]<0){distances[q]=distances[queue[k]]+1;queue.push(q);}
  if(distances.includes(-1))throw Error('Disconnected board');diameter=Math.max(diameter,...distances);beyondSix+=distances.filter(d=>d>6).length;
 }
 rows.push({board:kind+size,points:n,diameter,orderedPairsBeyondSixHops:beyondSix,fractionBeyondSix:beyondSix/(n*(n-1))});
}
fs.writeFileSync('tools/ai-gnn/target/offline-teacher/topology-diagnostics.json',JSON.stringify({schemaVersion:1,interpretation:'Current GNN has six local propagation blocks plus global pooling and engineered group features, so this is not a proof of an absolute receptive-field limit.',rows},null,2)+'\n');console.log(JSON.stringify(rows));
