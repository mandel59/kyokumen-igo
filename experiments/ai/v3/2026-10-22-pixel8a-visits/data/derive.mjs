// Recompute the selection without changing the phone's original reports.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const boards=['sphere3','sphere4','sphere5','torus7','torus9','torus11'];
const modelSha256='8e5b41e3974cbd30349fa483bb8a3a0f5c055ea9bb6cddef82c63b69b88b4b9a';
const select=(runs,threshold)=>{let visits=0;for(const run of runs){if(run.worstBoardP95Ms>threshold)break;visits=run.visits;}return visits;};
const reports=['chrome-webgpu.json','firefox-wasm.json'].map(file=>{
 const raw=readFileSync(new URL(file,import.meta.url)),r=JSON.parse(raw);
 assert.equal(r.schemaVersion,1);assert.equal(r.targetMs,300);assert.equal(r.margin,.8);assert.equal(r.repeats,2);
 assert.equal(r.modelSha256,modelSha256);assert.deepEqual(r.runs.map(x=>x.visits),[8,16,32,64]);
 for(const run of r.runs){
  assert.equal(run.sampleCount,36);assert.equal(run.excludedCertifiedLoss,0);
  assert.deepEqual(run.perBoard.map(x=>x.board),boards);
  for(const board of run.perBoard){assert.equal(board.samples,6);assert.ok(Number.isFinite(board.p95Ms)&&board.p95Ms>=0);}
  assert.equal(run.worstBoardP95Ms,Math.max(...run.perBoard.map(x=>x.p95Ms)));
 }
 assert.equal(r.recommendedVisits,select(r.runs,r.targetMs*r.margin));
 const recommendedVisits=select(r.runs,300),chosen=r.runs.find(x=>x.visits===recommendedVisits);
 assert.equal(recommendedVisits,64);
 return{file,sha256:createHash('sha256').update(raw).digest('hex'),backend:r.backend,finished:r.finished,
  originallyReportedVisits:r.recommendedVisits,recommendedVisits,
  p95Ms:chosen.p95Ms,worstBoardP95Ms:chosen.worstBoardP95Ms,
  initializationMs:r.initializationMs,elapsedMs:r.elapsedMs};
});
const summary={schemaVersion:1,referenceDevice:'Pixel 8a',deviceProvenance:'Identified by the user; both reports pasted into chat.',
 modelSha256,policy:{sameBudgetOnAllDevices:true,targetMs:300,headroomReferenceMs:400,additionalMargin:1,
  selection:'Largest measured visit budget whose worst-board P95 is at most 300ms in both reported browsers.'},
 selectedVisits:Math.min(...reports.map(r=>r.recommendedVisits)),measuredVisits:[8,16,32,64],reports,
 limitations:['Only one run per browser on one user-provided Pixel 8a; power/thermal conditions were not recorded.',
  'Each board has six samples per budget, so the reported nearest-rank P95 equals the maximum of those six samples.',
  'Per-move raw samples were omitted by the original sharing UI; per-board P95 and counts are preserved.',
  'The original benchmark stopped at 64 because of the superseded 240ms threshold. Higher budgets were not measured.',
  'This is latency calibration. Strength at 64 visits was not measured by this experiment.']};
if(process.argv.includes('--check')){
 assert.deepEqual(JSON.parse(readFileSync(new URL('summary.json',import.meta.url))),summary);
 console.log('Pixel 8a reports verified: both browsers select 64 visits against 300ms, with no additional margin.');
}else if(process.argv.includes('--output')){
 const out=process.argv[process.argv.indexOf('--output')+1];assert.ok(out);assert.equal(existsSync(out),false,'Refusing to overwrite a result');
 writeFileSync(out,JSON.stringify(summary,null,2)+'\n');
}else console.log(JSON.stringify(summary,null,2));
