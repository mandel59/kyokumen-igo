// Fixed v3 FP32 kernels: sparse neighbours and fused residual blocks.
// Weight format v1 follows model.py registration order; matrices are [input,output].
function layout(){
 let offset=0;const take=n=>{const start=offset;offset+=n;return start;};
 const linear=(input,output,bias=true)=>({w:take(input*output),b:bias?take(output):0});
 const input=linear(32,64),blocks=Array.from({length:6},()=>({local:linear(64,64),near:linear(64,64,false),context:linear(72,64),out:linear(64,64)}));
 const head=(input,width,output)=>({first:linear(input,width),last:linear(width,output)});
 return {input,blocks,policy:head(64,32,1),passing:head(72,32,1),value:head(72,64,3),score:head(72,64,1),ownership:head(64,32,3),length:offset};
}
function shader(m,batch){
 const a=key=>'array<u32,6>('+m.blocks.map(b=>b[key.split('.')[0]][key.split('.')[1]]+'u').join(',')+')';
 return `
struct Edge {point:u32, weight:f32}
struct Parameters {layer:u32, fromBank:u32, toBank:u32, unused:u32}
@group(0) @binding(0) var<storage,read> features:array<f32>;
@group(0) @binding(1) var<storage,read> globals:array<f32>;
@group(0) @binding(2) var<storage,read> masks:array<f32>;
@group(0) @binding(3) var<storage,read> edges:array<Edge>;
@group(0) @binding(4) var<storage,read> weights:array<f32>;
@group(0) @binding(5) var<storage,read_write> h:array<f32>;
@group(0) @binding(6) var<storage,read_write> context:array<f32>;
@group(0) @binding(7) var<storage,read_write> results:array<f32>;
@group(0) @binding(8) var<uniform> params:Parameters;
const BANK:u32=${batch*160*64}u;
const WDL:u32=${batch*161}u;
const SCORE:u32=${batch*164}u;
const OWN:u32=${batch*165}u;
const LW=${a('local.w')};const LB=${a('local.b')};const NW=${a('near.w')};
const CW=${a('context.w')};const CB=${a('context.b')};const OW=${a('out.w')};const OB=${a('out.b')};
var<workgroup> ownH:array<f32,64>;
var<workgroup> nearH:array<f32,64>;
var<workgroup> z:array<f32,64>;
var<workgroup> pooled:array<f32,64>;
var<workgroup> maskSum:f32;
var<workgroup> hp:array<f32,32>;
var<workgroup> ho:array<f32,32>;
var<workgroup> ht:array<f32,32>;
var<workgroup> hv:array<f32,64>;
var<workgroup> hs:array<f32,64>;

@compute @workgroup_size(64)
fn input_layer(@builtin(workgroup_id) id:vec3<u32>,@builtin(local_invocation_index) c:u32){
 let p=id.x;let b=id.y;let point=b*160u+p;
 var v=weights[${m.input.b}u+c];
 for(var j=0u;j<32u;j++){v+=features[point*32u+j]*weights[${m.input.w}u+j*64u+c];}
 h[point*64u+c]=max(v,0.0)*masks[point];
}
fn pool(b:u32,c:u32,bank:u32){
 if(c==0u){var total=0.0;for(var p=0u;p<160u;p++){total+=masks[b*160u+p];}maskSum=max(total,1.0);}
 workgroupBarrier();
 var v=0.0;for(var p=0u;p<160u;p++){v+=h[bank*BANK+(b*160u+p)*64u+c]*masks[b*160u+p];}
 pooled[c]=v/maskSum;workgroupBarrier();
}
@compute @workgroup_size(64)
fn global_context(@builtin(workgroup_id) id:vec3<u32>,@builtin(local_invocation_index) c:u32){
 let b=id.y;let layer=params.layer;pool(b,c,params.fromBank);
 var v=weights[CB[layer]+c];
 for(var j=0u;j<64u;j++){v+=pooled[j]*weights[CW[layer]+j*64u+c];}
 for(var j=0u;j<8u;j++){v+=globals[b*8u+j]*weights[CW[layer]+(64u+j)*64u+c];}
 context[b*64u+c]=v;
}
@compute @workgroup_size(64)
fn residual(@builtin(workgroup_id) id:vec3<u32>,@builtin(local_invocation_index) c:u32){
 let p=id.x;let b=id.y;let point=b*160u+p;let layer=params.layer;let base=params.fromBank*BANK+b*160u*64u;
 ownH[c]=h[base+p*64u+c];var near=0.0;
 for(var k=0u;k<4u;k++){let e=edges[p*4u+k];near+=e.weight*h[base+e.point*64u+c];}
 nearH[c]=near;workgroupBarrier();
 var local=weights[LB[layer]+c];var neighbour=0.0;
 for(var j=0u;j<64u;j++){local+=ownH[j]*weights[LW[layer]+j*64u+c];neighbour+=nearH[j]*weights[NW[layer]+j*64u+c];}
 z[c]=max(local+neighbour+context[b*64u+c],0.0);workgroupBarrier();
 var v=weights[OB[layer]+c];for(var j=0u;j<64u;j++){v+=z[j]*weights[OW[layer]+j*64u+c];}
 h[params.toBank*BANK+point*64u+c]=(ownH[c]+0.25*v)*masks[point];
}
@compute @workgroup_size(64)
fn point_heads(@builtin(workgroup_id) id:vec3<u32>,@builtin(local_invocation_index) c:u32){
 let p=id.x;let b=id.y;let base=(b*160u+p)*64u;ownH[c]=h[base+c];workgroupBarrier();
 if(c<32u){
  var v=weights[${m.policy.first.b}u+c];var o=weights[${m.ownership.first.b}u+c];
  for(var j=0u;j<64u;j++){v+=ownH[j]*weights[${m.policy.first.w}u+j*32u+c];o+=ownH[j]*weights[${m.ownership.first.w}u+j*32u+c];}
  hp[c]=max(v,0.0);ho[c]=max(o,0.0);
 }
 workgroupBarrier();
 if(c==0u){var v=weights[${m.policy.last.b}u];for(var j=0u;j<32u;j++){v+=hp[j]*weights[${m.policy.last.w}u+j];}results[b*161u+p]=v;}
 if(c<3u){var v=weights[${m.ownership.last.b}u+c];for(var j=0u;j<32u;j++){v+=ho[j]*weights[${m.ownership.last.w}u+j*3u+c];}results[OWN+(b*160u+p)*3u+c]=v;}
}
@compute @workgroup_size(64)
fn global_heads(@builtin(workgroup_id) id:vec3<u32>,@builtin(local_invocation_index) c:u32){
 let b=id.y;pool(b,c,0u);
 var v=weights[${m.value.first.b}u+c];var s=weights[${m.score.first.b}u+c];var t=0.0;
 if(c<32u){t=weights[${m.passing.first.b}u+c];}
 for(var j=0u;j<72u;j++){
  var g=0.0;if(j<64u){g=pooled[j];}else{g=globals[b*8u+j-64u];}
  v+=g*weights[${m.value.first.w}u+j*64u+c];s+=g*weights[${m.score.first.w}u+j*64u+c];
  if(c<32u){t+=g*weights[${m.passing.first.w}u+j*32u+c];}
 }
 hv[c]=max(v,0.0);hs[c]=max(s,0.0);if(c<32u){ht[c]=max(t,0.0);}workgroupBarrier();
 if(c<3u){var value=weights[${m.value.last.b}u+c];for(var j=0u;j<64u;j++){value+=hv[j]*weights[${m.value.last.w}u+j*3u+c];}results[WDL+b*3u+c]=value;}
 if(c==0u){
  var passing=weights[${m.passing.last.b}u];for(var j=0u;j<32u;j++){passing+=ht[j]*weights[${m.passing.last.w}u+j];}results[b*161u+160u]=passing;
  var score=weights[${m.score.last.b}u];for(var j=0u;j<64u;j++){score+=hs[j]*weights[${m.score.last.w}u+j];}results[SCORE+b]=score;
 }
}`;
}

