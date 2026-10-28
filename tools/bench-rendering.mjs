// CPU framebuffer timings; optionally check exact output against a Git revision.
// node tools/bench-rendering.mjs --baseline <revision>
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpus} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createTopology} from '../dist/engine.js';
import {renderSurface,highlightSurface} from '../dist/surface-renderer.js';
import {defaultOrientation,orientationFromEuler} from '../dist/orientation.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const baselineIndex=process.argv.indexOf('--baseline'),revision=baselineIndex<0?null:process.argv[baselineIndex+1];
if(baselineIndex>=0&&!revision)throw Error('--baseline requires a Git revision');
let baseline;
if(revision){
  const source=execFileSync('git',['show',`${revision}:dist/surface-renderer.js`],{cwd:root,encoding:'utf8'})
    .replace(/from '(\.\/[^']+)'/g,(_,path)=>`from '${new URL(path,new URL('../dist/surface-renderer.js',import.meta.url)).href}'`);
  baseline=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
}
const sizes={sphere:[3,4,5],torus:[7,9,11],plane:[7,9,11]};
let verified=0;
// Cover limbs, the torus hole, perspective, inverted views, marks and picking.
if(baseline)for(const [kind,boardSizes] of Object.entries(sizes))for(const size of boardSizes){
  const topology=createTopology(kind,size),n=topology.vertices.length;
  for(const [rotX,rotY] of [[0,0],[Math.PI/2,.4],[-.65,.57],[.9,2.1],[2.8,-1.2]])for(const interactive of [true,false]){
    const board=Int8Array.from({length:n},(_,i)=>i%5<3?i%2+1:0);
    const marks=Object.fromEntries(['alive','dead','atari','territory'].map((name,k)=>[name,Uint8Array.from(board,(_,i)=>i%7===k?i%2+1:0)]));
    const options={topology,board,lastMove:0,marks,rotX,rotY,interactive,width:interactive?216:390,height:interactive?240:430,pixelRatio:interactive?.65:1.5};
    const expected=baseline.renderSurface(options),actual=renderSurface(options),label=`${kind}${size} ${rotX},${rotY} interactive=${interactive}`;
    for(const key of ['pixels','depth','owners','points'])assert.deepEqual(actual[key],expected[key],`${label} ${key}`);
    const visible=actual.points.filter(p=>p.visible),selected=visible[0]?.i??null,hover=visible.at(-1)?.i??null;
    assert.deepEqual(highlightSurface(actual,selected,hover),baseline.highlightSurface(expected,selected,hover),`${label} highlight`);
    for(let y=0;y<actual.height;y+=7)for(let x=0;x<actual.width;x+=7)assert.equal(actual.pick(x+.5,y+.5),expected.pick(x+.5,y+.5),`${label} pick`);
    verified++;
  }
}
console.log(JSON.stringify({node:process.version,cpu:cpus()[0].model,baseline:revision,exactFrameComparisons:verified}));

const median=values=>values.toSorted((a,b)=>a-b)[Math.floor(values.length/2)];
for(const [kind,boardSizes] of Object.entries(sizes))for(const phase of ['empty','midgame','dense'])for(const interactive of [true,false]){
  const topology=createTopology(kind,boardSizes.at(-1));
  const board=Int8Array.from(topology.vertices,(_,i)=>phase==='empty'||phase==='midgame'&&i%3===0?0:i%2+1);
  const width=interactive?280:780,height=interactive?320:860;
  const options={topology,board,interactive,width,height,pixelRatio:interactive?1:2};
  const renderers=baseline?[baseline.renderSurface,renderSurface]:[renderSurface],samples=renderers.map(()=>[]);
  // Warm up caches/JIT, then alternate order to limit thermal/order bias.
  for(let round=0;round<14;round++){
    options.orientation=round%3===0?defaultOrientation(kind):orientationFromEuler(kind==='plane'?.9:-.65,.57+round*.03);
    for(const i of round%2?renderers.map((_,i)=>i).reverse():renderers.map((_,i)=>i)){
      const start=performance.now();renderers[i](options);const elapsed=performance.now()-start;
      if(round>=3)samples[i].push(elapsed);
    }
  }
  const times=samples.map(median),afterMs=+times.at(-1).toFixed(2);
  console.log(JSON.stringify({kind,phase,interactive,width,height,afterMs,...(baseline?{beforeMs:+times[0].toFixed(2),reductionPercent:+((1-times[1]/times[0])*100).toFixed(1)}:{})}));
}
