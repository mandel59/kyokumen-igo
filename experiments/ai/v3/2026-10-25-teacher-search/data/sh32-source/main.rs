// Self-play tuner for the 曲面囲碁 AI. See README.md in this directory.
mod ai;
mod board;
mod rng;
mod tune;

use ai::{choose_move, Params};
use board::{Game, Kind, Scratch, Topology};
use rng::Rng;
use std::time::Instant;
use tune::{per_config_wins, play_game, topologies, tune, Pairing, TuneOptions, CONFIGS};

/// `legacy`, `tuned`, or a literal like `{liberty:2.5,territory:0.3}` (other weights from legacy).
fn named(name: &str) -> Params {
    match name {
        "legacy" => Params::legacy(),
        "tuned" => Params::tuned(),
        literal if literal.starts_with('{') => {
            let mut v = Params::legacy().vector();
            for pair in literal.trim_matches(|c| c == '{' || c == '}').split(',').filter(|s| !s.is_empty()) {
                let (key, value) = pair.split_once(':').expect("key:value");
                let value: f64 = value.trim().parse().expect("number");
                match ai::TUNED.iter().position(|(name, ..)| *name == key.trim()) {
                    Some(k) => v[k] = value,
                    None => assert!(matches!(key.trim(), "capture" | "noise"), "unknown weight {key}"),
                }
            }
            Params::from_vector(&v)
        }
        _ => panic!("unknown parameter set {name} (use legacy, tuned or a {{key:value,...}} literal)"),
    }
}

fn arg<T: std::str::FromStr>(args: &[String], flag: &str, default: T) -> T {
    args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1)).and_then(|v| v.parse().ok()).unwrap_or(default)
}

fn selftest() {
    for (kind, size, points) in [(Kind::Sphere, 3, 56), (Kind::Sphere, 4, 98), (Kind::Sphere, 5, 152), (Kind::Torus, 7, 49), (Kind::Torus, 9, 81), (Kind::Torus, 11, 121)] {
        let t = Topology::new(kind, size);
        assert_eq!(t.len(), points, "{kind:?} {size} vertex count");
        let three = t.neighbors.iter().filter(|n| n.len() == 3).count();
        assert_eq!(three, if kind == Kind::Sphere { 8 } else { 0 }, "{kind:?} {size} three-neighbour points");
        assert!(t.neighbors.iter().all(|n| n.len() == 3 || n.len() == 4));
    }
    // Capture, suicide and positional superko on a 7×7 torus (same sequence as persistence tests).
    let t = Topology::new(Kind::Torus, 7);
    let mut s = Scratch::new(t.len());
    let mut g = Game::new(&t, 0.5);
    for p in [17, 24, 31, 18, 23, 32, 0, 26, 25] {
        assert!(g.play(p, &mut s), "legal {p}");
    }
    assert!(!g.play(24, &mut s), "superko retake is rejected");
    let mut g = Game::new(&t, 6.5);
    for p in [1, 0, 7, 48] {
        assert!(g.play(p, &mut s));
    }
    assert!(g.pass() && g.pass() && g.ended);
    eprintln!("selftest passed");
}

fn bench() {
    let topologies = topologies();
    let p = Params::legacy();
    for (k, t) in topologies.iter().enumerate() {
        let start = Instant::now();
        let games = 40;
        for seed in 0..games {
            play_game(t, &p, &p, seed);
        }
        eprintln!("{} {}: {:.1} ms/game", CONFIGS[k].0.name(), CONFIGS[k].1, start.elapsed().as_secs_f64() * 1000.0 / games as f64);
    }
}

fn report_match(a: &str, b: &str, games_per_config: usize, seed: u64) {
    let topologies = topologies();
    let wins = &per_config_wins(&[Pairing { a: named(a), b: named(b) }], &topologies, games_per_config, seed)[0];
    let total: usize = wins.iter().sum();
    let n = games_per_config * CONFIGS.len();
    let rate = total as f64 / n as f64;
    let margin = 1.96 * (rate * (1.0 - rate) / n as f64).sqrt();
    println!("{a} vs {b}: {total}/{n} = {:.1}% (95% CI ±{:.1})", rate * 100.0, margin * 100.0);
    for (k, w) in wins.iter().enumerate() {
        println!("  {} {:>2}: {:>5.1}%", CONFIGS[k].0.name(), CONFIGS[k].1, *w as f64 * 100.0 / games_per_config as f64);
    }
}

/// Positions from self-play with the deterministic (noise-free) tuned move, for the JS parity test.
fn parity(path: &str, count: usize) {
    let topologies = topologies();
    let tuned = Params::tuned();
    let mut rng = Rng::new(20261020);
    let mut cases = Vec::new();
    while cases.len() < count {
        let k = cases.len() % topologies.len();
        let t = &topologies[k];
        let mut game = Game::new(t, tune::KOMI);
        let mut scratch = Scratch::new(t.len());
        let stop = (rng.f64() * t.len() as f64 * 1.6) as usize;
        while !game.ended && game.history.len() < stop {
            let mut noise = || rng.f64();
            match choose_move(&game, &tuned, &mut scratch, &mut noise) {
                Some(i) => game.play(i, &mut scratch),
                None => game.pass(),
            };
        }
        if game.ended {
            continue;
        }
        let expected = choose_move(&game, &tuned, &mut scratch, &mut || 0.0);
        let moves: Vec<String> = game.history.iter().map(|m| m.map_or("-1".into(), |i| i.to_string())).collect();
        cases.push(format!(
            "{{\"kind\":\"{}\",\"size\":{},\"moves\":[{}],\"expected\":{}}}",
            CONFIGS[k].0.name(),
            CONFIGS[k].1,
            moves.join(","),
            expected.map_or("null".into(), |i| i.to_string())
        ));
    }
    let json = format!("{{\"params\":{},\"cases\":[\n{}\n]}}\n", tuned.to_js().replace('{', "{\"").replace(':', "\":").replace(',', ",\""), cases.join(",\n"));
    std::fs::write(path, json).expect("write parity fixture");
    eprintln!("wrote {count} positions to {path}");
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("selftest") => selftest(),
        Some("bench") => bench(),
        Some("match") => report_match(&args[1], &args[2], arg(&args, "--games", 500), arg(&args, "--seed", 7)),
        Some("tune") => {
            let options = TuneOptions {
                generations: arg(&args, "--generations", 40),
                population: arg(&args, "--population", 32),
                elite: arg(&args, "--elite", 8),
                games_per_config: arg(&args, "--games", 16),
                seed: arg(&args, "--seed", 1),
                frozen: if args.iter().any(|a| a == "--legacy-features") { vec![11] } else { vec![] },
            };
            let best = tune(&options, Params::legacy());
            println!("{}", best.to_js());
            println!("{best:?}");
        }
        Some("parity") => parity(args.get(1).map_or("parity.json", String::as_str), arg(&args, "--count", 120)),
        _ => eprintln!("usage: ai-tuner selftest | bench | match <legacy|tuned> <legacy|tuned> [--games N] | tune [--generations N --population N --elite N --games N --seed N --legacy-features] | parity <out.json> [--count N]"),
    }
}
