// Refresh installed npm metadata after npm ci; review catalog.json separately.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('../../',import.meta.url),project=new URL('./',import.meta.url);
const read=p=>JSON.parse(readFileSync(new URL(p,project)));
const web=new Set();
function visit(name){
 if(web.has(name))return;web.add(name);
 for(const dependency of Object.keys(read('node_modules/'+name+'/package.json').dependencies??{}))visit(dependency);
}
visit('onnxruntime-web');
const sources=['tools/ai-gnn/','tools/ai-tuner/'].map(directory=>{
 const source=directory+'package-lock.json';return{source,sourceSha256:createHash('sha256').update(readFileSync(new URL(source,root))).digest('hex')};
});
const packages=sources.flatMap(({source})=>Object.entries(JSON.parse(readFileSync(new URL(source,root))).packages).filter(([path])=>path).map(([path,entry])=>{
 const pkg=JSON.parse(readFileSync(new URL(source.replace('package-lock.json',path+'/package.json'),root)));assert.equal(pkg.version,entry.version,'Run npm ci first: '+source);
 return {name:pkg.name,version:entry.version,license:entry.license,source,
  repository:typeof pkg.repository==='string'?pkg.repository:pkg.repository?.url,
  declaredWebDependency:source===sources[0].source&&web.has(pkg.name),developmentOnly:!!entry.dev};
}));
writeFileSync(new URL('docs/third-party/node-packages.json',root),JSON.stringify({schemaVersion:1,
 source:'tools/ai-gnn/package-lock.json',sourceSha256:createHash('sha256').update(readFileSync(new URL('package-lock.json',project))).digest('hex'),
 sources,condition:'Lockfile inventory for AI runtime and compiler projects, including Node tools and types. A declared web dependency is not evidence that its code is in the shipped browser bundle.',packages},null,2)+'\n');
console.log('Inventoried '+packages.length+' Node packages.');
