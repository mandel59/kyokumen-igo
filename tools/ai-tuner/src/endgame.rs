//! Shared immediate winning passes, Benson life certificates and lost-root bounds.
//! Used by v2 alpha-beta, v3 PUCT and v3 invasion filtering.
//! Benson reference: KataGo cpp/game/board.cpp, calculateAreaForPla.
//! Copyright 2025 David J Wu and/or other authors; MIT notice retained in
//! dist/licenses/KataGo-LICENSE.txt. See THIRD_PARTY.md for the adaptation scope.
use crate::board::Game;

pub(crate) struct PassAlive { pub(crate) stones: Vec<bool>, pub(crate) vital: Vec<bool> }

/// Accept a win now instead of searching for a possibly larger winning margin.
/// A second pass ends the game without changing its board or komi.
pub fn wins_by_passing(game: &Game) -> bool {
    if game.ended||game.passes!=1 {return false;}
    let (black,white)=game.score();
    if game.turn==1 {black>white}else{white>black}
}

/// Accept a second pass, including a draw or loss, only when every point has a
/// Benson certificate: all stones live unconditionally and all empty regions
/// are vital regions of those living chains. Unsettled stones, dame and large
/// uncertified enclosures keep the position searchable. This is deliberately
/// independent of the neural win probability and the stone-count loss bound.
pub fn settled_by_passing(game: &Game) -> bool {
    if game.ended || game.passes != 1 { return false; }
    let black = pass_alive(game, 1);
    let white = pass_alive(game, 2);
    game.board.iter().enumerate().all(|(p, &stone)| match stone {
        1 => black.stones[p],
        2 => white.stones[p],
        _ => black.vital[p] || white.vital[p],
    })
}

/// Empty vital regions and stones of pass-alive chains, using the conservative
/// empty-region form of Benson's fixed point. Large enclosures are NOT marked
/// unless every point touches the same surviving chain (no room for an eye).
pub(crate) fn pass_alive(game: &Game, enemy: i8) -> PassAlive {
    let n=game.board.len();
    let mut chain_at=vec![usize::MAX;n];let mut chains=0;
    for start in 0..n {
        if game.board[start]!=enemy||chain_at[start]!=usize::MAX {continue;}
        let mut queue=vec![start];chain_at[start]=chains;let mut k=0;
        while k<queue.len() {
            for &q in &game.topology.neighbors[queue[k]] {
                if game.board[q]==enemy&&chain_at[q]==usize::MAX {chain_at[q]=chains;queue.push(q);}
            }
            k+=1;
        }
        chains+=1;
    }
    struct Region {points:Vec<usize>,boundary:Vec<usize>,vital:Vec<usize>}
    let mut seen=vec![false;n];let mut regions=vec![];
    for start in 0..n {
        if game.board[start]!=0||seen[start] {continue;}
        let mut points=vec![start];seen[start]=true;let mut boundary=vec![];let mut mixed=false;let mut k=0;
        while k<points.len() {
            for &q in &game.topology.neighbors[points[k]] {
                if game.board[q]==0 {
                    if !seen[q] {seen[q]=true;points.push(q);}
                } else if game.board[q]!=enemy {mixed=true;}
                else if !boundary.contains(&chain_at[q]) {boundary.push(chain_at[q]);}
            }
            k+=1;
        }
        if mixed||boundary.is_empty() {continue;}
        let vital=boundary.iter().copied().filter(|&c|points.iter().all(|&p|
            game.topology.neighbors[p].iter().any(|&q|chain_at[q]==c))).collect();
        regions.push(Region{points,boundary,vital});
    }
    let mut alive=vec![true;chains];let mut active=vec![true;regions.len()];
    loop {
        let mut counts=vec![0;chains];
        for (r,region) in regions.iter().enumerate() {
            if active[r] {for &c in &region.vital {if alive[c] {counts[c]+=1;}}}
        }
        let mut changed=false;
        for c in 0..chains {if alive[c]&&counts[c]<2 {alive[c]=false;changed=true;}}
        for (r,region) in regions.iter().enumerate() {
            if active[r]&&region.boundary.iter().any(|&c|!alive[c]) {active[r]=false;changed=true;}
        }
        if !changed {break;}
    }
    let mut result=vec![false;n];
    for (r,region) in regions.iter().enumerate() {
        if active[r]&&region.vital.iter().any(|&c|alive[c]) {for &p in &region.points {result[p]=true;}}
    }
    let stones=(0..n).map(|p|chain_at[p]!=usize::MAX&&alive[chain_at[p]]).collect();
    PassAlive {stones,vital:result}
}

