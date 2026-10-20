// Selective alpha-beta search on the graph board. No learned model.
// This evaluator is experimental; strength must be measured against the shipped greedy AI.
use crate::board::{Game, Scratch};
use crate::rng::Rng;

#[derive(Default, Clone, Copy)]
pub struct Stats { pub nodes: usize }
#[derive(Clone, Copy)]
struct Candidate { point: Option<usize>, priority: f64 }

fn black_value(game: &Game, scratch: &mut Scratch) -> f64 {
    if game.ended {
        let (b,w)=game.score();let margin=b-w;
        return if margin>0.0 {10000.0+margin} else if margin<0.0 {-10000.0+margin} else {0.0};
    }
    let t=game.topology;let n=t.len();
    let mut influence=vec![0i32;n];let mut value=-game.komi;
    for (i,&stone) in game.board.iter().enumerate() {
        if stone==0 {continue;}
        let color=if stone==1 {1}else{-1};
        value+=color as f64;
        for &(q,f) in &t.ball[i] {influence[q]+=color*f;}
    }
    for i in 0..n {
        if game.board[i]==0 {
            let f=influence[i] as f64;
            value+=f/(f.abs()+6.0);
        }
    }
    let mut seen=vec![false;n];
    for i in 0..n {
        let stone=game.board[i];
        if stone==0||seen[i] {continue;}
        let liberties=scratch.group(&game.board,&t.neighbors,i);
        let size=scratch.stones.len() as f64;
        for &p in &scratch.stones {seen[p]=true;}
        let color=if stone==1 {1.0}else{-1.0};
        value-=color*match liberties {0|1=>1.7*size+2.0,2=>0.2*size,_=>0.0};
    }
    value
}
fn candidates(game:&Game,scratch:&mut Scratch,width:usize,random:Option<&mut Rng>)->Vec<Candidate> {
    let t=game.topology;let n=t.len();
    let mut urgent=vec![0.0;n];let mut seen=vec![false;n];
    for i in 0..n {
        if game.board[i]==0||seen[i] {continue;}
        let liberties=scratch.group(&game.board,&t.neighbors,i);
        for &p in &scratch.stones {seen[p]=true;}
        if liberties==1 {
            let size=scratch.stones.len() as f64;
            let last=scratch.stones.iter().flat_map(|&p|t.neighbors[p].iter()).find(|&&q|game.board[q]==0).copied().unwrap();
            urgent[last]+=if game.board[i]==game.turn {(size*2.0).min(20.0)}else{(size*3.0).min(24.0)};
        }
    }
    let mut random=random;
    let mut choices=Vec::new();
    for i in 0..n {
        if game.board[i]!=0 {continue;}
        let neighbors=&t.neighbors[i];
        let friends=neighbors.iter().filter(|&&p|game.board[p]==game.turn).count();
        let enemies=neighbors.iter().filter(|&&p|game.board[p]==3-game.turn).count();
        if friends==neighbors.len()&&urgent[i]==0.0 {continue;}
        let Some(m)=game.analyze(i,scratch)else{continue};
        let mut value=m.captured as f64*12.0+urgent[i]+m.liberties.min(6) as f64*0.8;
        value+=enemies as f64*0.3-friends as f64*0.1;
        if m.liberties==1&&m.captured==0 {value-=16.0;}
        if let Some(rng)=random.as_deref_mut(){value+=rng.f64()*0.05;}
        choices.push(Candidate{point:Some(i),priority:value});
    }
    choices.sort_by(|a,b|b.priority.total_cmp(&a.priority));
    choices.truncate(width);
    // Passing is a real move, including accepting a winning two-pass result.
    choices.push(Candidate{point:None,priority:f64::NEG_INFINITY});
    choices
}
fn negamax(game:&Game,scratch:&mut Scratch,depth:u32,mut alpha:f64,beta:f64,stats:&mut Stats)->f64 {
    stats.nodes+=1;
    if depth==0||game.ended {
        return black_value(game,scratch)*if game.turn==1 {1.0}else{-1.0};
    }
    let mut best=f64::NEG_INFINITY;
    for candidate in candidates(game,scratch,6,None) {
        let mut child=game.clone();
        assert!(match candidate.point {Some(p)=>child.play(p,scratch),None=>child.pass()});
        let value=-negamax(&child,scratch,depth-1,-beta,-alpha,stats);
        best=best.max(value);alpha=alpha.max(value);
        if alpha>=beta {break;}
    }
    best
}

