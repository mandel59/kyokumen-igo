// Two azimuthal-equidistant hemispheres. Original graph IDs are never changed.
export function sphereProjection(topology,width,height) {
  const stacked=height>width;
  const cellW=stacked?width:width/2,cellH=stacked?height/2:height;
  const radius=Math.max(1,Math.min((cellW-32)/2,(cellH-40)/2));
  const views=[1,-1].map((sign,k)=>({sign,name:k?'後半球':'前半球',x:stacked?width/2:cellW*(k+.5),y:stacked?cellH*(k+.5)-4:height/2-4,radius}));
  const points=[],edges=[];
  const normalized=p=>{const n=Math.hypot(p.x,p.y,p.z);return{x:p.x/n,y:p.y/n,z:p.z/n};};
  const mix=(a,b,t)=>normalized({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t});
  const project=(v,view)=>{const d=Math.hypot(v.x,v.y),r=Math.acos(Math.max(-1,Math.min(1,v.z*view.sign)))/(Math.PI/2)*radius;return{x:view.x+(d?view.sign*v.x/d*r:0),y:view.y-(d?v.y/d*r:0)};};
  for(const view of views){
    topology.vertices.forEach((v,i)=>{if(v.z*view.sign>=-1e-10)points.push({...project(v,view),i,hemisphere:view.sign});});
    for(const [a,b] of topology.edges){
      let va=topology.vertices[a],vb=topology.vertices[b];
      const za=va.z*view.sign,zb=vb.z*view.sign;
      if(za< -1e-10&&zb< -1e-10)continue;
      if(za<0&&zb>=0)va=mix(va,vb,-za/(zb-za));
      else if(zb<0&&za>=0)vb=mix(va,vb,za/(za-zb));
      const path=[];for(let t=0;t<=12;t++)path.push(project(mix(va,vb,t/12),view));
      edges.push({a,b,path,hemisphere:view.sign});
    }
  }
  return {views,points,edges,radius};
}
