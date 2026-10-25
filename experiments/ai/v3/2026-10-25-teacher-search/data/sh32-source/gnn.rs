//! v3 feature ABI. All colours are relative to the player to move.
use crate::board::{Game, Scratch};

pub const POINTS: usize = 160;
pub const CHANNELS: usize = 32;
pub const GLOBALS: usize = 8;
pub const ACTIONS: usize = POINTS + 1;
pub const PASS: usize = POINTS;

#[derive(Clone)]
pub struct Features {
    pub x: Vec<f32>,
    pub global: [f32; GLOBALS],
    pub mask: Vec<f32>,
    pub legal: Vec<bool>,
}

/// `past` contains up to four previous boards, oldest first, excluding the current board.
pub fn encode(game: &Game, past: &[Vec<i8>], sphere: bool) -> Features {
    let n = game.board.len();
    assert!(n <= POINTS);
    let mut f = Features {
        x: vec![0.; POINTS * CHANNELS], mask: vec![0.; POINTS],
        global: [0.; GLOBALS], legal: vec![false; ACTIONS],
    };
    let mut scratch = Scratch::new(n);
    let mut seen = vec![false; n];
    for p in 0..n {
        f.mask[p] = 1.;
        let stone = game.board[p];
        let offset = if stone == 0 { 2 } else if stone == game.turn { 0 } else { 1 };
        f.x[p * CHANNELS + offset] = 1.;
        f.x[p * CHANNELS + 13 + usize::from(game.topology.neighbors[p].len() == 4)] = 1.;
        let adjacent = &game.topology.neighbors[p];
        f.x[p * CHANNELS + 30] = adjacent.iter().filter(|&&q| game.board[q] == game.turn).count() as f32 / 4.;
        f.x[p * CHANNELS + 31] = adjacent.iter().filter(|&&q| game.board[q] == 3-game.turn).count() as f32 / 4.;
        if stone != 0 && !seen[p] {
            let libs = scratch.group(&game.board, &game.topology.neighbors, p);
            let side = usize::from(stone != game.turn);
            let size = (scratch.stones.len() as f32).ln_1p() / (n as f32).ln_1p();
            for &q in &scratch.stones {
                seen[q] = true;
                f.x[q * CHANNELS + 3 + side * 4 + libs.clamp(1,4)-1] = 1.;
                f.x[q * CHANNELS + 11 + side] = size;
            }
        }
        if let Some(a) = game.analyze(p, &mut scratch) {
            f.legal[p] = true;
            f.x[p * CHANNELS + 27] = 1.;
            f.x[p * CHANNELS + 28] = (a.captured as f32 / n as f32).sqrt();
            f.x[p * CHANNELS + 29] = a.liberties.min(8) as f32 / 8.;
        }
    }
    for (k,point) in game.history.iter().rev().take(4).enumerate() {
        if let Some(p) = point { f.x[p * CHANNELS + 15 + k] = 1.; }
    }
    for (k,board) in past.iter().rev().take(4).enumerate() {
        assert_eq!(board.len(), n);
        for (p,&stone) in board.iter().enumerate() {
            if stone != 0 { f.x[p * CHANNELS + 19 + 2*k + usize::from(stone != game.turn)] = 1.; }
        }
    }
    f.legal[PASS] = !game.ended;
    let sign = if game.turn == 1 { 1. } else { -1. };
    f.global = [-sign * game.komi as f32 / n as f32, n as f32 / POINTS as f32,
        if sphere {1.} else {0.}, if sphere {0.} else {1.},
        game.passes.min(2) as f32 / 2., (game.history.len() as f32 / (2*n) as f32).min(2.),
        if game.turn == 1 {1.} else {0.}, 1.];
    f
}

pub fn remember(past: &mut Vec<Vec<i8>>, board: &[i8]) {
    past.push(board.to_vec());
    if past.len() > 4 { past.remove(0); }
}

/// Exact area ownership, including stones still on the board. 0 denotes neutral.
pub fn ownership(game: &Game) -> Vec<i8> {
    let mut result = game.board.clone();
    let mut seen = vec![false; result.len()];
    for p in 0..result.len() {
        if game.board[p] != 0 || seen[p] { continue; }
        let mut region = vec![p]; let mut borders = 0; seen[p] = true;
        let mut k = 0;
        while k < region.len() {
            for &q in &game.topology.neighbors[region[k]] {
                if game.board[q] != 0 { borders |= 1 << game.board[q]; }
                else if !seen[q] { seen[q] = true; region.push(q); }
            }
            k += 1;
        }
        let owner = if borders == 2 {1} else if borders == 4 {2} else {0};
        for q in region { result[q] = owner; }
    }
    result
}
