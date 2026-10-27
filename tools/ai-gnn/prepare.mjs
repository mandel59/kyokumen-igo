import {mkdirSync,writeFileSync,copyFileSync} from 'node:fs';
import {createTopology} from '../../dist/engine.js';
import {AI_BOARDS} from '../../dist/ai-position.js';
import {readFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const runtimeVersion='1.30.0';
assert.equal(JSON.parse(readFileSync(new URL('node_modules/onnxruntime-web/package.json',import.meta.url))).version,runtimeVersion,
 'Update the pinned third-party notices before preparing a different ONNX Runtime version');
const licenses=new URL('../../dist/licenses/',import.meta.url);
// Read the complete notices first: a missing notice must fail before copying binaries.
const license=readFileSync(new URL('onnxruntime-LICENSE.txt',licenses));
const notices=readFileSync(new URL('onnxruntime-ThirdPartyNotices.txt',licenses));
const target=new URL('./target/',import.meta.url),vendor=new URL('../../dist/vendor/onnxruntime/',import.meta.url);
mkdirSync(target,{recursive:true});mkdirSync(vendor,{recursive:true});
writeFileSync(new URL('topologies.json',target),JSON.stringify(AI_BOARDS.map(([kind,size])=>({kind,size,neighbors:createTopology(kind,size).neighbors}))));
for(const file of ['ort.webgpu.min.mjs','ort.wasm.min.mjs',
 'ort-wasm-simd-threaded.asyncify.mjs','ort-wasm-simd-threaded.mjs']) {
 copyFileSync(new URL('node_modules/onnxruntime-web/dist/'+file,import.meta.url),new URL(file,vendor));
}
for(const variant of ['', '.asyncify']){
 const file='ort-wasm-simd-threaded'+variant+'.wasm';
 const wasm=readFileSync(new URL('node_modules/onnxruntime-web/dist/'+file,import.meta.url));
 writeFileSync(new URL(file+'.gz',vendor),gzipSync(wasm,{level:9}));
}
writeFileSync(new URL('LICENSE',vendor),license);
writeFileSync(new URL('ThirdPartyNotices.txt',vendor),notices);
console.log('Prepared topologies and locally hosted ONNX Runtime 1.30.0.');
