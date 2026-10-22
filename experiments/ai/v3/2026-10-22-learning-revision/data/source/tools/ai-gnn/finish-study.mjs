// Build a machine-readable result and a complete artifact inventory after the final gate.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,relative,resolve} from 'node:path';
const directory='experiments/ai/v3/2026-10-22-learning-revision',data=directory+'/data';
const read=(path,optional=false)=>optional&&!existsSync(path)?null:JSON.parse(readFileSync(path,'utf8'));
const plan=read(directory+'/plan.json'),execution=read(data+'/execution.json'),selection=read(data+'/selection.json');
assert.ok(['accepted-in-experimental-slot','rejected-by-predeclared-guard'].includes(selection.status),'Final evaluation has not completed');
const second=read(data+'/second-generation.json'),search=read(data+'/search-summary.json'),reanalysis=read(data+'/round1-report.json');
const candidates=execution.candidates.map(c=>({id:'round1-t'+c.recipe,recipe:c.recipe,modelSha256:c.sha256,
 selectedEpoch:c.selectedEpoch,commonInitial:c.initialSelection,commonSelected:c.selection,
 validationCorpusSha256:c.selectionCorpusSha256,development:{games:c.score===undefined?0:96,score:c.score??null,boards:c.boards??[],eligible:c.eligible},
 modelDirectory:c.model}));
const installed=read('dist/models/v3/manifest.json');
if(selection.promoted)assert.equal(installed.sha256,selection.candidate.sha256);
const summary={schemaVersion:1,status:selection.status,finished:selection.finished,architecture:plan.baseline.architecture,
 planHistory:{initialSha256:execution.planSha256,initialSnapshot:'plan-at-start.json',effectivePlan:'../plan.json',
  effectiveSha256:createHash('sha256').update(readFileSync(directory+'/plan.json')).digest('hex'),amendments:plan.amendments??[]},
 experimentElapsedSeconds:(Date.parse(selection.finished)-Date.parse(search.selection.started))/1000,
 baseline:{sourceCommit:plan.baseline.sourceCommit,modelSha256:plan.baseline.modelSha256},
 search:{selectedFpu:search.selection.selectedFpu,comparisons:Object.fromEntries(Object.entries(search.reports).map(([k,r])=>[k,
  {role:r.role,games:r.games,score:r.score,scoreRate:r.scoreRate,interval95:r.pairedBootstrap.interval95}]))},
 preprocessing:read(data+'/preprocessing-amendment.json'),
 firstGenerationData:{selfplay:execution.selfplay,normalPositions:reanalysis.eligible,policyPositions:reanalysis.selected,
  policyPositionsByPhase:reanalysis.selectedByPhase,excludedCertified:reanalysis.excludedCertified},
 candidates,firstGenerationSelection:execution.selected,
 secondGeneration:{status:second.status,recipe:second.recipe,candidate:second.candidate,selected:second.selected,generation:second.generation},
 final:{candidate:selection.candidate,primary:selection.primary,primaryPassed:selection.primaryPassed,browser:selection.browser,browserPassed:selection.browserPassed},
 promotion:{accepted:selection.promoted,slot:'dist/models/v3',installationPackage:selection.installationPackage??null,installedModelSha256:installed.sha256},
 artifacts:{plan:'../plan.json',source:'source-manifest.json',search:'search-summary.json',training:'execution.json',
  secondGeneration:'second-generation.json',finalSelection:'selection.json',preprocessingVerification:'preprocessing-verification.json'},
 evaluationRoles:{development:'candidate-selection',primary:'held-out paired openings, same search and fixed visits',browser:'real Worker/WebGPU integration and fixed-time comparison'}};
writeFileSync(data+'/summary.json',JSON.stringify(summary,null,2)+'\n');
const artifacts=[];
function walk(path){
 for(const entry of readdirSync(path,{withFileTypes:true})){
  const file=join(path,entry.name);if(entry.isDirectory())walk(file);else if(entry.isFile()&&resolve(file)!==resolve(directory+'/manifest.json')){
   const bytes=readFileSync(file);artifacts.push({path:relative(directory,file).replaceAll('\\','/'),sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
  }
 }
}
walk(data);artifacts.sort((a,b)=>a.path.localeCompare(b.path));
const manifest={schemaVersion:1,id:'v3/2026-10-22-learning-revision',architecture:'v3',
 title:'Normal-position selection, controlled search teachers and iterative selfplay',
 source:{baseCommit:plan.baseline.sourceCommit,patch:'data/source.patch',snapshots:'data/source-manifest.json'},
 plan:{path:'plan.json',sha256:summary.planHistory.effectiveSha256},
 baseline:plan.baseline.modelSha256,variants:[...candidates.map(c=>({id:c.id,modelSha256:c.modelSha256})),
  ...(second.candidate?[{id:'round2',modelSha256:second.candidate.sha256}]:[])],
 result:{path:'data/summary.json',status:summary.status,promoted:selection.promoted,selectedModelSha256:selection.candidate.sha256},artifacts};
writeFileSync(directory+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');
for(const item of artifacts)assert.equal(createHash('sha256').update(readFileSync(join(directory,item.path))).digest('hex'),item.sha256);
console.log(JSON.stringify({status:summary.status,promoted:selection.promoted,primaryScore:selection.primary.score,
 primaryGames:selection.primary.games,browserScore:selection.browser.summary.score,artifactCount:artifacts.length}));
