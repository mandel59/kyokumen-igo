import {readFileSync} from 'node:fs';
import {runStudyCommand} from './study-commands.mjs';
const dir='tools/ai-gnn/target/curve-retention-study-20261029',p=JSON.parse(readFileSync(dir+'/results/preflight.json'));
if(!p.candidateIds.length)throw Error('Candidate did not pass registered preflight');
for(const {id} of p.results.filter(r=>r.arm==='Control'||p.candidateIds.includes(r.id)))await runStudyCommand(dir,'browser-'+id,'node',['tools/ai-gnn/test-browser.mjs','--model',dir+'/'+id+'-model','--wasm',dir+'/search.wasm','--output',dir+'/results/browser-'+id+'.json']);
