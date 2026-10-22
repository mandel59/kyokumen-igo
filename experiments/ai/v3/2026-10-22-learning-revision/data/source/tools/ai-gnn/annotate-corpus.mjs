// Recover actual bootstrap moves from consecutive boards, then verify every root by replay.
import assert from 'node:assert/strict';
import {createReadStream,createWriteStream,readFileSync,writeFileSync} from 'node:fs';
import {createGunzip,createGzip} from 'node:zlib';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {createV3Search} from '../../dist/ai-v3-search.js';
import {Game,createTopology} from '../../dist/engine.js';
import {aiPosition} from '../../dist/ai-position.js';
const args=process.argv.slice(2),arg=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
const at=args.indexOf('--input'),end=args.indexOf('--output'),inputs=args.slice(at+1,end);
const output=arg('--output'),reportPath=arg('--report');
if(at<0||end<=at+1||!output||inputs.includes(output))throw new Error('Expected --input FILES --output FILE [--report FILE]');
const file=createWriteStream(output),out=output.endsWith('.gz')?createGzip():file;
if(out!==file)out.pipe(file);
const search=await createV3Search({load:async()=>readFileSync(new URL('../../dist/ai-v3.wasm',import.meta.url))});
const report={schemaVersion:1,inputs,positions:0,games:0,decisions:{},recoveredTeacherDiversifications:0,verifiedRoots:0,archivedCertificates:0};
const board=r=>Array.from({length:r.x.length/32},(_,p)=>r.x[p*32]?(r.global[6]===1?1:2):r.x[p*32+1]?(r.global[6]===1?2:1):0);
async function write(r){if(!out.write(JSON.stringify(r)+'\n'))await once(out,'drain');report.positions++;report.decisions[r.decisionReason]=(report.decisions[r.decisionReason]??0)+1;}
async function annotate(rows){
 if(!rows.length)return;
 if(rows[0].variant==='certified-cleanup'){
  for(const r of rows){assert.ok(r.certificateMargin>0);await write({...r,decisionReason:'certified-loss',decisionVerification:'archived-certificate',policyEligible:false});report.archivedCertificates++;}
  return;
 }
 const first=rows[0],n=first.x.length/32,sign=first.global[6]===1?1:-1;
 const game=new Game(createTopology(first.kind,first.size),Math.round(-first.global[0]*n*sign*2)/2);
 for(let i=0;i<rows.length;i++){
  const r=rows[i],before=board(r);assert.deepEqual(Array.from(game.board),before,'Replayed board differs from stored features');
  assert.equal(game.turn,r.global[6]===1?1:2);
  search.start(aiPosition(game));const root=search.collect(1),result=search.result();search.cancel();
  assert.equal(root.count,1);
  assert.ok(r.x.every((v,k)=>Math.abs(v-root.x[k])<2e-5),'Feature/history mismatch');
  assert.ok(r.global.every((v,k)=>Math.abs(v-root.global_features[k])<2e-6),'Global feature mismatch');
  assert.deepEqual(Array.from(root.legal,Boolean),r.legal,'Legal mask mismatch');
  let action=r.playedAction??r.action;
  if(r.source!=='selfplay'&&i+1<rows.length){
   const after=board(rows[i+1]),added=after.flatMap((v,p)=>!before[p]&&v===game.turn?[p]:[]);
   assert.ok(added.length<=1);action=added[0]??160;
   if(action!==r.action)report.recoveredTeacherDiversifications++;
  }
  const annotated={...r,positionId:r.positionId??r.gameId+':'+i,ply:i,playedAction:action,
   decisionReason:result.decisionReason,decisionVerification:'full-history-replay',policyEligible:result.decisionReason!=='certified-loss'};
  await write(annotated);report.verifiedRoots++;
  assert.ok((action===160?game.pass():game.play(action)).ok,'Recovered move must be legal');
 }
 assert.equal(game.ended,true,'Only completed games can supply labels');
 report.games++;
}
try{
 for(const path of inputs){
  let group=[];
  const stream=createReadStream(path),input=path.endsWith('.gz')?stream.pipe(createGunzip()):stream;
  for await(const line of createInterface({input,crlfDelay:Infinity})){
   if(!line.trim())continue;const r=JSON.parse(line),key=r.sequenceId??r.gameId;
   if(group.length&&key!==(group[0].sequenceId??group[0].gameId)){await annotate(group);group=[];}
   group.push(r);
  }
  await annotate(group);console.log('Annotated',path,report.positions);
 }
}finally{search.dispose();out.end();await once(file,'finish');}
if(reportPath)writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
