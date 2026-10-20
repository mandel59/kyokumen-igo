// Pure renderer review and framebuffer fixtures, not browser screenshots.
import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTopology} from './dist/engine.js';
import {renderSurface} from './dist/surface-renderer.js';
const dir=process.env.RENDER_FIXTURE_DIR||join(tmpdir(),'surface-render-review');mkdirSync(dir,{recursive:true});
const width=390,height=430,scale=150,centerX=195,centerY=215;
function render(kind,size,rotation,filled=true){const topology=createTopology(kind,size);const board=new Int8Array(topology.vertices.length);if(filled)board.forEach((_,i)=>board[i]=i%2+1);const options={topology,board,lastMove:filled?0:null,rotX:rotation[0],rotY:rotation[1],width,height,scale,centerX,centerY};return {frame:renderSurface(options),options};}
function ppm(name,f){const rgb=Buffer.alloc(width*height*3);for(let i=0;i<width*height;i++){const alpha=f.pixels[i*4+3]/255;for(let c=0;c<3;c++)rgb[i*3+c]=Math.round(f.pixels[i*4+c]*alpha+247*(1-alpha));}writeFileSync(join(dir,`${name}.ppm`),Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`),rgb]));}
for(const [kind,size,rotation,name] of [['sphere',5,[-.26,.57],'sphere-dense'],['sphere',5,[0,0],'sphere-axis'],['torus',11,[-.65,.57],'torus-dense'],['torus',11,[Math.PI/2,0],'torus-face'],['torus',11,[0,0],'torus-edge']]){
 const {frame:f,options}=render(kind,size,rotation);assert.equal(f.pixels.length,width*height*4);assert.equal(f.depth.length,width*height);assert.equal(f.owners.length,width*height);assert.equal(f.points.length,options.board.length);
 const owned=new Map();for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=f.owners[y*width+x];if(i>=0){assert(i<options.board.length);assert(options.board[i]);assert(Number.isFinite(f.depth[y*width+x]));assert.equal(f.pick(x+.5,y+.5,0),i,`${name}: exact fragment picking`);owned.set(i,(owned.get(i)||0)+1);}}
 assert(owned.size>0);assert(owned.size<options.board.length,`${name}: back stones occluded`);ppm(name,f);
 const times=[];for(let k=0;k<5;k++){const t=performance.now();renderSurface(options);times.push(performance.now()-t)}times.sort((a,b)=>a-b);
 console.log(JSON.stringify({fixture:name,visibleStoneIds:owned.size,totalStones:options.board.length,minVisiblePixels:Math.min(...owned.values()),medianMs:+times[2].toFixed(2),maxMs:+times.at(-1).toFixed(2)}));
}
// Empty unit sphere depth must match its visible analytic hemisphere away from the limb.
const sphere=render('sphere',5,[.37,.78],false).frame;let maxError=0;for(let y=0;y<height;y+=4)for(let x=0;x<width;x+=4){const a=(x+.5-centerX)/scale,b=(centerY-y-.5)/scale,r2=a*a+b*b;if(r2<.8){const expected=Math.sqrt(1-r2);assert(Number.isFinite(sphere.depth[y*width+x]));maxError=Math.max(maxError,Math.abs(sphere.depth[y*width+x]-expected));}}
assert(maxError<.035,`sphere mesh depth error ${maxError}`);console.log('Sphere max analytic depth error',maxError);
const torus=render('torus',11,[Math.PI/2,0],false).frame;for(let y=centerY-25;y<=centerY+25;y+=5)for(let x=centerX-25;x<=centerX+25;x+=5){assert.equal(torus.pixels[(y*width+x)*4+3],0,'face-on torus hole has no board fragment');assert.equal(torus.pick(x,y,0),null,'hole has no pickable point');}
console.log(`Pure framebuffer fixtures written to ${dir}; all independent numeric renderer checks passed.`);
const {surfaceNormal,stoneGeometry,rotatePoint,highlightSurface}=await import('./dist/surface-renderer.js');
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
for(const kind of ['sphere','torus']){const t=createTopology(kind,kind==='sphere'?5:11);for(let i=0;i<t.vertices.length;i++){const p=t.vertices[i],g=stoneGeometry(t,i);assert(Math.abs(Math.hypot(g.normal.x,g.normal.y,g.normal.z)-1)<1e-12);assert(Math.abs(dot(g.normal,g.tangent))<1e-12);assert(Math.abs(dot(g.normal,g.bitangent))<1e-12);assert(Math.abs(dot(g.tangent,g.bitangent))<1e-12);assert(g.radius>0&&g.halfHeight<g.radius);if(kind==='torus'){const analytic={x:Math.cos(p.u)*Math.cos(p.v),y:Math.sin(p.v),z:Math.sin(p.u)*Math.cos(p.v)};assert(dot(analytic,g.normal)>1-1e-12,'inner-wall normal correct');}const rotated=rotatePoint(g.normal,.81,-1.7);assert(Math.abs(dot(rotated,rotated)-1)<1e-12);}}
const hf=render('torus',11,[-.65,.57]).frame,hp=highlightSurface(hf,0,1);for(let i=0;i<hf.owners.length;i++)if(hf.owners[i]<0)for(let c=0;c<4;c++)assert.equal(hp[i*4+c],hf.pixels[i*4+c],'highlight never paints over board/background occluder');
console.log('Independent surface-frame orthonormality, torus inner normals and highlight occlusion checks passed.');
