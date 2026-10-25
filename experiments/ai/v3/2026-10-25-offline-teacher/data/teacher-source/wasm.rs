// Browser AI adapter. The UI remains the authority for played moves and saved games.
mod ai;
mod board;
mod rng;
mod search;
mod endgame;

use std::cell::RefCell;
use board::{Game, Kind, Scratch, Topology};
use rng::Rng;

#[derive(Default)]
struct Engine {
    topology: Option<(u32, usize, Topology)>,
    scratch: Option<Scratch>,
}
impl Engine {
    fn choose(&mut self, kind: u32, size: usize, komi: f64, moves: &[i32], seed: u32, randomize: bool, depth: u32) -> i32 {
        if !matches!((kind, size), (0, 3..=5) | (1, 7 | 9 | 11))
            || !komi.is_finite() || moves.len() > 10000 {
            return -2;
        }
        if !self.topology.as_ref().is_some_and(|(k, s, _)| *k == kind && *s == size) {
            let topology = Topology::new(if kind == 0 { Kind::Sphere } else { Kind::Torus }, size);
            self.scratch = Some(Scratch::new(topology.len()));
            self.topology = Some((kind, size, topology));
        }
        // These borrows last only for this request: switching boards drops the old topology.
        let topology = &self.topology.as_ref().unwrap().2;
        let scratch = self.scratch.as_mut().unwrap();
        let mut game = Game::new(topology, komi);
        for &m in moves {
            if m < -1 || !(if m == -1 { game.pass() } else { game.play(m as usize, scratch) }) {
                return -3;
            }
        }
        if depth>0 {return search::choose_search(&game,depth,if randomize {seed}else{0}).0.map_or(-1,|m|m as i32);}
        let mut rng = Rng::new(seed as u64);
        let mut random = || if randomize { rng.f64() } else { 0.0 };
        ai::choose_move(&game, &ai::Params::tuned(), scratch, &mut random).map_or(-1, |m| m as i32)
    }
}
thread_local! { static ENGINE: RefCell<Engine> = RefCell::new(Engine::default()); }

#[no_mangle]
pub extern "C" fn ai_version() -> u32 { 2 }

#[no_mangle]
pub extern "C" fn ai_weight(index: usize) -> f64 {
    let p = ai::Params::tuned();
    match index { 0 => p.capture, 1..=12 => p.vector()[index - 1], 13 => p.noise, _ => f64::NAN }
}

#[no_mangle]
pub extern "C" fn ai_alloc(len: usize) -> *mut i32 {
    if len == 0 || len > 10000 { return std::ptr::null_mut(); }
    Box::into_raw(vec![0i32; len].into_boxed_slice()) as *mut i32
}

// The JS adapter owns this allocation and passes the original pointer and length.
#[no_mangle]
pub unsafe extern "C" fn ai_free(ptr: *mut i32, len: usize) {
    drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
}

#[no_mangle]
pub unsafe extern "C" fn ai_choose(kind: u32, size: usize, komi: f64, ptr: *const i32, len: usize, seed: u32, randomize: u32) -> i32 {
    if ptr.is_null() || len > 10000 { return -2; }
    let moves = std::slice::from_raw_parts(ptr, len);
    ENGINE.with(|engine| engine.borrow_mut().choose(kind, size, komi, moves, seed, randomize != 0, 0))
}

#[no_mangle]
pub unsafe extern "C" fn ai_search(kind: u32, size: usize, komi: f64, ptr: *const i32, len: usize, seed: u32, randomize: u32, depth: u32) -> i32 {
    if ptr.is_null() || len>10000 || !(1..=4).contains(&depth) {return -2;}
    let moves=std::slice::from_raw_parts(ptr,len);
    ENGINE.with(|engine|engine.borrow_mut().choose(kind,size,komi,moves,seed,randomize!=0,depth))
}
