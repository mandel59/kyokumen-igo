//! Batched PUCT with path reservations. No transposition merging: superko is path-dependent.
use crate::board::{Game, Scratch};
use crate::gnn::{self, Features, ACTIONS, PASS};
use crate::rng::Rng;
use crate::tactics;

const MAX_NODES: usize = 8192;
#[derive(Default)]
struct Node {
    visits: u32, sum: f32, reserved: u32, pending: bool, expanded: bool, edges: Vec<Edge>,
}
struct Edge { action: usize, prior: f32, child: Option<usize> }
struct Pending { id: u32, path: Vec<usize>, legal: Vec<bool> }
pub struct Leaf { pub id: u32, pub features: Features }
pub struct Search {
    nodes: Vec<Node>, pending: Vec<Pending>, next_id: u32, rng: Rng,
    pub completed: u32,
    pub avoided: usize,
    pub loss_margin: f64,
    tactics: bool,
    endgame: bool,
}
impl Search {
    pub fn new(seed: u64) -> Self {
        Self { nodes: vec![Node::default()], pending: vec![], next_id: 1, rng: Rng::new(seed), completed: 0, avoided: 0, loss_margin: 0., tactics: true, endgame: true }
    }
    pub fn set_tactics(&mut self, enabled: bool) -> bool {
        if self.completed != 0 || !self.pending.is_empty() { return false; }
        self.tactics = enabled; true
    }
    pub fn set_endgame(&mut self, enabled: bool) -> bool {
        if self.completed != 0 || !self.pending.is_empty() { return false; }
        self.endgame = enabled; true
    }
    fn backup(&mut self, path: &[usize], mut value: f32, reserved: bool) {
        for &p in path.iter().rev() {
            let node = &mut self.nodes[p];
            if reserved { node.reserved -= 1; }
            node.visits += 1; node.sum += value; value = -value;
        }
        self.completed += 1;
    }
    pub fn collect(&mut self, root: &Game, past: &[Vec<i8>], sphere: bool, batch: usize) -> Vec<Leaf> {
        assert!(self.pending.is_empty(), "submit or cancel the outstanding batch first");
        let mut leaves = vec![];
        if root.ended { return leaves; }
        let mut scratch = Scratch::new(root.board.len());
        // Bounded CPU work, including runs that repeatedly reach terminal positions.
        for _ in 0..batch.clamp(1,8)*16 {
            if leaves.len() == batch.clamp(1,8) { break; }
            let mut game = root.clone(); let mut boards = past.to_vec();
            let mut path = vec![0];
            for _ in 0..256 {
                let p = *path.last().unwrap();
                if game.ended {
                    let (b,w) = game.score();
                    let value = if b==w {0.} else if (b>w)==(game.turn==1) {1.} else {-1.};
                    self.backup(&path, value, false); break;
                }
                if self.nodes[p].pending { break; }
                if !self.nodes[p].expanded {
                    let features = gnn::encode(&game, &boards, sphere);
                    let mut legal = features.legal.clone();
                    if self.tactics && path.len() == 1 {
                        let avoided = tactics::avoid_isolated_invasions(&game, &legal);
                        self.avoided = avoided.len();
                        for p in avoided { legal[p] = false; }
                    }
                    if self.endgame && path.len() == 1 {
                        self.loss_margin = tactics::proven_loss_margin(&game);
                        if self.loss_margin > 0. {
                            // Stop futile continuations, including extensions of existing
                            // dead groups. Re-evaluate the certificate on each real turn.
                            legal.iter_mut().enumerate().for_each(|(a,v)|*v=a==PASS);
                        }
                    }
                    let id = self.next_id; self.next_id += 1;
                    for &q in &path { self.nodes[q].reserved += 1; }
                    self.nodes[p].pending = true;
                    self.pending.push(Pending {id, path, legal});
                    leaves.push(Leaf {id, features}); break;
                }
                let node = &self.nodes[p];
                let scale = ((node.visits + node.reserved + 1) as f32).sqrt();
                let mut best = 0; let mut best_score = f32::NEG_INFINITY;
                for (k,e) in node.edges.iter().enumerate() {
                    let (n,q) = e.child.map_or((0,0.), |c| {
                        let child = &self.nodes[c];
                        (child.visits + child.reserved, -(child.sum + child.reserved as f32) / (child.visits + child.reserved).max(1) as f32)
                    });
                    let score = q + 1.5 * e.prior * scale / (1+n) as f32;
                    if score > best_score { best = k; best_score = score; }
                }
                let action = self.nodes[p].edges[best].action;
                gnn::remember(&mut boards, &game.board);
                assert!(if action == PASS {game.pass()} else {game.play(action, &mut scratch)});
                let child = match self.nodes[p].edges[best].child {
                    Some(c) => c,
                    None => {
                        if self.nodes.len() >= MAX_NODES { break; }
                        let c = self.nodes.len(); self.nodes.push(Node::default());
                        self.nodes[p].edges[best].child = Some(c); c
                    }
                };
                path.push(child);
            }
        }
        leaves
    }
    pub fn submit(&mut self, ids: &[u32], evaluations: &[f32]) -> Result<(), &'static str> {
        if ids.len()!=self.pending.len() || evaluations.len()!=ids.len()*(ACTIONS+1)
            || ids.iter().zip(&self.pending).any(|(&a,b)|a!=b.id)
            || evaluations.iter().any(|v|!v.is_finite())
            || evaluations.chunks_exact(ACTIONS+1).any(|e|e[ACTIONS].abs()>1.00001) {
            return Err("Invalid or stale v3 evaluations");
        }
        for (pending,eval) in std::mem::take(&mut self.pending).into_iter().zip(evaluations.chunks_exact(ACTIONS+1)) {
            let count = pending.legal.iter().filter(|&&v|v).count();
            let max = eval[..ACTIONS].iter().zip(&pending.legal).filter(|(_,l)|**l).map(|(&v,_)|v).fold(f32::NEG_INFINITY,f32::max);
            let total: f32 = eval[..ACTIONS].iter().zip(&pending.legal).filter(|(_,l)|**l).map(|(&v,_)|(v-max).exp()).sum();
            let mut edges: Vec<Edge> = pending.legal.iter().enumerate().filter(|(_,l)|**l).map(|(a,_)| {
                Edge {action:a, prior:0.98*(eval[a]-max).exp()/total + 0.02/count as f32, child:None}
            }).collect();
            // Seeded tie-breaking without vertex-number preference on symmetric openings.
            for k in (1..edges.len()).rev() { let j = (self.rng.next_u64() % (k+1) as u64) as usize; edges.swap(k,j); }
            let leaf = *pending.path.last().unwrap();
            self.nodes[leaf].pending = false; self.nodes[leaf].expanded = true; self.nodes[leaf].edges = edges;
            self.backup(&pending.path, eval[ACTIONS].clamp(-1.,1.), true);
        }
        Ok(())
    }
    pub fn cancel(&mut self) {
        for pending in std::mem::take(&mut self.pending) {
            for p in pending.path { self.nodes[p].reserved -= 1; self.nodes[p].pending = false; }
        }
    }
    pub fn policy(&self) -> Vec<f32> {
        let mut result = vec![0.; ACTIONS];
        for e in &self.nodes[0].edges { result[e.action] = e.child.map_or(0.,|c|self.nodes[c].visits as f32); }
        let total: f32 = result.iter().sum();
        if total>0. { for v in &mut result {*v/=total;} }
        else { for e in &self.nodes[0].edges {result[e.action]=e.prior;} }
        result
    }
    pub fn best(&self) -> i32 {
        let policy = self.policy();
        let action = self.nodes[0].edges.iter().max_by(|a,b|policy[a.action].total_cmp(&policy[b.action])).map_or(PASS,|e|e.action);
        if action==PASS {-1} else {action as i32}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::board::{Topology,Kind};
    #[test]
    fn reservations_validation_and_exact_terminal_signs() {
        for komi in [-6.5,0.,6.5] {
            let t=Topology::new(Kind::Torus,7); let mut g=Game::new(&t,komi); g.pass();
            let mut s=Search::new(3);
            for _ in 0..40 {
                let leaves=s.collect(&g,&[vec![0;49]],false,8);
                let ids:Vec<_>=leaves.iter().map(|l|l.id).collect();
                let mut eval=vec![-10.;ids.len()*(ACTIONS+1)];
                for e in eval.chunks_exact_mut(ACTIONS+1) {e[PASS]=10.; e[ACTIONS]=0.;}
                if !ids.is_empty() {
                    let mut bad=eval.clone(); bad[0]=f32::NAN;
                    assert!(s.submit(&ids,&bad).is_err());
                    assert!(s.submit(&ids,&eval).is_ok());
                }
            }
            assert!(s.nodes.iter().all(|n|n.reserved==0&&!n.pending));
            if komi>0. {assert_eq!(s.best(),-1);}
            if komi<0. {assert_ne!(s.best(),-1);}
            let leaves=s.collect(&g,&[],false,8); s.cancel();
            assert!(s.submit(&leaves.iter().map(|l|l.id).collect::<Vec<_>>(),&[]).is_err() || leaves.is_empty());
            assert!(s.nodes.iter().all(|n|n.reserved==0));
        }
    }
}
