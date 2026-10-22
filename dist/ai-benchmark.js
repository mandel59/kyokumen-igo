import {createV3AI} from './ai-v3.js';

export const VISIT_CANDIDATES=[8,16,32,64,96,128,192,256,384,512];
const percentile=(values,p)=>values.slice().sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];

// Select one shared budget from the reference device; never adjust each player's budget automatically.
export function recommendVisits(runs,targetMs=300,margin=1){
 if(!Number.isFinite(targetMs)||targetMs<=0||!Number.isFinite(margin)||margin<=0||margin>1)throw new Error('Invalid timing target');
 let recommended=0;
 for(const run of runs){
  if(!Number.isInteger(run.visits)||run.visits<1||!Number.isFinite(run.worstBoardP95Ms)||run.worstBoardP95Ms<0)throw new Error('Invalid measurement');
  if(run.worstBoardP95Ms>targetMs*margin)break;
  recommended=run.visits;
 }
 return recommended;
}

export async function runDeviceBenchmark({backend='auto',candidates=VISIT_CANDIDATES,repeats=2,onProgress=()=>{}}={}){
 if(!Number.isInteger(repeats)||repeats<1||repeats>10||!candidates.length||candidates.some((n,i)=>!Number.isInteger(n)||n<1||n>512||i>0&&n<=candidates[i-1]))throw new Error('Invalid benchmark options');
 const [manifestResponse,positionsResponse]=await Promise.all([fetch(new URL('./models/v3/manifest.json',import.meta.url),{cache:'no-cache'}),fetch(new URL('./ai-benchmark-positions.json',import.meta.url))]);
 if(!manifestResponse.ok||!positionsResponse.ok)throw new Error('計測データを読み込めませんでした。');
 const manifest=await manifestResponse.json(),fixture=await positionsResponse.json();
 const started=performance.now(),player=await createV3AI({backend});
 const report={schemaVersion:1,targetMs:300,margin:1,modelSha256:manifest.sha256,userAgent:navigator.userAgent,
  backend:player.backend,initializationMs:performance.now()-started,fixtureSource:fixture.source,repeats,runs:[],recommendedVisits:0,
  method:'End-to-end chooseMove in a Worker; all six boards, opening/middle/late archived positions; per-board P95 against the 300ms target. No additional timing margin, time cutoff or automatic setting changes.'};
 try{
  onProgress({stage:'warming',backend:player.backend});
  for(const p of fixture.positions)await player.chooseMove({...p,moves:Int32Array.from(p.moves)},{seed:17,maxSimulations:8});
  for(const visits of candidates){
   const samples=[];
   for(let repeat=0;repeat<repeats;repeat++)for(const p of repeat%2?fixture.positions.slice().reverse():fixture.positions){
    const position={kind:p.kind,size:p.size,komi:p.komi,moves:Int32Array.from(p.moves)},begin=performance.now();
    const result=await player.chooseMove(position,{seed:17,maxSimulations:visits}),elapsedMs=performance.now()-begin;
    if(!result.provenLoss&&result.simulations!==visits)throw new Error('指定した訪問数に到達しませんでした。');
    samples.push({board:p.kind+p.size,phase:p.phase,repeat,elapsedMs,simulations:result.simulations,provenLoss:result.provenLoss});
    onProgress({stage:'measuring',visits,completed:samples.length,total:fixture.positions.length*repeats,backend:player.backend});
   }
   const ordinary=samples.filter(s=>!s.provenLoss),boards=[...new Set(fixture.positions.map(p=>p.kind+p.size))];
   const perBoard=boards.map(board=>{
    const times=ordinary.filter(s=>s.board===board).map(s=>s.elapsedMs);
    if(!times.length)throw new Error('通常局面の測定値がありません。');
    return{board,p95Ms:percentile(times,.95),samples:times.length};
   });
   const run={visits,p95Ms:percentile(ordinary.map(s=>s.elapsedMs),.95),worstBoardP95Ms:Math.max(...perBoard.map(b=>b.p95Ms)),perBoard,samples};
   report.runs.push(run);report.recommendedVisits=recommendVisits(report.runs,report.targetMs,report.margin);
   onProgress({stage:'budget-complete',run,recommendedVisits:report.recommendedVisits});
   if(run.worstBoardP95Ms>report.targetMs*report.margin)break;
  }
  report.backend=player.backend;report.elapsedMs=performance.now()-started;report.finished=new Date().toISOString();
  return report;
 }finally{await player.dispose();}
}
