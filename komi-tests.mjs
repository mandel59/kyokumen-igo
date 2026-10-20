import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTopology, Game} from './dist/engine.js';

const html=readFileSync(new URL('./dist/index.html',import.meta.url),'utf8');
// The settings stepper offers 0.5–9.5 in whole steps (ui-tests checks its buttons); 6.5 is the default.
assert.match(html,/<input type="hidden" id="komi" value="6\.5">/);
assert.match(html,/<output id="komiValue"[^>]*>6\.5 目<\/output>/);
const komis=Array.from({length:10},(_,i)=>i+.5);
for(const [kind,size] of [['sphere',4],['torus',9]]) {
  const topology=createTopology(kind,size);
  assert.equal(new Game(topology).komi,6.5);
  for(const komi of komis) {
    const game=new Game(topology,komi);
    game.pass(); game.pass();
    assert.equal(game.ended,true);
    assert.equal(game.score().black,0);
    assert.equal(game.score().white,komi);
    assert.equal(game.score().margin,komi);
  }
}
console.log('Komi options 0.5–9.5, default 6.5, and both topology score calculations passed.');
