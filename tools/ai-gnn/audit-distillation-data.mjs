import fs from 'node:fs';import {createHash} from 'node:crypto';
import {options,newOutputs,readRows,hash,saveReport} from './browser-data-host.mjs';
import {invariant,validateSavedGame} from './selfplay-records.mjs';
const arg=options(),rowsPath=arg('--rows'),gamesPath=arg('--games'),specPath=arg('--spec'),output=arg('--output'),paired=arg('--paired'),compare=arg('--compare'),compareGames=arg('--compare-games');newOutputs([output]);invariant(rowsPath&&gamesPath&&specPath,'Missing corpus-audit inputs');
const rows=await readRows(rowsPath),games=await readRows(gamesPath),spec=JSON.parse(fs.readFileSync(specPath)),expected=new Set(spec.games.map(g=>g.gameId)),families=new Map();
for(const r of rows){if(!families.has(r.gameId))families.set(r.gameId,[]);families.get(r.gameId).push(r);}
invariant(games.length===spec.games.length&&families.size===expected.size,'Game count mismatch');const seenGames=new Set(),positions=new Set(),counts={};
for(const saved of games){const id=saved.spec.gameId;invariant(expected.has(id)&&!seenGames.has(id),'Unexpected/duplicate game');seenGames.add(id);invariant(JSON.stringify(saved.spec)===JSON.stringify(spec.games.find(g=>g.gameId===id)),'Game spec differs');validateSavedGame(saved,families.get(id)??[]);counts[saved.spec.key]=(counts[saved.spec.key]??0)+1;}
function distribution(values,legal,name){invariant(values.length===161&&values.every(v=>Number.isFinite(v)&&v>=0),'Invalid '+name);invariant(Math.abs(values.reduce((s,v)=>s+v,0)-1)<1e-5,'Unnormalized '+name);invariant(values.every((v,i)=>legal[i]||v===0),'Illegal mass '+name);}
for(const r of rows){
 invariant(!positions.has(r.positionId),'Duplicate position');positions.add(r.positionId);const n=r.kind==='sphere'?6*r.size*r.size+2:r.size*r.size;
 invariant(r.x.length===n*32&&r.x.every(Number.isFinite)&&r.global.length===8&&r.global.every(Number.isFinite),'Invalid features');invariant(r.legal.length===161&&r.legal.every(v=>typeof v==='boolean'),'Invalid legality');invariant(r.ownership.length===n&&r.ownership.every(v=>Number.isInteger(v)&&v>=0&&v<=2),'Invalid ownership');
 const ownerMargin=r.ownership.filter(v=>v===0).length-r.ownership.filter(v=>v===2).length+r.global[0]*n;invariant(Math.abs(ownerMargin-r.score)<1e-4,'Ownership and score disagree');
 distribution(r.policy,r.legal,'policy');distribution(r.validationPolicy,r.legal,'validationPolicy');invariant(typeof r.policyEligible==='boolean','Missing eligibility');invariant(Number.isInteger(r.visits)&&r.visits>=1&&r.visits<=r.requestedVisits,'Invalid visits');if(r.decisionReason!=='certified-loss')invariant(r.visits===r.requestedVisits,'Incomplete normal budget');
 invariant(r.rootWdlLogits.length===3&&r.rootWdlLogits.every(Number.isFinite),'Missing root WDL');for(const name of ['rawVisits','rootPriors','rootQ'])invariant(r.searchDiagnostics[name].length===161&&r.searchDiagnostics[name].every(Number.isFinite),'Invalid diagnostics '+name);
}
let pairedFingerprint=null;
if(paired){
 const other=await readRows(paired);invariant(other.length===rows.length,'Paired root count differs');const digest=createHash('sha256'),fields=['gameId','originGameId','positionId','kind','size','ply','toPlay','x','global','legal','wdl','score','ownership','action','playedAction','source','policyEligible','decisionReason','validationPolicy'];
 for(let i=0;i<rows.length;i++){const left=fields.map(k=>rows[i][k]),right=fields.map(k=>other[i][k]);invariant(JSON.stringify(left)===JSON.stringify(right),'Paired training input differs '+rows[i].positionId);distribution(other[i].policy,other[i].legal,'paired policy');invariant(rows[i].searchSeed===other[i].searchSeed&&rows[i].rootNoiseApplied===false&&other[i].rootNoiseApplied===false,'Paired seed/noise mismatch');digest.update(JSON.stringify(left));}
 pairedFingerprint=digest.digest('hex');
}
let sameRows=null,sameGames=null;
if(compare){sameRows=JSON.stringify(rows)===JSON.stringify(await readRows(compare));invariant(sameRows,'Serial and pooled rows differ');}
if(compareGames){sameGames=JSON.stringify(games)===JSON.stringify(await readRows(compareGames));invariant(sameGames,'Serial and pooled games differ');}
const report={schemaVersion:1,games:games.length,positions:rows.length,boards:counts,uniqueOrigins:true,allGamesReplayed:true,allLabelsConsistent:true,allPoliciesLegal:true,allNormalBudgetsExact:true,sameRows,sameGames,pairedFingerprint,inputs:Object.fromEntries([rowsPath,gamesPath,specPath,...[paired,compare,compareGames].filter(Boolean)].map(p=>[p,hash(p)])),scriptSha256:hash('tools/ai-gnn/audit-distillation-data.mjs')};saveReport(output,report);console.log(JSON.stringify({games:report.games,positions:report.positions,sameRows,sameGames,pairedFingerprint}));