export async function createV3WebGPU(manifest,manifestURL,batchSize){
 const descriptor=manifest.webgpu,m=layout();
 if(!descriptor||descriptor.formatVersion!==1||descriptor.model!=='weights.f32'||descriptor.sourceSha256!==manifest.sha256||
  !/^[a-f0-9]{64}$/.test(descriptor.sha256)||m.length!==manifest.parameters)throw new Error('Incompatible v3 WebGPU weights');
 const url=new URL(descriptor.model,manifestURL);url.searchParams.set('sha256',descriptor.sha256);
 const response=await fetch(url);if(!response.ok)throw new Error('v3 GPU weights HTTP '+response.status);
 const bytes=await response.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
 if(hash!==descriptor.sha256||bytes.byteLength!==m.length*4)throw new Error('v3 GPU weights checksum mismatch');
 const adapter=await navigator.gpu?.requestAdapter();if(!adapter)throw new Error('No v3 WebGPU adapter');
 const device=await adapter.requestDevice();let disposed=false,current=null,failure=null,lastAdjacency=null;
 device.lost.then(info=>{failure='v3 GPU device lost: '+info.message;});
 device.addEventListener('uncapturederror',event=>{failure=event.error.message;event.preventDefault();});
 const buffers=[];const allocate=(size,usage)=>{const buffer=device.createBuffer({size,usage});buffers.push(buffer);return buffer;};
 try{
  const inputSizes=[batchSize*160*32,batchSize*8,batchSize*160,160*4*2,m.length,batchSize*160*64*2,batchSize*64,batchSize*645];
  const storage=inputSizes.map(n=>allocate(n*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC));
  device.queue.writeBuffer(storage[4],0,bytes);
  const readback=allocate(batchSize*645*4,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);
  const bindLayout=device.createBindGroupLayout({entries:[...inputSizes.map((_,binding)=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:binding<5?'read-only-storage':'storage'}})),
   {binding:8,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}}]});
  const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[bindLayout]}),module=device.createShaderModule({code:shader(m,batchSize)});
  const names=['input_layer','global_context','residual','point_heads','global_heads'];
  const pipelines=Object.fromEntries(await Promise.all(names.map(async name=>[name,await device.createComputePipelineAsync({layout:pipelineLayout,compute:{module,entryPoint:name}})])));
  const groups=Array.from({length:6},(_,layer)=>{
   const uniform=allocate(16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);device.queue.writeBuffer(uniform,0,Uint32Array.from([layer,layer%2,1-layer%2,0]));
   return device.createBindGroup({layout:bindLayout,entries:[...storage.map((buffer,binding)=>({binding,resource:{buffer}})),{binding:8,resource:{buffer:uniform}}]});
  });
  const widths={policy:161,wdl:3,score:1,ownership:480},offsets={policy:0,wdl:batchSize*161,score:batchSize*164,ownership:batchSize*165};
  async function evaluate(request,adjacency,auxiliary){
   const count=request.count;
   device.queue.writeBuffer(storage[0],0,request.x);device.queue.writeBuffer(storage[1],0,request.global_features);device.queue.writeBuffer(storage[2],0,request.mask);
   if(lastAdjacency!==adjacency){
    const edgeData=new ArrayBuffer(160*4*8),indices=new Uint32Array(edgeData),values=new Float32Array(edgeData);
    for(let p=0;p<160;p++){
     let k=0;for(let q=0;q<160;q++)if(adjacency[p*160+q]!==0){
      if(k===4||!Number.isFinite(adjacency[p*160+q]))throw new Error('Unsupported v3 graph adjacency');
      const slot=(p*4+k++)*2;indices[slot]=q;values[slot+1]=adjacency[p*160+q];
     }
    }
    device.queue.writeBuffer(storage[3],0,edgeData);lastAdjacency=adjacency;
   }
   const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();
   pass.setBindGroup(0,groups[0]);pass.setPipeline(pipelines.input_layer);pass.dispatchWorkgroups(160,count);
   for(let layer=0;layer<6;layer++){
    pass.setBindGroup(0,groups[layer]);pass.setPipeline(pipelines.global_context);pass.dispatchWorkgroups(1,count);
    pass.setPipeline(pipelines.residual);pass.dispatchWorkgroups(160,count);
   }
   pass.setPipeline(pipelines.point_heads);pass.dispatchWorkgroups(160,count);pass.setPipeline(pipelines.global_heads);pass.dispatchWorkgroups(1,count);pass.end();
   const keys=auxiliary?Object.keys(widths):['policy','wdl'];
   for(const key of keys)encoder.copyBufferToBuffer(storage[7],offsets[key]*4,readback,offsets[key]*4,count*widths[key]*4);
   device.queue.submit([encoder.finish()]);await readback.mapAsync(GPUMapMode.READ);
   try{
    if(failure)throw new Error(failure);const data=readback.getMappedRange();
    return Object.fromEntries(keys.map(key=>[key,new Float32Array(data,offsets[key]*4,count*widths[key]).slice()]));
   }finally{readback.unmap();}
  }
  return {
   async evaluate(request,adjacency,{auxiliary=false}={}){
    if(disposed)throw new Error('v3 inference disposed');if(current)throw new Error('v3 inference already running');if(failure)throw new Error(failure);
    try{current=evaluate(request,adjacency,auxiliary);return await current;}finally{current=null;}
   },
   async dispose(){if(!disposed){disposed=true;await current?.catch(()=>{});for(const buffer of buffers)buffer.destroy();device.destroy();}}
  };
 }catch(error){for(const buffer of buffers)buffer.destroy();device.destroy();throw error;}
}
