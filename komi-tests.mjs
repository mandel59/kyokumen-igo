import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTopology,Game} from './dist/engine.js';

const html=readFileSync(new URL('./dist/index.html',import.meta.url),'utf8');
assert.match(html,/<input type="hidden" id="komi" value="6\.5">/);
assert.match(html,/<output id="komiValue"[^>]*>6\.5 目<\/output>/);
assert.match(html,/aria-label="コミを 0\.5 目減らす"/);
assert.match(html,/aria-label="コミを 0\.5 目増やす"/);
const komis=Array.from({length:20},(_,i)=>i/2);
for(const [kind,sizes] of [['sphere',[3,4,5]],['torus',[7,9,11]]])for(const size of sizes) {
  const topology=createTopology(kind,size);
  assert.equal(new Game(topology).komi,6.5);
  for(const komi of komis) {
    const game=new Game(topology,komi);
    game.pass();game.pass();
    assert.equal(game.ended,true);
    assert.equal(game.score().black,0);
    assert.equal(game.score().white,komi);
    assert.equal(game.score().margin,komi);
    assert.equal(game.score().winner,komi===0?0:2);
  }
}
for(const [komi,winner,margin] of [[0,1,1],[1,0,0],[2,2,1]]) {
  const game=new Game(createTopology('torus',7),komi);
  for(const move of [0,24,1])assert.equal(game.play(move).ok,true);
  game.pass();game.pass();
  assert.equal(game.score().winner,winner);
  assert.equal(game.score().margin,margin);
}
console.log('Komi 0–9.5 in half-point steps passed: all boards, default 6.5, zero/integer komi and drawn games.');
