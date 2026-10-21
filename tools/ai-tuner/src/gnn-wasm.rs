//! Separate v3 module; the deployed v2 ABI and binary remain independent.
mod ai; mod board; mod rng; mod gnn; mod mcts; mod tactics;
use std::cell::RefCell;
use board::{Game,Kind,Scratch,Topology};
use gnn::{ACTIONS,GLOBALS,CHANNELS,POINTS};

struct Engine {
    topology: Topology, sphere: bool, komi: f64, moves: Vec<i32>, search: mcts::Search,
    ids: Vec<u32>, x: Vec<f32>, globals: Vec<f32>, masks: Vec<f32>, legal: Vec<f32>, policy: Vec<f32>,
}
thread_local! {static ENGINE: RefCell<Option<Engine>>=const {RefCell::new(None)};}
fn restore<'a>(t:&'a Topology,komi:f64,moves:&[i32])->Option<(Game<'a>,Vec<Vec<i8>>)> {
    let mut game=Game::new(t,komi); let mut past=vec![]; let mut scratch=Scratch::new(t.len());
    for &m in moves {
        gnn::remember(&mut past,&game.board);
        if !(if m == -1 {game.pass()} else if m>=0 {game.play(m as usize,&mut scratch)} else {false}) {return None;}
    }
    Some((game,past))
}
#[no_mangle] pub extern "C" fn v3_version()->u32 {3}
#[no_mangle] pub extern "C" fn v3_set_endgame(enabled:u32)->i32 {
    ENGINE.with(|slot| {let mut slot=slot.borrow_mut();let Some(e)=slot.as_mut()else{return -2;};
        if enabled>1||!e.search.set_endgame(enabled!=0){-2}else{0}
    })
}
#[no_mangle] pub extern "C" fn v3_loss_margin()->f64 {
    ENGINE.with(|slot|slot.borrow().as_ref().map_or(0.,|e|e.search.loss_margin))
}
#[no_mangle] pub extern "C" fn v3_set_tactics(enabled:u32)->i32 {
    ENGINE.with(|slot| {let mut slot=slot.borrow_mut();let Some(e)=slot.as_mut()else{return -2;};
        if enabled>1||!e.search.set_tactics(enabled!=0){-2}else{0}
    })
}
#[no_mangle] pub extern "C" fn v3_avoided()->u32 {
    ENGINE.with(|slot|slot.borrow().as_ref().map_or(0,|e|e.search.avoided as u32))
}
#[no_mangle] pub extern "C" fn v3_alloc(words:usize)->*mut u32 {
    if words==0||words>1_000_000 {return std::ptr::null_mut();}
    Box::into_raw(vec![0u32;words].into_boxed_slice()) as *mut u32
}
#[no_mangle] pub unsafe extern "C" fn v3_free(ptr:*mut u32,words:usize) {
    drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr,words)));
}
#[no_mangle] pub unsafe extern "C" fn v3_start(kind:u32,size:usize,komi:f64,ptr:*const i32,len:usize,seed:u32)->i32 {
    ENGINE.with(|slot| {
        *slot.borrow_mut()=None;
        if ptr.is_null()||len>10000||!komi.is_finite()||!matches!((kind,size),(0,3..=5)|(1,7|9|11)) {return -2;}
        let moves=std::slice::from_raw_parts(ptr,len).to_vec();
        let topology=Topology::new(if kind==0 {Kind::Sphere}else{Kind::Torus},size);
        if restore(&topology,komi,&moves).is_none() {return -3;}
        *slot.borrow_mut()=Some(Engine {topology,sphere:kind==0,komi,moves,search:mcts::Search::new(seed as u64),
            ids:vec![],x:vec![],globals:vec![],masks:vec![],legal:vec![],policy:vec![0.;ACTIONS]});
        0
    })
}
#[no_mangle] pub extern "C" fn v3_collect(batch:usize)->i32 {
    ENGINE.with(|slot| {
        let mut slot=slot.borrow_mut(); let Some(e)=slot.as_mut() else{return -2;};
        if !(1..=8).contains(&batch)||!e.ids.is_empty() {return -2;}
        let (game,past)=restore(&e.topology,e.komi,&e.moves).unwrap();
        let leaves=e.search.collect(&game,&past,e.sphere,batch);
        e.x.clear();e.globals.clear();e.masks.clear();e.legal.clear();
        for leaf in leaves {
            e.ids.push(leaf.id);e.x.extend(leaf.features.x);e.globals.extend(leaf.features.global);
            e.masks.extend(leaf.features.mask);e.legal.extend(leaf.features.legal.iter().map(|&v|if v{1.}else{0.}));
        }
        debug_assert_eq!(e.x.len(),e.ids.len()*POINTS*CHANNELS);
        debug_assert_eq!(e.globals.len(),e.ids.len()*GLOBALS);
        e.ids.len() as i32
    })
}
#[no_mangle] pub extern "C" fn v3_buffer(kind:u32)->*const u8 {
    ENGINE.with(|slot| {let slot=slot.borrow();let Some(e)=slot.as_ref() else{return std::ptr::null();};
        match kind {0=>e.x.as_ptr() as _,1=>e.globals.as_ptr() as _,2=>e.masks.as_ptr() as _,
            3=>e.legal.as_ptr() as _,4=>e.ids.as_ptr() as _,5=>e.policy.as_ptr() as _,_=>std::ptr::null()}
    })
}
#[no_mangle] pub unsafe extern "C" fn v3_submit(ids:*const u32,eval:*const f32,count:usize)->i32 {
    ENGINE.with(|slot| {let mut slot=slot.borrow_mut();let Some(e)=slot.as_mut() else{return -2;};
        if ids.is_null()||eval.is_null()||count!=e.ids.len()||count>8 {return -2;}
        if e.search.submit(std::slice::from_raw_parts(ids,count),std::slice::from_raw_parts(eval,count*(ACTIONS+1))).is_err(){return -3;}
        e.ids.clear();0
    })
}
#[no_mangle] pub extern "C" fn v3_best()->i32 {
    ENGINE.with(|slot| {let mut slot=slot.borrow_mut();let Some(e)=slot.as_mut() else{return -2;};
        e.policy=e.search.policy();e.search.best()
    })
}
#[no_mangle] pub extern "C" fn v3_completed()->u32 {
    ENGINE.with(|slot|slot.borrow().as_ref().map_or(0,|e|e.search.completed))
}
#[no_mangle] pub extern "C" fn v3_cancel() {
    ENGINE.with(|slot| {if let Some(e)=slot.borrow_mut().as_mut(){e.search.cancel();e.ids.clear();}})
}
