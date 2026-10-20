// Orthographic software renderer: one depth buffer for the board, grid and stones.
// The same final fragment ownership drives picking, including partly hidden stones.
const TAU = Math.PI * 2;
const dot = (a, b) => a.x*b.x+a.y*b.y+a.z*b.z;
const cross = (a,b) => ({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const unit = v => {const n=Math.hypot(v.x,v.y,v.z)||1;return {x:v.x/n,y:v.y/n,z:v.z/n};};
const add = (a,b,s=1) => ({x:a.x+b.x*s,y:a.y+b.y*s,z:a.z+b.z*s});
export function surfaceNormal(kind,p) {
  if(kind==='sphere')return unit(p);
  const r=Math.hypot(p.x,p.z);
  return unit({x:p.x*(1-.72/r),y:p.y,z:p.z*(1-.72/r)});
}
const radiusCache=new WeakMap(),stoneMeshCache=new WeakMap();
export function stoneRadius(topology){
  if(radiusCache.has(topology))return radiusCache.get(topology);
  let spacing=Infinity;
  for(const [a,b] of topology.edges){const p=topology.vertices[a],q=topology.vertices[b];spacing=Math.min(spacing,Math.hypot(q.x-p.x,q.y-p.y,q.z-p.z));}
  const radius=spacing*.43;radiusCache.set(topology,radius);return radius;
}
export function stoneGeometry(topology,index) {
  const p=topology.vertices[index],normal=surfaceNormal(topology.kind,p);
  const radius=stoneRadius(topology),halfHeight=radius*.42;
  const tangent=unit(cross(normal,Math.abs(normal.y)<.9?{x:0,y:1,z:0}:{x:1,y:0,z:0}));
  return {center:add(p,normal,halfHeight*.56),normal,tangent,bitangent:cross(normal,tangent),radius,halfHeight};
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
  const c=Math.cos(rotY),s=Math.sin(rotY),x=p.x*c+p.z*s,z=-p.x*s+p.z*c;
  return {x,y:p.y*Math.cos(rotX)-z*Math.sin(rotX),z:p.y*Math.sin(rotX)+z*Math.cos(rotX)};
}
function torus(u,v){const r=.72+.28*Math.cos(v);return {x:r*Math.cos(u),y:.28*Math.sin(v),z:r*Math.sin(u)};}
const meshCache=new Map();
function boardMesh(kind,interactive){
  const key=kind+':'+interactive;if(meshCache.has(key))return meshCache.get(key);
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

export function renderSurface({topology,board,lastMove=null,rotX=-.26,rotY=.57,width,height,scale=Math.min(width*.405,height*.385),centerX=width/2,centerY=height*.46,pixelRatio=1,interactive=false}) {
  width=Math.max(1,Math.round(width));height=Math.max(1,Math.round(height));
  const pixels=new Uint8ClampedArray(width*height*4),depth=new Float32Array(width*height).fill(-Infinity),owners=new Int32Array(width*height).fill(-2);
  const project=p=>{const q=rotatePoint(p,rotX,rotY);return {x:centerX+q.x*scale,y:centerY-q.y*scale,z:q.z};};
  const vertex=(p,n)=>({...project(p),normal:rotatePoint(n,rotX,rotY)});
  const put=(x,y,z,color,owner,epsilon=0)=>{
    if(x<0||x>=width||y<0||y>=height)return;
    const i=y*width+x;if(z+epsilon<depth[i])return;
    depth[i]=Math.max(depth[i],z);owners[i]=owner;
    const o=i*4;pixels[o]=color[0];pixels[o+1]=color[1];pixels[o+2]=color[2];pixels[o+3]=255;
  };
  function triangle(a,b,c,material,owner){
    if(a.normal.z+b.normal.z+c.normal.z<=0)return;
    const area=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);if(Math.abs(area)<1e-8)return;
    const minX=Math.max(0,Math.floor(Math.min(a.x,b.x,c.x))),maxX=Math.min(width-1,Math.ceil(Math.max(a.x,b.x,c.x)));
    const minY=Math.max(0,Math.floor(Math.min(a.y,b.y,c.y))),maxY=Math.min(height-1,Math.ceil(Math.max(a.y,b.y,c.y)));
    for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
      const px=x+.5,py=y+.5;
      const wa=((b.x-px)*(c.y-py)-(b.y-py)*(c.x-px))/area;
      const wb=((c.x-px)*(a.y-py)-(c.y-py)*(a.x-px))/area,wc=1-wa-wb;
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
      const spec=Math.pow(Math.max(0,(nx*HALF.x+ny*HALF.y+nz*HALF.z)*inv),material===1?48:material===2?32:70);
      const factor=material===1?.48+.62*diffuse:.57+.43*diffuse;
      const shine=spec*(material===1?115:material===2?28:8),o=i*4;
      depth[i]=z;owners[i]=owner;
      pixels[o]=(material===0?218:material===1?23:240)*factor+shine;
      pixels[o+1]=(material===0?195:material===1?30:239)*factor+shine;
      pixels[o+2]=(material===0?148:material===1?29:222)*factor+shine;pixels[o+3]=255;
    }
  }
  function line(a,b,color,owner=-1,radius=.65*pixelRatio,epsilon=.002){
    const steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)*1.4));
    for(let i=0;i<=steps;i++){
      const t=i/steps,x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t,z=a.z+(b.z-a.z)*t;
      for(let dy=-Math.ceil(radius);dy<=Math.ceil(radius);dy++)for(let dx=-Math.ceil(radius);dx<=Math.ceil(radius);dx++){
        const px=Math.floor(x)+dx,py=Math.floor(y)+dy;
        if(Math.hypot(px+.5-x,py+.5-y)<=radius)put(px,py,z,color,owner,epsilon);
      }
    }
  }
  const mesh=boardMesh(topology.kind,interactive),vs=mesh.vertices.map(p=>vertex(p,p.normal));
  for(const [a,b,c] of mesh.triangles)triangle(vs[a],vs[b],vs[c],0,-1);
  // Grid lines follow the curved surface, not straight chords through it.
  for(const [a,b] of topology.edges){
    const p=topology.vertices[a],q=topology.vertices[b];let previous;
    const steps=16;
    for(let j=0;j<=steps;j++){
      const t=j/steps;let s;
      if(topology.kind==='sphere')s=unit({x:p.x+(q.x-p.x)*t,y:p.y+(q.y-p.y)*t,z:p.z+(q.z-p.z)*t});
      else{let du=q.u-p.u,dv=q.v-p.v;if(du>Math.PI)du-=TAU;if(du< -Math.PI)du+=TAU;if(dv>Math.PI)dv-=TAU;if(dv< -Math.PI)dv+=TAU;s=torus(p.u+du*t,p.v+dv*t);}
      const next=project(add(s,surfaceNormal(topology.kind,s),.001));if(previous)line(previous,next,[97,99,72]);previous=next;
    }
  }
  // Small surface-conforming contact shadows anchor each stone to the board.
  // Blend into the existing board/grid without changing depth or hit ownership.
  function onSurface(p){
    if(topology.kind==='sphere')return unit(p);
    const r=Math.hypot(p.x,p.z),core={x:p.x*.72/r,y:0,z:p.z*.72/r};
    return add(core,unit({x:p.x-core.x,y:p.y,z:p.z-core.z}),.28);
  }
  for(let index=0;index<board.length;index++)if(board[index]){
    const {tangent,bitangent,radius}=stoneGeometry(topology,index),p=topology.vertices[index];
    const lift=q=>vertex(add(q,surfaceNormal(topology.kind,q),.003),surfaceNormal(topology.kind,q));
    const center=lift(p);
    for(const [r,material] of [[1.08,3],[.98,4],[.88,5]]){
      let previous;
      for(let i=0;i<=20;i++){
        const angle=i*TAU/20,q=onSurface(add(add(p,tangent,radius*r*Math.cos(angle)),bitangent,radius*r*Math.sin(angle))),next=lift(q);
        if(previous)triangle(center,previous,next,material,-1);previous=next;
      }
    }
  }
  const points=topology.vertices.map((p,i)=>({...project(p),i,visible:false}));
  // Empty intersection dots are depth-tested too; rear-face dots cannot be clicked.
  const dotRadius=1.6*pixelRatio;
  for(const p of points)if(!board[p.i]){
    const normal=rotatePoint(surfaceNormal(topology.kind,topology.vertices[p.i]),rotX,rotY);
    if(normal.z<=0)continue;
    for(let y=Math.floor(p.y-dotRadius);y<=p.y+dotRadius;y++)for(let x=Math.floor(p.x-dotRadius);x<=p.x+dotRadius;x++)if(Math.hypot(x+.5-p.x,y+.5-p.y)<dotRadius)put(x,y,p.z,[65,76,56],p.i,.003);
  }
  for(let index=0;index<board.length;index++)if(board[index]){
    const mesh=stoneMesh(topology,index,interactive),stone=mesh.vertices.map(p=>vertex(p,p.normal));
    for(const [a,b,c] of mesh.triangles)triangle(stone[a],stone[b],stone[c],board[index],index);
  }
  // Last-move ring lies on the curved crown and participates in occlusion.
  if(lastMove!==null&&board[lastMove]){
    const {center,normal,tangent,bitangent,radius,halfHeight}=stoneGeometry(topology,lastMove);let prev;
    for(let i=0;i<=48;i++){
      const a=i*TAU/48,r=.34,p=add(add(add(center,normal,halfHeight*Math.sqrt(1-r*r)+.001),tangent,radius*r*Math.cos(a)),bitangent,radius*r*Math.sin(a));
      const next=project(p);if(prev)line(prev,next,board[lastMove]===1?[226,201,145]:[81,104,83],lastMove,.8*pixelRatio,.001);prev=next;
    }
  }
  const visibleCounts=new Uint32Array(board.length);for(const id of owners)if(id>=0)visibleCounts[id]++;
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
    const active=id===selected||id===hover,ringRadius=board[id]?radius*.78:radius*1.18;
    const color=id===selected?[255,207,75]:id===hover?[242,255,253]:[87,226,202];
    function onRing(angle,r){
      let p;
      if(board[id]){
        const height=halfHeight*Math.sqrt(Math.max(0,1-(r/radius)**2));
        p=add(add(add(center,normal,height+.002),tangent,r*Math.cos(angle)),bitangent,r*Math.sin(angle));
      }else{
        const base=topology.vertices[id];p=add(add(base,tangent,r*Math.cos(angle)),bitangent,r*Math.sin(angle));
        if(topology.kind==='sphere')p=unit(p);
        else{const length=Math.hypot(p.x,p.z),core={x:p.x*.72/length,y:0,z:p.z*.72/length};p=add(core,unit({x:p.x-core.x,y:p.y,z:p.z-core.z}),.28);}
        p=add(p,surfaceNormal(topology.kind,p),.002);
      }
      return project(p);
    }
    for(const [cssWidth,ink] of [[active?4.6:3.6,[38,54,44]],[active?2.6:1.8,color]]){
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
