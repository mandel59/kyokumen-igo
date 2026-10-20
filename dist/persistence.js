import {Game, createTopology} from './engine.js';
import {isValidKomi} from './komi.js';
import {orientationFromEuler, normalizeOrientation} from './orientation.js';

// Keep the discovery key so upgrading never abandons an existing version-1 game.
export const STORAGE_KEY = 'surface-go:saved-game:v1';
const MAX_HISTORY = 10000;
const MAX_BYTES = 8 * 1024 * 1024;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sameArray = (a, b) => Array.isArray(a) && a.length === b.length && a.every((value, i) => value === b[i]);

function savedView(view, version) {
  if (!record(view) || typeof view.mapView !== 'boolean') throw new Error('Invalid view');
  const orientation = version === 1 ? orientationFromEuler(view.rotX, view.rotY) : view.orientation;
  normalizeOrientation(orientation);
  // New saves contain unit quaternions. Reject corrupt data, but preserve exact
  // components on reload so an already valid save is not repeatedly rewritten.
  if (Math.abs(Math.hypot(...orientation) - 1) > 1e-6) throw new Error('Invalid orientation');
  return {mapView: view.mapView, orientation: orientation.slice()};
}

// Replaying validates both the snapshot and its rules history, and rebuilds superko.
// Never feed untrusted localStorage directly to Game.fromJSON.
export function restoreSnapshot(data) {
  if (!record(data) || ![1, 2].includes(data.version) || !record(data.game) || !record(data.settings) || !record(data.view)) throw new Error('Invalid saved game');
  const saved = data.game;
  const sizes = saved.kind === 'sphere' ? [3, 4, 5] : saved.kind === 'torus' ? [7, 9, 11] : [];
  if (saved.version !== 1 || !sizes.includes(saved.size) || !isValidKomi(saved.komi)) throw new Error('Invalid board settings');
  if (!['ai', 'human'].includes(data.settings.opponent) || ![1, 2].includes(data.settings.human)) throw new Error('Invalid opponent');
  const view = savedView(data.view, data.version);
  if (!Array.isArray(saved.history) || saved.history.length < 1 || saved.history.length > MAX_HISTORY) throw new Error('Invalid history');
  const game = new Game(createTopology(saved.kind, saved.size), saved.komi);
  for (let i = 0; i < saved.history.length; i++) {
    const snapshot = saved.history[i];
    if (!record(snapshot)) throw new Error('Invalid move');
    if (i) {
      const result = snapshot.lastMove === null ? game.pass() : game.play(snapshot.lastMove);
      if (!result.ok) throw new Error('Illegal saved move');
    }
    if (!sameArray(snapshot.board, Array.from(game.board)) || !sameArray(snapshot.captures, game.captures) || snapshot.turn !== game.turn || snapshot.passes !== game.passes || snapshot.ended !== game.ended || snapshot.lastMove !== game.lastMove) throw new Error('Inconsistent saved move');
  }
  return {game, settings: {opponent: data.settings.opponent, human: data.settings.human}, view};
}

export function loadSavedGame(storage) {
  try {
    storage ??= window.localStorage;
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return {state: null, error: null};
    if (raw.length > MAX_BYTES) throw new Error('Saved game too large');
    return {state: restoreSnapshot(JSON.parse(raw)), error: null};
  } catch {
    return {state: null, error: '保存済みの対局を読み込めませんでした。新しい対局を表示しています。'};
  }
}

export function saveGame(game, settings, view, storage) {
  try {
    storage ??= window.localStorage;
    if (game.history.length > MAX_HISTORY) throw new Error('History too long');
    const raw = JSON.stringify({version: 2, game: game.toJSON(), settings, view: savedView(view, 2)});
    if (raw.length > MAX_BYTES) throw new Error('Saved game too large');
    storage.setItem(STORAGE_KEY, raw);
    return true;
  } catch {
    return false;
  }
}
