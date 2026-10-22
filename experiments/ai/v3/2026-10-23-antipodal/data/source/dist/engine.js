// Go rules on a closed, undirected graph. Area scoring; positional superko.
import {territoryOwners} from './board-analysis.js';
export function createTopology(kind = 'sphere', size = 6) {
  size = Math.round(Number(size));
  if (!Number.isFinite(size) || size < 3 || size > 40) throw new Error('Board size must be between 3 and 40.');
  if (kind !== 'sphere' && kind !== 'torus') throw new Error('Unknown surface.');
  const vertices = [], adjacency = [], edgeSet = new Set(), edges = [];
  const add = v => { adjacency.push(new Set()); return vertices.push(v) - 1; };
  const link = (a, b) => {
    if (a === b) return;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key); adjacency[a].add(b); adjacency[b].add(a); edges.push([a,b]);
  };
  if (kind === 'torus') {
    for (let u = 0; u < size; u++) for (let v = 0; v < size; v++) {
      const a = u * 2 * Math.PI / size, b = v * 2 * Math.PI / size;
      const r = 0.72 + 0.28 * Math.cos(b);
      add({x:r*Math.cos(a), y:0.28*Math.sin(b), z:r*Math.sin(a), u:a, v:b, i:u, j:v});
    }
    for (let u=0;u<size;u++) for(let v=0;v<size;v++) {
      link(u*size+v, ((u+1)%size)*size+v);
      link(u*size+v, u*size+(v+1)%size);
    }
  } else {
    const indices = new Map();
    const vertex = coords => {
      const key=coords.join(',');
      if(indices.has(key)) return indices.get(key);
      const [cx,cy,cz]=coords, length=Math.hypot(cx,cy,cz);
      const i=add({x:cx/length,y:cy/length,z:cz/length,cx,cy,cz});
      indices.set(key,i); return i;
    };
    for(let axis=0;axis<3;axis++) for(const sign of [-1,1]) {
      const other=[0,1,2].filter(a=>a!==axis), grid=[];
      for(let u=0;u<=size;u++) {
        grid[u]=[];
        for(let v=0;v<=size;v++) {
          const c=[0,0,0]; c[axis]=sign*size; c[other[0]]=2*u-size; c[other[1]]=2*v-size;
          grid[u][v]=vertex(c);
          if(u) link(grid[u-1][v],grid[u][v]);
          if(v) link(grid[u][v-1],grid[u][v]);
        }
      }
    }
  }
  return {kind,size,vertices,neighbors:adjacency.map(s=>[...s]),edges};
}

export function groupAt(board, neighbors, start) {
  const color=board[start], stones=[], liberties=new Set(), seen=new Set([start]), stack=[start];
  while(stack.length) {
    const p=stack.pop(); stones.push(p);
    for(const q of neighbors[p]) {
      if(board[q]===0) liberties.add(q);
      else if(board[q]===color && !seen.has(q)) {seen.add(q);stack.push(q);}
    }
  }
  return {stones,liberties};
}
const keyOf = board => board.join('');
export class Game {
  constructor(topology, komi=6.5) {
    this.topology=topology; this.komi=Number(komi); this.board=new Int8Array(topology.vertices.length);
    this.turn=1; this.captures=[0,0,0]; this.passes=0; this.ended=false; this.lastMove=null;
    this.history=[this._snapshot()]; this._seen=new Set([keyOf(this.board)]);
  }
  get moves() {return this.history.length-1;}
  _snapshot() {return {board:Array.from(this.board),turn:this.turn,captures:[...this.captures],passes:this.passes,ended:this.ended,lastMove:this.lastMove};}
  _restore(s) {this.board=Int8Array.from(s.board);this.turn=s.turn;this.captures=[...s.captures];this.passes=s.passes;this.ended=s.ended;this.lastMove=s.lastMove;}
  analyze(i) {
    if(this.ended) return {ok:false,reason:'ended'};
    if(!Number.isInteger(i)||i<0||i>=this.board.length) return {ok:false,reason:'invalid'};
    if(this.board[i]) return {ok:false,reason:'occupied'};
    const board=this.board.slice(), enemy=3-this.turn, checked=new Set(); let captured=0;
    board[i]=this.turn;
    for(const n of this.topology.neighbors[i]) if(board[n]===enemy && !checked.has(n)) {
      const group=groupAt(board,this.topology.neighbors,n);
      for(const p of group.stones) checked.add(p);
      if(!group.liberties.size) {captured+=group.stones.length;for(const p of group.stones) board[p]=0;}
    }
    const group=groupAt(board,this.topology.neighbors,i);
    if(!group.liberties.size) return {ok:false,reason:'suicide'};
    const key=keyOf(board);
    if(this._seen.has(key)) return {ok:false,reason:'superko'};
    return {ok:true,board,captured,liberties:group.liberties.size,key};
  }
  play(i) {
    const move=this.analyze(i);if(!move.ok)return {ok:false,reason:move.reason};
    this.board=move.board;this.captures[this.turn]+=move.captured;this.turn=3-this.turn;
    this.passes=0;this.lastMove=i;this._seen.add(move.key);this.history.push(this._snapshot());
    return {ok:true,captured:move.captured};
  }
  pass() {
    if(this.ended)return {ok:false,reason:'ended'};
    this.turn=3-this.turn;this.passes++;this.lastMove=null;this.ended=this.passes>=2;
    this.history.push(this._snapshot());return {ok:true};
  }
  undo(count=1) {
    const amount=Math.min(this.moves,Math.max(0,Math.floor(count)));
    if(!amount)return false;
    this.history.splice(this.history.length-amount);this._restore(this.history[this.history.length-1]);
    this._seen=new Set(this.history.map(s=>keyOf(s.board)));return true;
  }
  // Passes made by each colour so far, from the history: index 1 is black, 2 is white.
  passCounts() {
    const counts=[0,0,0];
    for(let i=1;i<this.history.length;i++) if(this.history[i].lastMove===null) counts[this.history[i-1].turn]++;
    return counts;
  }
  score() {
    const owners=territoryOwners(this.topology.neighbors,this.board); let territoryBlack=0,territoryWhite=0,neutral=0,stonesBlack=0,stonesWhite=0;
    for(let i=0;i<this.board.length;i++) {
      if(this.board[i]===1)stonesBlack++;
      else if(this.board[i]===2)stonesWhite++;
      else if(owners[i]===1)territoryBlack++;
      else if(owners[i]===2)territoryWhite++;
      else neutral++;
    }
    const black=stonesBlack+territoryBlack,white=stonesWhite+territoryWhite+this.komi;
    return {black,white,territoryBlack,territoryWhite,neutral,stonesBlack,stonesWhite,winner:black===white?0:black>white?1:2,margin:Math.abs(black-white)};
  }
  toJSON() {return {version:1,kind:this.topology.kind,size:this.topology.size,komi:this.komi,history:this.history.map(s=>({...s,board:[...s.board],captures:[...s.captures]}))};}
  static fromJSON(data) {
    const game=new Game(createTopology(data.kind,data.size),data.komi);
    if(data.history?.length) {game.history=data.history.map(s=>({...s,board:[...s.board],captures:[...s.captures]}));game._restore(game.history.at(-1));game._seen=new Set(game.history.map(s=>keyOf(s.board)));}
    return game;
  }
}
