//! Batched PUCT with path reservations. No transposition merging: superko is path-dependent.
use crate::board::{Game, Scratch};
use crate::gnn::{self, Features, ACTIONS, PASS};
use crate::rng::Rng;
use crate::{tactics,endgame};

const MAX_NODES: usize = 8192;
#[derive(Default)]
struct Node {
    visits: u32, sum: f32, reserved: u32, pending: bool, expanded: bool, edges: Vec<Edge>, proven: Option<f32>,
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
    fpu: u32,
    root_noise: bool,
    unvisited_selections: u32,
}
impl Search {
    pub fn new(seed: u64) -> Self {
        Self { nodes: vec![Node::default()], pending: vec![], next_id: 1, rng: Rng::new(seed), completed: 0, avoided: 0, loss_margin: 0., tactics: true, endgame: true, fpu: 0, root_noise: false, unvisited_selections: 0 }
    }
    pub fn set_fpu(&mut self, mode: u32, root_noise: bool) -> bool {
        if mode > 2 || self.completed != 0 || !self.pending.is_empty() { return false; }
        self.fpu = mode; self.root_noise = root_noise; true
    }
    fn unvisited_q(&self, p: usize) -> f32 {
        if self.fpu == 0 { return 0.; }
        let node = &self.nodes[p];
        let parent = node.sum / node.visits.max(1) as f32;
        if self.fpu == 1 || (p == 0 && self.root_noise) { return parent; }
        let mass: f32 = node.edges.iter().filter(|e|e.child.is_some_and(|c|self.nodes[c].visits>0)).map(|e|e.prior).sum();
        parent - 0.2 * mass.sqrt()
    }
    pub fn set_tactics(&mut self, enabled: bool) -> bool {
        if self.completed != 0 || !self.pending.is_empty() { return false; }
        self.tactics = enabled; true
    }
    pub fn set_endgame(&mut self, enabled: bool) -> bool {
        if self.completed != 0 || !self.pending.is_empty() { return false; }
        self.endgame = enabled; true
    }
    // Exact values use the node's player-to-move perspective. A single losing
    // child proves a win; proving a draw/loss requires resolving every action.
    fn prove(&mut self, p: usize) {
        if self.nodes[p].proven.is_some() || !self.nodes[p].expanded { return; }
        let edges = &self.nodes[p].edges;
        if edges.iter().any(|e| e.child.is_some_and(|c| self.nodes[c].proven == Some(-1.))) {
            self.nodes[p].proven = Some(1.);
        } else if !edges.is_empty() && edges.iter().all(|e| e.child.is_some_and(|c| self.nodes[c].proven.is_some())) {
            let value = edges.iter().map(|e| -self.nodes[e.child.unwrap()].proven.unwrap()).fold(-1., f32::max);
            self.nodes[p].proven = Some(value);
        }
    }
    fn viable(&self, p: usize, edge: &Edge) -> bool {
        // Spend remaining visits on moves that have not already been refuted.
        // If every move loses, keep them all so a legal policy still exists.
        edge.child.is_none_or(|c| self.nodes[c].proven != Some(1.)) ||
            self.nodes[p].edges.iter().all(|e| e.child.is_some_and(|c| self.nodes[c].proven == Some(1.)))
    }
    fn backup(&mut self, path: &[usize], mut value: f32, reserved: bool) {
        for &p in path.iter().rev() {
            let node = &mut self.nodes[p];
            if reserved { node.reserved -= 1; }
            node.visits += 1; node.sum += value;
            self.prove(p);
            value = -self.nodes[p].proven.unwrap_or(value);
        }
        self.completed += 1;
    }
    pub fn collect(&mut self, root: &Game, past: &[Vec<i8>], sphere: bool, batch: usize) -> Vec<Leaf> {
        self.collect_limited(root,past,sphere,batch,u32::MAX)
    }
    pub fn collect_limited(&mut self, root: &Game, past: &[Vec<i8>], sphere: bool, batch: usize, remaining: u32) -> Vec<Leaf> {
        assert!(self.pending.is_empty(), "submit or cancel the outstanding batch first");
        let mut leaves = vec![];
        let mut blocked = vec![false; MAX_NODES];
        if root.ended { return leaves; }
        let limit = self.completed.saturating_add(remaining);
        let mut scratch = Scratch::new(root.board.len());
        // Bounded CPU work, including runs that repeatedly reach terminal positions.
        for _ in 0..batch.clamp(1,8)*16 {
            // Pending neural evaluations and exact terminal backups both consume visits.
            if blocked[0] { break; }
            if leaves.len() == batch.clamp(1,8) || self.completed.saturating_add(self.pending.len() as u32) >= limit { break; }
            let mut game = root.clone(); let mut boards = past.to_vec();
            let mut path = vec![0];
            for _ in 0..256 {
                let p = *path.last().unwrap();
                if let Some(value) = self.nodes[p].proven {
                    self.backup(&path, value, false); break;
                }
                if game.ended {
                    let (b,w) = game.score();
                    let value = if b==w {0.} else if (b>w)==(game.turn==1) {1.} else {-1.};
                    self.nodes[p].proven = Some(value);
                    self.backup(&path, value, false); break;
                }
                // A winning second pass is an exact +1 for the player to move.
                // Resolve it inside the tree before asking the network: otherwise
                // an optimistic evaluation can make a losing first pass look safe.
                // Keep the root policy path so callers still receive its pass edge.
                if path.len() > 1 && endgame::wins_by_passing(&game) {
                    self.nodes[p].proven = Some(1.);
                    self.backup(&path, 1., false); break;
                }
                if self.nodes[p].pending { break; }
                if !self.nodes[p].expanded {
                    let features = gnn::encode(&game, &boards, sphere);
                    let mut legal = features.legal.clone();
                    if path.len() == 1 {
                        if endgame::wins_by_passing(&game) {
                            // The exact winning result takes priority over neural policy
                            // and value, even when optional endgame pruning is disabled.
                            legal.iter_mut().enumerate().for_each(|(a,v)|*v=a==PASS);
                        } else {
                            if self.tactics {
                                let avoided = tactics::avoid_isolated_invasions(&game, &legal);
                                self.avoided = avoided.len();
                                for p in avoided { legal[p] = false; }
                            }
                            if self.endgame {
                                self.loss_margin = endgame::proven_loss_margin(&game);
                                if self.loss_margin > 0. {
                                    // Stop futile continuations, including extensions of existing
                                    // dead groups. Re-evaluate the certificate on each real turn.
                                    legal.iter_mut().enumerate().for_each(|(a,v)|*v=a==PASS);
                                }
                            }
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
                let unvisited_q = self.unvisited_q(p);
                let mut best = None; let mut best_score = f32::NEG_INFINITY;
                for (k,e) in node.edges.iter().enumerate() {
                    if !self.viable(p,e) || e.child.is_some_and(|c| self.nodes[c].pending || blocked[c]) { continue; }
                    let (n,q) = e.child.map_or((0,unvisited_q), |c| {
                        let child = &self.nodes[c];
                        (child.visits + child.reserved, -child.sum / child.visits.max(1) as f32)
                    });
                    let score = q + 1.5 * e.prior * scale / (1+n) as f32;
                    if score > best_score { best = Some(k); best_score = score; }
                }
                let Some(best) = best else { blocked[p] = true; break; };
                let action = self.nodes[p].edges[best].action;
                if self.nodes[p].edges[best].child.is_none() { self.unvisited_selections += 1; }
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
        let winning = self.nodes[0].proven == Some(1.);
        for e in &self.nodes[0].edges {
            if self.viable(0,e) && (!winning || e.child.is_some_and(|c| self.nodes[c].proven == Some(-1.))) {
                result[e.action] = e.child.map_or(0.,|c|self.nodes[c].visits as f32);
            }
        }
        let total: f32 = result.iter().sum();
        if total>0. { for v in &mut result {*v/=total;} }
        else {
            let mass: f32 = self.nodes[0].edges.iter().filter(|e| self.viable(0,e)).map(|e|e.prior).sum();
            for e in &self.nodes[0].edges { if self.viable(0,e) {result[e.action]=e.prior/mass;} }
        }
        result
    }
    pub fn statistics(&self) -> Vec<f32> {
        let root = &self.nodes[0];
        let mut out = vec![0.; 3 + ACTIONS*3];
        out[0] = root.sum / root.visits.max(1) as f32;
        out[1] = self.unvisited_selections as f32; out[2] = root.visits as f32;
        for e in &root.edges {
            out[3+ACTIONS+e.action] = e.prior;
            if let Some(c) = e.child {
                let child = &self.nodes[c];
                out[3+e.action] = child.visits as f32;
                out[3+ACTIONS*2+e.action] = -child.proven.unwrap_or(child.sum / child.visits.max(1) as f32);
            }
        }
        out
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
    fn proofs_preserve_unknown_replies_and_prefer_wins_over_visit_counts() {
        for second in [None,Some(-1.),Some(0.),Some(1.)] {
            let mut s=Search::new(1);
            s.nodes[0].expanded=true;
            s.nodes.push(Node {visits:99, sum:-99., proven:Some(1.), ..Node::default()});
            s.nodes.push(Node {visits:1, sum:1., proven:second, ..Node::default()});
            s.nodes[0].edges=vec![Edge{action:PASS,prior:0.99,child:Some(1)},Edge{action:0,prior:0.01,child:Some(2)}];
            s.prove(0);
            assert_eq!(s.nodes[0].proven,second.map(|v|-v));
            let policy=s.policy();
            assert!((policy.iter().sum::<f32>()-1.).abs()<1e-6);
            if second!=Some(1.) {
                assert_eq!(s.best(),0,"a refuted pass must not beat an unknown move, draw or proven win");
                assert_eq!(policy[PASS],0.);
            } else {
                assert_eq!(s.nodes[0].proven,Some(-1.));
                assert!(policy[PASS]>0.,"retain a legal policy when every action loses");
            }
        }
        // The proof must cross several alternating player perspectives.
        let mut s=Search::new(2);
        for _ in 0..3 {s.nodes.push(Node::default());}
        for p in 0..3 {
            s.nodes[p].expanded=true;
            s.nodes[p].edges=vec![Edge{action:0,prior:1.,child:Some(p+1)}];
        }
        s.nodes[3].proven=Some(-1.);
        s.backup(&[0,1,2,3],-1.,false);
        assert_eq!(s.nodes.iter().map(|n|n.proven).collect::<Vec<_>>(),vec![Some(1.),Some(-1.),Some(1.),Some(-1.)]);
        assert_eq!(s.completed,1);
    }
    #[test]
    fn pending_leaf_does_not_block_other_available_evaluations() {
        let t=Topology::new(Kind::Torus,7);let g=Game::new(&t,6.5);
        let mut s=Search::new(3);assert!(s.set_fpu(1,false));
        let root=s.collect_limited(&g,&[],false,8,1);assert_eq!(root.len(),1);
        let mut eval=vec![-100.;ACTIONS+1];eval[0]=100.;eval[ACTIONS]=-1.;
        s.submit(&[root[0].id],&eval).unwrap();
        let batch=s.collect_limited(&g,&[],false,8,8);
        assert_eq!(batch.len(),8,"pending high-prior child must not prevent seven other legal leaves");
        let mut ids=batch.iter().map(|l|l.id).collect::<Vec<_>>();ids.sort();ids.dedup();assert_eq!(ids.len(),8);
        assert_eq!(s.nodes[0].reserved,8);
        s.cancel();assert!(s.nodes.iter().all(|n|n.reserved==0&&!n.pending));
    }
    #[test]
    fn visit_limit_counts_neural_leaves_and_exact_terminal_backups() {
        let t=Topology::new(Kind::Torus,7);let mut g=Game::new(&t,6.5);g.pass();
        for budget in [1,2,7,8,9,17,128,512] {
            let mut s=Search::new(3);let mut calls=0;
            while s.completed<budget {
                let leaves=s.collect_limited(&g,&[vec![0;49]],false,8,budget-s.completed);
                assert!(s.completed+leaves.len() as u32<=budget);
                let ids:Vec<_>=leaves.iter().map(|l|l.id).collect();
                let mut eval=vec![-10.;ids.len()*(ACTIONS+1)];
                for e in eval.chunks_exact_mut(ACTIONS+1) {e[PASS]=10.;e[ACTIONS]=0.;}
                if !ids.is_empty(){s.submit(&ids,&eval).unwrap();}
                calls+=1;assert!(calls<budget+10);
            }
            assert_eq!(s.completed,budget);
            assert!(s.nodes.iter().all(|n|n.reserved==0&&!n.pending));
            assert!(s.collect_limited(&g,&[],false,8,0).is_empty());assert_eq!(s.completed,budget);
        }
    }
    #[test]
    fn fpu_uses_parent_perspective_without_virtual_loss() {
        let mut s = Search::new(4);
        assert!(s.set_fpu(2,false));
        s.nodes[0].visits=2; s.nodes[0].sum=-1.4; s.nodes[0].reserved=99;
        s.nodes.push(Node {visits:1, ..Node::default()});
        s.nodes[0].edges.push(Edge {action:0, prior:0.25, child:Some(1)});
        assert!((s.unvisited_q(0)+0.8).abs()<1e-6);
        s.root_noise=true; assert!((s.unvisited_q(0)+0.7).abs()<1e-6);
        s.fpu=1; assert!((s.unvisited_q(0)+0.7).abs()<1e-6);
        s.fpu=0; assert_eq!(s.unvisited_q(0),0.);
        assert!(!s.set_fpu(3,false));
        s.completed=1; assert!(!s.set_fpu(1,false));
    }
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
