import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {runStudyCommand} from './study-commands.mjs';
const directory=resolve(process.argv[2]),screen=JSON.parse(readFileSync(join(directory,'screen-report.json')));
if(!screen.passes)throw Error('KataGo teacher did not qualify');
if(existsSync(join(directory,'pipeline-state.json')))throw Error('Pipeline already started; inspect saved state before resuming');
const state={started:new Date().toISOString(),stages:[]};
async function run(name,args){
 state.current=name;writeFileSync(join(directory,'pipeline-state.json'),JSON.stringify(state,null,2)+'\n');
 try{await runStudyCommand(directory,name,process.execPath,args);state.stages.push({name,status:'complete',at:new Date().toISOString()});}
 catch(error){state.stages.push({name,status:'failed',error:error.message});writeFileSync(join(directory,'pipeline-state.json'),JSON.stringify(state,null,2)+'\n');throw error;}
}
await run('collect',['tools/ai-gnn/katago-distill-data.mjs',directory,'generate']);
await run('prepare',['tools/ai-gnn/katago-distill-prepare.mjs',directory]);
await run('train',['tools/ai-gnn/katago-distill-train.mjs',directory]);
await run('development',['tools/ai-gnn/katago-distill-evaluate.mjs',directory,'development']);
await run('independent',['tools/ai-gnn/katago-distill-evaluate.mjs',directory,'independent']);
for(const arm of ['teacher','control'])await run(arm+'-onnx',['tools/ai-gnn/test-onnx.mjs',join(directory,arm+'-model')]);
await run('teacher-browser',['tools/ai-gnn/test-browser.mjs','--model',join(directory,'teacher-model'),'--output',join(directory,'teacher-browser.json')]);
await run('speed',['tools/ai-gnn/bench-search.mjs','--a-wasm',join(directory,'search.wasm'),'--b-wasm',join(directory,'search.wasm'),
 '--a-model',join(directory,'teacher-model'),'--b-model',join(directory,'baseline'),'--positions',join(directory,'speed-positions.json'),'--repeats','7','--output',join(directory,'speed.json')]);
state.current=null;state.finished=new Date().toISOString();writeFileSync(join(directory,'pipeline-state.json'),JSON.stringify(state,null,2)+'\n');
console.log('Training and independent evaluation complete. Inspect independent-summary.json and speed.json before any model installation.');
