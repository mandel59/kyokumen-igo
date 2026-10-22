// Exact cube-grid antipodes; no coordinate tolerance or projection is involved.
export function antipodalMap(topology){
 if(topology.kind!=='sphere')throw new Error('Antipodal opponent requires a sphere');
 const index=new Map(topology.vertices.map((p,i)=>[[p.cx,p.cy,p.cz].join(','),i]));
 const map=topology.vertices.map(p=>index.get([-p.cx,-p.cy,-p.cz].join(',')));
 for(let p=0;p<map.length;p++){
  if(map[p]===undefined||map[p]===p||map[map[p]]!==p)throw new Error('Invalid antipodal pairing');
  const neighbors=topology.neighbors[map[p]];
  if(neighbors.length!==topology.neighbors[p].length||topology.neighbors[p].some(q=>!neighbors.includes(map[q])))throw new Error('Antipodes must preserve adjacency');
 }
 return map;
}
export function colorAntipodal(board,map){return board.every((color,p)=>board[map[p]]===(color?3-color:0));}
