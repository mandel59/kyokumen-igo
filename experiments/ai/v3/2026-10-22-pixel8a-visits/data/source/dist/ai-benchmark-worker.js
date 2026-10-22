import {runDeviceBenchmark} from './ai-benchmark.js';
self.onmessage=async({data})=>{
 try{const result=await runDeviceBenchmark({...data,onProgress:progress=>self.postMessage({progress})});self.postMessage({result});}
 catch(error){self.postMessage({error:error.message});}
};
