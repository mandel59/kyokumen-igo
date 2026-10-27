import assert from 'node:assert/strict';
import {defaultOrientation,eulerFromOrientation,normalizeOrientation,orientationFromEuler,orientationMatrix,rotateByDrag,rotateUpright,transformPoint} from './dist/orientation.js';
import {createTopology} from './dist/engine.js';
import {renderSurface,rotatePoint} from './dist/surface-renderer.js';

const close=(a,b,label,tolerance=2e-12)=>assert.ok(Math.abs(a-b)<tolerance,`${label}: ${a} != ${b}`);
const closePoint=(a,b,label)=>{for(const key of ['x','y','z'])close(a[key],b[key],`${label}.${key}`);};
const rotate=(p,q)=>transformPoint(p,orientationMatrix(q));
const legacy=(p,x,y)=>{
  const X=p.x*Math.cos(y)+p.z*Math.sin(y),Z=-p.x*Math.sin(y)+p.z*Math.cos(y);
  return {x:X,y:p.y*Math.cos(x)-Z*Math.sin(x),z:p.y*Math.sin(x)+Z*Math.cos(x)};
};
const points=[{x:1,y:0,z:0},{x:0,y:1,z:0},{x:0,y:0,z:1},{x:.2,y:-.7,z:.5}];
for(const x of [-9,-Math.PI,-Math.PI/2,-.26,0,Math.PI/2,Math.PI,12])
  for(const y of [-8,-Math.PI,-.57,0,Math.PI/2,Math.PI,15])
    for(const p of points){
      const q=orientationFromEuler(x,y);
      closePoint(rotate(p,q),legacy(p,x,y),'legacy Rx*Ry migration');
      closePoint(rotatePoint(p,x,y),legacy(p,x,y),'legacy renderer interface');
      closePoint(rotatePoint(p,q),legacy(p,x,y),'quaternion renderer interface');
    }
for(const kind of ['sphere','torus'])for(const p of points)
  closePoint(rotate(p,defaultOrientation(kind)),legacy(p,kind==='sphere'?.35:.65,kind==='sphere'?0:-Math.PI/2),'home view');
// The home view looks down at the board and is centred left to right.
for(const kind of ['sphere','torus']){
  const up=transformPoint({x:0,y:1,z:0},orientationMatrix(defaultOrientation(kind)));
  assert.ok(up.y>0&&up.z>0,kind+' home view looks down at the board, not up from below');
}
const sphereFront=transformPoint({x:0,y:0,z:1},orientationMatrix(defaultOrientation('sphere')));
close(sphereFront.x,0,'sphere home view faces a cube face centre');assert.ok(sphereFront.z>.9);
for(const size of [7,9,11]){
  const first=transformPoint(createTopology('torus',size).vertices[0],orientationMatrix(defaultOrientation('torus')));
  close(first.x,0,'torus point 0 at the front centre, size '+size,1e-12);assert.ok(first.z>0);
}

const orientations=[
  [0,0,0,1],
  defaultOrientation('sphere'),
  defaultOrientation('torus'),
  orientationFromEuler(Math.PI,0),
  orientationFromEuler(Math.PI/2,.57),
  orientationFromEuler(-Math.PI/2,.57),
  [0,0,Math.SQRT1_2,Math.SQRT1_2],
  [0,0,1,0],
  normalizeOrientation([.32,-.61,.71,.15]),
];
for(const q of orientations){
  for(const p of points){
    const before=rotate(p,q);
    for(const amount of [-100,-1,1,100]){
      const angle=amount*.009;
      closePoint(rotate(p,rotateByDrag(q,amount,0)),{
        x:before.x*Math.cos(angle)+before.z*Math.sin(angle),
        y:before.y,
        z:-before.x*Math.sin(angle)+before.z*Math.cos(angle),
      },'horizontal drag is camera Y rotation, independent of board orientation');
      closePoint(rotate(p,rotateByDrag(q,0,amount)),{
        x:before.x,
        y:before.y*Math.cos(angle)-before.z*Math.sin(angle),
        z:before.y*Math.sin(angle)+before.z*Math.cos(angle),
      },'vertical drag is camera X rotation, independent of board orientation');
    }
    const whole=rotateByDrag(q,123,-87);
    let split=q;
    for(let i=0;i<100;i++)split=rotateByDrag(split,1.23,-.87);
    closePoint(rotate(p,whole),rotate(p,split),'straight drag segmentation');
    closePoint(rotate(p,rotateByDrag(whole,-123,87)),before,'drag then exact reverse');
    closePoint(rotate(p,q.map(x=>-x)),before,'quaternion sign equivalence');
  }
  // A point on the visible center follows both positive screen drag directions
  // even when the board is upside down or rolled by 90 / 180 degrees.
  const m=orientationMatrix(q),front={x:m[6],y:m[7],z:m[8]};
  const right=rotate(front,rotateByDrag(q,10,0));
  const down=rotate(front,rotateByDrag(q,0,10));
  assert(right.x>0);close(right.y,0,'right drag remains horizontal');
  assert(down.y<0);close(down.x,0,'down drag remains vertical');
}
// No Euler singularity or sign-flip seam on either side of a pole/inversion.
for(const x of [Math.PI/2,Math.PI,3*Math.PI/2]){
  const a=rotateByDrag(orientationFromEuler(x-1e-8,.57),8,3);
  const b=rotateByDrag(orientationFromEuler(x+1e-8,.57),8,3);
  for(const p of points)for(const axis of ['x','y','z'])
    close(rotate(p,a)[axis],rotate(p,b)[axis],'continuous inversion',3e-8);
}
let accumulated=defaultOrientation();
for(let i=0;i<10000;i++)accumulated=rotateByDrag(accumulated,Math.sin(i)*7,Math.cos(i*.71)*8);
close(Math.hypot(...accumulated),1,'long drag sequence unit length');
const basis=points.slice(0,3).map(p=>rotate(p,accumulated));
for(let a=0;a<3;a++)for(let b=0;b<3;b++)
  close(basis[a].x*basis[b].x+basis[a].y*basis[b].y+basis[a].z*basis[b].z,a===b?1:0,'rigid orthonormal rotation');
