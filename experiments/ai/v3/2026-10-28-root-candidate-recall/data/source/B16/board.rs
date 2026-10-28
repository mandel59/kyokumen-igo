// Port of createTopology and Game from dist/engine.js. Vertex numbering matches the JS
// exactly, so positions and moves can be exchanged with the browser engine.
use crate::rng::Rng;
use std::collections::{HashMap, HashSet};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Sphere,
    Torus,
    Plane,
}

impl Kind {
    pub fn name(self) -> &'static str {
        match self {
            Kind::Sphere => "sphere",
            Kind::Torus => "torus",
            Kind::Plane => "plane",
        }
    }
}

pub struct Topology {
    pub neighbors: Vec<Vec<usize>>,
    /// Points within graph distance 1..=3 of each vertex, with influence 4, 2, 1.
    pub ball: Vec<Vec<(usize, i32)>>,
    zobrist: Vec<[u64; 2]>,
}

fn link(adjacency: &mut [Vec<usize>], edges: &mut HashSet<(usize, usize)>, a: usize, b: usize) {
    if a == b {
        return;
    }
    if edges.insert((a.min(b), a.max(b))) {
        adjacency[a].push(b);
        adjacency[b].push(a);
    }
}

impl Topology {
    pub fn new(kind: Kind, size: usize) -> Topology {
        let mut adjacency: Vec<Vec<usize>> = Vec::new();
        let mut edges = HashSet::new();
        match kind {
            Kind::Torus => {
                adjacency.resize(size * size, Vec::new());
                for u in 0..size {
                    for v in 0..size {
                        link(&mut adjacency, &mut edges, u * size + v, ((u + 1) % size) * size + v);
                        link(&mut adjacency, &mut edges, u * size + v, u * size + (v + 1) % size);
                    }
                }
            }
            Kind::Plane => {
                adjacency.resize(size * size, Vec::new());
                for u in 0..size {
                    for v in 0..size {
                        if u + 1 < size {
                            link(&mut adjacency, &mut edges, u * size + v, (u + 1) * size + v);
                        }
                        if v + 1 < size {
                            link(&mut adjacency, &mut edges, u * size + v, u * size + v + 1);
                        }
                    }
                }
            }
            Kind::Sphere => {
                let mut index: HashMap<[i32; 3], usize> = HashMap::new();
                let s = size as i32;
                for axis in 0..3 {
                    for sign in [-1, 1] {
                        let other: Vec<usize> = (0..3).filter(|&a| a != axis).collect();
                        let mut grid = vec![vec![0usize; size + 1]; size + 1];
                        for u in 0..=size {
                            for v in 0..=size {
                                let mut c = [0i32; 3];
                                c[axis] = sign * s;
                                c[other[0]] = 2 * u as i32 - s;
                                c[other[1]] = 2 * v as i32 - s;
                                let id = *index.entry(c).or_insert_with(|| {
                                    adjacency.push(Vec::new());
                                    adjacency.len() - 1
                                });
                                grid[u][v] = id;
                                if u > 0 {
                                    link(&mut adjacency, &mut edges, grid[u - 1][v], id);
                                }
                                if v > 0 {
                                    link(&mut adjacency, &mut edges, grid[u][v - 1], id);
                                }
                            }
                        }
                    }
                }
            }
        }
        let n = adjacency.len();
        let mut ball = Vec::with_capacity(n);
        for start in 0..n {
            let mut distance = vec![u32::MAX; n];
            distance[start] = 0;
            let mut queue = vec![start];
            let mut near = Vec::new();
            let mut head = 0;
            while head < queue.len() {
                let p = queue[head];
                head += 1;
                if distance[p] == 3 {
                    continue;
                }
                for &q in &adjacency[p] {
                    if distance[q] == u32::MAX {
                        distance[q] = distance[p] + 1;
                        near.push((q, [0, 4, 2, 1][distance[q] as usize]));
                        queue.push(q);
                    }
                }
            }
            ball.push(near);
        }
        let mut rng = Rng::new(0x5eed_0f_b0a2d);
        let zobrist = (0..n).map(|_| [rng.next_u64(), rng.next_u64()]).collect();
        Topology { neighbors: adjacency, ball, zobrist }
    }
    pub fn len(&self) -> usize {
        self.neighbors.len()
    }
}

pub struct Analysis {
    pub board: Vec<i8>,
    pub captured: u32,
    pub liberties: usize,
    pub hash: u64,
}

#[derive(Clone)]
pub struct Game<'t> {
    pub topology: &'t Topology,
    pub board: Vec<i8>,
    pub turn: i8,
    pub captures: [u32; 3],
    pub passes: u32,
    pub ended: bool,
    pub komi: f64,
    pub history: Vec<Option<usize>>,
    hash: u64,
    seen: HashSet<u64>,
}

