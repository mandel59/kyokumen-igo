import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTopology,Game} from './dist/engine.js';
import {chooseMove,AI_WEIGHTS} from './tools/ai-tuner/legacy-v1.mjs';
function fixture(stones,turn=1,size=7) {
  const g=new Game(createTopology('torus',size));
  for(const [i,c] of stones)g.board[i]=c;
  g.turn=turn;g.history=[g._snapshot()];g._seen=new Set([g.board.join('')]);return g;
}
for(const n of [3,4,6,9]) {
  const s=createTopology('sphere',n);
  assert.equal(s.vertices.length,6*n*n+2);
  assert.equal(s.neighbors.filter(a=>a.length===3).length,8);
  assert.ok(s.neighbors.every(a=>a.length===3||a.length===4));
  assert.equal(s.edges.length,12*n*n);
  for(const p of s.vertices)assert.ok(Math.abs(Math.hypot(p.x,p.y,p.z)-1)<1e-10);
  const t=createTopology('torus',n);
  assert.equal(t.vertices.length,n*n);assert.ok(t.neighbors.every(a=>a.length===4));
  for(const topology of [s,t]) {
    for(const [a,b] of topology.edges)assert.ok(topology.neighbors[a].includes(b)&&topology.neighbors[b].includes(a));
    const reached=new Set([0]),stack=[0];while(stack.length)for(const q of topology.neighbors[stack.pop()])if(!reached.has(q)){reached.add(q);stack.push(q);}
    assert.equal(reached.size,topology.vertices.length);
  }
}
// Capture crosses both wrapped seams at torus vertex zero.
{
  const g=fixture([[0,2],[7,1],[42,1],[1,1]]);
  assert.deepEqual(g.play(6),{ok:true,captured:1});assert.equal(g.board[0],0);assert.equal(g.captures[1],1);
  assert.equal(g.turn,2);assert.equal(g.moves,1);assert.ok(g.undo());assert.equal(g.board[0],2);assert.equal(g.board[6],0);assert.equal(g.captures[1],0);
}
{
  const g=fixture([[7,2],[42,2],[1,2],[6,2]]);
  assert.equal(g.play(0).reason,'suicide');assert.equal(g.moves,0);
}
// Classic one-stone ko embedded away from the wrap seam.
{
  const p=(x,y)=>x*7+y;
  const g=fixture([[p(3,3),2],[p(2,3),1],[p(4,3),1],[p(3,2),1],[p(2,4),2],[p(4,4),2],[p(3,5),2]]);
  assert.equal(g.play(p(3,4)).captured,1);assert.equal(g.play(p(3,3)).reason,'superko');
  const clone=Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
  assert.equal(clone.play(p(3,3)).reason,'superko');assert.deepEqual(clone.score(),g.score());
  assert.ok(g.undo());assert.equal(g.play(p(3,4)).ok,true);
}
{
  const g=new Game(createTopology('sphere',3));
  assert.equal(g.score().neutral,g.board.length);assert.equal(g.score().white,6.5);
  g.pass();assert.equal(g.ended,false);g.pass();assert.equal(g.ended,true);assert.equal(g.play(0).reason,'ended');
  assert.equal(chooseMove(g),null);g.undo();assert.equal(g.ended,false);assert.equal(g.passes,1);g.play(0);assert.equal(g.passes,0);
  g.undo(999);assert.equal(g.moves,0);assert.equal(g.board.some(Boolean),false);
}
for(const kind of ['torus','sphere']) {
  const g=new Game(createTopology(kind,4));
  for(let i=0;i<40&&!g.ended;i++) {
    const move=chooseMove(g);
    assert.equal(move===null?g.pass().ok:g.play(move).ok,true);
  }
  const clone=Game.fromJSON(g.toJSON());assert.deepEqual([...clone.board],[...g.board]);assert.equal(clone.moves,g.moves);
}
// The browser AI makes exactly the moves the self-play tuner evaluated (tools/ai-tuner parity fixture).
{
  const parity=JSON.parse(readFileSync(new URL('./tests/fixtures/ai/v1-parity.json',import.meta.url),'utf8'));
  assert.deepEqual(parity.params,AI_WEIGHTS,'fixture was generated with the shipped weights');
  for(const c of parity.cases) {
    const g=new Game(createTopology(c.kind,c.size));
    for(const m of c.moves) assert.equal((m<0?g.pass():g.play(m)).ok,true);
    assert.equal(chooseMove(g,{random:()=>0}),c.expected,`${c.kind} ${c.size} after ${c.moves.length} moves`);
  }
}
console.log('All graph Go engine tests passed.');
