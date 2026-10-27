import {createTopology,Game} from './engine.js';

const SIZES={sphere:[3,4,5],torus:[7,9,11],plane:[7,9,11]};

// Only the move list crosses the Worker boundary; the UI keeps its snapshots for undo/save.
export function aiPosition(game) {
  return {kind:game.topology.kind,size:game.topology.size,komi:game.komi,
    moves:Int32Array.from(game.history.slice(1),s=>s.lastMove??-1)};
}

export function validateAIPosition(position) {
  if(!position||!SIZES[position.kind]?.includes(position.size)||!Number.isFinite(position.komi)
      ||!(Array.isArray(position.moves)||position.moves instanceof Int32Array)||position.moves.length>10000)
    throw new Error('Invalid AI position');
  const points=position.kind==='sphere'?6*position.size*position.size+2:position.size*position.size;
  for(const move of position.moves)
    if(!Number.isInteger(move)||move< -1||move>=points)throw new Error('Invalid AI move');
}

export function restoreAIPosition(position) {
  validateAIPosition(position);
  const game=new Game(createTopology(position.kind,position.size),position.komi);
  for(const move of position.moves)
    if(!(move===-1?game.pass():game.play(move)).ok)throw new Error('Illegal AI history');
  return game;
}
