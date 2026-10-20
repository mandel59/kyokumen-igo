// Run from any directory: node tools/ai-tuner/build-wasm.mjs
import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const root=new URL('./',import.meta.url),output=new URL('../../dist/ai-engine.wasm',root);
const target=new URL('target/browser-wasm/',root);
mkdirSync(target,{recursive:true});
const built=new URL('ai-engine.wasm',target);
const result=spawnSync('rustc',[
  '--edition','2021','--target','wasm32-unknown-unknown','--crate-type','cdylib',
  '-C','opt-level=3','-C','lto=fat','-C','codegen-units=1','-C','panic=abort',
  '-C','strip=symbols','-A','dead_code','src/wasm.rs','-o',fileURLToPath(built),
],{cwd:fileURLToPath(root),stdio:'inherit'});
if(result.error)throw result.error;
if(result.status!==0) {
  console.error('Install the target with: rustup target add wasm32-unknown-unknown');
  process.exit(result.status??1);
}
const bytes=readFileSync(built);
if(process.argv.includes('--check')) {
  if(!bytes.equals(readFileSync(output))) {
    console.error('dist/ai-engine.wasm is stale. Run node tools/ai-tuner/build-wasm.mjs');
    process.exit(1);
  }
  console.log('Shipped WASM matches the Rust source.');
} else {
  writeFileSync(output,bytes);
  console.log('Built dist/ai-engine.wasm ('+bytes.length+' bytes).');
}
