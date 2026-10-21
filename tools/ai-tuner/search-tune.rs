// Deterministic CEM tuning and paired matches for the fixed 4-ply search.
// Standalone rustc build; no additional crate or network dependency.
#[path="src/ai.rs"] mod ai;
#[path="src/board.rs"] mod board;
#[path="src/rng.rs"] mod rng;
#[path="src/search.rs"] mod search;
#[path="src/endgame.rs"] mod endgame;
use board::{Game,Kind,Topology,Scratch};
use rng::Rng;
use search::{Params,N,BOUNDS};
use std::sync::{Mutex,atomic::{AtomicUsize,Ordering}};
use std::time::Instant;
const CONFIGS:[(Kind,usize);6]=[(Kind::Sphere,3),(Kind::Sphere,4),(Kind::Sphere,5),(Kind::Torus,7),(Kind::Torus,9),(Kind::Torus,11)];
#[derive(Clone,Copy)]
struct Player { params:Params, greedy:bool, profile:bool }
impl Player {
 fn search(params:Params)->Self {Self {params,greedy:false,profile:false}}
 fn json(&self)->String {format!("{{\"depth\":{},\"values\":{:?},\"profile\":{}}}",if self.greedy {0}else{4},self.params.values,self.profile)}
}
struct Outcome {raw:i32,ended:bool,moves:usize,nodes:usize,komi:f64,record:Vec<Option<usize>>}
struct Match {a:Player,b:Player,pairs:usize,seed:u64,komi:Option<f64>,offset:usize}
struct Results {boards:Vec<Vec<Outcome>>}
impl Results {
 fn score(&self)->f64 {
  self.boards.iter().flatten().enumerate().map(|(i,o)|score(o,i%2==0)).sum::<f64>()/self.boards.iter().map(Vec::len).sum::<usize>() as f64
 }
 fn capped(&self)->usize {self.boards.iter().flatten().filter(|o|!o.ended).count()}
 fn json(&self,m:&Match,elapsed:f64)->String {
  let mut boards=Vec::new();
  for (k,row) in self.boards.iter().enumerate() {
   let mut wins=0;let mut draws=0;let mut capped=0;let mut moves=0;let mut nodes=0;
   for (i,o) in row.iter().enumerate() {
    if o.raw as f64==o.komi {draws+=1;} else if score(o,i%2==0)==1.0 {wins+=1;}
    capped+=usize::from(!o.ended);moves+=o.moves;nodes+=o.nodes;
   }
   let examples:Vec<_>=row.iter().take(2).enumerate().map(|(i,o)|format!("{{\"blackDepth\":{},\"margin\":{},\"komi\":{},\"ended\":{},\"moves\":[{}]}}",if (if i%2==0 {m.a}else{m.b}).greedy {0}else{4},o.raw,o.komi,o.ended,o.record.iter().map(|p|p.map_or("-1".into(),|v|v.to_string())).collect::<Vec<_>>().join(","))).collect();
   boards.push(format!("{{\"kind\":\"{}\",\"size\":{},\"games\":{},\"winsA\":{},\"draws\":{},\"capped\":{},\"moves\":{},\"nodes\":{},\"rawMargins\":{:?},\"komis\":{:?},\"examples\":[{}]}}",CONFIGS[k].0.name(),CONFIGS[k].1,row.len(),wins,draws,capped,moves,nodes,row.iter().map(|o|o.raw).collect::<Vec<_>>(),row.iter().map(|o|o.komi).collect::<Vec<_>>(),examples.join(",")));
  }
  format!("{{\"depthA\":{},\"depthB\":{},\"playerA\":{},\"playerB\":{},\"pairsPerBoard\":{},\"pairOffset\":{},\"komi\":{},\"seed\":{},\"elapsedSeconds\":{},\"boards\":[{}]}}",if m.a.greedy {0}else{4},if m.b.greedy {0}else{4},m.a.json(),m.b.json(),m.pairs,m.offset,m.komi.map_or("null".into(),|x|x.to_string()),m.seed,elapsed,boards.join(","))
 }
}
fn score(o:&Outcome,a_black:bool)->f64 {
 if o.raw as f64==o.komi {0.5} else if (o.raw as f64>o.komi)==a_black {1.0}else{0.0}
}
fn play(t:&Topology,black:Player,white:Player,sa:u64,sb:u64,komi:f64,record:bool)->Outcome {
 let mut game=Game::new(t,komi);let mut scratch=Scratch::new(t.len());
 let (mut ra,mut rb)=(Rng::new(sa),Rng::new(sb));let mut nodes=0;
 while !game.ended&&game.history.len()<t.len()*20 {
  let (player,seed)=if game.turn==1 {(black,ra.next_u64()as u32)}else{(white,rb.next_u64()as u32)};
  let point=if player.greedy {let mut r=Rng::new(seed as u64);ai::choose_move(&game,&ai::Params::tuned(),&mut scratch,&mut||r.f64())}
   else {let (point,stats)=search::choose_with_params(&game,4,seed,&if player.profile {Params::for_points(t.len())}else{player.params});nodes+=stats.nodes;point};
  assert!(match point {Some(p)=>game.play(p,&mut scratch),None=>game.pass()});
 }
 let (b,w)=game.score();
 Outcome{raw:(b-w+komi)as i32,ended:game.ended,moves:game.history.len(),nodes,komi,record:if record {game.history}else{Vec::new()}}
}
fn batch(matches:&[Match],topologies:&[Topology])->Vec<Results> {
 let mut jobs=Vec::new();
 for (i,m) in matches.iter().enumerate() {for k in 0..6 {for g in 0..m.pairs*2 {jobs.push((i,k,g));}}}
 let slots:Vec<_>=matches.iter().map(|m|(0..6).map(|_|(0..m.pairs*2).map(|_|None).collect::<Vec<Option<Outcome>>>()).collect::<Vec<_>>()).collect();
 let results=Mutex::new(slots);let next=AtomicUsize::new(0);let done=AtomicUsize::new(0);
 let workers=std::env::var("SEARCH_THREADS").ok().and_then(|v|v.parse().ok()).unwrap_or_else(||std::thread::available_parallelism().map_or(1,|n|n.get()));
 std::thread::scope(|scope|{for _ in 0..workers {scope.spawn(||{
  let mut local=Vec::new();
  loop {
   let index=next.fetch_add(1,Ordering::Relaxed);if index>=jobs.len(){break;}
   let (i,k,g)=jobs[index];let m=&matches[i];let pair=g/2+m.offset;
   let mut master=Rng::new(m.seed.wrapping_mul(0x100_0000_01b3)^((k as u64)<<40)^pair as u64);
   let (sa,sb)=(master.next_u64(),master.next_u64());
   let komi=m.komi.unwrap_or([1.0,3.5,6.5][(pair+k)%3]);
   let o=if g%2==0 {play(&topologies[k],m.a,m.b,sa,sb,komi,pair==m.offset)}else{play(&topologies[k],m.b,m.a,sb,sa,komi,pair==m.offset)};
   local.push((i,k,g,o));
   let finished=done.fetch_add(1,Ordering::Relaxed)+1;
   if jobs.len()>=1000&&finished%(jobs.len()/4).max(1)==0 {eprintln!("  completed {finished}/{} games",jobs.len());}
  }
  let mut results=results.lock().unwrap();for (i,k,g,o) in local {results[i][k][g]=Some(o);}
 });}});
 results.into_inner().unwrap().into_iter().map(|boards|Results {boards:boards.into_iter().map(|row|row.into_iter().map(Option::unwrap).collect()).collect()}).collect()
}
fn named(s:&str)->Player {
 if s=="legacy" {return Player::search(Params::legacy());}
 if s=="deployed" {return Player {params:Params::tuned(),greedy:false,profile:true};}
 if s=="tuned" {return Player::search(Params::tuned());}
 if s=="greedy" {return Player {params:Params::legacy(),greedy:true,profile:false};}
 let text=std::fs::read_to_string(s).expect("parameter file");
 let v:Vec<f64>=text.split_whitespace().map(|x|x.parse().unwrap()).collect();
 let params=Params::from_vector(v.try_into().expect("13 parameters"));Player::search(params)
}
fn tune(out:&str,generations:usize,population:usize,seed:u64) {
 assert!(generations>0&&population>=4);std::fs::create_dir_all(out).unwrap();
 let topologies:Vec<_>=CONFIGS.iter().map(|&(k,s)|Topology::new(k,s)).collect();
 let baseline=Player::search(Params::legacy());let mut champion=baseline;
 let mut mean=baseline.params.values;let mut spread:[f64;N]=std::array::from_fn(|k|(BOUNDS[k].2-BOUNDS[k].1)/6.0);
 let mut rng=Rng::new(seed);let started=Instant::now();let mut logs=Vec::new();
 for generation in 0..generations {
  let begin=Instant::now();
  let candidates:Vec<_>=(0..population).map(|i|Player::search(if i==0 {champion.params}else if i==1 {Params::from_vector(mean)}else{Params::from_vector(std::array::from_fn(|k|mean[k]+spread[k]*rng.normal()))})).collect();
  let training_seed=seed.wrapping_add((generation as u64+1)*1009);
  let matches:Vec<_>=candidates.iter().flat_map(|&a|[baseline,champion].into_iter().enumerate().map(move |(i,b)|Match {a,b,pairs:3,seed:training_seed+i as u64*17,komi:None,offset:0})).collect();
  let results=batch(&matches,&topologies);
  let fitness:Vec<_>=(0..population).map(|i|if results[2*i].capped()+results[2*i+1].capped()>0 {0.0}else{(results[2*i].score()+results[2*i+1].score())/2.0}).collect();
  let mut order:Vec<_>=(0..population).collect();order.sort_by(|&i,&j|fitness[j].total_cmp(&fitness[i]).then(i.cmp(&j)));
  let elite=&order[..3];
  for k in 0..N {
   let center=elite.iter().map(|&i|candidates[i].params.values[k]).sum::<f64>()/3.0;
   let sd=(elite.iter().map(|&i|(candidates[i].params.values[k]-center).powi(2)).sum::<f64>()/3.0).sqrt();
   mean[k]=center;spread[k]=(0.6*spread[k]+0.4*sd).max((BOUNDS[k].2-BOUNDS[k].1)/60.0);
  }
  let proposal=candidates[order[0]];
  let validation_seed=seed.wrapping_add(100_000+generation as u64*1013);
  let checks=[Match{a:proposal,b:champion,pairs:10,seed:validation_seed,komi:None,offset:0},Match{a:proposal,b:baseline,pairs:10,seed:validation_seed+17,komi:None,offset:0}];
  let check_results=batch(&checks,&topologies);
  let promoted=check_results[0].score()>0.53&&check_results[1].score()>0.52&&check_results.iter().all(|r|r.capped()==0);
  if promoted {champion=proposal;}
  let training:Vec<_>=matches.iter().zip(&results).map(|(m,r)|r.json(m,0.0)).collect();
  let validation:Vec<_>=checks.iter().zip(&check_results).map(|(m,r)|r.json(m,0.0)).collect();
  logs.push(format!("{{\"generation\":{},\"fitness\":{:?},\"bestIndex\":{},\"promoted\":{},\"mean\":{:?},\"spread\":{:?},\"champion\":{},\"elapsedSeconds\":{},\"training\":[{}],\"validation\":[{}]}}",generation,fitness,order[0],promoted,mean,spread,champion.json(),begin.elapsed().as_secs_f64(),training.join(","),validation.join(",")));
  eprintln!("gen {generation}: fitness {:.3}, vs champion {:.3}, vs baseline {:.3}, promoted {promoted}, {:.1}s",fitness[order[0]],check_results[0].score(),check_results[1].score(),begin.elapsed().as_secs_f64());
  eprintln!("  champion {:?}",champion.params.values);
  std::fs::write(format!("{out}/params.txt"),champion.params.values.iter().map(|x|x.to_string()).collect::<Vec<_>>().join(" ")+"\n").unwrap();
  std::fs::write(format!("{out}/tune.json"),format!("{{\"seed\":{},\"generationsRequested\":{},\"population\":{},\"trainingPairsPerBoardPerOpponent\":3,\"validationPairsPerBoardPerOpponent\":10,\"parameters\":{:?},\"elapsedSeconds\":{},\"generations\":[{}]}}\n",seed,generations,population,BOUNDS.iter().map(|x|x.0).collect::<Vec<_>>(),started.elapsed().as_secs_f64(),logs.join(","))).unwrap();
 }
}
fn tune_robust(out:&str,generations:usize,population:usize,seed:u64) {
 assert!(generations>0&&population>=4);std::fs::create_dir_all(out).unwrap();
 let topologies:Vec<_>=CONFIGS.iter().map(|&(k,s)|Topology::new(k,s)).collect();
 let baseline=Player::search(Params::legacy());let mut champion=baseline;
 let mut mean=baseline.params.values;let mut spread:[f64;N]=std::array::from_fn(|k|(BOUNDS[k].2-BOUNDS[k].1)/6.0);
 for k in 5..N {spread[k]=0.0;}
 let static_seed=Params {values:[1.0,6.988,1.307,2.382,0.413,2.0,20.0,3.0,24.0,0.8,0.3,-0.1,16.0]};
 let greedy=Player {params:Params::legacy(),greedy:true,profile:false};
 let mut rng=Rng::new(seed);let started=Instant::now();let mut logs=Vec::new();
 for generation in 0..generations {
  let begin=Instant::now();
  let candidates:Vec<_>=(0..population).map(|i|Player::search(if i==0 {champion.params}else if i==1 {if generation==0 {static_seed}else{Params::from_vector(mean)}}else{Params::from_vector(std::array::from_fn(|k|mean[k]+spread[k]*rng.normal()))})).collect();
  let training_seed=seed.wrapping_add((generation as u64+1)*1009);
  let matches:Vec<_>=candidates.iter().flat_map(|&a|[baseline,champion,greedy].into_iter().enumerate().map(move |(i,b)|Match {a,b,pairs:3,seed:training_seed+i as u64*17,komi:None,offset:0})).collect();
  let results=batch(&matches,&topologies);
  let fitness:Vec<_>=(0..population).map(|i|if results[3*i..3*i+3].iter().any(|r|r.capped()>0) {0.0}else{results[3*i..3*i+3].iter().map(Results::score).sum::<f64>()/3.0}).collect();
  let mut order:Vec<_>=(0..population).collect();order.sort_by(|&i,&j|fitness[j].total_cmp(&fitness[i]).then(i.cmp(&j)));
  let elite=&order[..3];
  for k in 0..5 {
   let center=elite.iter().map(|&i|candidates[i].params.values[k]).sum::<f64>()/3.0;
   let sd=(elite.iter().map(|&i|(candidates[i].params.values[k]-center).powi(2)).sum::<f64>()/3.0).sqrt();
   mean[k]=center;spread[k]=(0.6*spread[k]+0.4*sd).max((BOUNDS[k].2-BOUNDS[k].1)/60.0);
  }
  let proposal=candidates[order[0]];
  let validation_seed=seed.wrapping_add(100_000+generation as u64*1013);
  let checks=[Match{a:proposal,b:champion,pairs:10,seed:validation_seed,komi:None,offset:0},Match{a:proposal,b:baseline,pairs:10,seed:validation_seed+17,komi:None,offset:0},Match{a:proposal,b:greedy,pairs:10,seed:validation_seed+34,komi:None,offset:0},Match{a:baseline,b:greedy,pairs:10,seed:validation_seed+34,komi:None,offset:0}];
  let check_results=batch(&checks,&topologies);
  let promoted=check_results[0].score()>0.53&&check_results[1].score()>0.52&&check_results[2].score()>=check_results[3].score()-0.01&&check_results.iter().all(|r|r.capped()==0);
  if promoted {champion=proposal;}
  let training:Vec<_>=matches.iter().zip(&results).map(|(m,r)|r.json(m,0.0)).collect();
  let validation:Vec<_>=checks.iter().zip(&check_results).map(|(m,r)|r.json(m,0.0)).collect();
  logs.push(format!("{{\"generation\":{},\"fitness\":{:?},\"bestIndex\":{},\"promoted\":{},\"mean\":{:?},\"spread\":{:?},\"champion\":{},\"elapsedSeconds\":{},\"training\":[{}],\"validation\":[{}]}}",generation,fitness,order[0],promoted,mean,spread,champion.json(),begin.elapsed().as_secs_f64(),training.join(","),validation.join(",")));
  eprintln!("gen {generation}: fitness {:.3}, vs champion {:.3}, vs baseline {:.3}, promoted {promoted}, {:.1}s",fitness[order[0]],check_results[0].score(),check_results[1].score(),begin.elapsed().as_secs_f64());
  eprintln!("  greedy {:.3}, control {:.3}",check_results[2].score(),check_results[3].score());
  eprintln!("  champion {:?}",champion.params.values);
  std::fs::write(format!("{out}/params.txt"),champion.params.values.iter().map(|x|x.to_string()).collect::<Vec<_>>().join(" ")+"\n").unwrap();
  std::fs::write(format!("{out}/tune.json"),format!("{{\"seed\":{},\"generationsRequested\":{},\"population\":{},\"trainingPairsPerBoardPerOpponent\":3,\"validationPairsPerBoardPerOpponent\":10,\"parameters\":{:?},\"elapsedSeconds\":{},\"generations\":[{}]}}\n",seed,generations,population,BOUNDS.iter().map(|x|x.0).collect::<Vec<_>>(),started.elapsed().as_secs_f64(),logs.join(","))).unwrap();
 }
}
fn main() {
 let args:Vec<_>=std::env::args().collect();
 match args.get(1).map(String::as_str) {
  Some("robust")=>tune_robust(&args[2],args[3].parse().unwrap(),args[4].parse().unwrap(),args[5].parse().unwrap()),
  Some("tune")=>tune(&args[2],args[3].parse().unwrap(),args[4].parse().unwrap(),args[5].parse().unwrap()),
  Some("match")=>{
   let a=named(&args[2]);let b=named(&args[3]);let pairs=args[4].parse().unwrap();let komi=args[5].parse().unwrap();let seed=args[6].parse().unwrap();
   let m=Match {a,b,pairs,seed,komi:Some(komi),offset:0};
   let topologies:Vec<_>=CONFIGS.iter().map(|&(k,s)|Topology::new(k,s)).collect();let start=Instant::now();
   let result=batch(std::slice::from_ref(&m),&topologies).pop().unwrap();let elapsed=start.elapsed().as_secs_f64();
   std::fs::write(&args[7],result.json(&m,elapsed)+"\n").unwrap();
   eprintln!("score {:.4}, capped {}, {} games, {:.1}s",result.score(),result.capped(),pairs*12,elapsed);
   for (k,row) in result.boards.iter().enumerate(){eprintln!("{} {}: {:.3}",CONFIGS[k].0.name(),CONFIGS[k].1,row.iter().enumerate().map(|(i,o)|score(o,i%2==0)).sum::<f64>()/row.len()as f64);}
  },
  _=>panic!("usage: search-tune tune|robust OUTDIR GENERATIONS POPULATION SEED | match PARAMS_A PARAMS_B PAIRS_PER_BOARD KOMI SEED OUT.json (params: legacy/tuned/deployed/greedy or whitespace-vector file)"),
 }
}