/// Flood-fill scratch space reused across calls (stamp-based visited marks).
pub struct Scratch {
    stone_mark: Vec<u32>,
    liberty_mark: Vec<u32>,
    stamp: u32,
    stack: Vec<usize>,
    pub stones: Vec<usize>,
}

impl Scratch {
    pub fn new(n: usize) -> Scratch {
        Scratch { stone_mark: vec![0; n], liberty_mark: vec![0; n], stamp: 0, stack: Vec::new(), stones: Vec::new() }
    }
    /// Collects the group at `start` into `self.stones` and returns its liberty count.
    pub fn group(&mut self, board: &[i8], neighbors: &[Vec<usize>], start: usize) -> usize {
        self.stamp = self.stamp.wrapping_add(1);
        if self.stamp == 0 {
            self.stone_mark.iter_mut().for_each(|m| *m = 0);
            self.liberty_mark.iter_mut().for_each(|m| *m = 0);
            self.stamp = 1;
        }
        let color = board[start];
        self.stones.clear();
        self.stack.clear();
        self.stack.push(start);
        self.stone_mark[start] = self.stamp;
        let mut liberties = 0;
        while let Some(p) = self.stack.pop() {
            self.stones.push(p);
            for &q in &neighbors[p] {
                if board[q] == 0 {
                    if self.liberty_mark[q] != self.stamp {
                        self.liberty_mark[q] = self.stamp;
                        liberties += 1;
                    }
                } else if board[q] == color && self.stone_mark[q] != self.stamp {
                    self.stone_mark[q] = self.stamp;
                    self.stack.push(q);
                }
            }
        }
        liberties
    }
}

impl<'t> Game<'t> {
    pub fn new(topology: &'t Topology, komi: f64) -> Game<'t> {
        let mut seen = HashSet::new();
        seen.insert(0);
        Game {
            topology,
            board: vec![0; topology.len()],
            turn: 1,
            captures: [0; 3],
            passes: 0,
            ended: false,
            komi,
            history: Vec::new(),
            hash: 0,
            seen,
        }
    }

    pub fn analyze(&self, i: usize, scratch: &mut Scratch) -> Option<Analysis> {
        if self.ended || i >= self.board.len() || self.board[i] != 0 {
            return None;
        }
        let neighbors = &self.topology.neighbors;
        let (turn, enemy) = (self.turn, 3 - self.turn);
        let mut board = self.board.clone();
        board[i] = turn;
        let mut hash = self.hash ^ self.topology.zobrist[i][turn as usize - 1];
        let mut captured = 0u32;
        // Enemy groups already examined from another side of i (JS: the `checked` set).
        let mut checked: Vec<usize> = Vec::new();
        for &n in &neighbors[i] {
            if board[n] != enemy || checked.contains(&n) {
                continue;
            }
            let liberties = scratch.group(&board, neighbors, n);
            checked.extend_from_slice(&scratch.stones);
            if liberties == 0 {
                captured += scratch.stones.len() as u32;
                for &p in &scratch.stones {
                    board[p] = 0;
                    hash ^= self.topology.zobrist[p][enemy as usize - 1];
                }
            }
        }
        let liberties = scratch.group(&board, neighbors, i);
        if liberties == 0 || self.seen.contains(&hash) {
            return None;
        }
        Some(Analysis { board, captured, liberties, hash })
    }

    pub fn play(&mut self, i: usize, scratch: &mut Scratch) -> bool {
        match self.analyze(i, scratch) {
            None => false,
            Some(a) => {
                self.board = a.board;
                self.captures[self.turn as usize] += a.captured;
                self.turn = 3 - self.turn;
                self.passes = 0;
                self.hash = a.hash;
                self.seen.insert(a.hash);
                self.history.push(Some(i));
                true
            }
        }
    }

    pub fn pass(&mut self) -> bool {
        if self.ended {
            return false;
        }
        self.turn = 3 - self.turn;
        self.passes += 1;
        self.ended = self.passes >= 2;
        self.history.push(None);
        true
    }

    /// Area score: (black, white including komi).
    pub fn score(&self) -> (f64, f64) {
        let n = self.board.len();
        let (mut black, mut white) = (0usize, 0usize);
        let mut seen = vec![false; n];
        for i in 0..n {
            match self.board[i] {
                1 => black += 1,
                2 => white += 1,
                _ if !seen[i] => {
                    let mut region = vec![i];
                    seen[i] = true;
                    let mut border = 0u8;
                    let mut k = 0;
                    while k < region.len() {
                        for &q in &self.topology.neighbors[region[k]] {
                            match self.board[q] {
                                0 if !seen[q] => {
                                    seen[q] = true;
                                    region.push(q);
                                }
                                0 => {}
                                c => border |= 1 << c,
                            }
                        }
                        k += 1;
                    }
                    if border == 0b010 {
                        black += region.len();
                    } else if border == 0b100 {
                        white += region.len();
                    }
                }
                _ => {}
            }
        }
        (black as f64, white as f64 + self.komi)
    }
}
