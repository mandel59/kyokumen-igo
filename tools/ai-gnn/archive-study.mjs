// Preserve changed sources and archive large JSON traces without changing their contents.
import {readFileSync,writeFileSync,mkdirSync,existsSync,unlinkSync,statSync} from 'node:fs';
import {resolve,relative,join,isAbsolute} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
const directory='experiments/ai/v3/2026-10-22-learning-revision',data=directory+'/data',root=resolve('.');
const baseCommit='69caea83f6d32e1b6d3cddba70f0b49916b68b40';
const hash=b=>createHash('sha256').update(b).digest('hex');
const git=args=>{const r=spawnSync('git',args,{encoding:'utf8',maxBuffer:64*1024*1024});if(r.status!==0)throw new Error(r.stderr);return r.stdout;};
const untracked=new Set(git(['ls-files','--others','--exclude-standard']).trim().split('\n'));
const paths=new Set([...git(['diff','--name-only',baseCommit]).trim().split('\n'),...untracked]);
const inScope=p=>/^tools\/ai-gnn\/[^/]+\.(mjs|py|md|toml|json|lock)$/.test(p)||
 ['tools/ai-tuner/src/mcts.rs','tools/ai-tuner/src/gnn-wasm.rs','tools/ai-tuner/check-experiments.mjs',
  'experiments/ai/catalog.json','experiments/ai/README.md',directory+'/README.md',
  'THIRD_PARTY.md','docs/third-party/catalog.json','docs/ai/architectures/v3.md',
  'dist/third-party-catalog.json','dist/credits.html','dist/licenses/index.html','tests/fixtures/ai/v3-golden.json',directory+'/plan.json'].includes(p)||
 p.startsWith('dist/ai-v3')||p.startsWith('dist/models/v3/');
const sources=[];
for(const path of [...paths].sort()){
 if(!path||!inScope(path)||!existsSync(path)||!statSync(path).isFile())continue;
 const bytes=readFileSync(path),snapshot=join(data,'source',path);mkdirSync(resolve(snapshot,'..'),{recursive:true});writeFileSync(snapshot,bytes);
 sources.push({path,sha256:hash(bytes),snapshot});
}
const artifacts=[];
for(const name of['search-s1','search-s2']){
 const path=data+'/'+name+'.json';
 if(!existsSync(path)){
  if(existsSync(path+'.gz')){
   const packed=readFileSync(path+'.gz'),bytes=gunzipSync(packed);
   artifacts.push({path:path+'.gz',sha256:hash(packed),uncompressedSha256:hash(bytes),bytes:bytes.length,compressedBytes:packed.length});
  }
  continue;
 }
 const bytes=readFileSync(path),report=JSON.parse(bytes);
 if(report.summary?.games!==96||report.summary?.completed!==96)throw new Error('Cannot archive an unfinished comparison');
 const packed=gzipSync(bytes),destination=path+'.gz';writeFileSync(destination,packed);
 if(hash(gunzipSync(readFileSync(destination)))!==hash(bytes))throw new Error('Archive verification failed');
 artifacts.push({path:destination,sha256:hash(packed),uncompressedSha256:hash(bytes),bytes:bytes.length,compressedBytes:packed.length});
 // This is a single generated trace, never a recursive deletion or a user input file.
 const resolved=resolve(path),within=relative(resolve(data),resolved);
 if(!within||within.startsWith('..')||isAbsolute(within)||!statSync(resolved).isFile())throw new Error('Trace outside experiment');
 unlinkSync(resolved);
}
let patch=git(['diff','--binary',baseCommit,'--',...sources.map(s=>s.path)]);
for(const source of sources)if(untracked.has(source.path)){
 const result=spawnSync('git',['diff','--no-index','--binary','--','/dev/null',source.path],{encoding:'utf8',maxBuffer:64*1024*1024});
 if(![0,1].includes(result.status))throw new Error(result.stderr||String(result.error));patch+=result.stdout;
}
writeFileSync(data+'/source.patch',patch);
writeFileSync(data+'/source-manifest.json',JSON.stringify({schemaVersion:1,baseCommit,captured:new Date().toISOString(),patch:{path:data+'/source.patch',sha256:hash(Buffer.from(patch))},sources,compressedArtifacts:artifacts},null,2)+'\n');
console.log(JSON.stringify({sourceFiles:sources.length,compressedArtifacts:artifacts}));
