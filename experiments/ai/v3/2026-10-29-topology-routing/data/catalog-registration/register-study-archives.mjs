// Bring study manifests into the existing catalog without rewriting original experiment evidence.
import assert from'node:assert/strict';
import{readFileSync,writeFileSync,readdirSync,mkdirSync,existsSync}from'node:fs';
import{join,relative}from'node:path';
import{createHash}from'node:crypto';
import{execFileSync}from'node:child_process';
import{gunzipSync}from'node:zlib';
const root='experiments/ai',catalogPath=root+'/catalog.json',catalog=JSON.parse(readFileSync(catalogPath)),commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),hash=b=>createHash('sha256').update(b).digest('hex');
const studies=[
 ['2026-10-28-root-candidate-recall','根の候補取りこぼしの比較',null],
 ['2026-10-28-improvement-campaign','探索6案・学習5案の改善実験',null],
 ['2026-10-28-research-informed-study','学習専用の軟方策補助出力の比較',['Control','Soft4']],
 ['2026-10-28-fresh-teacher-pilot','平面KataGo教師の収集パイロット',['deployed-v3','KataGo-512']],
 ['2026-10-28-fresh-data-study','新規平面教師データ追加の比較',['Control','NewData']],
 ['2026-10-29-curve-retention','曲面保持とcompleted-Q教師の比較',['Control','CurveGuard','CompletedQ']],
 ['2026-10-29-topology-routing','盤面別の固定モデル切替の比較',['Routed-r0']]
];
const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]);
const read=p=>JSON.parse(readFileSync(p));
for(const[name,title,ids]of studies){
 const dir=root+'/v3/'+name,path=dir+'/manifest.json',id='v3/'+name;
 assert.ok(existsSync(path),'Completed study archive required: '+path);
 const bytes=readFileSync(path),m=JSON.parse(bytes);
 for(const f of m.files??m.archives??[]){
  const stored=readFileSync(join(dir,f.archive??f.path)),expected=f.storedSha256??f.sha256;
  assert.equal(hash(stored),expected,'Existing evidence changed: '+(f.archive??f.path));
  const original=f.compressed||f.encoding==='gzip'?gunzipSync(stored):stored;
  if(f.originalSha256??f.sourceSha256)assert.equal(hash(original),f.originalSha256??f.sourceSha256,'Original evidence changed');
 }
 if(!m.catalogRegistration){
  // Preserve exact pre-registration manifest bytes; do not edit archived models, traces, plans or source.
  const extra=dir+'/data/catalog-registration';mkdirSync(extra,{recursive:true});
  writeFileSync(extra+'/original-manifest.json',bytes);
  writeFileSync(extra+'/register-study-archives.mjs',readFileSync(new URL(import.meta.url)));
  m.id=id;m.architecture='v3';m.recordedAtCommit=commit;
  m.source={...(m.source??{}),...(m.baseCommit?{baseCommit:m.baseCommit}:{}),kind:'archived-source-snapshots',description:'Execution is pinned by archived source and artifact SHA-256. recordedAtCommit identifies catalog registration; it does not claim dirty execution sources were committed.',originalManifest:{path:'data/catalog-registration/original-manifest.json',sha256:hash(bytes)}};
  if(!m.variants){
   if(ids)m.variants=ids.map(id=>({id}));
   else if(name.endsWith('root-candidate-recall'))m.variants=read(dir+'/plan.json').variants;
   else m.variants=[...read(dir+'/data/search/plan.json').variants,...read(dir+'/data/heads/plan.json').training.arms,...read(dir+'/data/scope/plan.json').training.arms];
  }
  if(existsSync(dir+'/plan.json'))m.plan={path:'plan.json',sha256:hash(readFileSync(dir+'/plan.json'))};
  m.catalogRegistration={registered:new Date().toISOString(),preservedOriginalManifestSha256:hash(bytes),policy:'Original evidence and original file tables retained; artifacts is the complete stored-file inventory including this registration evidence.'};
 }
 m.artifacts=walk(dir+'/data').sort().map(p=>({path:relative(dir,p).replaceAll('\\','/'),sha256:hash(readFileSync(p))}));
 writeFileSync(path,JSON.stringify(m,null,2)+'\n');
 if(!catalog.experiments.some(e=>e.id===id))catalog.experiments.push({id,architecture:'v3',title,path:id+'/'});
 console.log(id,m.artifacts.length,'artifacts registered');
}
writeFileSync(catalogPath,JSON.stringify(catalog,null,2)+'\n');
const index=root+'/README.md';let text=readFileSync(index,'utf8');const heading='## 2026年10月28〜29日の追加実験';
if(!text.includes(heading)){text+='\n'+heading+'\n\n'+studies.map(([name,title])=>'- ['+title+'](v3/'+name+'/README.md)').join('\n')+'\n';writeFileSync(index,text);}
