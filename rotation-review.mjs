// Independent screen-space rotation, renderer and fresh-realm integration review.
// Run with: node --experimental-vm-modules rotation-review.mjs
// Pure math/framebuffer and DOM doubles only; not a real browser/touch test.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Game, createTopology} from './dist/engine.js';
import {
  orientationFromEuler, defaultOrientation, rotateByDrag,
  orientationMatrix, transformPoint, normalizeOrientation,
} from './dist/orientation.js';
import {renderSurface, highlightSurface} from './dist/surface-renderer.js';
import {STORAGE_KEY, restoreSnapshot, saveGame, loadSavedGame} from './dist/persistence.js';

const EPS = 3e-12;
const close = (actual, expected, label, eps = EPS) => {
  for (const key of ['x', 'y', 'z']) {
    assert(Math.abs(actual[key] - expected[key]) < eps,
      `${label}.${key}: ${actual[key]} vs ${expected[key]}`);
  }
};
const unitQuaternion = q => {
  const length = Math.hypot(...q);
  return q.map(v => v / length);
};
// Independent vector-form quaternion rotation, not the production matrix.
const rotateIndependent = (p, quaternion) => {
  const [x, y, z, w] = unitQuaternion(quaternion);
  const d = x * p.x + y * p.y + z * p.z;
  const s = w * w - x * x - y * y - z * z;
  return {
    x: s * p.x + 2 * x * d + 2 * w * (y * p.z - z * p.y),
    y: s * p.y + 2 * y * d + 2 * w * (z * p.x - x * p.z),
    z: s * p.z + 2 * z * d + 2 * w * (x * p.y - y * p.x),
  };
};
// Rodrigues around the camera-plane axis. Positive dx is screen-right;
// positive dy rotates front-facing points toward negative camera-y (screen-down).
const dragIndependent = (p, dx, dy, sensitivity = .009) => {
  const length = Math.hypot(dx, dy);
  if (!length) return {...p};
  const x = dy / length, y = dx / length;
  const angle = length * sensitivity, c = Math.cos(angle), s = Math.sin(angle);
  const d = x * p.x + y * p.y;
  return {
    x: p.x * c + y * p.z * s + x * d * (1 - c),
    y: p.y * c - x * p.z * s + y * d * (1 - c),
    z: p.z * c + (x * p.y - y * p.x) * s,
  };
};
const oldEuler = (p, x, y) => {
  const yawX = p.x * Math.cos(y) + p.z * Math.sin(y);
  const yawZ = -p.x * Math.sin(y) + p.z * Math.cos(y);
  return {
    x: yawX,
    y: p.y * Math.cos(x) - yawZ * Math.sin(x),
    z: p.y * Math.sin(x) + yawZ * Math.cos(x),
  };
};
const basis = [{x: 1, y: 0, z: 0}, {x: 0, y: 1, z: 0}, {x: 0, y: 0, z: 1}];
const sameRotation = (actual, expected, label, eps = EPS) => {
  for (const p of basis) close(rotateIndependent(p, actual), rotateIndependent(p, expected), label, eps);
};

