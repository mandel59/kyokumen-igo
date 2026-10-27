// Correct patch serialization and refresh source snapshots; learning/evaluation data stay immutable.
import {readFileSync,writeFileSync,copyFileSync,readdirSync,mkdirSync,existsSync} from 'node:fs';
import {join,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root='experiments/ai/v3/2026-10-27-katago-distillation',data=join(root,'data');
const manifest=JSON.parse(readFileSync(join(root,'manifest.json')));
const added=[...readdirSync('tools/ai-gnn').filter(f=>/^katago-.*\.mjs$/.test(f)||f==='test-katago-analysis.mjs').map(f=>'tools/ai-gnn/'+f),
 'dist/licenses/KataGo-NN-LICENSE.txt','dist/licenses/KataGo-v1.18.1-LICENSE.txt',
 ...(existsSync('dist/models/v3/KataGo-NN-LICENSE.txt')?['dist/models/v3/KataGo-NN-LICENSE.txt']:[])];
const modified=['tools/ai-gnn/bench-search.mjs','tools/ai-gnn/README.md','tools/third-party.mjs','docs/ai/README.md','docs/ai/architectures/v3.md',
 'docs/third-party/catalog.json','docs/third-party/catalog.schema.json','THIRD_PARTY.md','dist/credits.html','dist/third-party-catalog.json','dist/licenses/sources.json'];
let patch=execFileSync('git',['diff','--binary',manifest.source.baseCommit,'--',...modified],{encoding:'utf8'});
for(const file of added){
 const contents=readFileSync(file,'utf8').replace(/\r\n/g,'\n'),lines=contents.endsWith('\n')?contents.slice(0,-1).split('\n'):contents.split('\n');
 patch+=`diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n`+lines.map(line=>'+'+line).join('\n')+'\n'+(contents.endsWith('\n')?'':'\\ No newline at end of file\n');
}
writeFileSync(join(data,'source.patch'),patch);
for(const file of [...added,...modified]){const destination=join(data,'source',file);mkdirSync(dirname(destination),{recursive:true});copyFileSync(file,destination);}
const report=join(root,'README.md');writeFileSync(report,readFileSync(report,'utf8').replaceAll('現行v3','基準v3'));
const notePath=join(data,'execution-notes.json'),notes=JSON.parse(readFileSync(notePath));
notes.archiveCorrection={at:new Date().toISOString(),reason:'Preserve the no-final-newline marker in the upstream engine license new-file patch. Source snapshots refreshed and report comparator named baseline v3. No learning/evaluation inputs, selected weights, seeds, gates or results changed.'};
writeFileSync(notePath,JSON.stringify(notes,null,2)+'\n');
execFileSync('git',['apply','--reverse','--check',join(data,'source.patch')],{stdio:'inherit',windowsHide:true});
const files=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(dir,e.name)):[join(dir,e.name)]);
manifest.artifacts=files(data).sort().map(file=>({path:relative(root,file).split('\\').join('/'),sha256:createHash('sha256').update(readFileSync(file)).digest('hex')}));
writeFileSync(join(root,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log('Archive patch verified; refreshed',manifest.artifacts.length,'artifact hashes.');
