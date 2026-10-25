import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
const dir='tools/ai-gnn/target/root-value-scale';
async function run(name,script,args){
 const command={command:process.execPath,args:[script,...args],started:new Date().toISOString()},path=dir+'/'+name+'-command.json';if(existsSync(path))throw Error('Existing command: '+name);writeFileSync(path,JSON.stringify(command,null,2)+'\n');
 const child=spawn(command.command,command.args,{stdio:['ignore','pipe','pipe'],windowsHide:true}),start=Date.now();
 child.stdout.on('data',c=>{appendFileSync(dir+'/'+name+'.log',c);for(const line of String(c).split('\n'))if(/Browser games (12|24|36|48|60|72|84|96|108|120|132|144|156|168|180|192)$/.test(line.trim())||line.includes('Completed'))console.log(name,line.trim());});
 child.stderr.on('data',c=>appendFileSync(dir+'/'+name+'.log',c));
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});command.exitCode=code;command.finished=new Date().toISOString();command.elapsedSeconds=(Date.now()-start)/1000;writeFileSync(path,JSON.stringify(command,null,2)+'\n');if(code!==0)throw Error('Command failed: '+name);
}
const candidates=[];
for(const name of ['q2','q4']){
 const model=JSON.parse(readFileSync('dist/models/v3/manifest.json'));if(model.parameters!==120905||model.hidden!==64||model.blocks!==6)throw Error('Architecture drift');
 await run(name+'-development','tools/ai-gnn/browser-match.mjs',['--a','dist/models/v3','--b','dist/models/v3','--a-wasm',dir+'/'+name+'.wasm','--b-wasm',dir+'/baseline.wasm','--pairs','4','--simulations','64','--a-fpu','1','--b-fpu','1','--seed','2026102621','--role','development','--output',dir+'/'+name+'-development.json']);
 const report=JSON.parse(readFileSync(dir+'/'+name+'-development.json'));candidates.push({name,model:model.sha256,selectedEpoch:model.selectedEpoch,summary:report.summary});console.log(name,JSON.stringify(report.summary));
}
candidates.sort((a,b)=>b.summary.score-a.summary.score||(['q2','q4'].indexOf(a.name)-['q2','q4'].indexOf(b.name)));
const selected=candidates[0],selection={schemaVersion:1,candidates,selected:selected.name,passes:selected.summary.score>=27&&selected.summary.capped===0,reason:'Largest development score; ties prefer scale0.2; require >=27/48 before independent evaluation'};writeFileSync(dir+'/selection.json',JSON.stringify(selection,null,2)+'\n');
if(!selection.passes){console.log('Stopped at development gate');process.exit(0);}
await run('speed','tools/ai-gnn/bench-search.mjs',['--a-wasm',dir+'/'+selected.name+'.wasm','--b-wasm',dir+'/baseline.wasm','--a-model','dist/models/v3','--b-model','dist/models/v3','--output',dir+'/speed.json']);
const speed=JSON.parse(readFileSync(dir+'/speed.json'));if(!speed.passes){console.log('Stopped at speed gate');process.exit(0);}
await run('evaluation','tools/ai-gnn/browser-match.mjs',['--a','dist/models/v3','--b','dist/models/v3','--a-wasm',dir+'/'+selected.name+'.wasm','--b-wasm',dir+'/baseline.wasm','--pairs','16','--simulations','64','--a-fpu','1','--b-fpu','1','--seed','2026102622','--bootstrap-seed','2026102623','--role','evaluation','--output',dir+'/evaluation.json']);
const report=JSON.parse(readFileSync(dir+'/evaluation.json')),summary=report.summary,passes=summary.capped===0&&summary.pairedBootstrap.interval95[0]>.5&&summary.boards.every(b=>b.score>=12);
writeFileSync(dir+'/adoption.json',JSON.stringify({schemaVersion:1,selected:selected.name,model:selected.model,passes,summary,speedPasses:speed.passes},null,2)+'\n');console.log('Adoption',passes,JSON.stringify(summary));
