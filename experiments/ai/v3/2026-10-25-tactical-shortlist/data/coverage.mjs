import fs from 'node:fs';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import {createTopology} from '../../../../dist/engine.js';
const input='tools/ai-gnn/target/onpolicy-distillation/selfplay.jsonl',boards=new Map(),report={schemaVersion:1,input,inputSha256:createHash('sha256').update(fs.readFileSync(input)).digest('hex'),role:'diagnostic on previously generated training selfplay, not current development/evaluation',eligible:0,hasTactics:0,potentialPromotions:{slots1:0,slots2:0},examples:[]};
for await(const line of createInterface({input:fs.createReadStream(input),crlfDelay:Infinity})){
 const r=JSON.parse(line);if(r.rootNoiseApplied||r.decisionReason==='certified-loss')continue;
 const key=r.kind+r.size;if(!boards.has(key))boards.set(key,createTopology(r.kind,r.size));const t=boards.get(key),n=t.vertices.length,priors=r.searchDiagnostics.rootPriors,legal=priors.map(v=>v>0),ordered=Array.from({length:161},(_,p)=>p).filter(p=>legal[p]).sort((a,b)=>priors[b]-priors[a]);if(ordered.length<=8)continue;
 const scores=new Array(161).fill(0),captured=new Array(161).fill(0),saved=new Array(161).fill(0),seen=new Set();
 for(let p=0;p<n;p++)if(legal[p]&&r.x[p*32+29]>=.25)scores[p]=captured[p]=Math.round(r.x[p*32+28]**2*n);
 for(let p=0;p<n;p++)if(r.x[p*32]===1&&r.x[p*32+3]>.5&&!seen.has(p)){
  const group=[p];seen.add(p);let liberty;
  for(let k=0;k<group.length;k++)for(const q of t.neighbors[group[k]]){
   if(r.x[q*32+2]===1)liberty=q;
   else if(r.x[q*32]===1&&!seen.has(q)){seen.add(q);group.push(q);}
  }
  if(liberty!==undefined&&legal[liberty]&&r.x[liberty*32+29]>=.25){saved[liberty]+=group.length;scores[liberty]+=group.length;}
 }
 const tactical=ordered.filter(p=>scores[p]>0).sort((a,b)=>scores[b]-scores[a]||priors[b]-priors[a]);report.eligible++;if(tactical.length)report.hasTactics++;
 for(const slots of [1,2]){
  const outside=tactical.slice(0,slots).filter(p=>priors[p]<priors[ordered[7]]);if(outside.length)report.potentialPromotions['slots'+slots]++;
  if(slots===2&&outside.length&&report.examples.length<20)for(const action of outside)report.examples.push({gameId:r.gameId,board:key,ply:r.ply,action,captured:captured[action],saved:saved[action],prior:priors[action],higherPriorActions:ordered.filter(p=>priors[p]>priors[action]).length});
 }
}
fs.writeFileSync('tools/ai-gnn/target/tactical-shortlist/coverage.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,examples:report.examples.length}));
