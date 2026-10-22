import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {prepareRustNotices} from '../prepare-rust-notices.mjs';
prepareRustNotices();
const root=new URL('../../',import.meta.url),target=new URL('tools/ai-gnn/target/',root);
mkdirSync(target,{recursive:true});
const windows=process.platform==='win32';
const common=['--edition','2021','-C','opt-level=3','-A','dead_code'];
function compile(args){
 const r=spawnSync('rustc',[...common,...args],{cwd:fileURLToPath(root),stdio:'inherit'});
 if(r.error)throw r.error;if(r.status)process.exit(r.status);
}
compile(['--target','wasm32-unknown-unknown','--crate-type','cdylib','-C','lto=fat','-C','panic=abort','-C','strip=symbols',
 'tools/ai-tuner/src/gnn-wasm.rs','-o','dist/ai-v3.wasm']);
const wasmHash=createHash('sha256').update(readFileSync(new URL('dist/ai-v3.wasm',root))).digest('hex').slice(0,12);
const searchPath=new URL('dist/ai-v3-search.js',root),searchSource=readFileSync(searchPath,'utf8');
if(!/ai-v3\.wasm\?abi=3(?:&build=[a-f0-9]+)?/.test(searchSource))throw new Error('Missing v3 WASM cache key');
writeFileSync(searchPath,searchSource.replace(/ai-v3\.wasm\?abi=3(?:&build=[a-f0-9]+)?/,'ai-v3.wasm?abi=3&build='+wasmHash));
compile(['tools/ai-tuner/gnn-data.rs','-o',fileURLToPath(new URL('gnn-data'+(windows?'.exe':''),target))]);
console.log('Built v3 WASM and bootstrap data generator.');
