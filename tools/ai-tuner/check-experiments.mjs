// Verify the real archive and documentation after moves or new experiments.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('../../',import.meta.url)),archive=path.join(repo,'experiments/ai');
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const relative=(base,p)=>path.relative(base,p).split(path.sep).join('/');
if(process.argv.includes('--artifacts')){
 const i=process.argv.indexOf('--artifacts'),dir=path.resolve(process.argv[i+1]??'');
 assert.ok(dir.startsWith(archive+path.sep),'experiment must be under experiments/ai');
 console.log(JSON.stringify(files(path.join(dir,'data')).sort().map(p=>({path:relative(dir,p),sha256:sha(p)})),null,2));
 process.exit(0);
}
const catalog=JSON.parse(fs.readFileSync(path.join(archive,'catalog.json'),'utf8'));
assert.equal(catalog.schemaVersion,1);
const ids=new Set(),registered=new Set();let artifacts=0;
for(const e of catalog.experiments){
 assert.ok(!ids.has(e.id),'duplicate ID '+e.id);ids.add(e.id);
 const dir=path.resolve(archive,e.path);assert.ok(dir.startsWith(archive+path.sep));
 const manifestPath=path.join(dir,'manifest.json');registered.add(manifestPath);
 const m=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
 assert.equal(m.schemaVersion,1);assert.equal(m.id,e.id);assert.equal(m.architecture,e.architecture);
 assert.ok(['v1','v2'].includes(m.architecture));
 assert.match(m.source?.baseCommit??m.recordedAtCommit??'',/^[a-f0-9]{7,40}$/,'missing pinned source/archive commit');
 if(m.source?.patch)assert.ok(m.artifacts.some(a=>a.path===m.source.patch),'source patch not archived');
 assert.ok(Array.isArray(m.variants)&&m.variants.length>0);
 assert.ok(fs.existsSync(path.join(dir,'README.md')));
 const expected=files(path.join(dir,'data')).map(p=>relative(dir,p)).sort();
 assert.deepEqual(m.artifacts.map(a=>a.path).sort(),expected,'unlisted or missing artifact in '+e.id);
 for(const a of m.artifacts){
  const p=path.resolve(dir,a.path);assert.ok(p.startsWith(path.join(dir,'data')+path.sep));
  assert.match(a.sha256,/^[a-f0-9]{64}$/);assert.equal(sha(p),a.sha256,e.id+': '+a.path);artifacts++;
 }
}
for(const p of files(archive).filter(p=>path.basename(p)==='manifest.json'))assert.ok(registered.has(p),'unregistered manifest '+p);
const docs=[path.join(repo,'README.md'),path.join(repo,'tools/ai-tuner/README.md'),
 ...files(path.join(repo,'docs/ai')),...files(archive),...files(path.join(repo,'tests/fixtures/ai'))].filter(p=>p.endsWith('.md'));
let links=0;
for(const doc of docs){
 const text=fs.readFileSync(doc,'utf8').replace(/\x60{3}[\s\S]*?\x60{3}/g,'');
 for(const match of text.matchAll(/\]\(([^)]+)\)/g)){
  const href=match[1];if(/^(?:https?:|mailto:|#)/.test(href))continue;
  const file=decodeURIComponent(href.split('#')[0]);
  assert.ok(fs.existsSync(path.resolve(path.dirname(doc),file)),relative(repo,doc)+': broken link '+href);links++;
 }
}
console.log('Verified '+ids.size+' experiments, '+artifacts+' artifact hashes, '+docs.length+' documents and '+links+' local links.');
