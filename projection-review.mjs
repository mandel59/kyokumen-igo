import assert from 'node:assert/strict';
import {createTopology} from './dist/engine.js';
import {sphereProjection} from './dist/sphere-projection.js';
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const cross=(a,b)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const norm=a=>Math.hypot(a.x,a.y,a.z);
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const inverse=(p,v)=>{let x=p.x-v.x,y=p.y-v.y,d=Math.hypot(x,y),a=d/v.radius*Math.PI/2;return{x:d?v.sign*x/d*Math.sin(a):0,y:d?-y/d*Math.sin(a):0,z:v.sign*Math.cos(a)};};
let count=0,minSpacing=Infinity,largestError=0;
for(const n of [3,4,5])for(const [w,h] of [[340,355],[370,559],[422,228],[626,258],[300,195]]){
 const t=createTopology('sphere',n),p=sphereProjection(t,w,h),ids=new Set(p.points.map(q=>q.i));
 assert.equal(ids.size,t.vertices.length);assert.equal(ids.size,6*n*n+2);
 for(let i=0;i<t.vertices.length;i++)assert.equal(p.points.filter(q=>q.i===i).length,Math.abs(t.vertices[i].z)<1e-10?2:1);
 for(const q of p.points){const v=p.views.find(v=>v.sign===q.hemisphere);assert(q.x>=0&&q.x<=w&&q.y>=0&&q.y<=h);assert(dist(q,v)<=p.radius+1e-8);const back=inverse(q,v),o=t.vertices[q.i];assert(Math.hypot(back.x-o.x,back.y-o.y,back.z-o.z)<1e-8);
 // Actual picker uses nearest original ID within 20 px; every exact rendered point is reachable.
 let best=null,dd=20;for(const other of p.points){const d=dist(q,other);if(d<dd){best=other.i;dd=d;}}assert.equal(best,q.i);
 for(const other of p.points)if(q.i!==other.i){const d=dist(q,other);assert(d>1e-7);minSpacing=Math.min(minSpacing,d);}
 }
 assert.equal(new Set(p.edges.map(e=>`${e.a}:${e.b}`)).size,t.edges.length);
 for(const e of p.edges){const view=p.views.find(v=>v.sign===e.hemisphere),a=t.vertices[e.a],b=t.vertices[e.b],normal=cross(a,b),ab=Math.acos(dot(a,b));
  assert(a.z*view.sign>=-1e-10||b.z*view.sign>=-1e-10);
  for(const q of e.path){assert(Number.isFinite(q.x)&&Number.isFinite(q.y));assert(q.x>=-1e-8&&q.x<=w+1e-8&&q.y>=-1e-8&&q.y<=h+1e-8);assert(dist(q,view)<=p.radius+1e-8);const r=inverse(q,view),err=Math.abs(dot(normal,r))/norm(normal);largestError=Math.max(largestError,err);assert(err<1e-8);const ar=Math.acos(Math.max(-1,Math.min(1,dot(a,r)))),rb=Math.acos(Math.max(-1,Math.min(1,dot(r,b))));assert(Math.abs(ar+rb-ab)<1e-7);}
  if(a.z*b.z<0){const endpoint=a.z*view.sign<0?e.path[0]:e.path.at(-1);assert(Math.abs(dist(endpoint,view)-p.radius)<1e-8);}
 }
 count++;
 console.log(`n=${n} ${w}x${h}: ${ids.size} unique IDs, ${p.points.length} points, radius ${p.radius.toFixed(2)}`);
}
console.log(`PASS ${count} projections; minimum distinct-point spacing ${minSpacing.toFixed(2)} px; max great-circle error ${largestError}`);