const orientations = [
  [0, 0, 0, 1],
  orientationFromEuler(Math.PI, 0),
  orientationFromEuler(-Math.PI, .7),
  orientationFromEuler(Math.PI / 2, -2.1),
  [0, 0, Math.SQRT1_2, Math.SQRT1_2],
  [0, 0, -Math.SQRT1_2, Math.SQRT1_2],
  unitQuaternion([1, -2, 3, -4]),
];
let motionCases = 0;
for (const q of orientations) {
  const inverse = [-q[0], -q[1], -q[2], q[3]];
  const worldFront = rotateIndependent({x: 0, y: 0, z: 1}, inverse);
  for (const [dx, dy] of [[24, 0], [-24, 0], [0, 24], [0, -24], [21, -17], [-13, -9]]) {
    const after = rotateByDrag(q, dx, dy);
    assert(Math.abs(Math.hypot(...after) - 1) < EPS, 'drag normalizes orientation');
    const visibleFront = rotateIndependent(worldFront, after);
    close(visibleFront, dragIndependent({x: 0, y: 0, z: 1}, dx, dy), 'front follows pointer');
    if (dx) assert.equal(Math.sign(visibleFront.x), Math.sign(dx), 'horizontal never reverses');
    if (dy) assert.equal(Math.sign(visibleFront.y), -Math.sign(dy), 'vertical never reverses');
    for (const p of [...basis, {x: .2, y: -.7, z: .4}]) {
      const before = rotateIndependent(p, q);
      close(transformPoint(p, orientationMatrix(after)), dragIndependent(before, dx, dy), 'camera-space composition');
    }
    sameRotation(rotateByDrag(after, -dx, -dy), q, 'opposite drag is inverse');
    motionCases++;
  }
  sameRotation(rotateByDrag(q, 0, 0), q, 'zero drag');
  sameRotation(rotateByDrag(q, 2 * Math.PI / .009, 0), q, 'full-turn drag');
  for (const scale of [-3, .001, 600]) {
    sameRotation(normalizeOrientation(q.map(v => v * scale)), q, 'scaled quaternion');
  }
}
let accumulated = defaultOrientation('sphere');
for (let i = 0; i < 100000; i++) accumulated = rotateByDrag(accumulated, .037, -.029);
assert(Math.abs(Math.hypot(...accumulated) - 1) < EPS, '100,000 drag steps remain normalized');
for (const p of basis) {
  close(rotateIndependent(p, accumulated),
    dragIndependent(rotateIndependent(p, defaultOrientation('sphere')), 3700, -2900),
    'long accumulated camera-space rotation', 3e-10);
}
console.log(`Independent math passed: ${motionCases} upside-down/rolled drag cases, inverse/full turns, scaled quaternions and 100,000 drag steps.`);

// Legacy Euler migration must preserve every world-space direction, not just pitch.
for (const [x, y] of [[-.26, .57], [-.65, .57], [Math.PI, .9], [-8.3, 17.2], [1000, -300]]) {
  for (const p of [...basis, {x: .4, y: -.2, z: .8}]) {
    close(rotateIndependent(p, orientationFromEuler(x, y)), oldEuler(p, x, y), 'Euler compatibility');
  }
}
const width = 240, height = 260, scale = 92, centerX = 120, centerY = 120;
for (const [kind, size] of [['sphere', 4], ['torus', 9]]) {
  const topology = createTopology(kind, size), board = Int8Array.from(topology.vertices, (_, i) => i % 3 ? i % 2 + 1 : 0);
  for (const q of [orientations[1], orientations[4], rotateByDrag(orientations[6], 140, -63)]) {
    const frame = renderSurface({topology, board, orientation: q, width, height, scale, centerX, centerY});
    let owners = 0;
    for (const p of frame.points) {
      const expected = rotateIndependent(topology.vertices[p.i], q);
      close({x: (p.x - centerX) / scale, y: (centerY - p.y) / scale, z: p.z}, expected, `${kind} rendered projection`);
      close(frame.project(topology.vertices[p.i]), {x: p.x, y: p.y, z: p.z}, 'highlights share projection');
    }
    for (let i = 0; i < frame.owners.length; i++) if (frame.owners[i] >= 0) {
      const id = frame.owners[i];
      assert(frame.points[id].visible, 'rendered owner has visible point');
      assert.equal(frame.pick(i % width + .5, Math.floor(i / width) + .5, 0), id, 'picking matches rotated fragment');
      owners++;
    }
    assert(owners > 10, 'rotated framebuffer has selectable fragments');
    const hidden = frame.points.find(p => !p.visible && topology.neighbors[p.i].every(i => !frame.points[i].visible));
    assert(hidden, 'hidden-region fixture exists');
    assert.deepEqual(highlightSurface(frame, hidden.i, null), frame.pixels, 'rotated hidden highlights remain occluded');
  }
  const options = {topology, board, width, height, scale, centerX, centerY, rotX: 2.4, rotY: -.91};
  const legacy = renderSurface(options);
  const migrated = renderSurface({...options, orientation: orientationFromEuler(options.rotX, options.rotY)});
  for (let i = 0; i < legacy.points.length; i++) close(legacy.points[i], migrated.points[i], `${kind} migration projection`);
}
console.log('Independent renderer passed: sphere/torus inverted and rolled projections, exact fragment picking, hidden highlights and legacy camera equivalence.');

