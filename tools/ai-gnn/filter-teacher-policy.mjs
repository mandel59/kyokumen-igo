// Exclude impossible-to-select v2 policy labels, preserving all normal value labels.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,createReadStream,createWriteStream,existsSync,renameSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createGunzip,createGzip} from 'node:zlib';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
const directory='experiments/ai/v3/2026-10-22-learning-revision',data=directory+'/data';
const audit=JSON.parse(readFileSync(data+'/teacher-target-audit.json','utf8')),blocked=new Set(audit.blockedPositionIds);
assert.equal(blocked.size,160);assert.equal(audit.normalTargets,15387);
const execution=JSON.parse(readFileSync(data+'/execution.json','utf8'));
assert.equal(execution.status,'first-generation-selfplay');assert.equal(execution.candidates,undefined);
assert.ok(!existsSync(data+'/round1-t0-training-command.json'),'Amendment must precede all candidate training');
const planPath=directory+'/plan.json',original=readFileSync(planPath),input=data+'/teacher-annotated-unfiltered.jsonl.gz',output=data+'/teacher-annotated.jsonl.gz';
assert.ok(!existsSync(input),'Unfiltered teacher snapshot already exists');
writeFileSync(data+'/plan-at-start.json',original);
renameSync(output,input);
const file=createWriteStream(output),gzip=createGzip();gzip.pipe(file);let excluded=0,positions=0;
for await(const line of createInterface({input:createReadStream(input).pipe(createGunzip()),crlfDelay:Infinity})){
 const row=JSON.parse(line);
 if(blocked.has(row.positionId)){assert.notEqual(row.decisionReason,'certified-loss');row.policyEligible=false;row.policyExclusionReason='rule-masked-teacher-target';excluded++;}
 if(!gzip.write(JSON.stringify(row)+'\n'))await once(gzip,'drain');positions++;
}
gzip.end();await once(file,'finish');assert.equal(excluded,160);
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const amendment={stage:'measurement, before any candidate training',recordedAt:new Date().toISOString(),
 reason:'Uniform-prior replay found 160 of 15,387 normal v2 targets outside the existing v3 root rule mask.',
 change:'Set policyEligible=false for these targets in all T0/T1/T2 candidates. Preserve WDL/score/ownership labels and normalize policy source mass as planned.',
 decisionUses:'Current-position rule mask only; no game outcomes or candidate results.',
 trialsAndHyperparametersChanged:false,positions,excluded,input,inputSha256:hash(input),output,outputSha256:hash(output),
 originalPlanSha256:createHash('sha256').update(original).digest('hex')};
const plan=JSON.parse(original);plan.amendments??=[];plan.amendments.push(amendment);
writeFileSync(planPath,JSON.stringify(plan,null,2)+'\n');
writeFileSync(data+'/preprocessing-amendment.json',JSON.stringify(amendment,null,2)+'\n');console.log(JSON.stringify(amendment));
