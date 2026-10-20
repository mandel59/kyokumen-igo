// Compare search depths (0 = shipped greedy), swapping colours and player noise streams.
#[path="src/ai.rs"] mod ai;
#[path="src/board.rs"] mod board;
#[path="src/rng.rs"] mod rng;
#[path="src/search.rs"] mod search;
use board::{Game,Kind,Topology,Scratch};
use rng::Rng;
use std::sync::{Mutex,atomic::{AtomicUsize,Ordering}};
use std::time::Instant;
const CONFIGS:[(Kind,usize);6]=[(Kind::Sphere,3),(Kind::Sphere,4),(Kind::Sphere,5),(Kind::Torus,7),(Kind::Torus,9),(Kind::Torus,11)];
struct Outcome {margin:i32,ended:bool,moves:usize,nodes:usize,black_depth:u32,record:Vec<Option<usize>>}
fn play(t:&Topology,black_depth:u32,white_depth:u32,black_seed:u64,white_seed:u64,komi:f64,record:bool)->Outcome {
 let mut game=Game::new(t,komi);let mut scratch=Scratch::new(t.len());
 let (mut black,mut white)=(Rng::new(black_seed),Rng::new(white_seed));let mut nodes=0;
 while !game.ended&&game.history.len()<t.len()*20 {
  let depth=if game.turn==1 {black_depth}else{white_depth};
  let seed=if game.turn==1 {black.next_u64()}else{white.next_u64()}as u32;
  let point=if depth==0 {let mut noise=Rng::new(seed as u64);ai::choose_move(&game,&ai::Params::tuned(),&mut scratch,&mut||noise.f64())}
   else {let (point,stats)=search::choose_with_params(&game,depth,seed,&search::Params::legacy());nodes+=stats.nodes;point};
  assert!(match point {Some(p)=>game.play(p,&mut scratch),None=>game.pass()});
 }
 let (black,white)=game.score();
 Outcome{margin:(black-white+komi)as i32,ended:game.ended,moves:game.history.len(),nodes,black_depth,
  record:if record{game.history}else{Vec::new()}}
}
fn main() {
 let args:Vec<_>=std::env::args().collect();
 let parse=|i:usize,default:&str|args.get(i).map_or(default.to_string(),String::clone);
 let a:u32=parse(1,"3").parse().unwrap();let b:u32=parse(2,"0").parse().unwrap();
 let pairs:usize=parse(3,"20").parse().unwrap();let komi:f64=parse(4,"6.5").parse().unwrap();
 let seed:u64=parse(5,"20261022").parse().unwrap();
 let output=parse(6,"target/search-study/results.json");
 let topologies:Vec<_>=CONFIGS.iter().map(|&(kind,size)|Topology::new(kind,size)).collect();
 let samples:Vec<Vec<Option<Outcome>>>=(0..6).map(|_|(0..pairs*2).map(|_|None).collect()).collect();
 let results=Mutex::new(samples);let next=AtomicUsize::new(0);let completed=AtomicUsize::new(0);
 let workers=std::thread::available_parallelism().map_or(1,|n|n.get());
 let started=Instant::now();
 std::thread::scope(|scope|{
  for _ in 0..workers {scope.spawn(||{
   let mut local=Vec::new();
   loop{
    let job=next.fetch_add(1,Ordering::Relaxed);if job>=pairs*12 {break;}
    let config=job%6;let game=job/6;let pair=game/2;let flip=game%2==1;
    let mut master=Rng::new(seed.wrapping_mul(0x100_0000_01b3)^((config as u64)<<40)^pair as u64);
    let (sa,sb)=(master.next_u64(),master.next_u64());
    let outcome=if flip {play(&topologies[config],b,a,sb,sa,komi,pair==0)}
      else {play(&topologies[config],a,b,sa,sb,komi,pair==0)};
    local.push((config,game,outcome));
    let done=completed.fetch_add(1,Ordering::Relaxed)+1;
    if done%(pairs*12/10).max(1)==0 {eprintln!("completed {done}/{} games",pairs*12);}
   }
   let mut results=results.lock().unwrap();
   for(config,game,outcome)in local{results[config][game]=Some(outcome);}
  });}
 });
 let elapsed=started.elapsed().as_secs_f64();let results=results.into_inner().unwrap();let mut rows=Vec::new();
 for(config,row)in results.iter().enumerate(){
  let mut wins=0;let mut draws=0;let mut capped=0;let mut moves=0;let mut nodes=0;let mut margins=Vec::new();let mut examples=Vec::new();
  for(index,outcome)in row.iter().enumerate(){
   let o=outcome.as_ref().unwrap();let margin=o.margin as f64-komi;
   if margin==0.0{draws+=1;}else if (margin>0.0)==(index%2==0){wins+=1;}
   capped+=usize::from(!o.ended);moves+=o.moves;nodes+=o.nodes;margins.push(o.margin.to_string());
   if index<2 {examples.push(format!("{{\"blackDepth\":{},\"margin\":{},\"ended\":{},\"moves\":[{}]}}",o.black_depth,o.margin,o.ended,o.record.iter().map(|m|m.map_or("-1".into(),|p|p.to_string())).collect::<Vec<_>>().join(",")));}
  }
  eprintln!("{} {}: A {} wins, {} draws / {}, cap {}, {:.1} moves/game",CONFIGS[config].0.name(),CONFIGS[config].1,wins,draws,pairs*2,capped,moves as f64/(pairs*2)as f64);
  rows.push(format!("{{\"kind\":\"{}\",\"size\":{},\"winsA\":{},\"draws\":{},\"games\":{},\"capped\":{},\"moves\":{},\"nodes\":{},\"rawMargins\":[{}],\"examples\":[{}]}}",CONFIGS[config].0.name(),CONFIGS[config].1,wins,draws,pairs*2,capped,moves,nodes,margins.join(","),examples.join(",")));
 }
 std::fs::write(&output,format!("{{\"depthA\":{},\"depthB\":{},\"pairsPerBoard\":{},\"komi\":{},\"seed\":{},\"elapsedSeconds\":{},\"boards\":[{}]}}\n",a,b,pairs,komi,seed,elapsed,rows.join(","))).unwrap();
 eprintln!("{} games in {:.3}s -> {}",pairs*12,elapsed,output);
}
