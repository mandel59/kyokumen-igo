// Complete cleanup branches from selfplay families; the reported user game is never input.
import assert from 'node:assert/strict';
import {createReadStream,createWriteStream,readFileSync,writeFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {Game,createTopology} from '../../dist/engine.js';
import {aiPosition} from '../../dist/ai-position.js';
import {createV3Search} from '../../dist/ai-v3-search.js';
const args=process.argv.slice(2),arg=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const input=arg('--input'),output=arg('--output'),steps=Number(arg('--steps','8'));
if(!input||!output||!Number.isInteger(steps)||steps<1||steps>32)throw new Error('Expected --input, --output and optional --steps 1..32');
const families=new Map();
for await(const line of createInterface({input:createReadStream(input),crlfDelay:Infinity})){
 const r=JSON.parse(line);let family=families.get(r.gameId);
 if(!family){family={id:r.gameId,kind:r.kind,size:r.size,komi:-r.global[0]*(r.kind==='sphere'?6*r.size*r.size+2:r.size*r.size),moves:[],start:null};families.set(r.gameId,family);}
 assert.equal(r.ply,family.moves.length);assert.equal(r.source,'selfplay');
 if(family.start===null&&r.visits===1&&r.action===160)family.start=r.ply;
 family.moves.push(r.action===160?null:r.action);
}
const search=await createV3Search({load:async()=>readFileSync(new URL('../../dist/ai-v3.wasm',import.meta.url))});
const out=createWriteStream(output),report={schemaVersion:1,input,families:families.size,steps,positions:0,branchedFamilies:0,captures:0,skipped:0,
 condition:'Same gameId as parent enforces family-level splits; all added policies are pass, proved lost at every sampled root. Score/ownership come from the legally completed branch.',games:[]};
function proof(game){
 search.start(aiPosition(game));const request=search.collect(1),result=search.result();search.cancel();
 return result.provenLoss?{request,margin:result.lossMarginLowerBound}:null;
}
function owners(game){
 const result=Array.from(game.board),seen=new Set();
 for(let p=0;p<result.length;p++)if(!result[p]&&!seen.has(p)){
  const region=[p],border=new Set();seen.add(p);
  for(let k=0;k<region.length;k++)for(const q of game.topology.neighbors[region[k]]){
   if(game.board[q])border.add(game.board[q]);else if(!seen.has(q)){seen.add(q);region.push(q);}
  }
  const owner=border.size===1?[...border][0]:0;for(const q of region)result[q]=owner;
 }return result;
}
try{
 for(const family of families.values()){
  if(family.start===null){report.skipped++;continue;}
  // Komi was encoded as float32/n; restore the exact half point before replay.
  const game=new Game(createTopology(family.kind,family.size),Math.round(family.komi*2)/2);
  for(const move of family.moves)assert.equal((move===null?game.pass():game.play(move)).ok,true);
  assert.equal(game.ended,true);game.undo(game.moves-family.start);
  const loser=game.turn,initial=proof(game);assert.ok(initial,'Only a certified-loss root can start a branch');
  if(game.passes===1)game.undo(1);else game.pass();
  assert.equal(game.turn,3-loser);const samples=[];let captured=0;
  for(let step=0;step<steps&&!game.ended;step++){
   const candidates=[];
   for(let p=0;p<game.board.length;p++){
    const adjacent=game.topology.neighbors[p].filter(q=>game.board[q]===loser).length;
    if(!adjacent)continue;const a=game.analyze(p);if(a.ok)candidates.push({p,priority:1000*a.captured+10*adjacent-a.liberties,captured:a.captured});
   }
   candidates.sort((a,b)=>b.priority-a.priority||a.p-b.p);let chosen=null;
   for(const candidate of candidates){
    assert.equal(game.play(candidate.p).ok,true);const certified=proof(game);
    if(certified){chosen={...candidate,...certified};break;}game.undo();
   }
   if(!chosen)break;
   const root=chosen.request;captured+=chosen.captured;
   samples.push({schemaVersion:1,gameId:family.id,sequenceId:family.id+'-cleanup',source:'selfplay',variant:'certified-cleanup',kind:family.kind,size:family.size,
    ply:game.moves,x:Array.from(root.x.subarray(0,game.board.length*32)),global:Array.from(root.global_features),legal:Array.from(root.legal,Boolean),
    policy:Array.from({length:161},(_,p)=>p===160?1:0),action:160,visits:0,certificateMargin:chosen.margin});
   assert.equal(game.pass().ok,true);
  }
  while(!game.ended)game.pass();
  const score=game.score(),own=owners(game);assert.notEqual(score.winner,loser);assert.notEqual(score.winner,0);
  for(const sample of samples){
   const r={...sample,wdl:2,score:(score.black-score.white)*(loser===1?1:-1),ownership:own.map(v=>v===0?1:v===loser?0:2)};
   if(!out.write(JSON.stringify(r)+'\n'))await once(out,'drain');report.positions++;
  }
  if(samples.length){report.branchedFamilies++;report.captures+=captured;report.games.push({gameId:family.id,positions:samples.length,captured,loser,finalScore:score});}
 }
}finally{search.dispose();out.end();await once(out,'finish');}
if(arg('--report'))writeFileSync(arg('--report'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({families:report.families,branchedFamilies:report.branchedFamilies,positions:report.positions,captures:report.captures,skipped:report.skipped}));
