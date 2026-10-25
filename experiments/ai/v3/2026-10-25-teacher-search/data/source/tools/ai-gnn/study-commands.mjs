import {spawn} from 'node:child_process';
import {createWriteStream,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
export async function runStudyCommand(directory,name,command,args){
 const path=directory+'/'+name;
 if(existsSync(path+'-command.json')||existsSync(path+'-log.txt'))throw new Error('Command record already exists: '+name);
 const sources=['tools/ai-gnn/train.py','tools/ai-gnn/model.py','tools/ai-gnn/node-inference.mjs','tools/ai-gnn/match.mjs',
  'tools/ai-gnn/selfplay.mjs','tools/ai-gnn/reanalyze.mjs','dist/ai-v3-search.js','dist/ai-v3-inference.js','dist/ai-v3.js','dist/ai-v3.wasm'];
 const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
 const start=Date.now(),record={command,args,started:new Date(start).toISOString(),toolHashes:Object.fromEntries(sources.map(p=>[p,hash(p)]))};
 writeFileSync(path+'-command.json',JSON.stringify(record,null,2)+'\n');
 const log=createWriteStream(path+'-log.txt'),child=spawn(command,args,{stdio:['ignore','pipe','pipe']});
 console.log('Starting',name,record.started);child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
 await new Promise(resolve=>log.end(resolve));
 record.finished=new Date().toISOString();record.elapsedSeconds=(Date.now()-start)/1000;record.exitCode=code;
 writeFileSync(path+'-command.json',JSON.stringify(record,null,2)+'\n');
 if(code!==0)throw new Error(name+' exited '+code+'; inspect '+path+'-log.txt');
 console.log('Completed',name,record.elapsedSeconds,'seconds');
}
