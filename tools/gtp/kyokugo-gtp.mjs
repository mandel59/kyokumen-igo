// Kyokugo AI as a GTP version 2 engine on the plane boards, for matches against other Go programs.
//   node tools/gtp/kyokugo-gtp.mjs [--ai v2] [--depth 4] [--seed N]
//   node tools/gtp/kyokugo-gtp.mjs --ai v3 [--visits 64] [--seed N]
// v3 runs the shipped model (dist/models/v3) on the CPU through ONNX Runtime, with the shipped
// search WASM and a fixed visit budget (the app uses 64); it needs npm ci --prefix tools/ai-gnn.
// Rules are the app's: area scoring, positional superko, no suicide. The sphere and torus have no
// GTP coordinates, so only boardsize 7, 9 and 11 (the plane boards) are accepted.
import {readFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {createTopology,Game} from '../../dist/engine.js';
import {aiPosition} from '../../dist/ai-position.js';
import {createWasmAI} from '../../dist/ai-wasm.js';
import {fromVertex,toVertex} from './vertex.mjs';

const text=(name,fallback)=>{const i=process.argv.indexOf('--'+name);return i<0?fallback:process.argv[i+1];};
const option=(name,fallback)=>Number(text(name,fallback));
const version=text('ai','v2'),depth=option('depth',4),visits=option('visits',64);let seed=option('seed',1)>>>0;
const read=path=>readFileSync(new URL(path,import.meta.url));
// Both players take a position and a seed, and return a point or null for a pass.
async function createPlayer(){
  if(version==='v2'){
    const ai=await createWasmAI({load:async()=>read('../../dist/ai-engine.wasm')});
    return {name:'Kyokugo AI v2',detail:'depth '+depth,choose:(position,seed)=>ai.chooseMove(position,{depth,seed})};
  }
  if(version!=='v3')throw new Error('--ai must be v2 or v3');
  const [{createOfflineAI},{createNodeInference},{createV3Search}]=await Promise.all([
    import('../ai-gnn/offline-player.mjs'),import('../ai-gnn/node-inference.mjs'),import('../../dist/ai-v3-search.js')]);
  const ai=await createOfflineAI({createSearch:()=>createV3Search({load:async()=>read('../../dist/ai-v3.wasm')}),
    createInference:()=>createNodeInference(fileURLToPath(new URL('../../dist/models/v3',import.meta.url)))});
  return {name:'Kyokugo AI v3',detail:visits+' visits',choose:async(position,seed)=>(await ai.chooseMove(position,{seed,maxSimulations:visits})).move};
}
const ai=await createPlayer();
const SIZES=[7,9,11];
let size=9,komi=6.5,game=new Game(createTopology('plane',size),komi);

const colorOf=text=>/^(b|black)$/i.test(text)?1:/^(w|white)$/i.test(text)?2:0;
function reset(){game=new Game(createTopology('plane',size),komi);}
// GTP lets a controller play either colour at any time; a move out of turn is preceded by a pass.
function playAs(color,point){
  if(game.ended)game.undo();
  if(game.turn!==color)game.pass();
  const result=point===null?game.pass():game.play(point);
  if(!result.ok)throw new Error('illegal move');
}
async function genmove(color){
  if(game.turn!==color)game.pass();
  const move=await ai.choose(aiPosition(game),seed++);
  playAs(color,move);
  return toVertex(move,size);
}
const COMMANDS={
  protocol_version:()=>'2',name:()=>ai.name,version:()=>ai.detail,
  known_command:([c])=>String(c in COMMANDS),list_commands:()=>Object.keys(COMMANDS).join('\n'),
  boardsize:([n])=>{if(!SIZES.includes(Number(n)))throw new Error('unacceptable size');size=Number(n);reset();return '';},
  clear_board:()=>{reset();return '';},
  komi:([k])=>{if(!Number.isFinite(Number(k)))throw new Error('syntax error');komi=Number(k);game.komi=komi;return '';},
  play:([c,v])=>{const color=colorOf(c);if(!color)throw new Error('syntax error');playAs(color,fromVertex(v??'',size));return '';},
  genmove:([c])=>{const color=colorOf(c);if(!color)throw new Error('syntax error');return genmove(color);},
  // The app already requires dead stones to be captured, so cleanup play is ordinary play.
  'kgs-genmove_cleanup':args=>COMMANDS.genmove(args),
  undo:()=>{if(!game.undo())throw new Error('cannot undo');return '';},
  final_score:()=>{const s=game.score();return s.winner?(s.winner===1?'B+':'W+')+s.margin:'0';},
  showboard:()=>'\n'+Array.from({length:size},(_,r)=>Array.from({length:size},(_,u)=>'.XO'[game.board[u*size+r]]).join(' ')).join('\n'),
  quit:()=>'',
};
for await (const raw of createInterface({input:process.stdin})){
  const line=raw.replace(/#.*/,'').trim();if(!line)continue;
  const [first,...rest]=line.split(/\s+/),id=/^\d+$/.test(first)?first:'',[command,...args]=id?rest:[first,...rest];
  let reply,ok=true;
  try{if(!(command in COMMANDS))throw new Error('unknown command');reply=await COMMANDS[command](args);}
  catch(error){ok=false;reply=error.message;}
  process.stdout.write((ok?'=':'?')+id+(reply?' '+reply:'')+'\n\n');
  if(command==='quit')break;
}