/// Even giving EVERY other vertex to us cannot beat these enemy stones.
/// Only Benson-certified stones count: raw area, captures and NN estimates do not.
/// A positive margin is a sufficient loss certificate under life-preserving play,
/// not a claim that every losing position can be recognized.
/// This also guarantees a loss if both players pass immediately: the opponent's
/// current area is at least E (their certified living stones), and ours is at
/// most N-E. Thus the same strict bound already implies a loss in Game::score(),
/// including komi. Passes change neither the board nor komi, so no extra scoring
/// check is needed before forcing a pass.
pub fn proven_loss_margin(game: &Game) -> f64 {
    let enemy=pass_alive(game,3-game.turn).stones.into_iter().filter(|&v|v).count() as f64;
    let komi=if game.turn==1 {game.komi}else{-game.komi};
    (2.*enemy-game.board.len() as f64+komi).max(0.)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::board::{Kind,Topology,Scratch};
    fn position<'a>(t: &'a Topology, moves: &[i32]) -> Game<'a> {
        let mut g=Game::new(t,6.5);let mut scratch=Scratch::new(t.len());
        for &p in moves {assert!(if p<0 {g.pass()}else{g.play(p as usize,&mut scratch)});}
        g
    }
    #[test]
    fn certified_loss_bound_respects_both_colours_komi_and_draws_on_all_boards() {
        for (kind,size) in [(Kind::Sphere,3),(Kind::Sphere,4),(Kind::Sphere,5),(Kind::Torus,7),(Kind::Torus,9),(Kind::Torus,11)] {
            let t=Topology::new(kind,size);let n=t.len();
            let other=(1..n).find(|p|!t.neighbors[0].contains(p)).unwrap();
            let moves:Vec<i32>=(0..n).filter(|&p|p!=0&&p!=other).flat_map(|p|[-1,p as i32]).collect();
            let mut g=position(&t,&moves);
            assert_eq!(pass_alive(&g,2).stones.iter().filter(|&&v|v).count(),n-2);
            for colour in [1,2] {
                if colour==2 {for v in &mut g.board {if *v!=0 {*v=3-*v;}} g.turn=2;}
                let sign=if colour==1 {1.}else{-1.};
                g.komi=sign*(4.-n as f64);
                assert_eq!(proven_loss_margin(&g),0.,"a possible draw is not a loss");
                g.komi+=sign*0.5;assert_eq!(proven_loss_margin(&g),0.5);
                g.komi-=sign;assert_eq!(proven_loss_margin(&g),0.);
            }
        }
        let t=Topology::new(Kind::Torus,7);
        let g=position(&t,&[8,9,10,11,12,15,17,19,22,23,24,25,26].iter().flat_map(|&p|[-1,p]).collect::<Vec<_>>());
        assert_eq!(pass_alive(&g,2).stones.iter().filter(|&&v|v).count(),13);
        assert_eq!(proven_loss_margin(&g),0.,"there is still enough unsettled space to win");
    }
    #[test]
    fn settled_pass_requires_certificates_for_every_point_and_a_preceding_pass() {
        for (kind,size) in [(Kind::Sphere,3),(Kind::Sphere,4),(Kind::Sphere,5),
            (Kind::Torus,7),(Kind::Torus,9),(Kind::Torus,11),
            (Kind::Plane,7),(Kind::Plane,9),(Kind::Plane,11)] {
            let t=Topology::new(kind,size);let n=t.len();
            let other=(1..n).find(|p|!t.neighbors[0].contains(p)).unwrap();
            let moves:Vec<i32>=(0..n).filter(|&p|p!=0&&p!=other).flat_map(|p|[-1,p as i32]).collect();
            let mut g=position(&t,&moves);
            assert!(!settled_by_passing(&g),"a first pass is not forced");
            for colour in [1,2] {
                g.turn=colour;g.passes=1;
                assert!(settled_by_passing(&g));
                g.ended=true;assert!(!settled_by_passing(&g));g.ended=false;
            }
        }
        let t=Topology::new(Kind::Plane,11);
        // Two single eyes prove the surrounding stones alive, but not the
        // large enclosure: its centre is not adjacent to the living chain.
        let holes=[0,120,48,49,50,59,60,61,70,71,72];
        let moves:Vec<i32>=(0..121).filter(|p|!holes.contains(p)).flat_map(|p|[-1,p]).collect();
        let mut g=position(&t,&moves);g.passes=1;
        assert_eq!(pass_alive(&g,2).stones.iter().filter(|&&v|v).count(),110);
        assert!(!settled_by_passing(&g),"retain uncertified space even if every stone lives");
        let mut empty=Game::new(&t,6.5);empty.pass();
        assert!(!settled_by_passing(&empty),"empty/neutral points are not settled territory");
        let mut sparse=position(&t,&[60,61]);sparse.pass();
        assert!(!settled_by_passing(&sparse),"unsettled stones must remain searchable");
    }

}
