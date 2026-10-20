// Apply the board-wise acceptance rule declared before the final matches.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const root=new URL('./',import.meta.url),dir=new URL('experiments/2026-10-21/search-tuning/',root);
const read=p=>JSON.parse(fs.readFileSync(new URL(p,dir),'utf8'));
const plan=read('plan.json'),primary=read(plan.heldout[0].file);
const greedy=read('heldout-vs-greedy-komi-6.5.json'),control=read('heldout-control-vs-greedy-komi-6.5.json');
assert.equal(primary.seed,20261050);assert.equal(greedy.seed,20261052);assert.equal(control.seed,20261052);
const params=fs.readFileSync(new URL('robust/params.txt',dir),'utf8').trim().split(/\s+/).map(Number);
assert.deepEqual(primary.playerA.values,params);assert.deepEqual(greedy.playerA.values,params);
function pairScores(data,index){
 const b=data.boards[index],scores=[];
 assert.equal(b.rawMargins.length,b.games);
 for(let i=0;i<b.games;i+=2){
  const score=j=>b.rawMargins[j]===data.komi?.5:((b.rawMargins[j]>data.komi)===(j%2===0)?1:0);
  scores.push((score(i)+score(i+1))/2);
 }
 return scores;
}
function estimate(values){
 const value=values.reduce((s,x)=>s+x,0)/values.length;
 const se=Math.sqrt(values.reduce((s,x)=>s+(x-value)**2,0)/(values.length-1)/values.length);
 return {value,se,ci95:[value-1.96*se,value+1.96*se]};
}
const points=[56,98,152,49,81,121];
const boards=primary.boards.map((b,i)=>{
 assert.equal(b.games,1000);assert.equal(greedy.boards[i].games,500);assert.equal(control.boards[i].games,500);
 assert.equal(greedy.boards[i].kind,b.kind);assert.equal(greedy.boards[i].size,b.size);
 const a=pairScores(greedy,i),c=pairScores(control,i),score=estimate(pairScores(primary,i));
 const difference=estimate(a.map((v,j)=>v-c[j]));
 const lower=score.value-2.394*score.se;
 const capped=b.capped+greedy.boards[i].capped+control.boards[i].capped;
 const accepted=lower>.5&&difference.value>=0&&capped===0;
 return {kind:b.kind,size:b.size,points:points[i],score,simultaneousLower:lower,
  greedyScore:estimate(a),controlGreedyScore:estimate(c),greedyDifference:difference,capped,accepted};
});
const tunedPoints=boards.filter(b=>b.accepted).map(b=>b.points);
const report={rule:plan.adoption,params,boards,tunedPoints,originalPoints:boards.filter(b=>!b.accepted).map(b=>b.points)};
fs.writeFileSync(new URL('adoption.json',dir),JSON.stringify(report,null,2)+'\n');
const source=new URL('src/search.rs',root);let s=fs.readFileSync(source,'utf8');
const body=tunedPoints.length?'if matches!(points, '+tunedPoints.join(' | ')+') { Self::tuned() } else { Self::legacy() }':'let _=points; Self::legacy()';
const method=/    pub fn for_points\(points: usize\) -> Self \{[\s\S]*?\n    \}/;
assert.ok(method.test(s),'missing board selection method');
s=s.replace(method,'    pub fn for_points(points: usize) -> Self {\n        '+body+'\n    }');
s=s.replace('    /// The global tune regressed on the two largest app boards. Retain the\n    /// original 4-ply weights there; the other four boards use the tuned vector.',
 '    /// Board-wise acceptance on independent games; see SEARCH-TUNING.md.');
fs.writeFileSync(source,s);
console.log(JSON.stringify(report,null,2));
