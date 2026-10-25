import {Game,createTopology} from '../../dist/engine.js';
export function invariant(ok,message){if(!ok)throw Error(message);}
export function fnv1a(text){let h=2166136261;for(const c of text)h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;return h||1;}
export function finalOwners(game){
 const owners=Array.from(game.board),seen=new Set();
 for(let p=0;p<owners.length;p++)if(!owners[p]&&!seen.has(p)){
  const region=[p],border=new Set();seen.add(p);
  for(let i=0;i<region.length;i++)for(const q of game.topology.neighbors[region[i]]){if(game.board[q])border.add(game.board[q]);else if(!seen.has(q)){seen.add(q);region.push(q);}}
  const owner=border.size===1?[...border][0]:0;for(const q of region)owners[q]=owner;
 }
 return owners;
}
export function finishGame(game,samples,spec){
 invariant(game.ended,'Cannot label an incomplete game');const score=game.score(),owners=finalOwners(game);
 return samples.map(({turn,...sample})=>({schemaVersion:1,gameId:spec.gameId,originGameId:spec.gameId,positionId:spec.gameId+':'+sample.ply,kind:spec.kind,size:spec.size,toPlay:turn,...sample,wdl:score.winner===0?1:score.winner===turn?0:2,score:(score.black-score.white)*(turn===1?1:-1),ownership:owners.map(s=>s===0?1:s===turn?0:2)}));
}
export function validateSavedGame(saved,rows){
 const {spec,moves}=saved,game=new Game(createTopology(spec.kind,spec.size),spec.komi);invariant(rows.length===moves.length,'Saved rows/moves mismatch');
 for(let i=0;i<moves.length;i++){
  const r=rows[i];invariant(r.gameId===spec.gameId&&r.positionId===spec.gameId+':'+i&&r.ply===i&&r.toPlay===game.turn,'Saved position identity mismatch');
  invariant((r.playedAction??r.action)===(moves[i]<0?160:moves[i]),'Saved action mismatch');invariant((moves[i]<0?game.pass():game.play(moves[i])).ok,'Illegal saved move');
 }
 invariant(game.ended&&saved.ended,'Incomplete saved game');const score=game.score(),owners=finalOwners(game);invariant(saved.margin===score.black-score.white,'Saved margin mismatch');
 for(const r of rows){const turn=r.toPlay;invariant(r.wdl===(score.winner===0?1:score.winner===turn?0:2),'Saved WDL mismatch');invariant(r.score===(score.black-score.white)*(turn===1?1:-1),'Saved score mismatch');invariant(r.ownership.length===owners.length&&r.ownership.every((s,i)=>s===(owners[i]===0?1:owners[i]===turn?0:2)),'Saved ownership mismatch');}
 return game;
}
export function assertSameFeatures(row,root,n){
 invariant(row.x.length===n*32&&row.x.every((v,i)=>v===root.x[i]),'Replayed features differ');invariant(row.global.length===8&&row.global.every((v,i)=>v===root.global_features[i]),'Replayed globals differ');invariant(row.legal.length===161&&row.legal.every((v,i)=>v===Boolean(root.legal[i])),'Replayed legal mask differs');
}
