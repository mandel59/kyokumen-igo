// Completed-Q policy improvement target, following Danihelka et al. and mctx.
// Reference: https://github.com/google-deepmind/mctx/blob/main/mctx/_src/qtransforms.py
export function completedQPolicy({prior,q,visits,legal,rawValue,valueScale=.1,maxvisitInit=50}){
 const n=prior.length;
 if(!n||q.length!==n||visits.length!==n||legal.length!==n||!legal.some(Boolean)||!Number.isFinite(rawValue)||Math.abs(rawValue)>1.000001||!Number.isFinite(valueScale)||valueScale<0||!Number.isFinite(maxvisitInit)||maxvisitInit<0)throw Error('Invalid completed-Q dimensions/value');
 let priorSum=0,visitSum=0,maxVisits=0,visitedPrior=0,weightedQ=0;
 for(let i=0;i<n;i++){
  if(!Number.isFinite(prior[i])||prior[i]<0||(!legal[i]&&prior[i]>1e-12)||!Number.isInteger(visits[i])||visits[i]<0||(!legal[i]&&visits[i]))throw Error('Invalid prior/visits/legal mask');
  if(legal[i])priorSum+=prior[i];
  if(visits[i]){
   if(!Number.isFinite(q[i])||Math.abs(q[i])>1.000001)throw Error('Invalid visited Q value');
   visitSum+=visits[i];maxVisits=Math.max(maxVisits,visits[i]);const p=Math.max(1.1754943508222875e-38,prior[i]);visitedPrior+=p;weightedQ+=p*q[i];
  }
 }
 if(Math.abs(priorSum-1)>1e-5)throw Error('Prior is not normalized');
 const mixedValue=visitSum?(rawValue+visitSum*weightedQ/visitedPrior)/(visitSum+1):rawValue;
 const completedQ=Array.from({length:n},(_,i)=>visits[i]?q[i]:mixedValue),scale=valueScale*(maxvisitInit+maxVisits);
 // WDL values already have a fixed[-1,1] scale; use rescale_values=False.
 const logits=Array.from({length:n},(_,i)=>legal[i]&&prior[i]>0?Math.log(prior[i]/priorSum)+scale*completedQ[i]:-Infinity),maximum=Math.max(...logits);
 const policy=logits.map(v=>Number.isFinite(v)?Math.exp(v-maximum):0),total=policy.reduce((a,b)=>a+b,0);
 if(!(total>0)||!Number.isFinite(total))throw Error('Invalid completed-Q softmax');
 return{policy:policy.map(p=>p/total),mixedValue,completedQ,scale,visitedActions:visits.filter(v=>v>0).length,unvisitedLegal:legal.filter((v,i)=>v&&!visits[i]).length};
}
export function wdlValue(logits){
 if(logits.length!==3||!logits.every(Number.isFinite))throw Error('Invalid WDL logits');
 const m=Math.max(...logits),p=logits.map(v=>Math.exp(v-m)),sum=p.reduce((a,b)=>a+b,0);return(p[0]-p[2])/sum;
}
