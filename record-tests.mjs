// Shared game-record codes: round trips, size and rejection of untrusted input.
import assert from 'node:assert/strict';
import {Game,createTopology} from './dist/engine.js';
import {encodeRecord,decodeRecord} from './dist/record.js';
function finished(kind,size,komi,moves){
 const game=new Game(createTopology(kind,size),komi);
 for(const move of moves)assert.equal((move===null?game.pass():game.play(move)).ok,true);
 game.pass();game.pass();assert.equal(game.ended,true);return game;
}
// Every board size, a capture/ko sequence, mid-game passes and each AI colour survive the round trip.
const games=[finished('torus',7,.5,[17,24,31,18,23,32,0,26,25]),finished('sphere',5,9.5,[0,151,null,75,3])];
for(const [kind,sizes] of [['sphere',[3,4,5]],['torus',[7,9,11]]])for(const size of sizes){
 const n=createTopology(kind,size).vertices.length;games.push(finished(kind,size,6.5,[0,n-1,Math.floor(n/2),1]));
}
for(const game of games)for(const ai of [0,1,2]){
 const code=encodeRecord(game,ai),decoded=decodeRecord(code);
 assert.match(code,/^B[A-Za-z0-9_-]+$/,'format marker, then URL-safe characters without padding');
 assert.equal(decoded.ai,ai);
 assert.deepEqual(decoded.game.toJSON(),game.toJSON());
 // The header needs log2(2·3·10·3) bits and each move log2(points + 1); nothing is rounded to bytes.
 const bits=Math.log2(180)+game.moves*Math.log2(game.board.length+1);
 assert.ok(code.length<=1+Math.ceil(bits/6),`${game.topology.kind}${game.topology.size}: ${code.length} characters`);
}
console.log('Record round trips passed: all board sizes, komi, captures, passes, AI colours and packed length.');
// Hand-built codes for a two-player 7×7 torus with komi 0.5 (49 points, so 50 choices per move).
const ALPHABET='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',PASS=49;
function code(moves,extra=[]){
 const digits=[[1,2],[0,3],[0,10],[0,3],...moves.map(m=>[m??PASS,50]),...extra];let value=0n,text='';
 for(let i=digits.length-1;i>=0;i--)value=value*BigInt(digits[i][1])+BigInt(digits[i][0]);
 while(value>0n){text=ALPHABET[Number(value%64n)]+text;value/=64n;}
 return 'B'+text;
}
const ko=[17,24,31,18,23,32,0,26,25];
assert.equal(code([...ko,null,null]),encodeRecord(games[0]),'hand-built code matches the encoder');
const rejected={
 empty:'',notString:null,oldFormat:'AQEHAQA',symbols:code([null,null])+'+',padding:code([null,null])+'=',
 tooLong:'B'+'A'.repeat(16000),occupied:code([0,0,null,null]),unfinished:code([0]),
 afterEnd:code([null,null],[[5,50]]),superkoRetake:code([...ko,24,null,null]),
};
for(const [name,value] of Object.entries(rejected))assert.throws(()=>decodeRecord(value),undefined,name);
console.log('Record rejection passed: old or malformed codes, illegal moves, superko, unfinished, trailing and over-long records.');
