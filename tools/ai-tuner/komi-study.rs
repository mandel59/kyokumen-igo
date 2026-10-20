// Estimate komi for the shipped AI, with paired player noise streams.
// Build/run instructions are recorded with the study results.
#[path="src/ai.rs"] mod ai;
#[path="src/board.rs"] mod board;
#[path="src/rng.rs"] mod rng;
use ai::{choose_move,Params};
use board::{Game,Kind,Scratch,Topology};
use rng::Rng;
use std::sync::{Mutex,atomic::{AtomicUsize,Ordering}};
use std::time::Instant;

const CONFIGS:[(Kind,usize);6]=[(Kind::Sphere,3),(Kind::Sphere,4),(Kind::Sphere,5),(Kind::Torus,7),(Kind::Torus,9),(Kind::Torus,11)];
struct Outcome { margin:i32, ended:bool, moves:usize, record:Vec<Option<usize>> }
fn play(topology:&Topology,a:u64,b:u64,limit_factor:usize,record:bool)->Outcome {
    let mut game=Game::new(topology,0.0);
    let mut scratch=Scratch::new(topology.len());
    let (mut black,mut white)=(Rng::new(a),Rng::new(b));
    while !game.ended&&game.history.len()<topology.len()*limit_factor {
        // The browser passes a fresh 32-bit seed to WASM for each AI turn.
        let seed=if game.turn==1 {black.next_u64()}else{white.next_u64()} as u32;
        let mut noise=Rng::new(seed as u64);
        let chosen=choose_move(&game,&Params::tuned(),&mut scratch,&mut||noise.f64());
        assert!(match chosen {Some(m)=>game.play(m,&mut scratch),None=>game.pass()});
    }
    let (black,white)=game.score();
    Outcome {margin:(black-white)as i32,ended:game.ended,moves:game.history.len(),
        record:if record{game.history}else{Vec::new()}}
}
fn main() {
    let args:Vec<_>=std::env::args().collect();
    let pairs:usize=args.get(1).map_or(10000,|s|s.parse().expect("pairs"));
    let seed:u64=args.get(2).map_or(20261021,|s|s.parse().expect("seed"));
    let output=args.get(3).map_or("target/komi-study/scores.json",String::as_str);
    let limit_factor:usize=args.get(4).map_or(20,|s|s.parse().expect("limit factor"));
    assert!(pairs>0&&limit_factor>0);
    let topologies:Vec<_>=CONFIGS.iter().map(|&(kind,size)|Topology::new(kind,size)).collect();
    let samples:Vec<Vec<Option<(Outcome,Outcome)>>>=(0..6).map(|_|(0..pairs).map(|_|None).collect()).collect();
    let results=Mutex::new(samples);
    let next=AtomicUsize::new(0);
    let workers=std::thread::available_parallelism().map_or(1,|n|n.get());
    let start=Instant::now();
    std::thread::scope(|scope|{
        for _ in 0..workers {
            scope.spawn(||{
                let mut local=Vec::new();
                loop {
                    let job=next.fetch_add(1,Ordering::Relaxed);
                    if job>=pairs*6 {break;}
                    let (config,pair)=(job%6,job/6);
                    let mut master=Rng::new(seed.wrapping_mul(0x100_0000_01b3)^((config as u64)<<40)^pair as u64);
                    let (a,b)=(master.next_u64(),master.next_u64());
                    let first=play(&topologies[config],a,b,limit_factor,pair==0);
                    let second=play(&topologies[config],b,a,limit_factor,pair==0);
                    local.push((config,pair,first,second));
                }
                let mut results=results.lock().unwrap();
                for (config,pair,a,b) in local {results[config][pair]=Some((a,b));}
            });
        }
    });
    let elapsed=start.elapsed().as_secs_f64();
    let results=results.into_inner().unwrap();
    let mut rows=Vec::new();
    for (config,samples) in results.iter().enumerate() {
        let mut capped=0;let mut moves=0usize;
        let margins:Vec<_>=samples.iter().map(|pair|{
            let (a,b)=pair.as_ref().unwrap();
            capped+=usize::from(!a.ended)+usize::from(!b.ended);moves+=a.moves+b.moves;
            format!("[{},{}]",a.margin,b.margin)
        }).collect();
        let (a,b)=samples[0].as_ref().unwrap();
        let record=|o:&Outcome|format!("{{\"margin\":{},\"ended\":{},\"moves\":[{}]}}",
            o.margin,o.ended,o.record.iter().map(|m|m.map_or("-1".into(),|m|m.to_string())).collect::<Vec<_>>().join(","));
        rows.push(format!("{{\"kind\":\"{}\",\"size\":{},\"points\":{},\"capped\":{},\"totalMoves\":{},\"pairMargins\":[{}],\"examples\":[{},{}]}}",
            CONFIGS[config].0.name(),CONFIGS[config].1,topologies[config].len(),capped,moves,margins.join(","),record(a),record(b)));
        eprintln!("{} {}: {} games, {} capped, {:.1} moves/game",CONFIGS[config].0.name(),CONFIGS[config].1,pairs*2,capped,moves as f64/(pairs*2)as f64);
    }
    let weights=Params::tuned().to_js().replace('{',"{\"").replace(':',"\":").replace(',',",\"");
    let json=format!("{{\"seed\":{},\"pairsPerBoard\":{},\"limitFactor\":{},\"workers\":{},\"elapsedSeconds\":{},\"weights\":{},\"boards\":[{}]}}\n",
        seed,pairs,limit_factor,workers,elapsed,weights,rows.join(","));
    std::fs::write(output,json).expect("write study results");
    eprintln!("{} games in {:.2} seconds -> {}",pairs*12,elapsed,output);
}
