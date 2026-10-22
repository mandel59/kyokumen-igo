import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {matchStatistics} from './match-statistics.mjs';
const data='experiments/ai/v3/2026-10-22-learning-revision/data';
const read=name=>{const path=data+'/'+name+'.json';return JSON.parse(existsSync(path)?readFileSync(path):gunzipSync(readFileSync(path+'.gz')));};
const selection=read('search-selection'),reports={};
for(const [name,seed,role]of[['search-s1',2026102213,'development; used for search selection'],['search-s2',2026102214,'development; used for search selection'],['teacher-budget',2026102215,'predeclared budget gate using selected search and frozen weights']]){
 const r=read(name);reports[name]={role,a:r.aConfig,b:r.bConfig,...matchStatistics(r,{seed})};
}
const result={schemaVersion:1,selection,reports,
 elapsed:{searchSeconds:(Date.parse(selection.finishedSearch)-Date.parse(selection.started))/1000,
  teacherBudgetSeconds:(Date.parse(selection.finished)-Date.parse(selection.finishedSearch))/1000},
 interpretation:'Paired bootstrap describes this fixed board/opponent/opening scheme. Search variants were compared for selection; this is not the final learning evaluation.'};
writeFileSync(data+'/search-summary.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(reports).map(([k,r])=>[k,{score:r.score,games:r.games,interval95:r.pairedBootstrap.interval95}]))));
