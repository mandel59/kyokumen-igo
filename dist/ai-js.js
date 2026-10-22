import {createAIAdapter} from './ai-api.js';
export async function createJSAI(options={}){
 const {instantiate}=await import('./ai-engine.generated.js');
 return createAIAdapter(instantiate(),{...options,backend:'generated-js'});
}
