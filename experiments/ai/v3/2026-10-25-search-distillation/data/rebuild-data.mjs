// Rebuild the exact training inputs from immutable replay plus sparse target overlays.
// Run from repository root: node .../data/rebuild-data.mjs NEW_OUTPUT_DIRECTORY
import assert from 'node:assert/strict';
import {createReadStream,createWriteStream,readFileSync,mkdirSync,existsSync} from 'node:fs';
import {createGunzip,createGzip,gunzipSync} from 'node:zlib';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
const output=process.argv[2];if(!output||existsSync(output))throw Error('Provide a fresh output directory');
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const manifest=JSON.parse(readFileSync(new URL('./datasets.json',import.meta.url)));
mkdirSync(output,{recursive:true});
for(const set of manifest.sets){
 assert.equal(sha(set.original),set.originalSha256);
 const overlay=new URL('./'+set.overlay,import.meta.url);assert.equal(sha(overlay),set.overlaySha256);
 const rows=JSON.parse(gunzipSync(readFileSync(overlay))),targets=new Map(rows.map(r=>[r.positionId,r.target]));assert.equal(targets.size,set.targets);
 const file=createWriteStream(join(output,set.output)),gzip=createGzip();gzip.pipe(file);
 for await(const line of createInterface({input:createReadStream(set.original).pipe(createGunzip()),crlfDelay:Infinity})){
  const r=JSON.parse(line),target=targets.get(r.positionId);const updated={...r,policyEligible:!!target,policySurprise:0,...target};
  if(target)targets.delete(r.positionId);
  if(!gzip.write(JSON.stringify(updated)+'\n'))await once(gzip,'drain');
 }
 gzip.end();await once(file,'finish');assert.equal(targets.size,0);assert.equal(sha(join(output,set.output)),set.outputSha256);console.log('Exact dataset reconstructed:',set.output);
}
