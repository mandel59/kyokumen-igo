import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTopology, Game} from './dist/engine.js';

const html=readFileSync(new URL('./dist/index.html',import.meta.url),'utf8');
const select=html.match(/<select id="komi">([\s\S]*?)<\/select>/)?.[1];
assert.ok(select);
const options=[...select.matchAll(/<option value="([^"]+)"([^>]*)>/g)];
assert.deepEqual(options.map(o=>Number(o[1])),Array.from({length:10},(_,i)=>i+.5));
assert.deepEqual(options.filter(o=>/\bselected\b/.test(o[2])).map(o=>Number(o[1])),[6.5]);
for(const [kind,size] of [['sphere',4],['torus',9]]) {
  const topology=createTopology(kind,size);
  assert.equal(new Game(topology).komi,6.5);
  for(const option of options) {
    const komi=Number(option[1]),game=new Game(topology,option[1]);
    game.pass(); game.pass();
    assert.equal(game.ended,true);
    assert.equal(game.score().black,0);
    assert.equal(game.score().white,komi);
    assert.equal(game.score().margin,komi);
  }
}
console.log('Komi options 0.5–9.5, default 6.5, and both topology score calculations passed.');
