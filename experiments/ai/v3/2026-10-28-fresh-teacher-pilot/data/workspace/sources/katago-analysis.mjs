// Local KataGo JSON analysis process. No hosted service or API credentials are used.
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createWriteStream} from 'node:fs';
import {toVertex,fromVertex} from '../gtp/vertex.mjs';

export const KATAGO_RULES={ko:'POSITIONAL',scoring:'AREA',suicide:false,tax:'NONE',hasButton:false,whiteHandicapBonus:'0',friendlyPassOk:false};
export function analysisPosition(game){
 if(game.topology.kind!=='plane')throw Error('KataGo requires a plane board');
 const size=game.topology.size;
 return {boardXSize:size,boardYSize:size,komi:game.komi,rules:KATAGO_RULES,
  moves:game.history.slice(1).map((s,i)=>[i%2?'W':'B',toVertex(s.lastMove,size)])};
}
export function analysisPolicy(result,game,{uniformMix=.02}={}){
 if(!Number.isFinite(uniformMix)||uniformMix<0||uniformMix>1)throw Error('Invalid policy mixture');
 const policy=new Float32Array(161),legal=[];
 for(let p=0;p<game.board.length;p++)if(game.analyze(p).ok)legal.push(p);
 if(!game.ended)legal.push(160);
 if(!legal.length)throw Error('No legal training actions');
 for(const move of result.moveInfos??[]){
  // Graph-search child visits can include paths through other parents; use root edge visits.
  const point=fromVertex(move.move,game.topology.size),action=point??160,visits=move.edgeVisits??move.visits;
  if(!Number.isFinite(visits)||visits<0)throw Error('Invalid KataGo visits');
  if(visits&&!legal.includes(action))throw Error('KataGo and app legality disagree: '+move.move);
  if(legal.includes(action))policy[action]+=visits;
 }
 const sum=policy.reduce((a,b)=>a+b,0);if(!(sum>0))throw Error('Empty KataGo search policy');
 for(const p of legal)policy[p]=(1-uniformMix)*policy[p]/sum+uniformMix/legal.length;
 return policy;
}
export function createKataGoAnalysis({exe,model,config,log,timeoutMs=600000,overrides=[]}){
 const child=spawn(exe,['analysis','-config',config,'-model',model,...(overrides.length?['-override-config',overrides.join(',')]:[])],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 const lines=createInterface({input:child.stdout}),output=log?createWriteStream(log):null,pending=new Map();
 let sequence=0,closed=false,stderr='',exitResolve;
 const exited=new Promise(r=>{exitResolve=r;});
 function fail(error){for(const item of pending.values()){clearTimeout(item.timer);item.reject(error);}pending.clear();}
 child.stderr.on('data',data=>{stderr=(stderr+data).slice(-16000);output?.write(data);});
 child.once('error',error=>{closed=true;fail(error);exitResolve();});
 child.stdin.on('error',error=>fail(error));
 child.once('exit',(code,signal)=>{closed=true;fail(Error('KataGo exited '+(signal??code)+'\n'+stderr));exitResolve();});
 lines.on('line',line=>{
  try{
   const reply=JSON.parse(line),item=pending.get(reply.id);
   if(!item||reply.isDuringSearch)return;
   pending.delete(reply.id);clearTimeout(item.timer);
   if(reply.error)item.reject(Error('KataGo: '+reply.error));else if(reply.warning)item.reject(Error('KataGo warning: '+reply.warning));else item.resolve(reply);
  }catch(error){fail(error);child.kill();}
 });
 return {
  query(position,options={}){
   if(closed)return Promise.reject(Error('KataGo process is closed'));
   const id=String(++sequence);
   return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(Error('KataGo query timeout'));child.kill();},timeoutMs);
    pending.set(id,{resolve,reject,timer});
    child.stdin.write(JSON.stringify({...position,...options,id})+'\n',error=>{if(error){pending.delete(id);clearTimeout(timer);reject(error);}});
   });
  },
  async dispose(){
   if(!closed)child.stdin.end();
   let timer;await Promise.race([exited,new Promise(r=>{timer=setTimeout(()=>{child.kill();r();},15000);})]);
   clearTimeout(timer);lines.close();if(output)await new Promise(r=>output.end(r));
  }
 };
}
