import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {Game,createTopology} from '../../dist/engine.js';
import {createKataGoAnalysis,analysisPosition,analysisPolicy} from './katago-analysis.mjs';
const directory=resolve(process.argv[2]),provenance=JSON.parse(readFileSync(join(directory,'provenance.json')));
const engine=createKataGoAnalysis({exe:provenance.engine.path,model:provenance.model.path,config:join(directory,'analysis.cfg'),log:join(directory,'benchmark-engine.log')});
const report={schemaVersion:1,started:new Date().toISOString(),provenance,measurements:[]};
try{
 const begin=performance.now();await engine.query(analysisPosition(new Game(createTopology('plane',7),6.5)),{maxVisits:8});report.startupSeconds=(performance.now()-begin)/1000;
 for(const visits of [512,2048]){
  const roots=[];for(const size of [7,9,11])for(const moves of [[],[1,0,size]]){
   const game=new Game(createTopology('plane',size),6.5);for(const move of moves)if(!game.play(move).ok)throw Error('Invalid benchmark fixture');roots.push(game);
  }
  const start=performance.now();const answers=await Promise.all(roots.map(game=>engine.query(analysisPosition(game),{maxVisits:visits,includePolicy:true})));
  const seconds=(performance.now()-start)/1000;
  const measurements=answers.map((result,i)=>{analysisPolicy(result,roots[i]);return{size:roots[i].topology.size,moves:roots[i].moves,visits:result.rootInfo.visits,best:result.moveInfos.find(m=>m.order===0)?.move};});
  report.measurements.push({requestedVisits:visits,seconds,secondsPerRoot:seconds/roots.length,roots:measurements});
  console.log(JSON.stringify(report.measurements.at(-1)));writeFileSync(join(directory,'benchmark.json'),JSON.stringify(report,null,2)+'\n');
 }
 const deep=report.measurements.find(m=>m.requestedVisits===2048);report.selectedVisits=deep.secondsPerRoot<=.25?2048:512;
 report.decision='Use 2048 if batched benchmark <=0.25 seconds/root; otherwise 512. Selection uses speed only, before collecting training games.';
 writeFileSync(join(directory,'benchmark.json'),JSON.stringify(report,null,2)+'\n');
}finally{await engine.dispose();}
