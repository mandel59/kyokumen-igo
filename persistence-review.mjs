// Independent fresh-realm reload checks. Run with node --experimental-vm-modules.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const base=new URL('./dist/',import.meta.url),html=readFileSync(new URL('index.html',base),'utf8');
const validIds=new Set([...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]));
const store=new Map();let unavailable=false;
async function boot(){
 const noop=()=>{},elements=new Map(),timers=new Map();let tid=0;
 const context2d=new Proxy({createRadialGradient:()=>({addColorStop:noop})},{get:(o,k)=>k in o?o[k]:noop,set:(o,k,v)=>(o[k]=v,true)});
 function el(id){assert(validIds.has(id),id);if(!elements.has(id)){
 const e={id,style:{},disabled:false,hidden:false,textContent:'',value:({opponent:'ai',humanColor:'1',size:'4',komi:'6.5'})[id]||'',selectedIndex:1,checked:false,events:{},classList:{toggle:noop},getContext:()=>context2d,getBoundingClientRect:()=>({width:340,height:355,left:0,top:0}),setAttribute:noop,setPointerCapture:noop,addEventListener(k,f){this.events[k]=f},showModal(){this.open=true},close(){this.open=false}};
 Object.defineProperty(e,'innerHTML',{set(v){this.html=v;this.value=v.includes('value="7"')?'9':'4'}});elements.set(id,e);}return elements.get(id);}
 const storage={getItem(k){if(unavailable)throw Error('denied');return store.get(k)??null},setItem(k,v){if(unavailable)throw Error('quota');store.set(k,String(v))},removeItem(k){if(unavailable)throw Error('denied');store.delete(k)}};
 const realm=vm.createContext({console,URL,document:{getElementById:el},window:{devicePixelRatio:1,localStorage:storage,addEventListener:noop},localStorage:storage,ResizeObserver:class{constructor(f){this.f=f}observe(){this.f()}},confirm:()=>true,setTimeout:(f)=>{timers.set(++tid,f);return tid},clearTimeout:id=>timers.delete(id)});
 const cache=new Map();async function mod(url){const path=fileURLToPath(url);if(cache.has(path))return cache.get(path);const m=new vm.SourceTextModule(readFileSync(path,'utf8'),{context:realm,identifier:url.href,initializeImportMeta(meta){meta.url=url.href}});cache.set(path,m);await m.link((s,p)=>mod(new URL(s,p.identifier)));return m;}
 const app=await mod(new URL('app.js',base));await app.evaluate();
 return {el,timers,async tick(){const ts=[...timers.values()];timers.clear();for(const f of ts)f();await Promise.resolve()},moves:()=>Number(el('moveCount').textContent.split(' ')[0]),saved:()=>JSON.parse([...store.values()][0])};
}
function human(a){a.el('opponent').value='human';a.el('newGame').onclick()}
function play(a){a.el('board').events.keydown({key:'Enter',preventDefault(){}})}
let a=await boot();human(a);play(a);assert.equal(a.moves(),1);const snapshot=JSON.stringify([...store]);let b=await boot();assert.equal(b.moves(),1,'reload retains move');assert.equal(b.el('opponent').value,'human');assert.equal(JSON.stringify([...store]),snapshot,'restore does not mutate persisted state');
b.el('pass').onclick();b.el('pass').onclick();assert.equal(b.moves(),3);assert.match(b.el('status').textContent,/終局/);let c=await boot();assert.match(c.el('status').textContent,/終局/);assert.equal(c.el('pass').disabled,true);c.el('undo').onclick();assert.equal(c.moves(),2);assert.equal(c.el('pass').disabled,false);let d=await boot();assert.equal(d.moves(),2);d.el('undo').onclick();assert.equal(d.moves(),1);d.el('undo').onclick();assert.equal(d.moves(),0,'all prior history survives reload');
// Unsaved settings must not replace active game settings when a move is saved.
human(d);d.el('settingsOpen').onclick();d.el('opponent').value='ai';d.el('humanColor').value='2';d.el('komi').value='9.5';d.el('settingsClose').onclick();play(d);let e=await boot();assert.equal(e.el('opponent').value,'human');assert.equal(e.el('komi').value,'6.5');assert.equal(e.moves(),1);
// AI pending at reload resumes once, with no duplicated response.
e.el('opponent').value='ai';e.el('humanColor').value='1';e.el('newGame').onclick();play(e);assert.equal(e.moves(),1);let f=await boot();assert.equal(f.moves(),1);assert.equal(f.timers.size,1);await f.tick();assert.equal(f.moves(),2);await f.tick();assert.equal(f.moves(),2);let g=await boot();assert.equal(g.moves(),2);assert.equal(g.timers.size,0);
// Reset replaces persisted game, including kind and selected size.
g.el('torusTab').onclick();let h=await boot();assert.equal(h.moves(),0);assert.equal(h.el('topologyName').textContent,'トーラス盤');assert.equal(h.el('size').value,'9');
const good=[...store];for(const [key] of store)store.set(key,'{');let i=await boot();assert.equal(i.moves(),0,'corrupt storage safely falls back');
store.clear();for(const [k,v]of good)store.set(k,v);unavailable=true;let j=await boot();human(j);play(j);assert.equal(j.moves(),1,'storage errors do not break play');unavailable=false;
console.log('Independent fresh-realm persistence review passed: restore, end/undo/history, unsaved settings, AI resume once, reset, corrupt/blocked storage.');
const {Game,createTopology}=await import('./dist/engine.js');
const {saveGame,loadSavedGame,restoreSnapshot,STORAGE_KEY}=await import('./dist/persistence.js');
const memory={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};
const ko=new Game(createTopology('torus',7),.5);for(const point of [17,24,31,18,23,32,0,26,25])assert.equal(ko.play(point).ok,true);
assert.equal(saveGame(ko,{opponent:'human',human:1},{mapView:true,rotX:.2,rotY:-2},memory),true);
const loaded=loadSavedGame(memory).state;assert.equal(loaded.game.play(24).reason,'superko');assert.deepEqual(loaded.game.toJSON(),ko.toJSON());assert.equal(loaded.game.undo(),true);assert.equal(loaded.game.play(25).ok,true);
const k=await boot();assert.equal(k.moves(),9);assert.equal(k.el('komi').value,'0.5');assert.equal(k.el('size').value,'7');assert.equal(k.el('mapSection').hidden,false);assert.equal(k.el('surfaceSection').hidden,true);
const saved=JSON.parse(store.get(STORAGE_KEY));for(const mutation of [v=>v.version=9,v=>v.game.history.at(-1).captures[2]++,v=>v.game.history.at(-1).board[0]=2,v=>v.settings.opponent='unknown',v=>v.view.rotX=null]){const bad=structuredClone(saved);mutation(bad);assert.throws(()=>restoreSnapshot(bad));}
// Reset while AI work is pending cancels the old response.
k.el('opponent').value='ai';k.el('humanColor').value='2';k.el('newGame').onclick();assert.equal(k.timers.size,1);human(k);await k.tick();assert.equal(k.moves(),0);const l=await boot();assert.equal(l.moves(),0);assert.equal(l.el('opponent').value,'human');
console.log('Additional independent checks passed: legal ko history survives reload, captures/history equality, view/size/komi restore, corrupt schema rejection, pending AI reset cancellation.');
