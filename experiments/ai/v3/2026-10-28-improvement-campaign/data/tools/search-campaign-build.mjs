import {spawnSync} from 'node:child_process';import {readFileSync,writeFileSync,existsSync} from 'node:fs';import {createHash} from 'node:crypto';
const dir='tools/ai-gnn/target/search-campaign-20261028',plan=JSON.parse(readFileSync(dir+'/plan.json')),rows=[];
for(const id of ['A8',...plan.variants.map(x=>x.id)]){const src=dir+'/builds/'+id+'/gnn-wasm.rs',output=dir+'/'+id+'.wasm';if(existsSync(output))throw Error('Build exists '+id);
 const args=['--edition','2021','-C','opt-level=3','-A','dead_code','--target','wasm32-unknown-unknown','--crate-type','cdylib','-C','lto=fat','-C','panic=abort','-C','strip=symbols',src,'-o',output];
 const r=spawnSync('rustc',args,{encoding:'utf8',windowsHide:true});writeFileSync(dir+'/logs/build-'+id+'.log',(r.stdout??'')+(r.stderr??''));if(r.error||r.status)throw Error(r.stderr||r.error?.message);
 const testArgs=['--edition','2021','-C','opt-level=2','-A','dead_code','--test',src,'-o',dir+'/'+id+'-tests.exe'];const t=spawnSync('rustc',testArgs,{encoding:'utf8',windowsHide:true});if(t.status)throw Error(t.stderr);const tests=spawnSync(dir+'/'+id+'-tests.exe',[],{encoding:'utf8',windowsHide:true});writeFileSync(dir+'/logs/tests-'+id+'.log',(tests.stdout??'')+(tests.stderr??''));if(tests.status)throw Error(tests.stdout+tests.stderr);
 rows.push({id,args,testArgs,testsExitCode:tests.status,sha256:createHash('sha256').update(readFileSync(output)).digest('hex')});console.log('Built and tested',id);
}writeFileSync(dir+'/builds.json',JSON.stringify(rows,null,2)+'\n');
