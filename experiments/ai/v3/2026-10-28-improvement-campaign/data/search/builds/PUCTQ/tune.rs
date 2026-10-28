// Self-play matches and a cross-entropy search over the evaluation weights.
use crate::ai::{choose_move, Params, N, TUNED};
use crate::board::{Game, Kind, Scratch, Topology};
use crate::rng::Rng;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

/// The board sizes the app offers.
pub const CONFIGS: [(Kind, usize); 6] = [(Kind::Sphere, 3), (Kind::Sphere, 4), (Kind::Sphere, 5), (Kind::Torus, 7), (Kind::Torus, 9), (Kind::Torus, 11)];
pub const KOMI: f64 = 6.5;

pub fn topologies() -> Vec<Topology> {
    CONFIGS.iter().map(|&(kind, size)| Topology::new(kind, size)).collect()
}

/// Plays one game and returns the winner (1 black, 2 white). Long games are scored as they stand.
pub fn play_game(topology: &Topology, black: &Params, white: &Params, seed: u64) -> u8 {
    let mut game = Game::new(topology, KOMI);
    let mut scratch = Scratch::new(topology.len());
    let mut rng = Rng::new(seed);
    let limit = topology.len() * 4;
    while !game.ended && game.history.len() < limit {
        let params = if game.turn == 1 { black } else { white };
        let mut noise = || rng.f64();
        match choose_move(&game, params, &mut scratch, &mut noise) {
            Some(i) => {
                game.play(i, &mut scratch);
            }
            None => {
                game.pass();
            }
        }
    }
    let (b, w) = game.score();
    if b > w {
        1
    } else {
        2
    }
}

pub struct Pairing {
    pub a: Params,
    pub b: Params,
}

/// Win rate of `a` over `b` for each pairing: `games_per_config` games on every board size,
/// alternating colours. Seeds depend only on (seed, config, game), so every pairing faces the
/// same openings and noise stream (common random numbers reduce comparison variance).
pub fn win_rates(pairings: &[Pairing], topologies: &[Topology], games_per_config: usize, seed: u64) -> Vec<f64> {
    per_config_wins(pairings, topologies, games_per_config, seed).iter().map(|row| row.iter().sum::<usize>() as f64 / (games_per_config * CONFIGS.len()) as f64).collect()
}

/// Wins of `a` per pairing and board size.
pub fn per_config_wins(pairings: &[Pairing], topologies: &[Topology], games_per_config: usize, seed: u64) -> Vec<Vec<usize>> {
    let jobs = pairings.len() * CONFIGS.len() * games_per_config;
    let next = AtomicUsize::new(0);
    let wins = Mutex::new(vec![vec![0usize; CONFIGS.len()]; pairings.len()]);
    let workers = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    std::thread::scope(|scope| {
        for _ in 0..workers {
            scope.spawn(|| {
                let mut local = vec![vec![0usize; CONFIGS.len()]; pairings.len()];
                loop {
                    let job = next.fetch_add(1, Ordering::Relaxed);
                    if job >= jobs {
                        break;
                    }
                    let pairing = job / (CONFIGS.len() * games_per_config);
                    let config = job / games_per_config % CONFIGS.len();
                    let game = job % games_per_config;
                    let Pairing { a, b } = &pairings[pairing];
                    let game_seed = seed.wrapping_mul(0x100_0000_01b3) ^ ((config as u64) << 40) ^ game as u64;
                    let a_is_black = game % 2 == 0;
                    let (black, white) = if a_is_black { (a, b) } else { (b, a) };
                    let winner = play_game(&topologies[config], black, white, game_seed);
                    if (winner == 1) == a_is_black {
                        local[pairing][config] += 1;
                    }
                }
                let mut total = wins.lock().unwrap();
                for (row, add) in total.iter_mut().zip(local) {
                    for (cell, x) in row.iter_mut().zip(add) {
                        *cell += x;
                    }
                }
            });
        }
    });
    wins.into_inner().unwrap()
}

pub struct TuneOptions {
    pub generations: usize,
    pub population: usize,
    pub elite: usize,
    pub games_per_config: usize,
    pub seed: u64,
    /// Weights kept at their starting value (by index into TUNED).
    pub frozen: Vec<usize>,
}

/// Cross-entropy method: sample around a mean, keep the best, refit mean and spread.
/// Fitness is the average win rate against the legacy AI and the current champion, so a
/// candidate cannot win by exploiting one opponent's quirks.
pub fn tune(options: &TuneOptions, start: Params) -> Params {
    let topologies = topologies();
    let legacy = Params::legacy();
    let mut mean = start.vector();
    let mut spread: [f64; N] = std::array::from_fn(|k| (TUNED[k].2 - TUNED[k].1) / 8.0);
    for &k in &options.frozen {
        spread[k] = 0.0;
    }
    let mut champion = start;
    let mut rng = Rng::new(options.seed);
    for generation in 0..options.generations {
        let candidates: Vec<Params> = (0..options.population)
            .map(|_| {
                let v: [f64; N] = std::array::from_fn(|k| mean[k] + spread[k] * rng.normal());
                Params::from_vector(&v)
            })
            .collect();
        let seed = options.seed ^ (generation as u64 + 1) * 0x9e37_79b9;
        let pairings: Vec<Pairing> = candidates.iter().flat_map(|c| [Pairing { a: *c, b: legacy }, Pairing { a: *c, b: champion }]).collect();
        let rates = win_rates(&pairings, &topologies, options.games_per_config, seed);
        let mut scored: Vec<(f64, &Params)> = candidates.iter().enumerate().map(|(i, c)| ((rates[2 * i] + rates[2 * i + 1]) / 2.0, c)).collect();
        scored.sort_by(|x, y| y.0.partial_cmp(&x.0).unwrap());
        let elite: Vec<[f64; N]> = scored[..options.elite].iter().map(|(_, c)| c.vector()).collect();
        for k in 0..N {
            if options.frozen.contains(&k) {
                continue;
            }
            let m = elite.iter().map(|v| v[k]).sum::<f64>() / elite.len() as f64;
            let sd = (elite.iter().map(|v| (v[k] - m).powi(2)).sum::<f64>() / elite.len() as f64).sqrt();
            mean[k] = m;
            // Smoothed refit with a floor keeps the search from collapsing on noise.
            spread[k] = (0.6 * spread[k] + 0.4 * sd).max((TUNED[k].2 - TUNED[k].1) / 100.0);
        }
        let proposal = Params::from_vector(&mean);
        let check = win_rates(&[Pairing { a: proposal, b: champion }, Pairing { a: proposal, b: legacy }], &topologies, options.games_per_config * 2, seed ^ 0xc0ffee);
        let promoted = check[0] > 0.53;
        if promoted {
            champion = proposal;
        }
        eprintln!(
            "gen {generation:>3}: best fitness {:.3}, elite mean {:.3} | mean vs champion {:.3}, vs legacy {:.3}{}",
            scored[0].0,
            scored[..options.elite].iter().map(|s| s.0).sum::<f64>() / options.elite as f64,
            check[0],
            check[1],
            if promoted { "  -> champion" } else { "" }
        );
        eprintln!("         mean {}", proposal.to_js());
    }
    champion
}
