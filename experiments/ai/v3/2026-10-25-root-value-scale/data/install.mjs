import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const dir='tools/ai-gnn/target/root-value-scale',read=p=>JSON.parse(fs.readFileSync(p)),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const adoption=read(dir+'/adoption.json'),selection=read(dir+'/selection.json'),speed=read(dir+'/speed.json'),evaluation=read(dir+'/evaluation.json');
const chosen=selection.selected;if(!['q2','q4'].includes(chosen)||!adoption.passes||!speed.passes||adoption.summary.games!==192||adoption.summary.capped||adoption.summary.pairedBootstrap.interval95[0]<=.5||adoption.summary.boards.some(b=>b.score<12))throw Error('Adoption gates not satisfied');
if(evaluation.provenance.wasm.a!==sha(dir+'/'+chosen+'.wasm')||evaluation.provenance.wasm.b!==sha(dir+'/baseline.wasm')||sha('dist/ai-v3.wasm')!==sha(dir+'/baseline.wasm'))throw Error('Search identity mismatch');
if(read('dist/models/v3/manifest.json').sha256!=='8e5b41e3974cbd30349fa483bb8a3a0f5c055ea9bb6cddef82c63b69b88b4b9a')throw Error('Model changed');
const oldJS=fs.readFileSync('dist/ai-v3-search.js','utf8');fs.writeFileSync(dir+'/baseline-search.js',oldJS);
const binary=dir+'/'+chosen+'.wasm',source=dir+'/'+chosen+'-mcts.rs',wasmHash=sha(binary);
fs.copyFileSync(binary,'dist/ai-v3.wasm');fs.copyFileSync(source,'tools/ai-tuner/src/mcts.rs');
const nextJS=oldJS.replace(/ai-v3\.wasm\?abi=3(?:&build=[a-f0-9]+)?/,'ai-v3.wasm?abi=3&build='+wasmHash.slice(0,12));if(nextJS===oldJS)throw Error('Cache key not updated');fs.writeFileSync('dist/ai-v3-search.js',nextJS);
try{
 for(const [name,args]of [['installed-wasm',['v3-tests.mjs']],['browser-verification',['tools/ai-gnn/test-browser.mjs','--output',dir+'/browser-verification.json']]]){
  const r=spawnSync(process.execPath,args,{encoding:'utf8',windowsHide:true});fs.writeFileSync(dir+'/'+name+'.log',(r.stdout??'')+(r.stderr??''));if(r.status!==0)throw Error('Installed check failed: '+name);
 }
}catch(error){fs.copyFileSync(dir+'/baseline.wasm','dist/ai-v3.wasm');fs.copyFileSync(dir+'/baseline-mcts.rs','tools/ai-tuner/src/mcts.rs');fs.writeFileSync('dist/ai-v3-search.js',oldJS);throw error;}
if(sha('dist/ai-v3.wasm')!==wasmHash||sha('tools/ai-tuner/src/mcts.rs')!==sha(source))throw Error('Installed identity mismatch');
fs.writeFileSync(dir+'/installation.json',JSON.stringify({schemaVersion:1,installed:true,selected:chosen,scale:chosen==='q2'?.2:.4,wasm:wasmHash,source:sha(source),model:evaluation.models.a,tests:['v3-tests.mjs','test-browser.mjs'],visits:64},null,2)+'\n');
const scale=chosen==='q2'?'0.2':'0.4',summary=adoption.summary,ci=summary.pairedBootstrap.interval95.map(v=>(v*100).toFixed(1)).join('〜');
let p='docs/ai/architectures/v3.md',s=fs.readFileSync(p,'utf8');s=s.replace('log(prior) + 0.1 ×','log(prior) + '+scale+' ×');s=s.split('\n').map(l=>l.startsWith('通常対局の標準は v2 です。v3 は')?'通常対局の標準はv2です。v3は[学習改修](../../../experiments/ai/v3/2026-10-22-learning-revision/README.md)で採用した同じモデルを保ち、[根の探索評価値の重み](../../../experiments/ai/v3/2026-10-25-root-value-scale/README.md)を'+scale+'に調整しました。同じ64訪問で更新前v3に'+summary.wins+'勝'+summary.losses+'敗（独立192局、ペア95%区間'+ci+'%）。CPU/WASM・WebGPUの速度基準も通過しました。根の8候補、内部PUCT、標準64訪問は維持しています。':l).join('\n');fs.writeFileSync(p,s);
p='docs/ai/README.md';s=fs.readFileSync(p,'utf8').replace('後者はモデルと訪問数を固定した独立192局で','逐次半減の導入時はモデルと訪問数を固定した独立192局で');fs.writeFileSync(p,s);
p='tools/ai-gnn/README.md';s=fs.readFileSync(p,'utf8').replace('モデルは変更せず、独立192局で従来探索に117勝75敗でした。','逐次半減の導入時はモデルを固定した独立192局で従来探索に117勝75敗でした。');s+='\n根の比較式の評価値倍率は'+scale+'です。[倍率の比較](../../experiments/ai/v3/2026-10-25-root-value-scale/README.md)で同じ64訪問・同じモデルの独立対戦と速度基準を通過しました。\n';fs.writeFileSync(p,s);
console.log('Installed verified root Q scale',scale,wasmHash);
