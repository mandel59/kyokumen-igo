import {Game,createTopology} from './engine.js';
import {KOMI_VALUES,isValidKomi} from './komi.js';

// A finished game as a URL-safe code. The first character names the format; the rest is one
// mixed-radix integer written in base 64: board kind, size, komi and AI colour (0 = two players),
// then every move as one of the board's points or a pass. Each value takes log2(choices) bits.
// D adds the plane board (three kinds); C adds zero and integer komi; B links retain their
// original 10-value header. B and C links have two kinds.
const VERSION='D',ALPHABET='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const KINDS=['sphere','torus','plane'],SIZES={sphere:[3,4,5],torus:[7,9,11],plane:[7,9,11]},LEGACY_KOMIS=[.5,1.5,2.5,3.5,4.5,5.5,6.5,7.5,8.5,9.5];
const MAX_MOVES=10000,MAX_LENGTH=16000;

export function encodeRecord(game,ai=0){
  const {kind,size}=game.topology,points=game.board.length;
  if(!isValidKomi(game.komi))throw new Error('Invalid record komi');
  const digits=[[KINDS.indexOf(kind),KINDS.length],[SIZES[kind].indexOf(size),3],[KOMI_VALUES.indexOf(game.komi),KOMI_VALUES.length],[ai,3],...game.history.slice(1).map(s=>[s.lastMove??points,points+1])];
  let value=0n;
  for(let i=digits.length-1;i>=0;i--)value=value*BigInt(digits[i][1])+BigInt(digits[i][0]);
  let text='';
  while(value>0n){text=ALPHABET[Number(value%64n)]+text;value/=64n;}
  return VERSION+text;
}

// Shared codes are untrusted: replay every move through the rules and require a finished game.
export function decodeRecord(code){
  if(typeof code!=='string'||!['B','C',VERSION].includes(code[0])||code.length>MAX_LENGTH||!/^[A-Za-z0-9_-]+$/.test(code))throw new Error('Invalid record');
  let value=0n;
  for(const c of code.slice(1))value=value*64n+BigInt(ALPHABET.indexOf(c));
  const take=radix=>{const digit=Number(value%BigInt(radix));value/=BigInt(radix);return digit;};
  const komis=code[0]==='B'?LEGACY_KOMIS:KOMI_VALUES;
  const kind=KINDS[take(code[0]===VERSION?KINDS.length:2)],size=SIZES[kind][take(3)],komi=komis[take(komis.length)],ai=take(3);
  const game=new Game(createTopology(kind,size),komi),points=game.board.length;
  // Once the digits run out every further move reads as point 0, which soon fails as occupied.
  while(!game.ended){
    if(game.moves>=MAX_MOVES)throw new Error('Record too long');
    const move=take(points+1);
    if(!(move===points?game.pass():game.play(move)).ok)throw new Error('Illegal recorded move');
  }
  if(value)throw new Error('Data after the end of the game');
  return {game,ai};
}
