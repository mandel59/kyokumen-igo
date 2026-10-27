import assert from 'node:assert/strict';
import {Game,createTopology} from '../../dist/engine.js';
import {analysisPosition,analysisPolicy,KATAGO_RULES} from './katago-analysis.mjs';
import {toVertex,fromVertex} from '../gtp/vertex.mjs';
for(const size of [7,9,11]){
 const game=new Game(createTopology('plane',size),6.5);
 for(let point=0;point<size*size;point++)assert.equal(fromVertex(toVertex(point,size),size),point);
 for(const point of [1,0,size])assert.ok(game.play(point).ok);
 const query=analysisPosition(game);
 assert.deepEqual(query.moves,[['B','A'+(size-1)],['W','A'+size],['B','B'+size]]);
 assert.deepEqual(query.rules,KATAGO_RULES);assert.equal(query.komi,6.5);assert.equal(query.boardXSize,size);
 assert.equal(game.board[0],0,'app fixture captured the corner');
 const target=size+1;
 const policy=analysisPolicy({moveInfos:[{move:toVertex(target,size),visits:999,edgeVisits:3},{move:'pass',visits:1,edgeVisits:1}]},game,{uniformMix:0});
 assert.equal(policy[target],.75);assert.equal(policy[160],.25);assert.equal(policy[1],0);
 const smooth=analysisPolicy({moveInfos:[{move:toVertex(target,size),visits:4}]},game);
 assert.ok(Math.abs(smooth.reduce((a,b)=>a+b,0)-1)<1e-6);
 assert.equal(smooth[1],0);assert.equal(smooth[size],0);assert.ok(smooth[160]>0);
 assert.throws(()=>analysisPolicy({moveInfos:[{move:toVertex(1,size),visits:1}]},game),/legality/);
 assert.throws(()=>analysisPolicy({moveInfos:[{move:'pass',visits:NaN}]},game),/visits/);
 assert.throws(()=>analysisPolicy({moveInfos:[]},game),/Empty/);
 game.pass();assert.equal(analysisPosition(game).moves.at(-1)[1],'pass');
}
assert.throws(()=>analysisPosition(new Game(createTopology('torus',7))),/plane/);
console.log('KataGo adapter: coordinate/history mapping, plane captures, edge-visit targets, legal smoothing and invalid-output rejection passed.');
