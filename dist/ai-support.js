// A 1-function WebAssembly module using a SIMD instruction; it validates only where SIMD exists.
const SIMD_PROBE=Uint8Array.of(0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11);

// v3 runs in a Worker: its search is WebAssembly and its model runs on ONNX Runtime, whose WASM build needs SIMD.
// There is no JavaScript version of it, so a device without these cannot use v3 at all.
export function v3Supported(env=globalThis){
  try{
    return typeof env.Worker==='function'&&typeof env.WebAssembly?.validate==='function'&&env.WebAssembly.validate(SIMD_PROBE);
  }catch{
    return false;
  }
}
