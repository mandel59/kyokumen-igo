// Orthographic software renderer: one depth buffer for the board, grid and stones.
// The same final fragment ownership drives picking, including partly hidden stones.
import {PLANE_HALF} from './engine.js';
import {defaultOrientation,orientationFromEuler,orientationMatrix,transformPoint} from './orientation.js';
const TAU = Math.PI * 2;
const dot = (a, b) => a.x*b.x+a.y*b.y+a.z*b.z;
const cross = (a,b) => ({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const unit = v => {const n=Math.hypot(v.x,v.y,v.z)||1;return {x:v.x/n,y:v.y/n,z:v.z/n};};
const add = (a,b,s=1) => ({x:a.x+b.x*s,y:a.y+b.y*s,z:a.z+b.z*s});
export function surfaceNormal(kind,p) {
  if(kind==='sphere')return unit(p);
  if(kind==='plane')return {x:0,y:1,z:0};
  const r=Math.hypot(p.x,p.z);
  return unit({x:p.x*(1-.72/r),y:p.y,z:p.z*(1-.72/r)});
}
const radiusCache=new WeakMap(),stoneMeshCache=new WeakMap(),geometryCache=new WeakMap(),gridCache=new WeakMap(),shadowCache=new WeakMap();
export function stoneRadius(topology){
  if(radiusCache.has(topology))return radiusCache.get(topology);
  let spacing=Infinity;
  for(const [a,b] of topology.edges){const p=topology.vertices[a],q=topology.vertices[b];spacing=Math.min(spacing,Math.hypot(q.x-p.x,q.y-p.y,q.z-p.z));}
  const radius=spacing*(topology.kind==='plane'?.47:.43);radiusCache.set(topology,radius);return radius;
}
export function stoneGeometry(topology,index) {
  let cache=geometryCache.get(topology);if(!cache){cache=new Map();geometryCache.set(topology,cache);}
  if(cache.has(index))return cache.get(index);
  const p=topology.vertices[index],normal=surfaceNormal(topology.kind,p);
  const radius=stoneRadius(topology),halfHeight=radius*.42;
  const tangent=unit(cross(normal,Math.abs(normal.y)<.9?{x:0,y:1,z:0}:{x:1,y:0,z:0}));
  // Curved boards seat the stone slightly into the surface; a plane board's stone rests on top.
  const shape={center:add(p,normal,halfHeight*(topology.kind==='plane'?.92:.56)),normal,tangent,bitangent:cross(normal,tangent),radius,halfHeight};
  cache.set(index,shape);return shape;
}
function stoneMesh(topology,index,interactive){
  let cache=stoneMeshCache.get(topology);if(!cache){cache=new Map();stoneMeshCache.set(topology,cache);}
  const key=index+':'+interactive;if(cache.has(key))return cache.get(key);
  const {center,normal,tangent,bitangent,radius,halfHeight}=stoneGeometry(topology,index);
  const nu=interactive?16:32,nv=interactive?8:16,vertices=[],triangles=[];
  for(let v=0;v<=nv;v++)for(let u=0;u<=nu;u++){
    const a=u*TAU/nu,b=v*Math.PI/nv,s=Math.sin(b),c=Math.cos(b),tx=Math.cos(a)*s,ty=Math.sin(a)*s;
    const p=add(add(add(center,tangent,tx*radius),bitangent,ty*radius),normal,c*halfHeight);
    const gradient=add(add({x:0,y:0,z:0},tangent,tx/radius),bitangent,ty/radius);
    vertices.push({...p,normal:unit(add(gradient,normal,c/halfHeight))});
  }
  for(let v=0;v<nv;v++)for(let u=0;u<nu;u++){
    const a=v*(nu+1)+u,b=a+nu+1;triangles.push([a,b,a+1],[b,b+1,a+1]);
  }
  const mesh={vertices,triangles};cache.set(key,mesh);return mesh;
}
export function rotatePoint(p,rotX,rotY) {
  return transformPoint(p,orientationMatrix(Array.isArray(rotX)?rotX:orientationFromEuler(rotX,rotY)));
}
function torus(u,v){const r=.72+.28*Math.cos(v);return {x:r*Math.cos(u),y:.28*Math.sin(v),z:r*Math.sin(u)};}
// Topology and the paths on its surface do not change when the camera turns.
function gridPaths(topology){
  if(gridCache.has(topology))return gridCache.get(topology);
  const paths=topology.edges.map(([a,b])=>{
    const p=topology.vertices[a],q=topology.vertices[b],points=[],plane=topology.kind==='plane',steps=plane?1:16;
    let du=q.u-p.u,dv=q.v-p.v;if(du>Math.PI)du-=TAU;if(du< -Math.PI)du+=TAU;if(dv>Math.PI)dv-=TAU;if(dv< -Math.PI)dv+=TAU;
    for(let j=0;j<=steps;j++){
      const t=j/steps;let s;
      if(topology.kind==='sphere')s=unit({x:p.x+(q.x-p.x)*t,y:p.y+(q.y-p.y)*t,z:p.z+(q.z-p.z)*t});
      else if(plane)s={x:p.x+(q.x-p.x)*t,y:0,z:p.z+(q.z-p.z)*t};
      else s=torus(p.u+du*t,p.v+dv*t);
      points.push(add(s,surfaceNormal(topology.kind,s),.001));
    }
    return {p,q,normalP:surfaceNormal(topology.kind,p),normalQ:surfaceNormal(topology.kind,q),points};
  });
  gridCache.set(topology,paths);return paths;
}
// Star points (hoshi) of the plane boards: the corner points and the centre.
export function starPoints(topology){
  if(topology.kind!=='plane')return [];
  const n=topology.size,c=(n-1)/2,o=n>=11?3:2,stars=[[o,o],[o,n-1-o],[n-1-o,o],[n-1-o,n-1-o],[c,c]];
  return stars.map(([i,j])=>i*n+j);
}
// The goban: a solid block whose top face carries the grid, standing on four legs. It takes the
// curved boards' material (0); every face has its own vertices so it shades flat.
// Camera distance for the goban's perspective, in board units (about a 28° field of view).
export const CAMERA=4.2;
export function planeExtent(size){const step=2*PLANE_HALF/(size-1);return {half:PLANE_HALF+step*.75+.03,thickness:.2,leg:.14};}
function planeMesh(size){
  const {half,thickness,leg}=planeExtent(size),vertices=[],triangles=[];
  function box(x0,x1,y0,y1,z0,z1){
    const quad=(corners,normal)=>{
      const base=vertices.length;
      for(const [x,y,z] of corners)vertices.push({x,y,z,normal});
      triangles.push([base,base+1,base+2],[base,base+2,base+3]);
    };
    quad([[x0,y1,z0],[x0,y1,z1],[x1,y1,z1],[x1,y1,z0]],{x:0,y:1,z:0});
    quad([[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1]],{x:0,y:-1,z:0});
    quad([[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]],{x:0,y:0,z:1});
    quad([[x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0]],{x:0,y:0,z:-1});
    quad([[x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1]],{x:1,y:0,z:0});
    quad([[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0]],{x:-1,y:0,z:0});
  }
  box(-half,half,-thickness,0,-half,half);
  const inset=half*.64,foot=half*.1;
  for(const sx of [-1,1])for(const sz of [-1,1])box(sx*inset-foot,sx*inset+foot,-thickness-leg,-thickness,sz*inset-foot,sz*inset+foot);
  return {vertices,triangles};
}
const meshCache=new Map();
function boardMesh(kind,interactive,size){
  const key=kind+':'+interactive+(kind==='plane'?':'+size:'');if(meshCache.has(key))return meshCache.get(key);
  if(kind==='plane'){const mesh=planeMesh(size);meshCache.set(key,mesh);return mesh;}
  const nu=interactive?(kind==='sphere'?48:64):(kind==='sphere'?96:128),nv=interactive?(kind==='sphere'?24:32):(kind==='sphere'?48:64),vertices=[],triangles=[];
  for(let u=0;u<=nu;u++)for(let v=0;v<=nv;v++){
    const a=u*TAU/nu,b=v*(kind==='sphere'?Math.PI:TAU)/nv;
    const p=kind==='sphere'?{x:Math.sin(b)*Math.cos(a),y:Math.cos(b),z:Math.sin(b)*Math.sin(a)}:torus(a,b);
    vertices.push({...p,normal:surfaceNormal(kind,p)});
  }
  for(let u=0;u<nu;u++)for(let v=0;v<nv;v++){
    const a=u*(nv+1)+v,b=a+nv+1;triangles.push([a,b,a+1],[b,b+1,a+1]);
  }
  const mesh={vertices,triangles};meshCache.set(key,mesh);return mesh;
}
const LIGHT=unit({x:-.45,y:.7,z:1});
const HALF=unit(add(LIGHT,{x:0,y:0,z:1}));
let coverage=new Float32Array(0);
// One marker style for the 3D board and both maps. A dark under-stroke keeps each coloured ring
// readable on pale wood, white stones and black stones alike. Widths are CSS pixels; ring radii
// are fractions of the stone radius (inside a stone's rim, or around an empty point).
export const MARKER={outline:[38,54,44],selected:[255,207,75],hover:[250,248,240],neighbor:[86,200,178],width:{active:[4.6,2.6],neighbor:[3.6,1.8]},onStone:.78,aroundPoint:1.18};
// Board marks, shared by the 3D board and both maps. Shapes tell the marks apart (a dot, a cross, a ring
// on stones, a square on empty points); sizes are fractions of the stone radius.
export const MARKS={alive:[88,164,240],dead:[226,72,72],atari:[255,150,40],territory:{1:[30,42,38],2:[246,242,228]},outline:[38,54,44],aliveDot:.17,deadArm:.3,atariRing:.62,territorySquare:.42};
export const markerColor=(id,selected,hover)=>id===selected?MARKER.selected:id===hover?MARKER.hover:MARKER.neighbor;

export function renderSurface({topology,board,lastMove=null,orientation,rotX,rotY,width,height,scale=Math.min(width*.405,height*.385),centerX=width/2,centerY=height*.46,pixelRatio=1,interactive=false,marks=null}) {
  width=Math.max(1,Math.round(width));height=Math.max(1,Math.round(height));
  // The goban is shown larger than the closed boards; turned 45° from a low angle its corners may leave a narrow frame.
  if(topology.kind==='plane')scale*=1.12;
  const pixels=new Uint8ClampedArray(width*height*4),depth=new Float32Array(width*height).fill(-Infinity),owners=new Int32Array(width*height).fill(-2);
  const matrix=orientationMatrix(orientation??(rotX===undefined?defaultOrientation(topology.kind):orientationFromEuler(rotX,rotY)));
  const rotate=p=>transformPoint(p,matrix);
  // The goban is seen in perspective from a camera CAMERA units in front of its centre; the closed
  // boards stay orthographic. Depth is CAMERA·z/(CAMERA−z): it keeps the order and roughly the
  // units of z, and is affine in screen space, so it interpolates exactly across a flat triangle.
  const perspective=topology.kind==='plane';
  const toScreen=q=>{
    if(!perspective)return {x:centerX+q.x*scale,y:centerY-q.y*scale,z:q.z};
    const f=CAMERA/(CAMERA-q.z);return {x:centerX+q.x*scale*f,y:centerY-q.y*scale*f,z:q.z*f};
  };
  const project=p=>toScreen(rotate(p));
  // front > 0 when the surface faces the camera: along +z for orthographic, towards the eye in perspective.
  const vertex=(p,n)=>{const q=rotate(p),normal=rotate(n),s=toScreen(q);return {x:s.x,y:s.y,z:s.z,normal,front:perspective?CAMERA*normal.z-(normal.x*q.x+normal.y*q.y+normal.z*q.z):normal.z};};
  // A sphere enclosing the entire object projects inside this camera-space box.
  // Reject it only when EVERY pixel in the box is nearer, retaining silhouettes
  // and stones partly visible through the torus hole. Account for Float32 depth rounding.
  function occluded(center,radius){
    const q=rotate(center);let minX,maxX,minY,maxY,maxZ;
    if(!perspective){
      minX=centerX+(q.x-radius)*scale;maxX=centerX+(q.x+radius)*scale;
      minY=centerY-(q.y+radius)*scale;maxY=centerY-(q.y-radius)*scale;maxZ=q.z+radius;
    }else{
      if(q.z+radius>=CAMERA)return false;
      minX=minY=Infinity;maxX=maxY=maxZ=-Infinity;
      for(const dx of [-radius,radius])for(const dy of [-radius,radius])for(const dz of [-radius,radius]){
        const p=toScreen({x:q.x+dx,y:q.y+dy,z:q.z+dz});
        minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);maxZ=Math.max(maxZ,p.z);
      }
    }
    minX=Math.max(0,Math.floor(minX));maxX=Math.min(width-1,Math.ceil(maxX));
    minY=Math.max(0,Math.floor(minY));maxY=Math.min(height-1,Math.ceil(maxY));
    for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++)if(depth[y*width+x]<maxZ+1e-6)return false;
    return true;
  }
  const put=(x,y,z,color,owner,epsilon=0)=>{
    if(x<0||x>=width||y<0||y>=height)return;
    const i=y*width+x;if(z+epsilon<depth[i])return;
    depth[i]=Math.max(depth[i],z);owners[i]=owner;
    const o=i*4;pixels[o]=color[0];pixels[o+1]=color[1];pixels[o+2]=color[2];pixels[o+3]=255;
  };
  function triangle(a,b,c,material,owner){
    if(a.front+b.front+c.front<=0)return;
    const area=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);if(Math.abs(area)<1e-8)return;
    const minX=Math.max(0,Math.floor(Math.min(a.x,b.x,c.x))),maxX=Math.min(width-1,Math.ceil(Math.max(a.x,b.x,c.x)));
    const minY=Math.max(0,Math.floor(Math.min(a.y,b.y,c.y))),maxY=Math.min(height-1,Math.ceil(Math.max(a.y,b.y,c.y)));
    // Barycentric weights are affine in x: compute them exactly once per row, then step.
    const stepA=(b.y-c.y)/area,stepB=(c.y-a.y)/area;
    for(let y=minY;y<=maxY;y++){
     const px0=minX+.5,py=y+.5;
     let wa=((b.x-px0)*(c.y-py)-(b.y-py)*(c.x-px0))/area,wb=((c.x-px0)*(a.y-py)-(c.y-py)*(a.x-px0))/area;
     for(let x=minX;x<=maxX;x++,wa+=stepA,wb+=stepB){
      const wc=1-wa-wb;
      if(wa< -1e-7||wb< -1e-7||wc< -1e-7)continue;
      const z=wa*a.z+wb*b.z+wc*c.z,i=y*width+x;if(z<=depth[i])continue;
      if(material>=3){
        const factor=material===3?.94:material===4?.88:.79,o=i*4;
        pixels[o]*=factor;pixels[o+1]*=factor;pixels[o+2]*=factor;
        continue;
      }
      const nx=wa*a.normal.x+wb*b.normal.x+wc*c.normal.x,ny=wa*a.normal.y+wb*b.normal.y+wc*c.normal.y,nz=wa*a.normal.z+wb*b.normal.z+wc*c.normal.z;
      const inv=1/Math.sqrt(nx*nx+ny*ny+nz*nz);
      const diffuse=Math.max(0,(nx*LIGHT.x+ny*LIGHT.y+nz*LIGHT.z)*inv);
      // Below .88 the highlight adds less than half a colour level, so skip the pow.
      const h=(nx*HALF.x+ny*HALF.y+nz*HALF.z)*inv,spec=h>.88?Math.pow(h,material===1?48:material===2?32:70):0;
      const factor=material===1?.48+.62*diffuse:.57+.43*diffuse;
      const shine=spec*(material===1?115:material===2?28:8),o=i*4;
      depth[i]=z;owners[i]=owner;
      pixels[o]=(material===0?218:material===1?23:240)*factor+shine;
      pixels[o+1]=(material===0?195:material===1?30:239)*factor+shine;
      pixels[o+2]=(material===0?148:material===1?29:222)*factor+shine;pixels[o+3]=255;
     }
    }
  }
  // Anti-aliased strokes. Per-pixel coverage is kept as a maximum until flushed, so
  // polyline joints don't darken, and strokes thinner than a raster pixel fade
  // instead of breaking into dots in low-resolution drag frames.
  if(coverage.length<width*height)coverage=new Float32Array(width*height);
  const touched=[];
  function stroke(a,b,radius,epsilon){
    const half=Math.max(radius,.5),strength=radius/half,dx=b.x-a.x,dy=b.y-a.y,length2=dx*dx+dy*dy;
    const minX=Math.max(0,Math.floor(Math.min(a.x,b.x)-half-1)),maxX=Math.min(width-1,Math.ceil(Math.max(a.x,b.x)+half+1));
    const minY=Math.max(0,Math.floor(Math.min(a.y,b.y)-half-1)),maxY=Math.min(height-1,Math.ceil(Math.max(a.y,b.y)+half+1));
    for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
      const px=x+.5,py=y+.5,t=length2?Math.max(0,Math.min(1,((px-a.x)*dx+(py-a.y)*dy)/length2)):0;
      const ex=a.x+dx*t-px,ey=a.y+dy*t-py,c=strength*Math.min(1,half+.5-Math.sqrt(ex*ex+ey*ey)),i=y*width+x;
      if(c<=coverage[i]||a.z+(b.z-a.z)*t+epsilon<depth[i])continue;
      if(!coverage[i])touched.push(i);
      coverage[i]=c;
    }
  }
  function flush(color){
    for(const i of touched){
      const c=coverage[i],o=i*4;coverage[i]=0;
      if(pixels[o+3]){pixels[o]+=(color[0]-pixels[o])*c;pixels[o+1]+=(color[1]-pixels[o+1])*c;pixels[o+2]+=(color[2]-pixels[o+2])*c;}
      else{pixels[o]=color[0];pixels[o+1]=color[1];pixels[o+2]=color[2];pixels[o+3]=255*c;}
    }
    touched.length=0;
  }
  const plane=topology.kind==='plane',mesh=boardMesh(topology.kind,interactive,topology.size),vs=mesh.vertices.map(p=>vertex(p,p.normal));
  for(const [a,b,c] of mesh.triangles)triangle(vs[a],vs[b],vs[c],0,-1);
  // Grid lines follow the curved surface, not straight chords through it. A goban's lines are
  // straight and dark, with a heavier border.
  const last=topology.size-1,border=(p,q)=>plane&&(p.i===q.i&&(p.i===0||p.i===last)||p.j===q.j&&(p.j===0||p.j===last));
  const lineColor=[97,99,72];
  for(const pass of plane?[false,true]:[false]){
  for(const {p,q,normalP,normalQ,points} of gridPaths(topology)){
    let previous;
    // A closed board always hides its own far side; skip those edges before sampling them.
    if(rotate(normalP).z< -.15&&rotate(normalQ).z< -.15)continue;
    if(border(p,q)!==pass)continue;
    for(const point of points){
      const next=project(point);if(previous)stroke(previous,next,(pass?1.15:.65)*pixelRatio,.002);previous=next;
    }
  }
  flush(lineColor);
  }
  // Small surface-conforming contact shadows anchor each stone to the board.
  // Blend into the existing board/grid without changing depth or hit ownership.
  function onSurface(p){
    if(topology.kind==='sphere')return unit(p);
    if(plane)return {x:p.x,y:0,z:p.z};
    const r=Math.hypot(p.x,p.z),core={x:p.x*.72/r,y:0,z:p.z*.72/r};
    return add(core,unit({x:p.x-core.x,y:p.y,z:p.z-core.z}),.28);
  }
  let shadows=shadowCache.get(topology);if(!shadows){shadows=new Map();shadowCache.set(topology,shadows);}
  for(let index=0;index<board.length;index++)if(board[index]){
    const p=topology.vertices[index];let shadow=shadows.get(index);
    if(!shadow){
      const {tangent,bitangent,radius}=stoneGeometry(topology,index),vertices=[],triangles=[];
      const lift=q=>{const normal=surfaceNormal(topology.kind,q);vertices.push({...add(q,normal,.003),normal});};
      lift(p);let bound=0;
      for(const [r,material] of [[1.08,3],[.98,4],[.88,5]])for(let i=0;i<=20;i++){
        const angle=i*TAU/20,q=onSurface(add(add(p,tangent,radius*r*Math.cos(angle)),bitangent,radius*r*Math.sin(angle)));
        lift(q);const v=vertices.at(-1);bound=Math.max(bound,Math.hypot(v.x-p.x,v.y-p.y,v.z-p.z));
        if(i)triangles.push([0,vertices.length-2,vertices.length-1,material]);
      }
      shadow={vertices,triangles,bound};shadows.set(index,shadow);
    }
    if(occluded(p,shadow.bound))continue;
    const vertices=shadow.vertices.map(p=>vertex(p,p.normal));
    for(const [a,b,c,material] of shadow.triangles)triangle(vertices[a],vertices[b],vertices[c],material,-1);
  }
  const points=topology.vertices.map((p,i)=>({...project(p),i,visible:false}));
  // Empty intersection dots are depth-tested too; rear-face dots cannot be clicked.
  // At least one pixel centre always falls inside, so dots never vanish at low drag resolution.
  // A goban marks only its star points; its other dots are the size of a line crossing.
  // Each dot pixel takes the depth of the surface's tangent plane beneath it, so a tilted board's
  // far side of a star point stays behind marks drawn on the board. Star points are discs painted
  // on the goban and foreshorten with it, like the territory squares that cover them.
  const stars=new Set(starPoints(topology)),starRadius=Math.max(1.6*pixelRatio,stoneRadius(topology)*scale*.2);
  for(const p of points)if(!board[p.i]){
    const star=stars.has(p.i),dotRadius=!plane?Math.max(.75,1.6*pixelRatio):star?starRadius:Math.max(.75,.7*pixelRatio);
    const {normal:n,tangent,bitangent,radius}=stoneGeometry(topology,p.i),normal=rotate(n);
    if(normal.z<=0)continue;
    const v=topology.vertices[p.i],a=project(add(v,tangent,radius)),b=project(add(v,bitangent,radius));
    const ax=a.x-p.x,ay=a.y-p.y,bx=b.x-p.x,by=b.y-p.y,det=ax*by-ay*bx;
    const gx=det?((a.z-p.z)*by-(b.z-p.z)*ay)/det:0,gy=det?((b.z-p.z)*ax-(a.z-p.z)*bx)/det:0;
    // (u,v): the pixel's offset along the surface, in stone radii; the centre pixel is always kept.
    const disc=dotRadius/(scale*radius),reach=star?disc*Math.max(Math.hypot(ax,ay),Math.hypot(bx,by)):dotRadius;
    const inside=(dx,dy)=>!star||!det?Math.hypot(dx,dy)<dotRadius:Math.hypot(dx*by-dy*bx,ax*dy-ay*dx)<disc*Math.abs(det);
    for(let y=Math.floor(p.y-reach);y<=p.y+reach;y++)for(let x=Math.floor(p.x-reach);x<=p.x+reach;x++)if(inside(x+.5-p.x,y+.5-p.y)||x===Math.floor(p.x)&&y===Math.floor(p.y))put(x,y,p.z+gx*(x+.5-p.x)+gy*(y+.5-p.y),plane&&!star?lineColor:[65,76,56],p.i,.003);
  }
  for(let index=0;index<board.length;index++)if(board[index]){
    const {center,radius}=stoneGeometry(topology,index);if(occluded(center,radius))continue;
    const mesh=stoneMesh(topology,index,interactive),stone=mesh.vertices.map(p=>vertex(p,p.normal));
    for(const [a,b,c] of mesh.triangles)triangle(stone[a],stone[b],stone[c],board[index],index);
  }
  // Last-move ring lies on the curved crown and participates in occlusion.
  if(lastMove!==null&&board[lastMove]){
    const {center,normal,tangent,bitangent,radius,halfHeight}=stoneGeometry(topology,lastMove);let prev;
    for(let i=0;i<=48;i++){
      const a=i*TAU/48,r=.34,p=add(add(add(center,normal,halfHeight*Math.sqrt(1-r*r)+.001),tangent,radius*r*Math.cos(a)),bitangent,radius*r*Math.sin(a));
      const next=project(p);if(prev)stroke(prev,next,.8*pixelRatio,.001);prev=next;
    }
    flush(board[lastMove]===1?[226,201,145]:[81,104,83]);
  }
  // marks.alive / dead / atari / territory are per-point arrays (territory holds the owner colour); any may be absent.
  // Stone marks lie on the curved crown like the last-move ring and share its occlusion; territory squares lie on the board.
  function drawMarks(){
    const px=pixelRatio,radiusPx=stoneRadius(topology)*scale,dot=Math.max(1.6*px,radiusPx*MARKS.aliveDot),groups={alive:[],dead:[],atari:[]};
    for(let index=0;index<board.length;index++)if(board[index]&&(marks.alive?.[index]||marks.dead?.[index]||marks.atari?.[index])){
      const {center,normal,tangent,bitangent,radius,halfHeight}=stoneGeometry(topology,index);
      const at=(x,y)=>project(add(add(add(center,tangent,radius*x),bitangent,radius*y),normal,halfHeight*Math.sqrt(Math.max(0,1-x*x-y*y))+.001));
      if(marks.atari?.[index])for(let i=0,prev;i<=32;i++){const a=i*TAU/32,next=at(MARKS.atariRing*Math.cos(a),MARKS.atariRing*Math.sin(a));if(prev)groups.atari.push([prev,next]);prev=next;}
      // The dot is a few concentric rings, each point at its own crown height: a single depth would sink the
      // outer part of the dot into a tilted stone.
      if(marks.alive?.[index]){const c=at(0,0);groups.alive.push([c,c]);for(const ring of [.35,.7]){const r=ring*dot/radiusPx;for(let i=0,prev;i<=16;i++){const a=i*TAU/16,next=at(r*Math.cos(a),r*Math.sin(a));if(prev)groups.alive.push([prev,next]);prev=next;}}}
      if(marks.dead?.[index])for(const side of [-1,1])for(let k=0,prev;k<=6;k++){const t=(k/3-1)*MARKS.deadArm,next=at(t,side*t);if(prev)groups.dead.push([prev,next]);prev=next;}
    }
    for(const [name,lineWidth] of [['atari',1.1*px],['alive',dot*.4],['dead',1.4*px]]){
      for(const [color,extra] of [[MARKS.outline,.9*px],[MARKS[name],0]]){
        for(const [a,b] of groups[name])stroke(a,b,lineWidth+extra,.001);
        flush(color);
      }
    }
    function fill(a,b,c,color){
      const area=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);if(Math.abs(area)<1e-8)return;
      for(let y=Math.max(0,Math.floor(Math.min(a.y,b.y,c.y)));y<=Math.min(height-1,Math.ceil(Math.max(a.y,b.y,c.y)));y++)
        for(let x=Math.max(0,Math.floor(Math.min(a.x,b.x,c.x)));x<=Math.min(width-1,Math.ceil(Math.max(a.x,b.x,c.x)));x++){
          const qx=x+.5,qy=y+.5,wa=((b.x-qx)*(c.y-qy)-(b.y-qy)*(c.x-qx))/area,wb=((c.x-qx)*(a.y-qy)-(c.y-qy)*(a.x-qx))/area,wc=1-wa-wb;
          if(wa<0||wb<0||wc<0)continue;
          const i=y*width+x;if(wa*a.z+wb*b.z+wc*c.z+.004<depth[i])continue;
          const o=i*4;pixels[o]=color[0];pixels[o+1]=color[1];pixels[o+2]=color[2];pixels[o+3]=255;
        }
    }
    if(marks.territory)for(let index=0;index<board.length;index++){
      const owner=marks.territory[index];if(!owner||board[index]||rotate(surfaceNormal(topology.kind,topology.vertices[index])).z<=0)continue;
      const {tangent,bitangent,radius}=stoneGeometry(topology,index),p=topology.vertices[index];
      for(const [scaleUp,color] of [[1.3,MARKS.outline],[1,MARKS.territory[owner]]]){
        const half=radius*MARKS.territorySquare*scaleUp,corner=(sx,sy)=>{const q=onSurface(add(add(p,tangent,sx*half),bitangent,sy*half));return project(add(q,surfaceNormal(topology.kind,q),.004));};
        const [a,b,c,d]=[corner(-1,-1),corner(1,-1),corner(1,1),corner(-1,1)];fill(a,b,c,color);fill(a,c,d,color);
      }
    }
  }
  if(marks)drawMarks();
  const visibleCounts=new Uint32Array(board.length);for(let i=0;i<owners.length;i++)if(owners[i]>=0)visibleCounts[owners[i]]++;
  for(const p of points)p.visible=visibleCounts[p.i]>0;
  function pick(x,y,tolerance=12){
    const px=Math.floor(x),py=Math.floor(y);if(px<0||px>=width||py<0||py>=height)return null;
    const owner=owners[py*width+px];if(owner>=0)return owner;
    // No magnetic picking through the board or across an occluding stone.
    if(owner!==-1)return null;
    let result=null,distance=tolerance;
    for(const p of points)if(p.visible&&!board[p.i]){const d=Math.hypot(x-p.x,y-p.y);if(d<distance){distance=d;result=p.i;}}
    return result;
  }
  return {width,height,pixels,depth,owners,points,pick,project,board,topology,scale,pixelRatio};
}

