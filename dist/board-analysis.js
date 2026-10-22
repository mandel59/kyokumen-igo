// Reads a position for display only. Rules, scoring and the AI never depend on the life and
// death marks here: they say what can be proved about the stones, not what a player must accept.

// Connected empty regions with the set of stone colours that touch them.
export function emptyRegions(neighbors, board) {
  const seen = new Uint8Array(board.length), regions = [];
  for (let start = 0; start < board.length; start++) {
    if (board[start] || seen[start]) continue;
    const points = [start], border = new Set();
    seen[start] = 1;
    for (let k = 0; k < points.length; k++) for (const n of neighbors[points[k]]) {
      if (board[n]) border.add(board[n]);
      else if (!seen[n]) { seen[n] = 1; points.push(n); }
    }
    regions.push({points, border});
  }
  return regions;
}

// Empty points enclosed by one colour only: 1 or 2 at that point, 0 for stones and neutral points.
export function territoryOwners(neighbors, board, regions = emptyRegions(neighbors, board)) {
  const owners = new Uint8Array(board.length);
  for (const {points, border} of regions) {
    if (border.size !== 1) continue;
    const [color] = border;
    for (const p of points) owners[p] = color;
  }
  return owners;
}

// Territory as the screen shows it. With a single stone on the board nobody owns any: after the first
// move the whole board would otherwise read as that stone's territory. (A board emptied of one colour
// by captures keeps the plain reading: there the whole board really is the other colour's.)
// The area score keeps the plain definition (territoryOwners).
export function shownTerritory(neighbors, board, regions) {
  if (board.reduce((count, stone) => count + (stone ? 1 : 0), 0) === 1) return new Uint8Array(board.length);
  return territoryOwners(neighbors, board, regions);
}

function chainsOf(neighbors, board) {
  const chainAt = new Int32Array(board.length).fill(-1), chains = [];
  for (let start = 0; start < board.length; start++) {
    if (!board[start] || chainAt[start] >= 0) continue;
    const color = board[start], stones = [start], liberties = new Set(), id = chains.length;
    chainAt[start] = id;
    for (let k = 0; k < stones.length; k++) for (const n of neighbors[stones[k]]) {
      if (!board[n]) liberties.add(n);
      else if (board[n] === color && chainAt[n] < 0) { chainAt[n] = id; stones.push(n); }
    }
    chains.push({color, stones, liberties});
  }
  return {chainAt, chains};
}

// Benson's pass-alive chains of one colour, in the conservative empty-region form that
// tools/ai-tuner/src/endgame.rs uses: a chain lives with two empty regions that touch only
// surviving chains of that colour and whose every point is adjacent to the chain.
function passAliveChains(neighbors, board, color, chainAt, chains, empties) {
  const regions = [];
  for (const {points, border} of empties) {
    if (border.size !== 1 || !border.has(color)) continue;
    const boundary = new Set();
    for (const p of points) for (const n of neighbors[p]) if (board[n]) boundary.add(chainAt[n]);
    const vital = [...boundary].filter(c => points.every(p => neighbors[p].some(n => chainAt[n] === c)));
    regions.push({boundary, vital, active: true});
  }
  const alive = new Set(chains.flatMap((chain, id) => chain.color === color ? [id] : []));
  for (let changed = true; changed;) {
    changed = false;
    const counts = new Map();
    for (const region of regions) if (region.active) for (const c of region.vital) if (alive.has(c)) counts.set(c, (counts.get(c) || 0) + 1);
    for (const c of [...alive]) if ((counts.get(c) || 0) < 2) { alive.delete(c); changed = true; }
    for (const region of regions) if (region.active && [...region.boundary].some(c => !alive.has(c))) { region.active = false; changed = true; }
  }
  return alive;
}

// The points a colour could still use to live, given the other colour's pass-alive chains: the
// connected area outside those chains. Returns the stones of this colour that provably cannot
// make two eyes there. Each eye needs a point whose neighbours are all inside the area (a point
// touching a pass-alive stone is not an eye), two eyes need non-adjacent such points, and the
// area must hold none of the other colour's loose stones, which could trade a seki, or any
// pass-alive stone of this colour to join.
function stonesWithoutRoom(neighbors, board, color, passAliveStones) {
  const area = new Int32Array(board.length).fill(-1), dead = [];
  for (let start = 0; start < board.length; start++) {
    if (area[start] >= 0 || passAliveStones[start] && board[start] !== color) continue;
    const points = [start];
    area[start] = start;
    for (let k = 0; k < points.length; k++) for (const n of neighbors[points[k]]) {
      if (area[n] < 0 && !(passAliveStones[n] && board[n] !== color)) { area[n] = start; points.push(n); }
    }
    const stones = points.filter(p => board[p] === color);
    if (!stones.length || points.some(p => board[p] === 3 - color || passAliveStones[p])) continue;
    const eyePoints = points.filter(p => neighbors[p].every(n => area[n] === start));
    const twoEyes = eyePoints.some((p, i) => eyePoints.slice(i + 1).some(q => !neighbors[p].includes(q)));
    if (!twoEyes) dead.push(...stones);
  }
  return dead;
}

// Per point: alive (pass-alive stone), dead (stone proved unable to live), atari (stone in a chain
// with one liberty) as 0/1, and territory (owner colour of an enclosed empty point, see shownTerritory).
export function analyzeBoard(topology, board) {
  const {neighbors} = topology, n = board.length;
  const {chainAt, chains} = chainsOf(neighbors, board), regions = emptyRegions(neighbors, board);
  const alive = new Uint8Array(n), dead = new Uint8Array(n), atari = new Uint8Array(n);
  const aliveChains = {1: passAliveChains(neighbors, board, 1, chainAt, chains, regions), 2: passAliveChains(neighbors, board, 2, chainAt, chains, regions)};
  for (let p = 0; p < n; p++) if (board[p]) {
    const id = chainAt[p];
    if (aliveChains[board[p]].has(id)) alive[p] = 1;
    if (chains[id].liberties.size === 1) atari[p] = 1;
  }
  for (const color of [1, 2]) for (const p of stonesWithoutRoom(neighbors, board, color, alive)) dead[p] = 1;
  return {alive, dead, atari, territory: shownTerritory(neighbors, board, regions)};
}
