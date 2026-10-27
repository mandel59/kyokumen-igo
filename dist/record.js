import {Game,createTopology} from './engine.js';
import {KOMI_VALUES,isValidKomi} from './komi.js';

// A finished game as a URL-safe code. The first character names the format; the rest is one
// mixed-radix integer written in base 64: board kind, size, komi and AI colour (0 = two players),
// then every move as one of the board's points or a pass. Each value takes log2(choices) bits.
// B and C headers are dense: two kinds, three sizes per kind, every komi value and AI colour
// are each used up, so C (zero and integer komi) needed a new letter. D (adding the plane) leaves
// room in each header field, so new kinds, sizes, komi and AI options fit the same format:
//   kind   radix 16   index into KINDS, which is only ever appended to
//   size   radix 64   the number of lines (sphere: cube-edge divisions), not an index
//   komi   radix 128  half-points + 64, so -32 to 31.5
//   ai     radix 8    0 two players, 1 black, 2 white; 3-7 reserved
//   extra  radix 16   always 0 for now; reserved for information D cannot yet carry, such as
//                     handicap stones, rule variants or which AI played
// A decoder rejects values it does not support instead of misreading the record. The header costs
// 24 bits instead of 9, about two and a half characters.
const VERSION='D',ALPHABET='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const KINDS=['sphere','torus','plane'],SIZES={sphere:[3,4,5],torus:[7,9,11],plane:[7,9,11]},LEGACY_KOMIS=[.5,1.5,2.5,3.5,4.5,5.5,6.5,7.5,8.5,9.5];
const MAX_MOVES=10000,MAX_LENGTH=16000,HEADER={kind:16,size:64,komi:128,ai:8,extra:16},KOMI_OFFSET=64;

export function encodeRecord(game,ai=0){
  const {kind,size}=game.topology,points=game.board.length;
  if(!isValidKomi(game.komi))throw new Error('Invalid record komi');
  if(![0,1,2].includes(ai))throw new Error('Invalid record AI');
  const digits=[[KINDS.indexOf(kind),HEADER.kind],[size,HEADER.size],[game.komi*2+KOMI_OFFSET,HEADER.komi],[ai,HEADER.ai],[0,HEADER.extra],...game.history.slice(1).map(s=>[s.lastMove??points,points+1])];
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
  let kind,size,komi,ai;
  if(code[0]===VERSION){
    kind=KINDS[take(HEADER.kind)];size=take(HEADER.size);komi=(take(HEADER.komi)-KOMI_OFFSET)/2;ai=take(HEADER.ai);
    if(!SIZES[kind]?.includes(size)||!isValidKomi(komi)||ai>2||take(HEADER.extra))throw new Error('Unsupported record');
  }else{
    const komis=code[0]==='B'?LEGACY_KOMIS:KOMI_VALUES;
    kind=KINDS[take(2)];size=SIZES[kind][take(3)];komi=komis[take(komis.length)];ai=take(3);
  }
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
