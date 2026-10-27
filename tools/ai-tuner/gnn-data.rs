//! Bootstrap data from the actual v2 teacher. Capped games never become training labels.
#[path="src/board.rs"] mod board;
#[path="src/ai.rs"] mod ai;
#[path="src/rng.rs"] mod rng;
#[path="src/search.rs"] mod search;
#[path="src/endgame.rs"] mod endgame;
#[path="src/gnn.rs"] mod gnn;
use board::{Game,Kind,Scratch,Topology};
use std::io::{Write,BufWriter};

fn main() {
    let args:Vec<_>=std::env::args().collect();
    assert!(args.len()>=3,"usage: gnn-data OUT.jsonl GAMES_PER_BOARD [SEED]");
    let games:usize=args[2].parse().unwrap(); assert!(games>0);
    let seed:u64=args.get(3).map_or(20261021,|s|s.parse().unwrap());
    let mut rng=rng::Rng::new(seed);
    let mut out=BufWriter::new(std::fs::File::create(&args[1]).unwrap());
    let mut count=0;let mut capped=0;
    for (config,(kind,size)) in [(Kind::Sphere,3),(Kind::Sphere,4),(Kind::Sphere,5),(Kind::Torus,7),(Kind::Torus,9),(Kind::Torus,11),(Kind::Plane,7),(Kind::Plane,9),(Kind::Plane,11)].into_iter().enumerate() {
        let t=Topology::new(kind,size);
        for k in 0..games {
            let komi=[0.,3.5,6.5,9.5][k%4];
            let mut game=Game::new(&t,komi);let mut scratch=Scratch::new(t.len());let mut past=vec![];let mut samples=vec![];
            while !game.ended&&game.history.len()<t.len()*20 {
                let features=gnn::encode(&game,&past,kind);
                let teacher=search::choose_search(&game,4,rng.next_u64() as u32).0;
                // Slightly diversify openings while retaining the teacher's actual target.
                let played=if game.history.len()<6&&rng.f64()<0.25 {
                    let legal:Vec<_>=features.legal[..t.len()].iter().enumerate().filter(|(_,v)|**v).map(|(i,_)|i).collect();
                    if legal.is_empty(){teacher}else{Some(legal[rng.next_u64() as usize%legal.len()])}
                }else{teacher};
                samples.push((features,teacher,game.turn));
                gnn::remember(&mut past,&game.board);
                assert!(match played {Some(p)=>game.play(p,&mut scratch),None=>game.pass()});
            }
            if !game.ended {capped+=1;continue;}
            let (b,w)=game.score();let owners=gnn::ownership(&game);
            for (f,teacher,turn) in samples {
                let value=if b==w{1}else if (b>w)==(turn==1){0}else{2};
                let own:Vec<_>=owners.iter().map(|&s|if s==0{1}else if s==turn{0}else{2}).collect();
                let margin=(b-w)*if turn==1{1.}else{-1.};
                writeln!(out,"{{\"schemaVersion\":1,\"gameId\":\"{seed}-{config}-{k}\",\"kind\":\"{}\",\"size\":{},\"x\":{:?},\"global\":{:?},\"legal\":{:?},\"action\":{},\"wdl\":{},\"score\":{},\"ownership\":{:?}}}",
                    kind.name(),size,&f.x[..t.len()*gnn::CHANNELS],f.global,f.legal,teacher.unwrap_or(gnn::PASS),value,margin,own).unwrap();
                count+=1;
            }
            eprintln!("{} {} game {}/{}: {} moves",kind.name(),size,k+1,games,game.history.len());
        }
    }
    out.flush().unwrap();
    eprintln!("wrote {count} positions; excluded {capped} capped games; seed {seed}");
}
