//! Conservative root guards against isolated invasions and certified lost games.
//! A capture proof must cover *all* legal defender replies (including pass).
//! Exhausting the depth/node budget means unknown, never "dead".
use crate::board::{Game, Scratch};

const ROOT_BUDGET: usize = 1024;
const MOVE_BUDGET: usize = 384;

struct PassAlive { stones: Vec<bool>, vital: Vec<bool> }

/// Empty vital regions and stones of pass-alive chains, using the conservative
/// empty-region form of Benson's fixed point. Large enclosures are NOT marked
/// unless every point touches the same surviving chain (no room for an eye).
fn pass_alive(game: &Game, enemy: i8) -> PassAlive {
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
pub fn proven_loss_margin(game: &Game) -> f64 {
    let enemy=pass_alive(game,3-game.turn).stones.into_iter().filter(|&v|v).count() as f64;
    let komi=if game.turn==1 {game.komi}else{-game.komi};
    (2.*enemy-game.board.len() as f64+komi).max(0.)
}

fn enemy_vital_regions(game: &Game) -> Vec<bool> { pass_alive(game,3-game.turn).vital }

fn liberties(game: &Game, target: usize, scratch: &mut Scratch) -> Vec<usize> {
    scratch.group(&game.board, &game.topology.neighbors, target);
    let mut points = vec![];
    for &p in &scratch.stones {
        for &q in &game.topology.neighbors[p] {
            if game.board[q] == 0 && !points.contains(&q) { points.push(q); }
        }
    }
    points
}

fn forced_capture(game: &Game, target: usize, defender: i8, depth: u32, budget: &mut usize, scratch: &mut Scratch) -> bool {
    if *budget == 0 { return false; }
    *budget -= 1;
    if game.board[target] != defender { return true; }
    if game.ended || depth == 0 { return false; }
    let libs = liberties(game, target, scratch);
    // This is a short capture reader, not a general life-and-death solver.
    if libs.len() > 2 { return false; }
    if game.turn != defender {
        // One legal attacking line suffices; ignoring other attacks is conservative.
        for p in libs {
            let mut child = game.clone();
            if child.play(p, scratch) && forced_capture(&child, target, defender, depth-1, budget, scratch) { return true; }
        }
        false
    } else {
        // Extensions first: finding an escape early avoids an expensive full proof.
        let mut replies = libs;
        for p in 0..game.board.len() {
            if game.board[p] == 0 && !replies.contains(&p) { replies.push(p); }
        }
        for p in replies {
            let mut child = game.clone();
            if child.play(p, scratch) && !forced_capture(&child, target, defender, depth-1, budget, scratch) { return false; }
        }
        let mut child = game.clone();
        !child.pass() || forced_capture(&child, target, defender, depth-1, budget, scratch)
    }
}

pub fn avoid_isolated_invasions(game: &Game, legal: &[bool]) -> Vec<usize> {
    let mut avoided = vec![];
    let mut scratch = Scratch::new(game.board.len());
    let mut total_budget = ROOT_BUDGET;
    let vital = enemy_vital_regions(game);
    for p in 0..game.board.len() {
        if !legal[p] { continue; }
        if vital[p] { avoided.push(p); continue; }
        if total_budget == 0 { continue; }
        let neighbors = &game.topology.neighbors[p];
        // Keep connections/rescues, open moves, and captures (including sacrifices).
        if neighbors.iter().any(|&q| game.board[q] == game.turn) { continue; }
        let Some(analysis) = game.analyze(p, &mut scratch) else { continue; };
        if analysis.captured > 0 || analysis.liberties > 2 { continue; }
        let mut child = game.clone();
        assert!(child.play(p, &mut scratch));
        // Keep threats against unsettled enemy chains: snapback, ko and nakade
        // can intentionally leave the newly played stone capturable.
        if neighbors.iter().any(|&q| child.board[q] == child.turn &&
            scratch.group(&child.board, &child.topology.neighbors, q) <= 2) { continue; }
        let mut budget = MOVE_BUDGET.min(total_budget);
        let before = budget;
        let proven = forced_capture(&child, p, game.turn, 3, &mut budget, &mut scratch);
        total_budget -= before-budget;
        if proven { avoided.push(p); }
    }
    avoided
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::board::{Kind, Topology};
    fn position<'a>(t: &'a Topology, moves: &[i32]) -> Game<'a> {
        let mut g=Game::new(t,6.5); let mut scratch=Scratch::new(t.len());
        for &p in moves {assert!(if p<0 {g.pass()}else{g.play(p as usize,&mut scratch)});}
        g
    }
    fn legal(g:&Game)->Vec<bool>{
        let mut scratch=Scratch::new(g.board.len());
        (0..g.board.len()).map(|p|g.analyze(p,&mut scratch).is_some()).collect()
    }
    #[test]
    fn rejects_one_and_two_liberty_pockets_without_mutating_position() {
        let t=Topology::new(Kind::Torus,7);
        for moves in [vec![-1,17,-1,23,-1,25],vec![-1,16,-1,30,-1,22,-1,17,-1,31,-1,18,-1,32,-1,26]] {
            let game=position(&t,&moves);let before=game.board.clone();
            assert!(avoid_isolated_invasions(&game,&legal(&game)).contains(&24));
            assert_eq!(game.board,before);
        }
    }
    #[test]
    fn unknown_open_extensions_are_retained_and_zero_budget_is_unknown() {
        let t=Topology::new(Kind::Torus,7);
        let mut game=position(&t,&[-1,17,-1,23]);
        assert!(!avoid_isolated_invasions(&game,&legal(&game)).contains(&24));
        let mut scratch=Scratch::new(t.len());game.play(24,&mut scratch);
        assert!(!forced_capture(&game,24,1,3,&mut 0,&mut scratch));
    }
    #[test]
    fn benson_requires_two_regions_and_does_not_condemn_large_enclosures() {
        let t=Topology::new(Kind::Torus,7);
        let setup=|holes:&[usize]| {
            let moves:Vec<i32>=(0..49).filter(|p|!holes.contains(p)).flat_map(|p|[-1,p as i32]).collect();
            position(&t,&moves)
        };
        let pockets=[16,17,18,23,24,25,40];
        let g=setup(&pockets);assert!(enemy_vital_regions(&g)[17]);
        assert!(avoid_isolated_invasions(&g,&legal(&g)).contains(&17));
        let g=setup(&pockets[..6]);assert!(!enemy_vital_regions(&g)[17]);
        let g=setup(&[8,9,10,15,16,17,22,23,24,40,45]);
        assert!(!enemy_vital_regions(&g)[16]);
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
}
