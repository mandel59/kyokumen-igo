// Run from the repo root: node tools/ai-tuner/bench-wasm.mjs
// Build instructions and measurement definitions are in WASM-BENCHMARK.md.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createTopology, Game, chooseMove, AI_WEIGHTS} from '../../dist/engine.js';

const here = new URL('./', import.meta.url);
const fixture = JSON.parse(readFileSync(new URL('parity.json', here), 'utf8'));
assert.deepEqual(fixture.params, AI_WEIGHTS);
const output = new URL('target/wasm-bench/results.json', here);
const started = performance.now();
const bytes = readFileSync(new URL('target/wasm-bench/engine.wasm', here));
const readMs = performance.now() - started;
let mark = performance.now();
const module = await WebAssembly.compile(bytes);
const compileMs = performance.now() - mark;
mark = performance.now();
const instance = await WebAssembly.instantiate(module, {});
const instantiateMs = performance.now() - mark;
const wasm = instance.exports;
const maxMoves = Math.max(1, ...fixture.cases.map(c => c.moves.length));
const ptr = wasm.bench_alloc(maxMoves);
const options = {random: () => 0};
const topologies = new Map();
const groups = new Map();
function replay(c) {
  const game = new Game(c.topology, 6.5);
  for (const move of c.moves) assert.equal((move < 0 ? game.pass() : game.play(move)).ok, true);
  return game;
}
function transfer(c) {
  new Int32Array(wasm.memory.buffer, ptr, c.moves.length).set(c.typedMoves);
}
mark = performance.now();
for (const [index, raw] of fixture.cases.entries()) {
  const key = raw.kind + '-' + raw.size;
  if (!topologies.has(key)) topologies.set(key, createTopology(raw.kind, raw.size));
  const c = {...raw, index, kindId: raw.kind === 'sphere' ? 0 : 1,
    topology: topologies.get(key), typedMoves: Int32Array.from(raw.moves)};
  c.game = replay(c);
  transfer(c);
  c.wasmId = wasm.bench_load(c.kindId, c.size, ptr, c.moves.length);
  const expected = c.expected ?? -1;
  assert.equal(chooseMove(c.game, options) ?? -1, expected, 'JS parity ' + index);
  assert.equal(wasm.bench_choose(c.wasmId), expected, 'WASM parity ' + index);
  transfer(c);
  assert.equal(wasm.bench_replay_choose(c.kindId, c.size, ptr, c.moves.length), expected, 'WASM replay parity ' + index);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(c);
}
const preloadAndParityMs = performance.now() - mark;
const cases = [...groups.values()].flat();
let checksum = 0;
const methods = {
  core: {
    js: c => chooseMove(c.game, options) ?? -1,
    wasm: c => wasm.bench_choose(c.wasmId),
  },
  replay: {
    js: c => chooseMove(replay(c), options) ?? -1,
    wasm: c => {
      transfer(c);
      return wasm.bench_replay_choose(c.kindId, c.size, ptr, c.moves.length);
    },
  },
};
function batch(fn, positions, repeats) {
  const begin = performance.now();
  let sum = 0;
  for (let r = 0; r < repeats; r++) for (const c of positions) sum += fn(c);
  checksum += sum;
  return (performance.now() - begin) / (positions.length * repeats);
}
function stats(values) {
  const sorted = [...values].sort((a,b) => a-b);
  return {median: sorted[sorted.length >> 1], min: sorted[0], max: sorted.at(-1), samples: values};
}
const results = [];
for (const [mode, implementations] of Object.entries(methods)) {
  console.error('Warming ' + mode + '...');
  for (let r = 0; r < 10; r++) {
    batch(implementations.js, cases, 1);
    batch(implementations.wasm, cases, 1);
  }
  for (const [key, positions] of groups) {
    const samples = {js: [], wasm: []};
    const rounds = 21, repeats = 4;
    // Alternate which implementation runs first to reduce ordering bias.
    for (let round = 0; round < rounds; round++) {
      const order = round % 2 ? ['wasm', 'js'] : ['js', 'wasm'];
      for (const kind of order) samples[kind].push(batch(implementations[kind], positions, repeats));
    }
    const js = stats(samples.js), wasmTime = stats(samples.wasm);
    const result = {mode, board: key, positions: positions.length, rounds, repeats,
      jsMsPerCall: js, wasmMsPerCall: wasmTime, speedup: js.median / wasmTime.median};
    results.push(result);
    console.log(JSON.stringify({mode, board: key,
      jsMs: +js.median.toFixed(4), wasmMs: +wasmTime.median.toFixed(4),
      speedup: +result.speedup.toFixed(2)}));
  }
}
wasm.bench_free(ptr, maxMoves);
const report = {
  timestamp: new Date().toISOString(),
  environment: {node: process.version, v8: process.versions.v8, platform: process.platform,
    arch: process.arch, cpu: os.cpus()[0].model, logicalCpus: os.cpus().length},
  fixtureCases: cases.length, parity: 'all JS, WASM and WASM replay moves matched fixture',
  wasmBytes: bytes.length, initialization: {readMs, compileMs, instantiateMs, preloadAndParityMs},
  methodology: {warmupRounds: 10, sampleRounds: 21, repeatsPerSample: 4,
    statistic: 'median of batch mean milliseconds per call over 50 positions',
    noise: 0, topology: 'cached in both implementations',
    core: 'positions preloaded; includes one JS-to-WASM call per choice',
    replay: 'rebuild from move history then choose; WASM includes copying moves into linear memory; excludes JSON and Worker messaging'},
  checksum, results,
};
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log('Saved ' + fileURLToPath(output));
