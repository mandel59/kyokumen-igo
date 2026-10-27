// Plays two GTP engines against each other on a plane board, refereed by the app's own rules
// (dist/engine.js: area scoring, positional superko, no suicide, no dead-stone removal).
//   node tools/gtp/match.mjs --a "<command>" --b "<command>" [--size 9] [--komi 6.5] [--games 20]
//     [--out results.jsonl] [--cwd-a dir] [--cwd-b dir]
// Engines swap colours every game. An illegal or unreadable move loses the game. Each game is
// written as one JSON line with its moves (GTP vertices), the referee's score and the winner.
import {spawn} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {createTopology,Game} from '../../dist/engine.js';
import {fromVertex,toVertex} from './vertex.mjs';

const arg=(name,fallback)=>{const i=process.argv.indexOf('--'+name);return i<0?fallback:process.argv[i+1];};
const size=Number(arg('size',9)),komi=Number(arg('komi',6.5)),games=Number(arg('games',20)),out=arg('out',null);
// A game that runs this long without two passes is scored as it stands.
const MAX_MOVES=size*size*3;

function engine(command,cwd){
  const child=spawn(command,{shell:true,cwd,stdio:['pipe','pipe','ignore']}),lines=createInterface({input:child.stdout});
  const pending=[];let reply=[];
  lines.on('line',line=>{
    if(line.trim()===''){if(reply.length)pending.shift()?.(reply.join('\n'));reply=[];return;}
    reply.push(line);
  });
  const send=command=>new Promise(resolve=>{pending.push(resolve);child.stdin.write(command+'\n');}).then(text=>{
    if(!text.startsWith('='))throw new Error(`${command}: ${text}`);
    return text.slice(1).trim();
  });
  return {send,name:async()=>[await send('name'),await send('version').catch(()=>'')].filter(Boolean).join(' '),close:()=>send('quit').catch(()=>{}).finally(()=>child.kill())};
}

const engines={a:engine(arg('a'),arg('cwd-a')),b:engine(arg('b'),arg('cwd-b'))};
const names={a:await engines.a.name(),b:await engines.b.name()};
const tally={a:0,b:0,draw:0};
for(let index=0;index<games;index++){
  // Game 0: a plays black. Colours alternate so both engines play both sides equally.
  const black=index%2?'b':'a',white=black==='a'?'b':'a',side={1:black,2:white};
  for(const key of ['a','b']){await engines[key].send('boardsize '+size);await engines[key].send('clear_board');await engines[key].send('komi '+komi);}
  const game=new Game(createTopology('plane',size),komi),moves=[];let forfeit=null;
  while(!game.ended&&game.moves<MAX_MOVES){
    const color=game.turn,mover=side[color],other=side[3-color],letter=color===1?'b':'w';
    const vertex=(await engines[mover].send('genmove '+letter)).toLowerCase();
    if(vertex==='resign'){forfeit=color;moves.push('resign');break;}
    let point;
    try{point=fromVertex(vertex,size);}catch{forfeit=color;moves.push(vertex);break;}
    const result=point===null?game.pass():game.play(point);
    if(!result.ok){forfeit=color;moves.push(vertex+'?');break;}
    moves.push(toVertex(point,size));
    await engines[other].send(`play ${letter} ${toVertex(point,size)}`);
  }
  const score=game.score(),winnerColor=forfeit?3-forfeit:score.winner,winner=winnerColor?side[winnerColor]:'draw';
  tally[winner]++;
  const record={game:index,size,komi,black:names[black],white:names[white],winner:winner==='draw'?'draw':names[winner],
    reason:forfeit?(moves.at(-1)==='resign'?'resign':'illegal'):game.ended?'score':'move limit',
    black_points:score.black,white_points:score.white,moves:moves.length,record:moves.join(' ')};
  if(out)appendFileSync(out,JSON.stringify(record)+'\n');
  console.log(`${index+1}/${games} ${names[black]} (B) vs ${names[white]} (W): ${record.winner}, ${record.reason}, B ${score.black} / W ${score.white}, ${moves.length} moves`);
}
console.log(`\n${names.a}: ${tally.a} wins, ${names.b}: ${tally.b} wins, ${tally.draw} draws (${games} games, ${size}x${size}, komi ${komi})`);
await engines.a.close();await engines.b.close();
