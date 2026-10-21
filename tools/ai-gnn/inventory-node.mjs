// Refresh installed npm metadata after npm ci; review catalog.json separately.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../../',import.meta.url),project=new URL('./',import.meta.url);
const read=p=>JSON.parse(readFileSync(new URL(p,project)));
const lock=read('package-lock.json'),web=new Set();
function visit(name){
 if(web.has(name))return;web.add(name);
 for(const dependency of Object.keys(read('node_modules/'+name+'/package.json').dependencies??{}))visit(dependency);
}
visit('onnxruntime-web');
const packages=Object.entries(lock.packages).filter(([path])=>path).map(([path,entry])=>{
 const pkg=read(path+'/package.json');assert.equal(pkg.version,entry.version,'Run npm ci first: '+path);
 return {name:pkg.name,version:entry.version,license:entry.license,
  repository:typeof pkg.repository==='string'?pkg.repository:pkg.repository?.url,
  declaredWebDependency:web.has(pkg.name),developmentOnly:!!entry.dev};
});
writeFileSync(new URL('docs/third-party/node-packages.json',root),JSON.stringify({schemaVersion:1,
 source:'tools/ai-gnn/package-lock.json',sourceSha256:createHash('sha256').update(readFileSync(new URL('package-lock.json',project))).digest('hex'),
 condition:'Lockfile inventory, including Node tools and types. A declared web dependency is not evidence that its code is in the shipped browser bundle.',packages},null,2)+'\n');
console.log('Inventoried '+packages.length+' Node packages.');
