// Reproducible AlphaZero-style exploration, used for data generation only.
export function createRandom(seed){
 let state=seed>>>0||1;
 return ()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};
}
function normal(random){return Math.sqrt(-2*Math.log(Math.max(1e-12,random())))*Math.cos(2*Math.PI*random());}
function gamma(shape,random){
 if(shape<1)return gamma(shape+1,random)*Math.pow(Math.max(1e-12,random()),1/shape);
 const d=shape-1/3,c=1/Math.sqrt(9*d);
 for(;;){
  const x=normal(random),v=1+c*x;if(v<=0)continue;
  const cube=v*v*v,u=random();
  if(u<1-.0331*x*x*x*x||Math.log(Math.max(1e-12,u))<.5*x*x+d*(1-cube+Math.log(cube)))return d*cube;
 }
}
export function exploreRoot(logits,legal,random,{fraction=.25,concentration=10}={}){
 const points=Array.from(legal,(_,p)=>p).filter(p=>legal[p]),max=Math.max(...points.map(p=>logits[p]));
 const prior=points.map(p=>Math.exp(logits[p]-max)),noise=points.map(()=>gamma(concentration/points.length,random));
 const total=prior.reduce((a,b)=>a+b,0),sum=noise.reduce((a,b)=>a+b,0);
 points.forEach((p,k)=>{logits[p]=Math.log(Math.max(1e-30,(1-fraction)*prior[k]/total+fraction*noise[k]/sum));});
}
export function sampleVisits(policy,random,temperature){
 if(temperature===0){let best=160;for(let p=0;p<160;p++)if(policy[p]>policy[best])best=p;return best;}
 const weights=Array.from(policy,v=>Math.pow(v,1/temperature)),total=weights.reduce((a,b)=>a+b,0);
 if(!(total>0))throw new Error('Empty visit distribution');
 const target=random()*total;let sum=0;
 for(let p=0;p<weights.length;p++){sum+=weights[p];if(target<sum)return p;}
 return weights.findLastIndex(v=>v>0);
}
