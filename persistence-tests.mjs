import assert from 'node:assert/strict';
import {Game, createTopology} from './dist/engine.js';
import {orientationFromEuler} from './dist/orientation.js';
import {STORAGE_KEY, restoreSnapshot, loadSavedGame, saveGame} from './dist/persistence.js';

const settings = {opponent: 'human', human: 2};
const view = {mapView: true, orientation: orientationFromEuler(-.8, 1.2)};
const data = new Map();
const storage = {getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value)};
const save = game => assert.equal(saveGame(game, settings, view, storage), true);
const read = () => JSON.parse(data.get(STORAGE_KEY));
assert.deepEqual(loadSavedGame(storage), {state: null, error: null});

for (const kind of ['sphere', 'torus']) {
  for (const size of kind === 'sphere' ? [3, 4, 5] : [7, 9, 11]) {
    for (const komi of [.5, 6.5, 9.5]) {
      const game = new Game(createTopology(kind, size), komi);
      game.play(0); game.play(1); game.pass(); save(game);
      const {state, error} = loadSavedGame(storage);
      assert.equal(error, null);
      assert.deepEqual(state.game.toJSON(), game.toJSON());
      assert.deepEqual(state.settings, settings);
      assert.deepEqual(state.view, view);
      assert.equal(read().version, 2);
      assert.deepEqual(Object.keys(read().view).sort(), ['mapView', 'orientation']);
      // Load the previous deployed schema using the unchanged storage key,
      // preserving the full game/history/settings and the exact legacy view.
      const legacyView = {mapView: true, rotX: -.8, rotY: 1.2};
      storage.setItem(STORAGE_KEY, JSON.stringify({version: 1, game: game.toJSON(), settings, view: legacyView}));
      const migrated = loadSavedGame(storage).state;
      assert.deepEqual(migrated.game.toJSON(), game.toJSON());
      assert.deepEqual(migrated.settings, settings);
      assert.deepEqual(migrated.view, view);
      assert.equal(saveGame(migrated.game, migrated.settings, migrated.view, storage), true);
      assert.equal(read().version, 2);
      assert.deepEqual(loadSavedGame(storage).state.view, view);
      assert.deepEqual([...state.game._seen], [...game._seen]);
      state.game.pass(); game.pass();
      assert.equal(state.game.ended, true);
      assert.deepEqual(state.game.score(), game.score());
      save(state.game);
      const ended = loadSavedGame(storage).state.game;
      assert.equal(ended.ended, true);
      ended.undo(); game.undo();
      assert.deepEqual(ended.toJSON(), game.toJSON());
    }
  }
}

const ko = new Game(createTopology('torus', 7), 6.5);
for (const point of [17,24,31,18,23,32,0,26,25]) assert.equal(ko.play(point).ok, true);
save(ko);
assert.equal(loadSavedGame(storage).state.game.analyze(24).reason, 'superko');
const original = read();
const mutations = [
  d => d.version = 3,
  d => d.game.version = 2,
  d => d.game.kind = 'plane',
  d => d.game.size = 40,
  d => d.game.komi = '6.5',
  d => d.game.komi = 10.5,
  d => d.settings.opponent = 'other',
  d => d.settings.human = 0,
  d => d.view.mapView = 'true',
  d => d.view.orientation = null,
  d => d.view.orientation = [0, 0, 0, 0],
  d => d.view.orientation = [0, 0, 0, 2],
  d => d.view.orientation = [0, 0, 1],
  d => d.view.orientation = [0, 0, 0, '1'],
  d => d.view.orientation = [0, 0, 0, Infinity],
  d => d.game.history = [],
  d => d.game.history[0].board[0] = 1,
  d => d.game.history[1].lastMove = 24,
  d => d.game.history[1].turn = 1,
  d => d.game.history[1].captures[1] = 20,
  d => d.game.history[1].board.pop(),
  d => d.game.history.at(-1).ended = true,
  d => d.game.history.at(-1).passes = 1,
];
for (const mutate of mutations) {
  const changed = structuredClone(original); mutate(changed);
  assert.throws(() => restoreSnapshot(changed));
  storage.setItem(STORAGE_KEY, JSON.stringify(changed));
  assert.equal(loadSavedGame(storage).state, null);
  assert.ok(loadSavedGame(storage).error);
}
for (const rotX of [null, '0', Infinity, NaN]) {
  assert.throws(() => restoreSnapshot({...original, version: 1, view: {mapView: false, rotX, rotY: 0}}));
}
for (const raw of ['{broken', 'null', '[]', '{}', 'x'.repeat(8 * 1024 * 1024 + 1)]) {
  storage.setItem(STORAGE_KEY, raw);
  assert.equal(loadSavedGame(storage).state, null);
}
const blocked = {getItem() {throw new Error('SecurityError');}, setItem() {throw new Error('QuotaExceededError');}};
assert.equal(loadSavedGame(blocked).state, null);
assert.equal(saveGame(ko, settings, view, blocked), false);
// New game atomically replaces the previous history; it cannot come back on reload.
const fresh = new Game(createTopology('sphere', 3), .5);
save(fresh);
assert.deepEqual(loadSavedGame(storage).state.game.toJSON(), fresh.toJSON());
console.log('Persistence tests passed: all board sizes, komi, history/undo, superko, ended games, strict corruption validation, storage errors and reset.');
