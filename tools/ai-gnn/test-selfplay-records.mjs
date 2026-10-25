import assert from 'node:assert/strict';import fs from 'node:fs';
import {Game,createTopology} from '../../dist/engine.js';
import {fnv1a,finishGame,validateSavedGame,assertSameFeatures} from './selfplay-records.mjs';
const split=JSON.parse(fs.readFileSync('experiments/ai/plans/v3-teacher-distillation/game-split.json'));
for(const g of split.games)assert.equal(fnv1a(`${split.seed}|${g.kind}|${g.size}|${g.gameIndex}`),g.seed);
let cases=0;
for(const[kind,size]of [['sphere',3],['sphere',4],['sphere',5],['torus',7],['torus',9],['torus',11]])for(const komi of [-6.5,0,6.5]){
 const game=new Game(createTopology(kind,size),komi),spec={kind,size,komi,gameId:kind+size+':'+komi},samples=[];
 for(let i=0;i<4;i++){const action=i<2?Array.from(game.board,(_,p)=>p).find(p=>game.analyze(p).ok):160;samples.push({turn:game.turn,ply:game.moves,action,playedAction:action});assert.ok((action===160?game.pass():game.play(action)).ok);}
 const records=finishGame(game,samples,spec),saved={spec,moves:game.history.slice(1).map(s=>s.lastMove??-1),ended:true,margin:game.score().black-game.score().white};
 validateSavedGame(saved,records);assert.equal(records.length,4);assert.equal(records[0].wdl,records[2].wdl);assert.equal(records[1].score,-records[0].score);
 const bad=structuredClone(records);bad[0].score+=1;assert.throws(()=>validateSavedGame(saved,bad),/score/);
 const root={x:new Float32Array(160*32),global_features:new Float32Array(8),legal:new Float32Array(161).fill(1)},row={x:Array(game.board.length*32).fill(0),global:Array(8).fill(0),legal:Array(161).fill(true)};assertSameFeatures(row,root,game.board.length);row.x[0]=1;assert.throws(()=>assertSameFeatures(row,root,game.board.length),/features/);cases++;
}
console.log(JSON.stringify({plannedSeedsMatched:48,labelCases:cases,relativeOwnershipAndOutcomes:true,corruptionRejected:true}));
