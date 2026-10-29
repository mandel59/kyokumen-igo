// One active v3 player, selected only by the board topology.
export function v3ModelRoute(manifestURL,manifest,kind){
 if(!['plane','sphere','torus'].includes(kind))throw new Error('Invalid v3 board kind');
 const base=new URL(manifestURL),routes=manifest.modelRoutes??{};
 if(typeof routes!=='object'||Array.isArray(routes)||Object.keys(routes).some(k=>!['plane','sphere','torus'].includes(k)))throw new Error('Invalid v3 model routes');
 const route=routes[kind];
 if(!route)return{manifestURL:base,manifest,expectedModelSha256:manifest.sha256};
 if(!route||typeof route.manifest!=='string'||!/^[a-zA-Z0-9._/-]+\.json$/.test(route.manifest)||!/^[a-f0-9]{64}$/.test(route.sha256))throw new Error('Invalid v3 child manifest');
 const url=new URL(route.manifest,base),directory=new URL('.',base);
 if(url.origin!==base.origin||!url.pathname.startsWith(directory.pathname))throw new Error('v3 model route leaves its directory');
 return{manifestURL:url,manifest:undefined,expectedModelSha256:route.sha256};
}
export async function createV3ModelRouter(options,createPlayer){
 const manifestURL=new URL(options.manifestURL),manifest=options.manifest;
 let active=null,disposed=false,generation=0,disposal=null;
 const cancelled=()=>new Error('v3 cancelled');
 async function retire(state){
  if(!state)return;
  if(!state.retirement)state.retirement=(async()=>{
   const player=await state.promise.catch(()=>null);player?.cancel();
   await state.inflight?.catch(()=>{});
   await player?.dispose();state.player=null;state.inflight=null;
  })();
  return state.retirement;
 }
 function select(kind){
  if(disposed)throw cancelled();
  const route=v3ModelRoute(manifestURL,manifest,kind),key=route.manifestURL.href;
  if(active?.key===key)return active;
  const previous=active,state={key,route,player:null,inflight:null,retirement:null,promise:null};
  active=state;
  state.promise=(async()=>{
   await retire(previous);
   if(disposed||active!==state)throw cancelled();
   const player=await createPlayer({...options,...route,modelRoutes:undefined,discoverModels:false,fpu:options.fpu??manifest.search?.fpu??0});
   state.player=player;return player;
  })();
  state.promise.catch(()=>{});return state;
 }
 const initial=select(options.initialKind??'torus');await initial.promise;
 return{
  get backend(){return active?.player?.backend??'v3-loading';},
  async chooseMove(position,budget={}){
   if(disposed)throw cancelled();
   const request=++generation;active?.player?.cancel();
   const state=select(position.kind),previous=state.inflight;
   const task=(async()=>{
    await previous?.catch(()=>{});
    const player=await state.promise;
    if(disposed||request!==generation||active!==state)throw cancelled();
    const result=await player.chooseMove(position,budget);
    if(disposed||request!==generation||active!==state)throw cancelled();
    return{...result,modelSha256:state.route.expectedModelSha256};
   })();
   state.inflight=task;return task;
  },
  cancel(){generation++;active?.player?.cancel();},
  async dispose(){
   if(disposal)return disposal;disposed=true;generation++;
   const old=active;active=null;old?.player?.cancel();disposal=retire(old);return disposal;
  }
 };
}
