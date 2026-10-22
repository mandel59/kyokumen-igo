// Validate tracked notices without npm; --prepared also verifies locally served vendor files.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const root=new URL('../',import.meta.url),read=p=>readFileSync(new URL(p,root));
const json=p=>JSON.parse(read(p)),sha=p=>createHash('sha256').update(read(p)).digest('hex');
const sources=json('dist/licenses/sources.json');
for(const entry of sources.notices){assert.ok(entry.url);assert.equal(sha('dist/licenses/'+entry.path),entry.sha256,entry.path);}
const rust=json('dist/licenses/rust/manifest.json');
assert.match(rust.version,/^rustc \d+\.\d+/);
assert.ok(rust.version.startsWith('rustc '+json('docs/third-party/catalog.json').entries.find(e=>e.id==='rust-stdlib').version+' '),'Update the Rust catalog version');
for(const entry of rust.files)assert.equal(sha('dist/licenses/rust/'+entry.path),entry.sha256,entry.path);
const node=json('docs/third-party/node-packages.json'),python=json('docs/third-party/python-packages.json');
for(const inventory of [...(node.sources??[node]),python])assert.equal(sha(inventory.source),inventory.sourceSha256,'Refresh inventory: '+inventory.source);
const lock=json(node.source),entries=(node.sources??[node]).flatMap(({source})=>Object.entries(json(source).packages).filter(([path])=>path).map(([path,entry])=>[path,entry,source]));
assert.equal(node.packages.length,entries.length);
for(const [path,entry,source]of entries){
 const name=path.replace(/^node_modules\//,''),item=node.packages.find(p=>p.name===name&&(p.source??node.source)===source);
 assert.ok(item,name);assert.equal(item.version,entry.version,name);assert.equal(item.license,entry.license,name);
}
assert.equal(lock.packages['node_modules/onnxruntime-web'].version,sources.versions.onnxruntime);
for(const file of ['THIRD_PARTY.md','dist/third-party.html']){
 const text=read(file).toString(),links=file.endsWith('.md')?[...text.matchAll(/\]\(([^)]+)\)/g)]:[...text.matchAll(/href="([^"]+)"/g)];
 for(const [,link]of links)if(!/^https?:|^#/.test(link))assert.ok(existsSync(new URL(link.split('#')[0],new URL(file,root))),file+': '+link);
}
assert.match(read('dist/index.html').toString(),/href="third-party.html"/);
if(process.argv.includes('--prepared')){
 const vendor='dist/vendor/onnxruntime/',npm='tools/ai-gnn/node_modules/onnxruntime-web/';
 for(const [copy,original]of [['LICENSE','onnxruntime-LICENSE.txt'],['ThirdPartyNotices.txt','onnxruntime-ThirdPartyNotices.txt']])
  assert.deepEqual(read(vendor+copy),read('dist/licenses/'+original));
 for(const file of ['ort.webgpu.min.mjs','ort.wasm.min.mjs','ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.asyncify.mjs'])
  assert.deepEqual(read(vendor+file),read(npm+'dist/'+file));
 for(const variant of ['', '.asyncify']){
  const file='ort-wasm-simd-threaded'+variant+'.wasm';assert.deepEqual(gunzipSync(read(vendor+file+'.gz')),read(npm+'dist/'+file));
 }
 // New external bundle code requires a fresh attribution review.
 for(const file of ['ort.webgpu.min.mjs','ort.wasm.min.mjs']){
  const map=json(npm+'dist/'+file+'.map');
  assert.ok(map.sources.length>0);
  assert.ok(map.sources.every(s=>/^(?:\.\.\/\.\.\/common\/lib\/|\.\.\/lib\/)/.test(s)),file+': review new bundled sources');
 }
}
console.log('Third-party notices: '+sources.notices.length+' snapshots, '+rust.files.length+' Rust files, '+node.packages.length+' Node / '+python.packages.length+' Python entries; links and hashes passed'+(process.argv.includes('--prepared')?'; prepared runtime bytes and bundle sources passed.':'.'));