for(const invalid of [null,[],[0,0,0,0],[0,0,0,Infinity],[0,0,0,NaN],[0,0,0,'1']])
  assert.throws(()=>normalizeOrientation(invalid));

// All geometry, lighting, raster owners and picking share one camera matrix.
// Legacy and migrated orientations must produce exactly the same frame at DPR 1/3.
for(const kind of ['sphere','torus'])for(const dpr of [1,3]){
  const topology=createTopology(kind,kind==='sphere'?3:7),board=Int8Array.from(topology.vertices,(_,i)=>i%3===0?i%2+1:0);
  const options={topology,board,lastMove:0,width:180*dpr,height:200*dpr,scale:75*dpr,centerX:90*dpr,centerY:100*dpr,pixelRatio:dpr};
  const old=renderSurface({...options,rotX:Math.PI+.12,rotY:-1.7});
  const migrated=renderSurface({...options,orientation:orientationFromEuler(Math.PI+.12,-1.7)});
  assert.deepEqual(migrated.pixels,old.pixels);
  assert.deepEqual(migrated.owners,old.owners);
  assert.deepEqual(migrated.points,old.points);
  for(let i=0;i<migrated.owners.length;i++)if(migrated.owners[i]>=0)
    assert.equal(migrated.pick(i%migrated.width+.5,Math.floor(i/migrated.width)+.5,0),migrated.owners[i],'high-DPI fragment picking');
}
// The goban turns by yaw and pitch: its vertical axis always projects onto the screen's vertical line.
{
  for(const [pitch,yaw] of [[.78,-.32],[0,0],[-1.2,2.5],[Math.PI/2-1e-3,-3]]){
    const e=eulerFromOrientation(orientationFromEuler(pitch,yaw));close(e.pitch,pitch,'pitch',1e-12);close(e.yaw,yaw,'yaw',1e-12);
  }
  let q=defaultOrientation('plane');
  const drags=[[40,-25],[-130,60],[300,10],[5,-400],[-70,900],[220,-35]];
  for(const [dx,dy] of drags){
    q=rotateUpright(q,dx,dy);const up=rotate({x:0,y:1,z:0},q);
    close(up.x,0,'vertical axis stays vertical on screen',1e-12);assert.ok(up.y>=-1e-12,'pitch stops at straight above and below');
  }
  const start=eulerFromOrientation(defaultOrientation('plane')),moved=eulerFromOrientation(rotateUpright(defaultOrientation('plane'),10,-20));
  close(moved.yaw-start.yaw,10*.009,'horizontal drag turns the yaw');close(moved.pitch-start.pitch,-20*.009,'vertical drag tilts the pitch');
  // A rolled orientation (from an older save) comes back upright.
  close(rotate({x:0,y:1,z:0},rotateUpright(orientationFromEuler(.4,.2).map((v,i)=>v+[.05,0,.08,0][i]),0,0)).x,0,'roll dropped',1e-12);
}
// The goban is drawn in perspective: the near edge is wider on screen than the far edge, and picking still
// returns the point under each stone's own pixels.
{
  const topology=createTopology('plane',9),board=new Int8Array(81);board[0]=1;board[80]=2;
  const frame=renderSurface({topology,board,orientation:orientationFromEuler(.6,0),width:400,height:400});
  const far=frame.points[72].x-frame.points[0].x,near=frame.points[80].x-frame.points[8].x;assert.ok(far>0);
  assert.ok(near>far*1.1,`perspective widens the near edge (${near} vs ${far})`);
  for(const id of [0,80]){const p=frame.points[id];assert.equal(frame.pick(p.x,p.y),id,'stone under its own point');}
  assert.ok(frame.points.every(p=>p.visible),'every point of the goban is visible from above');
}
console.log('Orientation tests passed: legacy order, screen-relative inverted/rolled drags, continuity, event-rate invariance, long-run normalization, home view, identical migrated rendering and DPR 1/3 picking.');
