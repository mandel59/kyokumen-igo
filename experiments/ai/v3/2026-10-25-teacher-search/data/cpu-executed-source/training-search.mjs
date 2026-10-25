// Shared offline search contract: match the application's finite visit budget.
export function legalPrior(logits,legal){
 const max=Math.max(...Array.from(logits,(v,i)=>legal[i]?v:-Infinity));
 const result=Array.from(logits,(v,i)=>legal[i]?Math.exp(v-max):0),sum=result.reduce((a,b)=>a+b,0);
 if(!(sum>0)||!Number.isFinite(sum))throw new Error('Invalid root prior');
 return result.map(v=>v/sum);
}
export function trainingTarget(policy,prior,priorMix=.25){
 if(!Number.isFinite(priorMix)||priorMix<0||priorMix>1||policy.length!==prior.length)throw new Error('Invalid prior mixture');
 const valid=a=>a.every(v=>Number.isFinite(v)&&v>=0)&&Math.abs(a.reduce((s,v)=>s+v,0)-1)<1e-5;
 if(!valid(Array.from(policy))||!valid(prior))throw new Error('Invalid training distribution');
 const surprise=Array.from(policy).reduce((s,v,i)=>s+(v>0?v*Math.log(v/Math.max(1e-30,prior[i])):0),0);
 return {policy:Array.from(policy,(v,i)=>(1-priorMix)*v+priorMix*prior[i]),policySurprise:Math.max(0,surprise)};
}
export async function runTrainingSearch(search,inference,adjacency,{visits,mode='halving',onRoot}={}){
 if(!Number.isInteger(visits)||visits<1||!['halving','puct'].includes(mode))throw new Error('Invalid training search');
 let root,prior,stalled=0;
 while(search.result().simulations<visits){
  const completed=search.result().simulations,remaining=visits-completed;
  const leaves=search.collect(Math.min(8,remaining),mode==='halving'?remaining:undefined);
  if(leaves.count){
   const evaluation=await inference.evaluate(leaves,adjacency);
   if(!root){root=leaves;prior=legalPrior(evaluation.policy.subarray(0,161),leaves.legal.subarray(0,161));onRoot?.(evaluation,leaves);}
   search.submit(leaves,evaluation);
  }
  if(search.result().simulations===completed){if(++stalled>16)throw new Error('Stalled training search');}else stalled=0;
  if(search.result().provenLoss)break;
 }
 const result=search.result({diagnostics:true});
 if(!result.provenLoss&&result.simulations!==visits)throw new Error('Training visit budget mismatch');
 return {root,prior,...result};
}
