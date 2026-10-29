import {readFileSync} from 'node:fs';
import {runStudyCommand} from './study-commands.mjs';
const dir='tools/ai-gnn/target/fresh-data-study-20261028',p=JSON.parse(readFileSync(dir+'/results/preflight.json'));
if(!p.newDataEligible)throw Error('Candidate did not pass registered preflight');
for(const {id} of p.results)await runStudyCommand(dir,'browser-'+id,'node',['tools/ai-gnn/test-browser.mjs','--model',dir+'/'+id+'-model','--wasm',dir+'/search.wasm','--output',dir+'/results/browser-'+id+'.json']);
