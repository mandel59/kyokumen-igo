// Benchmark adapter only. The production app continues to use JavaScript.
#[path = "src/ai.rs"] mod ai;
#[path = "src/board.rs"] mod board;
#[path = "src/rng.rs"] mod rng;

use std::cell::RefCell;
use board::{Game, Kind, Scratch, Topology};

struct Position {
    game: Game<'static>,
    scratch: Scratch,
}
#[derive(Default)]
struct State {
    topologies: Vec<(u32, usize, &'static Topology)>,
    positions: Vec<Position>,
}
impl State {
    fn topology(&mut self, kind: u32, size: usize) -> &'static Topology {
        if let Some((_, _, t)) = self.topologies.iter().find(|(k, s, _)| *k == kind && *s == size) {
            return t;
        }
        // Six benchmark topologies intentionally live for the module's lifetime.
        let t = Box::leak(Box::new(Topology::new(match kind {
            0 => Kind::Sphere, 1 => Kind::Torus, _ => panic!("invalid kind"),
        }, size)));
        self.topologies.push((kind, size, t));
        t
    }
}
thread_local! { static STATE: RefCell<State> = RefCell::new(State::default()); }

fn replay(topology: &'static Topology, moves: &[i32]) -> Position {
    let mut position = Position { game: Game::new(topology, 6.5), scratch: Scratch::new(topology.len()) };
    for &m in moves {
        assert!(if m < 0 { position.game.pass() } else { position.game.play(m as usize, &mut position.scratch) });
    }
    position
}
fn choose(position: &mut Position) -> i32 {
    ai::choose_move(&position.game, &ai::Params::tuned(), &mut position.scratch, &mut || 0.0)
        .map_or(-1, |m| m as i32)
}

#[no_mangle]
pub extern "C" fn bench_alloc(len: usize) -> *mut i32 {
    Box::into_raw(vec![0i32; len].into_boxed_slice()) as *mut i32
}
#[no_mangle]
pub unsafe extern "C" fn bench_free(ptr: *mut i32, len: usize) {
    drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
}
#[no_mangle]
pub unsafe extern "C" fn bench_load(kind: u32, size: usize, ptr: *const i32, len: usize) -> usize {
    let moves = std::slice::from_raw_parts(ptr, len);
    STATE.with(|state| {
        let mut state = state.borrow_mut();
        let topology = state.topology(kind, size);
        let id = state.positions.len();
        state.positions.push(replay(topology, moves));
        id
    })
}
#[no_mangle]
pub extern "C" fn bench_choose(id: usize) -> i32 {
    STATE.with(|state| choose(&mut state.borrow_mut().positions[id]))
}
#[no_mangle]
pub unsafe extern "C" fn bench_replay_choose(kind: u32, size: usize, ptr: *const i32, len: usize) -> i32 {
    let moves = std::slice::from_raw_parts(ptr, len);
    STATE.with(|state| {
        let topology = state.borrow_mut().topology(kind, size);
        choose(&mut replay(topology, moves))
    })
}
