import {createWasmAI} from './ai-wasm.js';
import {createJSAI} from './ai-js.js';
import {AIInputError} from './ai-api.js';
export async function createV2AI(options={}){
 let current,disposed=false;
 try{current=await createWasmAI(options);}catch{current=await createJSAI(options);}
 return{
  get backend(){return current.backend;},
  async chooseMove(position,search={}){
   if(disposed)throw new Error('AI module disposed');
   search={depth:4,...search};
   try{return current.chooseMove(position,search);}
   catch(error){
    if(current.backend!=='wasm'||error instanceof AIInputError)throw error;
    try{current.dispose();}catch{}
    const replacement=await createJSAI(options);
    if(disposed){replacement.dispose();throw new Error('AI module disposed');}
    current=replacement;
    return current.chooseMove(position,search);
   }
  },
  dispose(){disposed=true;current.dispose();}
 };
}
