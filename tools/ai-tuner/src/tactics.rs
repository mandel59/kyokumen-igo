//! Conservative v3 root guards against futile invasions and certified eye fills.
//! A capture proof must cover *all* legal defender replies (including pass).
//! Exhausting the depth/node budget means unknown, never "dead".
use crate::board::{Game, Scratch};
use crate::endgame::pass_alive;

const ROOT_BUDGET: usize = 1024;
const MOVE_BUDGET: usize = 384;

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

/// A single-point eye of certified living chains cannot gain area by being
/// filled. Keep uncertified eye shapes, connections, rescues and captures.
/// This also prevents turning the last two true eyes into a capturable chain.
pub fn avoid_futile_moves(game: &Game, legal: &[bool]) -> Vec<usize> {
    let mut avoided = avoid_isolated_invasions(game, legal);
    let own = pass_alive(game, game.turn);
    for p in 0..game.board.len() {
        if legal[p] && own.vital[p] &&
            game.topology.neighbors[p].iter().all(|&q| game.board[q] == game.turn) {
            avoided.push(p);
        }
    }
    avoided
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
    fn certified_eyes_are_preserved_but_unsettled_connections_are_kept() {
        for (kind,size) in [(Kind::Sphere,3),(Kind::Sphere,4),(Kind::Sphere,5),
            (Kind::Torus,7),(Kind::Torus,9),(Kind::Torus,11),
            (Kind::Plane,7),(Kind::Plane,9),(Kind::Plane,11)] {
            let t=Topology::new(kind,size);let n=t.len();
            let other=(1..n).find(|p|!t.neighbors[0].contains(p)).unwrap();
            for colour in [1,2] {
                let moves:Vec<i32>=(0..n).filter(|&p|p!=0&&p!=other).flat_map(|p|
                    if colour==1 {[p as i32,-1]} else {[-1,p as i32]}).collect();
                let mut g=position(&t,&moves);
                if g.turn!=colour {assert!(g.pass());}
                let before=g.board.clone();let avoided=avoid_futile_moves(&g,&legal(&g));
                assert!(avoided.contains(&0));assert!(avoided.contains(&other));
                assert_eq!(g.board,before);
            }
        }
        let t=Topology::new(Kind::Torus,7);
        let g=position(&t,&[17,-1,23,-1,25,-1,31,-1]);
        assert!(legal(&g)[24]);
        assert!(!avoid_futile_moves(&g,&legal(&g)).contains(&24));
    }

}
