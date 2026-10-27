// Shared game-record codes: round trips and compatibility with deployed B and C links.
import assert from 'node:assert/strict';
import {Game,createTopology} from './dist/engine.js';
import {encodeRecord,decodeRecord} from './dist/record.js';
function finished(kind,size,komi,moves){
 const game=new Game(createTopology(kind,size),komi);
 for(const move of moves)assert.equal((move===null?game.pass():game.play(move)).ok,true);
 game.pass();game.pass();assert.equal(game.ended,true);return game;
}
const games=[finished('torus',7,.5,[17,24,31,18,23,32,0,26,25]),finished('sphere',5,9.5,[0,151,null,75,3]),
 finished('torus',7,1,[0,24,1])];
for(const [kind,sizes] of [['sphere',[3,4,5]],['torus',[7,9,11]],['plane',[7,9,11]]])for(const size of sizes){
 for(let komi=0;komi<=9.5;komi+=.5){
  const n=createTopology(kind,size).vertices.length;
  games.push(finished(kind,size,komi,[0,n-1,Math.floor(n/2),1]));
 }
}
for(const game of games)for(const ai of [0,1,2]){
 const code=encodeRecord(game,ai),decoded=decodeRecord(code);
 assert.match(code,/^D[A-Za-z0-9_-]+$/);
 assert.equal(decoded.ai,ai);
 assert.deepEqual(decoded.game.toJSON(),game.toJSON());
 const bits=Math.log2(540)+game.moves*Math.log2(game.board.length+1);
 assert.ok(code.length<=1+Math.ceil(bits/6));
}
assert.equal(decodeRecord(encodeRecord(games[2])).game.score().winner,0);
for(const example of [{"kind":"torus","size":7,"komi":0.5,"moves":[17,24,31,18,23,32,0,26,25],"code":"BL6LiwJ2WUU3l"},{"kind":"sphere","size":4,"komi":6.5,"moves":[],"code":"BGurG"}]) {
 const decoded=decodeRecord(example.code);
 assert.deepEqual(decoded.game.toJSON(),finished(example.kind,example.size,example.komi,example.moves).toJSON());
 assert.equal(decoded.ai,0);
}
const ALPHABET='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',PASS=49;
function code(moves,extra=[],version='C',komiIndex=version==='B'?0:1){
 const digits=[[1,2],[0,3],[komiIndex,version==='B'?10:20],[0,3],...moves.map(m=>[m??PASS,50]),...extra];
 let value=0n,text='';
 for(let i=digits.length-1;i>=0;i--)value=value*BigInt(digits[i][1])+BigInt(digits[i][0]);
 while(value>0n){text=ALPHABET[Number(value%64n)]+text;value/=64n;}
 return version+text;
}
const ko=[17,24,31,18,23,32,0,26,25];
// Deployed C links (two board kinds) still decode to the same game.
assert.deepEqual(decodeRecord(code([...ko,null,null])).game.toJSON(),games[0].toJSON());
// The same moves are a different game on the plane board, so the kind survives the round trip.
const planeKo=finished('plane',7,.5,[17,24,31,18,23,32,0,26,25]);
assert.equal(decodeRecord(encodeRecord(planeKo)).game.topology.kind,'plane');
for(let i=0;i<10;i++){
 const old=decodeRecord(code([null,null],[],'B',i)).game;
 assert.equal(old.komi,i+.5);
 assert.equal(old.ended,true);
}
for(const version of ['B','C']){
 const rejected={
  empty:'',notString:null,oldFormat:'AQEHAQA',futureFormat:'Exyz',
  symbols:code([null,null],[],version)+'+',padding:code([null,null],[],version)+'=',
  tooLong:version+'A'.repeat(16000),occupied:code([0,0,null,null],[],version),
  unfinished:code([0],[],version),afterEnd:code([null,null],[[5,50]],version),
  superkoRetake:code([...ko,24,null,null],[],version),
 };
 for(const [name,value] of Object.entries(rejected))assert.throws(()=>decodeRecord(value),undefined,version+' '+name);
}
for(const komi of [-.5,.25,10,NaN,Infinity])assert.throws(()=>encodeRecord(finished('torus',7,komi,[])),/komi/);
console.log('Record round trips passed: every half-point komi, drawn games, all boards (plane included)/AI colours and deployed B/C links.');
console.log('Record rejection passed for B/C: malformed codes, illegal moves, superko, unfinished and trailing records.');
