import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {runStudyCommand} from './study-commands.mjs';
const directory=resolve(process.argv[2]),state=JSON.parse(readFileSync(join(directory,'pipeline-state.json')));
if(!state.finished)throw Error('Wait for the primary pipeline to finish; do not overlap speed measurements');
await runStudyCommand(directory,'speed-nine',process.execPath,['tools/ai-gnn/bench-search.mjs',
 '--a-wasm',join(directory,'search.wasm'),'--b-wasm',join(directory,'search.wasm'),
 '--a-model',join(directory,'teacher-model'),'--b-model',join(directory,'baseline'),
 '--positions',join(directory,'speed-positions.json'),'--repeats','7','--output',join(directory,'speed-nine.json')]);
