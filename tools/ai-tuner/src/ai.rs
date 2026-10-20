// Parameterised port of chooseMove from dist/engine.js. Every weight is a field so self-play
// can tune it; `legacy()` reproduces the hand-written weights the browser AI shipped with.
use crate::board::{Game, Scratch};

/// Number of tuned weights (everything except `capture` and `noise`).
pub const N: usize = 12;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Params {
    /// Per captured stone. Fixed at 10: it anchors the scale against the fixed noise.
    pub capture: f64,
    pub save_per_stone: f64,
    pub save_cap: f64,
    pub kill_per_stone: f64,
    pub kill_cap: f64,
    pub liberty: f64,
    pub enemy_adjacent: f64,
    pub friend_adjacent: f64,
    pub self_atari: f64,
    pub crowded: f64,
    pub open: f64,
    pub pass_below: f64,
    /// Per empty point the move turns toward the mover in the influence estimate.
    pub territory: f64,
    /// Uniform random bonus in [0, noise). Fixed: it keeps games varied.
    pub noise: f64,
}

/// Names and search bounds of the tuned weights, in `Params::vector` order.
pub const TUNED: [(&str, f64, f64); N] = [
    ("savePerStone", 0.0, 10.0),
    ("saveCap", 0.0, 40.0),
    ("killPerStone", 0.0, 10.0),
    ("killCap", 0.0, 40.0),
    ("liberty", -2.0, 4.0),
    ("enemyAdjacent", -3.0, 5.0),
    ("friendAdjacent", -3.0, 5.0),
    ("selfAtari", -40.0, 0.0),
    ("crowded", -15.0, 5.0),
    ("open", -5.0, 8.0),
    ("passBelow", -15.0, 5.0),
    ("territory", -2.0, 6.0),
];

impl Params {
    pub fn legacy() -> Params {
        Params {
            capture: 10.0,
            save_per_stone: 2.0,
            save_cap: 12.0,
            kill_per_stone: 3.0,
            kill_cap: 14.0,
            liberty: 0.5,
            enemy_adjacent: 0.7,
            friend_adjacent: 0.35,
            self_atari: -15.0,
            crowded: -4.0,
            open: 0.6,
            pass_below: -4.0,
            territory: 0.0,
            noise: 0.7,
        }
    }
    /// Result of `ai-tuner tune` (2026-10-20, rounded); mirrors AI_WEIGHTS in dist/engine.js.
    pub fn tuned() -> Params {
        Params {
            save_per_stone: 2.1,
            save_cap: 6.66,
            kill_per_stone: 2.33,
            kill_cap: 4.69,
            liberty: 3.14,
            enemy_adjacent: 0.66,
            friend_adjacent: -0.85,
            self_atari: -20.16,
            crowded: -3.14,
            open: -2.13,
            pass_below: -0.51,
            territory: 0.27,
            ..Params::legacy()
        }
    }
    pub fn vector(&self) -> [f64; N] {
        [
            self.save_per_stone, self.save_cap, self.kill_per_stone, self.kill_cap, self.liberty,
            self.enemy_adjacent, self.friend_adjacent, self.self_atari, self.crowded, self.open,
            self.pass_below, self.territory,
        ]
    }
    pub fn from_vector(v: &[f64; N]) -> Params {
        let clamp = |k: usize| v[k].clamp(TUNED[k].1, TUNED[k].2);
        Params {
            save_per_stone: clamp(0),
            save_cap: clamp(1),
            kill_per_stone: clamp(2),
            kill_cap: clamp(3),
            liberty: clamp(4),
            enemy_adjacent: clamp(5),
            friend_adjacent: clamp(6),
            self_atari: clamp(7),
            crowded: clamp(8),
            open: clamp(9),
            pass_below: clamp(10),
            territory: clamp(11),
            ..Params::legacy()
        }
    }
    pub fn to_js(&self) -> String {
        let fields: Vec<String> = TUNED.iter().zip(self.vector()).map(|((name, ..), x)| format!("{name}:{}", round(x))).collect();
        format!("{{capture:{},{},noise:{}}}", round(self.capture), fields.join(","), round(self.noise))
    }
}

fn round(x: f64) -> f64 {
    (x * 1000.0).round() / 1000.0
}

fn sign(x: i32) -> i32 {
    x.signum()
}

/// Returns the chosen point, or None to pass. `random` supplies the noise in [0, 1).
pub fn choose_move(game: &Game, p: &Params, scratch: &mut Scratch, random: &mut dyn FnMut() -> f64) -> Option<usize> {
    if game.ended {
        return None;
    }
    let topology = game.topology;
    let (board, neighbors, turn) = (&game.board, &topology.neighbors, game.turn);
    let n = board.len();
    // Groups in atari make their last liberty urgent: to save our stones or to take theirs.
    let mut urgent = vec![0.0f64; n];
    let mut grouped = vec![false; n];
    for i in 0..n {
        if board[i] == 0 || grouped[i] {
            continue;
        }
        let liberties = scratch.group(board, neighbors, i);
        for &s in &scratch.stones {
            grouped[s] = true;
        }
        if liberties == 1 {
            let size = scratch.stones.len() as f64;
            let last = scratch.stones.iter().flat_map(|&s| neighbors[s].iter()).find(|&&q| board[q] == 0).copied().unwrap();
            urgent[last] += if board[i] == turn { (size * p.save_per_stone).min(p.save_cap) } else { (size * p.kill_per_stone).min(p.kill_cap) };
        }
    }
    // Influence: stones radiate 4, 2, 1 to points 1, 2, 3 steps away (black positive).
    let mover = if turn == 1 { 1 } else { -1 };
    let mut influence = vec![0i32; n];
    if p.territory != 0.0 {
        for i in 0..n {
            if board[i] != 0 {
                let color = if board[i] == 1 { 1 } else { -1 };
                for &(q, f) in &topology.ball[i] {
                    influence[q] += color * f;
                }
            }
        }
    }
    let mut best = None;
    let mut best_value = f64::NEG_INFINITY;
    for i in 0..n {
        if board[i] != 0 {
            continue;
        }
        let adjacent = &neighbors[i];
        let friends = adjacent.iter().filter(|&&q| board[q] == turn).count();
        let enemies = adjacent.iter().filter(|&&q| board[q] == 3 - turn).count();
        // Leave simple eyes intact instead of filling secure territory.
        if friends == adjacent.len() {
            continue;
        }
        let Some(m) = game.analyze(i, scratch) else { continue };
        let mut value = m.captured as f64 * p.capture + urgent[i] + (m.liberties.min(6) as f64) * p.liberty;
        value += enemies as f64 * p.enemy_adjacent + friends as f64 * p.friend_adjacent;
        if m.liberties == 1 && m.captured == 0 {
            value += p.self_atari;
        }
        if friends >= 3 && enemies == 0 {
            value += p.crowded;
        }
        if friends == 0 && enemies == 0 {
            value += p.open;
        }
        if p.territory != 0.0 {
            // The point stops being empty; nearby empty points may change side.
            let mut flipped = -sign(influence[i]) * mover;
            for &(q, f) in &topology.ball[i] {
                if board[q] == 0 {
                    flipped += (sign(influence[q] + mover * f) - sign(influence[q])) * mover;
                }
            }
            value += flipped as f64 * p.territory;
        }
        value += random() * p.noise;
        if value > best_value {
            best_value = value;
            best = Some(i);
        }
    }
    if best_value < p.pass_below {
        None
    } else {
        best
    }
}
