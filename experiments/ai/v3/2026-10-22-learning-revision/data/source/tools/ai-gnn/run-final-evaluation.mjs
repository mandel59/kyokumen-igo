import {readFileSync,writeFileSync,existsSync,mkdirSync,copyFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runStudyCommand} from './study-commands.mjs';
import {matchStatistics} from './match-statistics.mjs';
const directory='experiments/ai/v3/2026-10-22-learning-revision',data=directory+'/data';
const plan=JSON.parse(readFileSync(directory+'/plan.json','utf8')),stage=plan.stages.find(s=>s.id==='final_evaluation');
const candidate=JSON.parse(readFileSync(data+'/final-candidate.json','utf8'));
if(!candidate.developmentEligible||existsSync(data+'/selection.json'))throw new Error('Candidate ineligible or final evaluation already recorded');
const manifest=JSON.parse(readFileSync(candidate.model+'/manifest.json','utf8'));
if(manifest.sha256!==candidate.sha256)throw new Error('Final candidate changed');
const baseline=data+'/baseline-model',run=(name,command,args)=>runStudyCommand(data,name,command,args);
const selection={schemaVersion:1,started:new Date().toISOString(),candidate,status:'primary-evaluation',promoted:false};
const save=()=>writeFileSync(data+'/selection.json',JSON.stringify(selection,null,2)+'\n');save();
try{
 await run('final-match',process.execPath,['tools/ai-gnn/match.mjs','--a',candidate.model,'--b',baseline,
  '--a-fpu',String(candidate.fpu),'--b-fpu',String(candidate.fpu),'--pairs',String(stage.primary.pairsPerBoard),
  '--simulations',String(stage.primary.visits),'--seed',String(stage.primary.seed),'--output',data+'/final-match.json']);
 const report=JSON.parse(readFileSync(data+'/final-match.json','utf8'));
 selection.primary=matchStatistics(report,stage.primary.bootstrap);const guard=stage.primary.promotionGuard;
 selection.primaryPassed=selection.primary.completed===384&&selection.primary.capped===0&&selection.primary.score>=guard.minimumScore&&
  selection.primary.boards.every(b=>b.score>=guard.minimumBoardScore)&&selection.primary.pairedBootstrap?.interval95[0]>guard.pairedBootstrapLower95StrictlyAbove;
 selection.status='browser-verification';save();
 await run('final-browser-verification',process.execPath,['tools/ai-gnn/test-browser.mjs','--model',candidate.model,'--output',data+'/final-browser-verification.json']);
 selection.status='browser-match';save();
 await run('final-browser-match',process.execPath,['tools/ai-gnn/browser-match.mjs','--a',candidate.model,'--b',baseline,
  '--a-fpu',String(candidate.fpu),'--b-fpu','0','--b-wasm',data+'/baseline-search.wasm','--pairs',String(stage.browser.pairsPerBoard),
  '--budget-ms',String(stage.browser.budgetMsPerMove),'--seed',String(stage.browser.seed),'--output',data+'/final-browser-match.json']);
 const browser=JSON.parse(readFileSync(data+'/final-browser-match.json','utf8')),bg=stage.browser.promotionGuard;
 selection.browser={summary:browser.summary,warmInference:browser.warmInference,environment:browser.environment};
 selection.browserPassed=browser.summary.completed===48&&browser.summary.capped===0&&browser.summary.score>=bg.minimumScore&&browser.warmInference.ratio<=bg.maximumRelativeWarmInferenceP95;
 if(selection.primaryPassed&&selection.browserPassed){
  if(JSON.parse(readFileSync('dist/models/v3/manifest.json','utf8')).sha256!==plan.baseline.modelSha256)throw new Error('Distribution model changed during the study');
  const accepted=data+'/accepted-model';if(existsSync(accepted))throw new Error('Installation package already exists');
  mkdirSync(accepted);
  for(const name of['model.onnx','weights.f32','weights.pt','golden.json'])copyFileSync(candidate.model+'/'+name,accepted+'/'+name);
  manifest.accepted=true;manifest.acceptance={experiment:directory,selection:'data/selection.json',primaryScore:selection.primary.score,games:384,
   sourceCandidate:candidate.model,sourceManifestSha256:createHash('sha256').update(readFileSync(candidate.model+'/manifest.json')).digest('hex')};
  writeFileSync(accepted+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');selection.installationPackage=accepted;
  try{
   await run('install-experimental-model',process.execPath,['tools/ai-gnn/install-model.mjs',accepted]);
   await run('installed-model-onnx',process.execPath,['tools/ai-gnn/test-onnx.mjs']);
  }catch(error){
   await run('restore-baseline-after-install-failure',process.execPath,['tools/ai-gnn/install-model.mjs',baseline]);
   manifest.accepted=false;writeFileSync(accepted+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');throw error;
  }
  selection.promoted=true;selection.status='accepted-in-experimental-slot';
 }else selection.status='rejected-by-predeclared-guard';
 selection.finished=new Date().toISOString();save();console.log(JSON.stringify(selection));
}catch(error){selection.status='error';selection.error=error.stack;save();throw error;}
