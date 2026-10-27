import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const directory=resolve(process.argv[2]),file=join(directory,'plan.json');
if(existsSync(file))throw Error('Plan already frozen');
const provenance=JSON.parse(readFileSync(join(directory,'provenance.json'))),benchmark=JSON.parse(readFileSync(join(directory,'benchmark.json')));
const plan={schemaVersion:1,id:'v3/2026-10-27-katago-distillation',created:new Date().toISOString(),baseCommit:provenance.baseCommit,
 objective:'Isolate KataGo search-policy distillation from extra training, with exact app outcomes and curved-board replay.',
 teacherModel:provenance.model,teacherVisits:benchmark.selectedVisits,baselineModel:provenance.baseline,
 rules:{area:true,positionalSuperko:true,suicide:false,deadStoneRemoval:false,komi:6.5},
 seeds:{screen:2026102721,generate:2026102722,training:2026102723,development:2026102724,independentBaseline:2026102725,independentControl:2026102726},
 screen:{gamesPerBoard:4,colourSwapped:true,minOverallScore:.75,minBoardScore:.5,excludeFromLearning:true},
 data:{boards:[7,9,11],gamesPerBoard:32,katagoSelfplay:16,v3Selfplay:16,trainPerBoard:24,validationPerBoard:8,
  validationIndices:[3,7,11,15,19,23,27,31],baselineVisits:64,concurrency:4,maxMovesPerPoint:6,uniformTeacherMix:.02,
  control:'Same roots, features, labels, split, common KataGo validation targets and sampling order; only training policy differs (baseline v3 search policy with 25% legal NN prior).',
  curveReplay:'experiments/ai/v3/2026-10-25-teacher-distillation-pilot/data/teacher4096.jsonl.gz',
  curveSplit:'Preserve deployed model train/validation origins. Never include independent evaluation games in learning.'},
 training:{epochs:16,batchSize:64,learningRate:.0001,minimumLearningRate:.00001,cosine:true,emaDecay:.99,balanced:true,
  normalTraining:true,normalSelection:true,normalizePolicy:true,bestValidation:true,checkpointEvery:4,architecture:'unchanged 64x6 / 120905 parameters',
  validation:'Common KataGo policy targets and exact app outcome/score/ownership on normal roots; selectable epochs 0/4/8/12/16 only.'},
 evaluation:{visits:64,player:'offline',komi:6.5,developmentPairsPerBoard:4,independentBaselinePairsPerBoard:16,independentControlPairsPerPlaneBoard:16,
  confidence:'95% paired bootstrap, stratified by board; colour-swapped opening pairs are resampling units.',
  adoption:{planeVsBaseline:{minScore:.60,minBoardScore:.50,minLower95:.50},planeVsControl:{minScore:.55,minLower95:.50},
   curveVsBaseline:{minScore:.50,minBoardScore:.50,minLower95:.45},noCappedOrIllegalGames:true,
   speed:{overallP95Ratio:1.05,perBoardP95Ratio:1.10},numericValidation:true},
  policy:'Do not change candidate, hyperparameters, gate or sample count after independent evaluation. Failure leaves deployed weights unchanged.'},
 licenses:{networkURL:provenance.licenses.networkURL,networkLicenseSha256:provenance.licenses.networkSha256,
  delivery:'Retain teacher provenance and NN notice with the student package as a documented attribution policy.'}};
writeFileSync(file,JSON.stringify(plan,null,2)+'\n');
console.log('Frozen plan',createHash('sha256').update(readFileSync(file)).digest('hex'));
