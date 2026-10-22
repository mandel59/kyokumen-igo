import assert from 'node:assert/strict';
import {createTopology, Game} from './dist/engine.js';
import {analyzeBoard, territoryOwners} from './dist/board-analysis.js';

const torus = createTopology('torus', 7), n = torus.vertices.length;
const at = (u, v) => (u % 7) * 7 + (v % 7);
const points = arr => [...arr].flatMap((flag, i) => flag ? [i] : []);
const board = (stones, empties = []) => {
  const b = new Int8Array(n);
  for (const [color, list] of Object.entries(stones)) for (const p of list) b[p] = Number(color);
  for (const p of empties) b[p] = 0;
  return b;
};
// A game standing on an arbitrary position, with the given side to move.
function positioned(topology, b, turn = 1) {
  const game = new Game(topology, 0);
  game.board = Int8Array.from(b);
  game.turn = turn;
  game._seen = new Set([game.board.join('')]);
  game.history = [game._snapshot()];
  return game;
}

// Atari: a chain with exactly one liberty, whole chain marked, both colours.
{
  const a = analyzeBoard(torus, board({1: [0], 2: [7, 42, 1]}));
  assert.deepEqual(points(a.atari), [0]);
  const chain = analyzeBoard(torus, board({1: [0, 6], 2: [7, 42, 1, 5, 13]}));
  assert.deepEqual(points(chain.atari), [0, 6].sort((x, y) => x - y), 'both stones of a one-liberty chain');
  assert.deepEqual(points(analyzeBoard(torus, board({1: [0, 24]})).atari), [], 'many liberties');
}

// Territory is the empty region enclosed by one colour, exactly as the area score counts it.
{
  const single = analyzeBoard(torus, board({1: [10]}));
  assert.equal(points(single.territory).length, n - 1, 'a lone stone owns the whole empty torus');
  assert.ok(points(single.territory).every(p => single.territory[p] === 1));
  const shared = analyzeBoard(torus, board({1: [10], 2: [40]}));
  assert.deepEqual(points(shared.territory), [], 'a region touching both colours is nobody\'s');
  assert.deepEqual(points(analyzeBoard(torus, new Int8Array(n)).territory), [], 'an empty board has no territory');
}

// Alive: Benson's pass-alive chains. The 13-stone shape is the fixture used for the AI's own check.
{
  const stones = [8, 9, 10, 11, 12, 15, 17, 19, 22, 23, 24, 25, 26];
  const a = analyzeBoard(torus, board({2: stones}));
  assert.deepEqual(points(a.alive), stones);
  assert.deepEqual(points(a.dead), []);
  assert.deepEqual(points(analyzeBoard(torus, board({1: stones})).alive), stones, 'either colour');
  // One eye is not enough: filling a vital point of the two-eyed shape removes the certificate.
  assert.deepEqual(points(analyzeBoard(torus, board({2: [...stones, 16]})).alive).length, 0, 'one eye left');
  // The guarantee holds whatever the opponent plays while the owner never moves.
  for (let seed = 1; seed <= 20; seed++) {
    const game = positioned(torus, board({2: stones}), 1);
    let state = seed * 7919;
    const random = max => { state = (state * 1103515245 + 12345) % 2147483648; return state % max; };
    for (let step = 0; step < 300 && !game.ended; step++) {
      const legal = [...Array(n).keys()].filter(i => !game.board[i] && game.analyze(i).ok);
      if (!legal.length) break;
      game.play(legal[random(legal.length)]);
      if (game.ended) break;
      game.pass();
      if (game.ended) break;
    }
    assert.ok(stones.every(p => game.board[p] === 2), 'pass-alive stones stay on the board (seed ' + seed + ')');
  }
}

