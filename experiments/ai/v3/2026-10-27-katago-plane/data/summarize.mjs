// Summarises the match records in this directory into summary.json.
//   node experiments/ai/v3/2026-10-27-katago-plane/data/summarize.mjs
// Margin is Kyokugo's points minus KataGo's (negative = loss). "Wiped" means Kyokugo ended with no
// stones (its points equal its komi as white, or zero as black). Intervals are Wilson 95% intervals
// of the win rate; games are independent, with colours alternating.
import {readFileSync,writeFileSync} from 'node:fs';

const here=new URL('./',import.meta.url);
const wilson=(wins,n,z=1.959964)=>{
  const p=wins/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
  return [Number((c-h).toFixed(3)),Number((c+h).toFixed(3))];
};
const median=values=>{const a=[...values].sort((x,y)=>x-y);return (a[(a.length-1)>>1]+a[a.length>>1])/2;};
function summarise(games){
  const rows=games.map(g=>{
    const black=g.black.startsWith('Kyokugo'),own=black?g.black_points:g.white_points,other=black?g.white_points:g.black_points;
    return {black,win:g.winner.startsWith('Kyokugo'),margin:own-other,wiped:own===(black?0:g.komi),moves:g.moves,reason:g.reason};
  });
  const wins=rows.filter(r=>r.win).length,side=black=>rows.filter(r=>r.black===black);
  return {games:rows.length,wins,winRate:Number((wins/rows.length).toFixed(3)),wilson95:wilson(wins,rows.length),
    winsAsBlack:side(true).filter(r=>r.win).length,gamesAsBlack:side(true).length,
    winsAsWhite:side(false).filter(r=>r.win).length,gamesAsWhite:side(false).length,
    medianMargin:median(rows.map(r=>r.margin)),meanMargin:Number((rows.reduce((a,r)=>a+r.margin,0)/rows.length).toFixed(1)),
    wiped:rows.filter(r=>r.wiped).length,meanMoves:Math.round(rows.reduce((a,r)=>a+r.moves,0)/rows.length),
    endedOtherThanScore:rows.filter(r=>r.reason!=='score').length};
}
const read=name=>readFileSync(new URL(name,here),'utf8').trim().split('\n').map(line=>JSON.parse(line));
const summary={schemaVersion:1,opponent:'KataGo 1.18.1 b18c384nbt-humanv0, humanSLProfile rank_20k, maxVisits 10',komi:6.5,players:{}};
for(const player of ['v2','v3']){
  const all=[];summary.players[player]={boards:{}};
  for(const size of [7,9,11]){const games=read(`${player}-rank20k-${size}.jsonl`);all.push(...games);summary.players[player].boards[size]=summarise(games);}
  summary.players[player].total=summarise(all);
}
writeFileSync(new URL('summary.json',here),JSON.stringify(summary,null,1)+'\n');
for(const [player,data] of Object.entries(summary.players))
  for(const [board,s] of [...Object.entries(data.boards),['total',data.total]])
    console.log(player,board,`${s.wins}/${s.games}`,s.wilson95.join('–'),'median',s.medianMargin,'wiped',s.wiped);