// Real modules in a fresh JS realm with minimal DOM doubles (no browser automation).
const base = new URL('./dist/', import.meta.url);
const validIds = new Set([...readFileSync(new URL('index.html', base), 'utf8').matchAll(/id="([^"]+)"/g)].map(m => m[1]));
async function boot(raw = null) {
  const data = new Map(raw === null ? [] : [[STORAGE_KEY, raw]]);
  const storage = {getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value))};
  const noop = () => {}, elements = new Map(), timers = new Map(), frames = [];
  let tid = 0, painted = null;
  const context2d = new Proxy({
    createRadialGradient: () => ({addColorStop: noop}),
    createImageData: (w, h) => ({data: new Uint8ClampedArray(w * h * 4)}),
    putImageData: value => {painted = value.data.slice();},
  }, {get: (o, k) => k in o ? o[k] : noop, set: (o, k, v) => (o[k] = v, true)});
  function el(id) {
    assert(validIds.has(id), `required DOM id ${id}`);
    if (!elements.has(id)) {
      const e = {
        id, style: {}, disabled: false, hidden: false, textContent: '',
        value: ({boardKind: 'sphere', opponent: 'human', humanColor: '1', size: '4', komi: '6.5'})[id] || '',
        selectedIndex: 1, checked: false, events: {}, classList: {toggle: noop},
        getContext: () => context2d, getBoundingClientRect: () => ({width, height, left: 0, top: 0}),
        setAttribute: noop, setPointerCapture: noop,
        addEventListener(k, f) {this.events[k] = f;},
        showModal() {this.open = true;}, close() {this.open = false;},
      };
      if (id === 'size') {
        let options = ['3', '4', '5'], value = '4';
        Object.defineProperty(e, 'value', {get: () => value, set: v => {value = String(v);}});
        Object.defineProperty(e, 'selectedIndex', {get: () => options.indexOf(value), set: i => {value = options[i] ?? '';}});
        Object.defineProperty(e, 'innerHTML', {set(v) {options = [...v.matchAll(/value="([^"]+)"/g)].map(m => m[1]); value = options[0] ?? '';}});
      }
      elements.set(id, e);
    }
    return elements.get(id);
  }
  const realm = vm.createContext({
    console, URL, document: {getElementById: el}, window: {devicePixelRatio: 1, localStorage: storage},
    ResizeObserver: class {constructor(f) {this.f = f;} observe() {this.f();}},
    confirm: () => true,
    requestAnimationFrame: f => frames.push(f),
    setTimeout: f => {timers.set(++tid, f); return tid;},
    clearTimeout: id => timers.delete(id),
  });
  const cache = new Map();
  async function moduleAt(url) {
    const path = fileURLToPath(url);
    if (cache.has(path)) return cache.get(path);
    const module = new vm.SourceTextModule(readFileSync(path, 'utf8'), {
      context: realm, identifier: url.href, initializeImportMeta(meta) {meta.url = url.href;},
    });
    cache.set(path, module);
    await module.link((specifier, parent) => moduleAt(new URL(specifier, parent.identifier)));
    return module;
  }
  await (await moduleAt(new URL('app.js', base))).evaluate();
  return {
    el, data, storage, frames, raw: () => data.get(STORAGE_KEY),
    saved: () => JSON.parse(data.get(STORAGE_KEY)), pixels: () => painted,
    moves: () => Number(el('moveCount').textContent.split(' ')[0]),
  };
}
function gesture(app, dx, dy, cancelled = false) {
  const e = {currentTarget: app.el('board'), pointerId: 1, clientX: 100, clientY: 100};
  app.el('board').events.pointerdown(e);
  app.el('board').events.pointermove({...e, clientX: 100 + dx, clientY: 100 + dy});
  app.el('board').events[cancelled ? 'pointercancel' : 'pointerup']({...e, clientX: 100 + dx, clientY: 100 + dy});
}
for (const [kind, size] of [['sphere', 4], ['torus', 9]]) {
  const game = new Game(createTopology(kind, size), 6.5);
  assert(game.play(0).ok);
  const legacy = {version: 1, game: game.toJSON(), settings: {opponent: 'human', human: 1}, view: {mapView: false, rotX: Math.PI, rotY: .7}};
  const app = await boot(JSON.stringify(legacy));
  assert.equal(app.moves(), 1, 'legacy migration retains moves');
  assert.equal(app.saved().version, 2, 'legacy save upgrades to quaternion schema');
  sameRotation(app.saved().view.orientation, orientationFromEuler(Math.PI, .7), 'legacy app camera');
  assert.deepEqual(app.saved().game, game.toJSON(), 'migration preserves history');
  let q = app.saved().view.orientation;
  for (const [dx, dy, cancelled] of [[24, 0, false], [0, 25, false], [-16, -10, true]]) {
    gesture(app, dx, dy, cancelled);
    q = rotateByDrag(q, dx, dy);
    sameRotation(app.saved().view.orientation, q, 'pointer gesture updates and saves camera');
    assert.equal(app.moves(), 1, 'drag never places a stone');
    const finalPixels = app.pixels();
    while (app.frames.length) app.frames.shift()();
    assert.deepEqual(app.pixels(), finalPixels, 'queued frame cannot restore stale orientation');
  }
  app.el('viewToggle').onclick();
  assert.equal(app.saved().view.mapView, true);
  app.el('viewToggle').onclick();
  sameRotation(app.saved().view.orientation, q, 'map toggle retains orientation');
  const reloaded = await boot(app.raw());
  assert.equal(reloaded.moves(), 1);
  sameRotation(reloaded.saved().view.orientation, q, 'quaternion survives reload');
  assert.deepEqual(reloaded.pixels(), app.pixels(), 'quaternion reload restores identical framebuffer');
  reloaded.el('homeView').onclick();
  sameRotation(reloaded.saved().view.orientation, defaultOrientation(kind), 'home view resets camera');
  assert.equal(reloaded.moves(), 1, 'home view retains game');
  gesture(reloaded, 50, -20);
  reloaded.el('newGame').onclick();
  sameRotation(reloaded.saved().view.orientation, defaultOrientation(kind), 'new game resets camera');
  assert.equal(reloaded.moves(), 0, 'new game resets history');
}
console.log('Independent app integration passed: v1 migration, screen-space pointer events, release/cancel persistence, coalesced redraw, map toggle, v2 reload, home and new-game resets.');

const game = new Game(createTopology('sphere', 3), 6.5);
const data = new Map(), storage = {getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v)};
const view = {mapView: false, orientation: unitQuaternion([1, 2, 3, 4])};
assert.equal(saveGame(game, {opponent: 'human', human: 1}, view, storage), true);
const saved = JSON.parse(data.get(STORAGE_KEY));
assert.equal(saved.version, 2);
sameRotation(loadSavedGame(storage).state.view.orientation, view.orientation, 'public persistence round trip');
for (const bad of [[0, 0, 0, 0], [1, 2, 3], [0, 0, 0, null], ['0', 0, 0, 1], {}, null]) {
  const changed = structuredClone(saved);
  changed.view.orientation = bad;
  assert.throws(() => restoreSnapshot(changed), 'malformed quaternion rejected');
}
console.log('Independent quaternion persistence validation passed.');