// Dead: stones that cannot make two eyes in the pocket left by a pass-alive wall.
{
  // White fills everything except two single-point eyes and the pocket.
  const wall = (pocket, eyes, stones = {}) => {
    const b = new Int8Array(n).fill(2);
    for (const p of [...pocket, ...eyes]) b[p] = 0;
    for (const [color, list] of Object.entries(stones)) for (const p of list) b[p] = Number(color);
    return b;
  };
  const eyes = [at(1, 3), at(2, 6)];

  // A black stone with one point of room is dead, and white really can capture it.
  {
    const pocket = [at(5, 0), at(5, 1), at(5, 2)], b = wall(pocket, eyes, {1: [at(5, 1)]});
    const a = analyzeBoard(torus, b);
    assert.deepEqual(points(a.dead), [at(5, 1)]);
    assert.ok(!a.dead[at(5, 0)] && !a.alive[at(5, 1)]);
    assert.ok(points(a.alive).every(p => b[p] === 2), 'the wall is alive');
    const forces = (game, depth) => {
      if (game.board[at(5, 1)] !== 1) return true;
      if (depth === 0 || game.ended) return false;
      const moves = [null, ...[...Array(n).keys()].filter(i => !game.board[i] && game.analyze(i).ok)];
      const next = move => { const g = Game.fromJSON(game.toJSON()); if (move === null) g.pass(); else g.play(move); return g; };
      return game.turn === 2 ? moves.some(m => forces(next(m), depth - 1)) : moves.every(m => forces(next(m), depth - 1));
    };
    assert.ok(forces(positioned(torus, b, 1), 8), 'white captures against every black reply, passes included');
    assert.ok(forces(positioned(torus, b, 2), 8));
  }

  // A 3 × 3 pocket has a single point that is not on the wall, so it cannot hold two eyes.
  const block = [4, 5, 6].flatMap(u => [1, 2, 3].map(v => at(u, v)));
  {
    const a = analyzeBoard(torus, wall(block, eyes, {1: [at(4, 2)]}));
    assert.deepEqual(points(a.dead), [at(4, 2)]);
  }
  // A loose white stone inside leaves the pocket undecided: the two could settle into a seki.
  {
    const a = analyzeBoard(torus, wall(block, eyes, {1: [at(4, 2)], 2: [at(5, 2)]}));
    assert.deepEqual(points(a.dead), []);
  }
  // Room for two non-adjacent eyes means nothing is proved, however dead the shape may look.
  {
    const open = [3, 4, 5, 6].flatMap(u => [0, 1, 2, 3].map(v => at(u, v)));
    assert.deepEqual(points(analyzeBoard(torus, wall(open, [at(0, 5), at(1, 4)], {1: [at(4, 1)]})).dead), []);
  }
  // With no wall at all nothing is dead, and a lone stone is not alive either.
  const lone = analyzeBoard(torus, board({1: [10]}));
  assert.deepEqual([points(lone.dead), points(lone.alive)], [[], []]);
}

// Consistency over random games on every board.
for (const [kind, size] of [['sphere', 3], ['sphere', 4], ['sphere', 5], ['torus', 7], ['torus', 9], ['torus', 11]]) {
  const topology = createTopology(kind, size);
  let state = size * 104729;
  const random = max => { state = (state * 1103515245 + 12345) % 2147483648; return state % max; };
  for (let g = 0; g < 6; g++) {
    const game = new Game(topology, 6.5);
    for (let move = 0; move < topology.vertices.length * 2 && !game.ended; move++) {
      const legal = [...Array(game.board.length).keys()].filter(i => !game.board[i] && game.analyze(i).ok);
      if (!legal.length || random(30) === 0) game.pass(); else game.play(legal[random(legal.length)]);
      if (move % 17) continue;
      const a = analyzeBoard(topology, game.board), score = game.score();
      for (let i = 0; i < game.board.length; i++) {
        if (game.board[i]) assert.equal(a.territory[i], 0, 'stones are not territory');
        else assert.ok(!a.alive[i] && !a.dead[i] && !a.atari[i], 'marks sit on stones');
        assert.ok(!(a.alive[i] && a.dead[i]) && !(a.alive[i] && a.atari[i]), 'alive stones are neither dead nor in atari');
      }
      assert.equal(points(a.territory).filter(i => a.territory[i] === 1).length, score.territoryBlack);
      assert.equal(points(a.territory).filter(i => a.territory[i] === 2).length, score.territoryWhite);
      assert.equal(game.board.length - points(a.territory).length - score.stonesBlack - score.stonesWhite, score.neutral);
      assert.deepEqual(a.territory, territoryOwners(topology.neighbors, game.board));
      // Whole chains are marked together.
      for (const [flag, name] of [[a.alive, 'alive'], [a.dead, 'dead'], [a.atari, 'atari']]) for (let i = 0; i < game.board.length; i++) if (flag[i]) {
        for (const q of topology.neighbors[i]) if (game.board[q] === game.board[i]) assert.ok(flag[q], name + ' covers the chain');
      }
    }
  }
}

console.log('Board analysis passed: atari, territory, Benson alive stones (also under opponent play), proved dead stones (exhaustively checked), and random-game invariants on all boards.');