pub fn choose_search(game:&Game,depth:u32,seed:u32)->(Option<usize>,Stats) {
    let mut stats=Stats::default();
    if game.ended {return (None,stats);}
    let mut scratch=Scratch::new(game.topology.len());
    let mut random=Rng::new(seed as u64);
    let choices=candidates(game,&mut scratch,12,Some(&mut random));
    let mut best=None;let mut best_value=f64::NEG_INFINITY;
    for candidate in choices {
        let mut child=game.clone();
        assert!(match candidate.point {Some(p)=>child.play(p,&mut scratch),None=>child.pass()});
        let value=-negamax(&child,&mut scratch,depth.clamp(1,4)-1,f64::NEG_INFINITY,-best_value,&mut stats);
        if value>best_value+1e-9 {best_value=value;best=candidate.point;}
    }
    (best,stats)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::board::{Kind,Topology};
    fn position<'a>(topology:&'a Topology,komi:f64,moves:&[i32])->Game<'a> {
        let mut game=Game::new(topology,komi);
        let mut scratch=Scratch::new(topology.len());
        for &m in moves {
            assert!(if m<0 {game.pass()} else {game.play(m as usize,&mut scratch)});
        }
        game
    }
    #[test]
    fn draws_are_zero_and_terminal_wins_have_the_correct_sign() {
        let t=Topology::new(Kind::Torus,7);
        let mut scratch=Scratch::new(t.len());
        assert_eq!(black_value(&position(&t,0.0,&[-1,-1]),&mut scratch),0.0);
        assert!(black_value(&position(&t,6.5,&[-1,-1]),&mut scratch)< -10000.0);
        assert!(black_value(&position(&t,-6.5,&[-1,-1]),&mut scratch)>10000.0);
    }
    #[test]
    fn accepts_a_winning_pass_and_rejects_a_losing_pass() {
        let t=Topology::new(Kind::Torus,7);
        assert_eq!(choose_search(&position(&t,6.5,&[-1]),4,1).0,None);
        assert!(choose_search(&position(&t,-6.5,&[-1]),4,1).0.is_some());
    }
    #[test]
    fn captures_atari_and_preserves_the_root_position() {
        let t=Topology::new(Kind::Torus,7);
        let game=position(&t,6.5,&[17,24,18,25,19,26,31,0,32,1,33,2,23,3]);
        let before=game.clone();
        let (point,stats)=choose_search(&game,4,19);
        let mut scratch=Scratch::new(t.len());
        assert!(game.analyze(point.unwrap(),&mut scratch).unwrap().captured>=3);
        assert_eq!(game.board,before.board);
        assert_eq!(game.turn,before.turn);
        assert_eq!(game.history,before.history);
        assert_eq!(game.score(),before.score());
        assert!(stats.nodes>1&&stats.nodes<=5000);
    }
    #[test]
    fn respects_superko_and_is_reproducible() {
        let t=Topology::new(Kind::Torus,7);
        let game=position(&t,0.5,&[17,24,31,18,23,32,0,26,25]);
        let mut scratch=Scratch::new(t.len());
        assert!(game.analyze(24,&mut scratch).is_none());
        let point=choose_search(&game,4,23).0;
        assert_ne!(point,Some(24));
        assert_eq!(point,choose_search(&game,4,23).0);
        if let Some(point)=point {assert!(game.analyze(point,&mut scratch).is_some());}
    }
    #[test]
    fn never_moves_after_the_game_ends() {
        let t=Topology::new(Kind::Sphere,3);
        assert_eq!(choose_search(&position(&t,0.0,&[-1,-1]),4,1).0,None);
    }
}
