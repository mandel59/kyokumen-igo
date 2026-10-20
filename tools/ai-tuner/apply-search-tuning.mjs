// Apply the board-wise acceptance rule declared before the final matches.
import fs from 'node:fs';
import {reportOptions,writeReport} from './experiment-paths.mjs';
import assert from 'node:assert/strict';
const root=new URL('./',import.meta.url);
const {data:dir,output,context}=reportOptions('v2/2026-10-21-tuning','adoption.json');
const read=p=>JSON.parse(fs.readFileSync(new URL(p,dir),'utf8'));
const plan=read('plan.json'),primary=read(plan.heldout[0].file);
const greedy=read('heldout-vs-greedy-komi-6.5.json'),control=read('heldout-control-vs-greedy-komi-6.5.json');
for(const [data,file] of [[primary,'heldout-vs-original-komi-6.5.json'],[greedy,'heldout-vs-greedy-komi-6.5.json'],[control,'heldout-control-vs-greedy-komi-6.5.json']]){
 const spec=plan.heldout.find(s=>s.file===file);assert.ok(spec,'missing planned match '+file);
 assert.equal(data.seed,spec.seed);assert.equal(data.komi,spec.komi);assert.equal(data.pairsPerBoard,spec.pairsPerBoard);
}
assert.equal(greedy.seed,control.seed);
assert.deepEqual(primary.playerB,control.playerA,'original opponent/control must be the same model');
assert.deepEqual(greedy.playerB,control.playerB,'greedy opponent must match the control');
assert.ok(plan.adoption.primary.includes('2.394'),'Unsupported acceptance rule');
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
 assert.equal(b.games,primary.pairsPerBoard*2);assert.equal(greedy.boards[i].games,greedy.pairsPerBoard*2);assert.equal(control.boards[i].games,greedy.pairsPerBoard*2);
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
const report={analysisContext:context,rule:plan.adoption,params,boards,tunedPoints,originalPoints:boards.filter(b=>!b.accepted).map(b=>b.points)};
writeReport(output,report);
if(process.argv.includes('--apply')){
const source=new URL('src/search.rs',root);let s=fs.readFileSync(source,'utf8');
assert.equal(params.length,13);assert.ok(params.every(Number.isFinite));
const tuned=/pub fn tuned\(\) -> Self \{ Self \{ values: \[[^\]]+\] \} \}/;
assert.ok(tuned.test(s),'missing tuned parameters');
s=s.replace(/    \/\/\/ Robust CEM self-play tuning[^\n]*\n/, '    /// Selected experiment parameters; see docs/ai/architectures/v2.md.\n');
s=s.replace(tuned,'pub fn tuned() -> Self { Self { values: ['+params.map(x=>Number.isInteger(x)?x+'.0':x).join(', ')+'] } }');
const body=tunedPoints.length?'if matches!(points, '+tunedPoints.join(' | ')+') { Self::tuned() } else { Self::legacy() }':'let _=points; Self::legacy()';
const method=/    pub fn for_points\(points: usize\) -> Self \{[\s\S]*?\n    \}/;
assert.ok(method.test(s),'missing board selection method');
s=s.replace(method,'    pub fn for_points(points: usize) -> Self {\n        '+body+'\n    }');
s=s.replace('    /// The global tune regressed on the two largest app boards. Retain the\n    /// original 4-ply weights there; the other four boards use the tuned vector.',
 '    /// Board-wise acceptance on independent games; see docs/ai/architectures/v2.md.');
fs.writeFileSync(source,s);
}
console.log(JSON.stringify(report,null,2));