// Broad, surface-following rings remain readable at every raster scale. A dark
// under-stroke separates them from pale wood/white stones; depth clipping prevents
// highlighting through the board, another stone, or the opposite torus wall.
export function highlightSurface(frame,selected,hover){
  if(selected===null&&hover===null)return frame.pixels;
  const pixels=frame.pixels.slice(),ids=new Set(selected===null?[]:[selected,...frame.topology.neighbors[selected]]);
  if(hover!==null)ids.add(hover);
  const {width,height,depth,owners,project,topology,board,scale,pixelRatio}=frame;
  function triangle(a,b,c,color,id){
    const area=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);if(Math.abs(area)<1e-8)return;
    for(let y=Math.max(0,Math.floor(Math.min(a.y,b.y,c.y)));y<=Math.min(height-1,Math.ceil(Math.max(a.y,b.y,c.y)));y++)
      for(let x=Math.max(0,Math.floor(Math.min(a.x,b.x,c.x)));x<=Math.min(width-1,Math.ceil(Math.max(a.x,b.x,c.x)));x++){
        const px=x+.5,py=y+.5,wa=((b.x-px)*(c.y-py)-(b.y-py)*(c.x-px))/area,wb=((c.x-px)*(a.y-py)-(c.y-py)*(a.x-px))/area,wc=1-wa-wb;
        if(wa<0||wb<0||wc<0)continue;
        const i=y*width+x,z=wa*a.z+wb*b.z+wc*c.z;
        if(z+.002<depth[i]||(owners[i]>=0&&owners[i]!==id))continue;
        const o=i*4;pixels[o]=color[0];pixels[o+1]=color[1];pixels[o+2]=color[2];pixels[o+3]=255;
      }
  }
  for(const id of ids){
    if(!frame.points[id]?.visible)continue;
    const shape=stoneGeometry(topology,id),{center,normal,tangent,bitangent,radius,halfHeight}=shape;
    const active=id===selected||id===hover,ringRadius=radius*(board[id]?MARKER.onStone:MARKER.aroundPoint);
    const [outlineWidth,inkWidth]=active?MARKER.width.active:MARKER.width.neighbor;
    function onRing(angle,r){
      let p;
      if(board[id]){
        const height=halfHeight*Math.sqrt(Math.max(0,1-(r/radius)**2));
        p=add(add(add(center,normal,height+.002),tangent,r*Math.cos(angle)),bitangent,r*Math.sin(angle));
      }else{
        const base=topology.vertices[id];p=add(add(base,tangent,r*Math.cos(angle)),bitangent,r*Math.sin(angle));
        if(topology.kind==='sphere')p=unit(p);
        else if(topology.kind==='plane')p={x:p.x,y:0,z:p.z};
        else{const length=Math.hypot(p.x,p.z),core={x:p.x*.72/length,y:0,z:p.z*.72/length};p=add(core,unit({x:p.x-core.x,y:p.y,z:p.z-core.z}),.28);}
        p=add(p,surfaceNormal(topology.kind,p),.002);
      }
      return project(p);
    }
    for(const [cssWidth,ink] of [[outlineWidth,MARKER.outline],[inkWidth,markerColor(id,selected,hover)]]){
      const halfWidth=cssWidth*pixelRatio/(2*scale),inner=Math.max(radius*.12,ringRadius-halfWidth),outer=board[id]?Math.min(radius*.98,ringRadius+halfWidth):ringRadius+halfWidth;
      let prevInner=onRing(0,inner),prevOuter=onRing(0,outer);
      for(let step=1;step<=64;step++){
        const angle=step*TAU/64,nextInner=onRing(angle,inner),nextOuter=onRing(angle,outer);
        triangle(prevInner,prevOuter,nextInner,ink,id);triangle(prevOuter,nextOuter,nextInner,ink,id);
        prevInner=nextInner;prevOuter=nextOuter;
      }
    }
  }
  return pixels;
}
