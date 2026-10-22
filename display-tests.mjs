import assert from 'node:assert/strict';
import {createTopology, Game} from './dist/engine.js';
import {COUNTERS, DEFAULT_DISPLAY, DISPLAY_KEY, MARK_KEYS, counterValues, loadDisplay, normalizeDisplay, saveDisplay} from './dist/display.js';

// Black captures the white stone at (3, 3) of a 7 × 7 torus; white passes three times and black once.
const topology = createTopology('torus', 7), at = (u, v) => u * 7 + v;
const game = new Game(topology, 6.5);
const play = move => move === null ? game.pass() : game.play(move);
const counters = () => Object.fromEntries(Object.keys(COUNTERS).map(name => [name, counterValues(game, name).slice(1)]));

assert.deepEqual(game.passCounts(), [0, 0, 0]);
assert.deepEqual(counters(), {captures: [0, 0], capturesAndPasses: [0, 0], stones: [0, 0], area: [0, 0]});
for (const move of [at(2, 3), at(3, 3), at(4, 3), null, at(3, 2), null]) play(move);
assert.deepEqual(counters(), {captures: [0, 0], capturesAndPasses: [2, 0], stones: [3, 1], area: [3, 1]}, 'white\'s two passes count for black');
play(at(3, 4));
assert.equal(game.captures[1], 1);
assert.deepEqual(counters(), {captures: [1, 0], capturesAndPasses: [3, 0], stones: [4, 0], area: [49, 0]}, 'area adds the territory, komi stays out');
play(null);
play(null);
assert.equal(game.ended, true);
assert.deepEqual(game.passCounts(), [0, 1, 3], 'one black pass, three white passes');
assert.deepEqual(counters(), {captures: [1, 0], capturesAndPasses: [4, 1], stones: [4, 0], area: [49, 0]});
// The counters are read from the history, so they follow undo.
game.undo(2);
assert.deepEqual(game.passCounts(), [0, 0, 2]);
assert.deepEqual(counters().capturesAndPasses, [3, 0]);
// A neutral point is in neither area; each side's area is what the score counts.
{
  const g = new Game(createTopology('torus', 7), 0);
  g.play(0); g.play(24);
  const score = g.score();
  assert.deepEqual(counterValues(g, 'area'), [0, score.stonesBlack + score.territoryBlack, score.stonesWhite + score.territoryWhite]);
  assert.equal(score.neutral, 47);
  assert.deepEqual(counterValues(g, 'area').slice(1), [1, 1]);
}

// Settings: defaults, normalisation, and a round trip through storage.
const memory = () => {
  const items = new Map();
  return {items, getItem: key => items.has(key) ? items.get(key) : null, setItem: (key, value) => { items.set(key, value); }};
};
assert.deepEqual(DEFAULT_DISPLAY.marks, {alive: false, dead: false, atari: false, territory: false});
assert.equal(DEFAULT_DISPLAY.counter, 'captures');
assert.deepEqual(loadDisplay(memory()), DEFAULT_DISPLAY, 'nothing saved yet');
assert.deepEqual(loadDisplay(), DEFAULT_DISPLAY, 'no storage in this environment');
{
  const storage = memory(), chosen = {marks: {alive: true, dead: false, atari: true, territory: true}, counter: 'area'};
  assert.equal(saveDisplay(chosen, storage), true);
  assert.deepEqual(JSON.parse(storage.items.get(DISPLAY_KEY)), chosen);
  assert.deepEqual(loadDisplay(storage), chosen);
}
assert.equal(saveDisplay(DEFAULT_DISPLAY, {setItem() { throw new Error('quota'); }}), false);
assert.deepEqual(loadDisplay({getItem() { throw new Error('blocked'); }}), DEFAULT_DISPLAY);
// Damaged or foreign data never throws and never turns anything on by accident.
for (const raw of ['', '{', 'null', '[]', '7', '"area"', '{"marks":5}', '{"marks":[true,true],"counter":["area"]}', '{"marks":{"alive":"true","dead":1},"counter":"nope"}', '{"counter":"__proto__"}', '{"counter":"toString"}']) {
  assert.deepEqual(loadDisplay({getItem: () => raw}), DEFAULT_DISPLAY, raw);
}
assert.deepEqual(normalizeDisplay({marks: {alive: true, extra: true}, counter: 'stones', other: 1}), {marks: {alive: true, dead: false, atari: false, territory: false}, counter: 'stones'}, 'unknown fields are dropped');
assert.deepEqual(MARK_KEYS, ['alive', 'dead', 'atari', 'territory']);

console.log('Display tests passed: counters (captures, captures + opponent passes, stones, stones + territory) through undo, and display settings storage, defaults and corrupt data.');
