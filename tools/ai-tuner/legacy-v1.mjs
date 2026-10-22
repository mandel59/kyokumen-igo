// Historical JS v1 for fixtures and comparison tools; never imported by the application.
import {groupAt} from '../../dist/engine.js';
// Evaluation weights, tuned by self-play in tools/ai-tuner (Params::tuned there must match).
// capture and noise are fixed; the tuner searches the rest.
export const AI_WEIGHTS={capture:10,savePerStone:2.1,saveCap:6.66,killPerStone:2.33,killCap:4.69,liberty:3.14,enemyAdjacent:0.66,friendAdjacent:-0.85,selfAtari:-20.16,crowded:-3.14,open:-2.13,passBelow:-0.51,territory:0.27,noise:0.7};

// Points 1–3 steps from each vertex, weighted 4, 2, 1: a cheap estimate of who will own empty points.
const influenceBalls=new WeakMap();
function influenceBall(topology) {
  if(influenceBalls.has(topology)) return influenceBalls.get(topology);
  const balls=topology.neighbors.map((_,start)=>{
    const distance=new Map([[start,0]]), queue=[start], near=[];
    for(let k=0;k<queue.length;k++) {
      const p=queue[k], d=distance.get(p);if(d===3)continue;
      for(const q of topology.neighbors[p]) if(!distance.has(q)) {distance.set(q,d+1);near.push([q,[0,4,2,1][d+1]]);queue.push(q);}
    }
    return near;
  });
  influenceBalls.set(topology,balls);return balls;
}

// A small local heuristic, not a trained or professional-strength Go engine: every legal point
// gets a weighted sum of local features (captures, ataris, liberties, contact, influence) and
// the best one is played. `random` and `weights` are injectable for tests and the tuner parity check.
export function chooseMove(game,{weights:w=AI_WEIGHTS,random=Math.random}={}) {
  if(game.ended)return null;
  const {board,topology,turn}=game, neighbors=topology.neighbors;
  const urgent=new Map(), seen=new Set();
  for(let i=0;i<board.length;i++) if(board[i]&&!seen.has(i)) {
    const g=groupAt(board,neighbors,i);for(const p of g.stones)seen.add(p);
    if(g.liberties.size===1) {
      const p=[...g.liberties][0];urgent.set(p,(urgent.get(p)||0)+(board[i]===turn?Math.min(w.saveCap,g.stones.length*w.savePerStone):Math.min(w.killCap,g.stones.length*w.killPerStone)));
    }
  }
  const balls=influenceBall(topology), mover=turn===1?1:-1, influence=new Int32Array(board.length);
  if(w.territory) for(let i=0;i<board.length;i++) if(board[i]) {
    const color=board[i]===1?1:-1;
    for(const [q,f] of balls[i]) influence[q]+=color*f;
  }
  let best=null,bestValue=-Infinity;
  for(let i=0;i<board.length;i++) {
    if(board[i])continue;
    const adjacent=neighbors[i], friends=adjacent.filter(n=>board[n]===turn).length,enemies=adjacent.filter(n=>board[n]===3-turn).length;
    // Leave simple eyes intact instead of filling secure territory.
    if(friends===adjacent.length)continue;
    const move=game.analyze(i);if(!move.ok)continue;
    let value=move.captured*w.capture+(urgent.get(i)||0)+Math.min(move.liberties,6)*w.liberty;
    value+=enemies*w.enemyAdjacent+friends*w.friendAdjacent;
    if(move.liberties===1&&!move.captured)value+=w.selfAtari;
    if(friends>=3&&!enemies)value+=w.crowded;
    if(!friends&&!enemies)value+=w.open;
    if(w.territory) {
      // The point stops being empty; nearby empty points may change side.
      let flipped=-Math.sign(influence[i])*mover;
      for(const [q,f] of balls[i]) if(!board[q]) flipped+=(Math.sign(influence[q]+mover*f)-Math.sign(influence[q]))*mover;
      value+=flipped*w.territory;
    }
    value+=random()*w.noise;
    if(value>bestValue){bestValue=value;best=i;}
  }
  return bestValue < w.passBelow ? null : best;
}
