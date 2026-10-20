// Go rules on a closed, undirected graph. Area scoring; positional superko.
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

function groupAt(board, neighbors, start) {
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
  score() {
    const seen=new Set(); let territoryBlack=0,territoryWhite=0,neutral=0,stonesBlack=0,stonesWhite=0;
    for(let i=0;i<this.board.length;i++) {
      if(this.board[i]===1){stonesBlack++;continue;}
      if(this.board[i]===2){stonesWhite++;continue;}
      if(seen.has(i))continue;
      const region=[i], border=new Set();seen.add(i);
      for(let j=0;j<region.length;j++) for(const n of this.topology.neighbors[region[j]]) {
        if(this.board[n])border.add(this.board[n]);
        else if(!seen.has(n)){seen.add(n);region.push(n);}
      }
      if(border.size===1 && border.has(1))territoryBlack+=region.length;
      else if(border.size===1 && border.has(2))territoryWhite+=region.length;
      else neutral+=region.length;
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

// A small local heuristic, not a trained or professional-strength Go engine.
export function chooseMove(game) {
  if(game.ended)return null;
  const {board,topology,turn}=game, neighbors=topology.neighbors;
  const urgent=new Map(), seen=new Set();
  for(let i=0;i<board.length;i++) if(board[i]&&!seen.has(i)) {
    const g=groupAt(board,neighbors,i);for(const p of g.stones)seen.add(p);
    if(g.liberties.size===1) {
      const p=[...g.liberties][0];urgent.set(p,(urgent.get(p)||0)+(board[i]===turn?Math.min(12,g.stones.length*2):Math.min(14,g.stones.length*3)));
    }
  }
  let best=null,bestValue=-Infinity;
  for(let i=0;i<board.length;i++) {
    if(board[i])continue;
    const adjacent=neighbors[i], friends=adjacent.filter(n=>board[n]===turn).length,enemies=adjacent.filter(n=>board[n]===3-turn).length;
    // Leave simple eyes intact instead of filling secure territory.
    if(friends===adjacent.length)continue;
    const move=game.analyze(i);if(!move.ok)continue;
    let value=move.captured*10+(urgent.get(i)||0)+Math.min(move.liberties,6)*0.5;
    value+=enemies*0.7+friends*0.35;
    if(move.liberties===1&&!move.captured)value-=15;
    if(friends>=3&&!enemies)value-=4;
    if(!friends&&!enemies)value+=0.6;
    value+=Math.random()*0.7;
    if(value>bestValue){bestValue=value;best=i;}
  }
  return bestValue < -4 ? null : best;
}
