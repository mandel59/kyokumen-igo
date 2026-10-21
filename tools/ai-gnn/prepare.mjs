import {mkdirSync,writeFileSync,copyFileSync} from 'node:fs';
import {createTopology} from '../../dist/engine.js';
import {readFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
const target=new URL('./target/',import.meta.url),vendor=new URL('../../dist/vendor/onnxruntime/',import.meta.url);
mkdirSync(target,{recursive:true});mkdirSync(vendor,{recursive:true});
writeFileSync(new URL('topologies.json',target),JSON.stringify([
 ['sphere',3],['sphere',4],['sphere',5],['torus',7],['torus',9],['torus',11],
].map(([kind,size])=>({kind,size,neighbors:createTopology(kind,size).neighbors}))));
for(const file of ['ort.webgpu.min.mjs','ort.wasm.min.mjs',
 'ort-wasm-simd-threaded.asyncify.mjs','ort-wasm-simd-threaded.mjs']) {
 copyFileSync(new URL('node_modules/onnxruntime-web/dist/'+file,import.meta.url),new URL(file,vendor));
}
for(const variant of ['', '.asyncify']){
 const file='ort-wasm-simd-threaded'+variant+'.wasm';
 const wasm=readFileSync(new URL('node_modules/onnxruntime-web/dist/'+file,import.meta.url));
 writeFileSync(new URL(file+'.gz',vendor),gzipSync(wasm,{level:9}));
}
const license=await fetch('https://raw.githubusercontent.com/microsoft/onnxruntime/v1.30.0/LICENSE');
if(!license.ok)throw new Error('ONNX Runtime license HTTP '+license.status);
writeFileSync(new URL('LICENSE',vendor),await license.text());
console.log('Prepared topologies and locally hosted ONNX Runtime 1.30.0.');
