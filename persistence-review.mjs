// Independent fresh-realm reload checks. Run with node --experimental-vm-modules.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const base=new URL('./dist/',import.meta.url),html=readFileSync(new URL('index.html',base),'utf8');
const validIds=new Set([...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]));
const store=new Map();let unavailable=false;
async function boot(){
 const noop=()=>{},elements=new Map(),timers=new Map();let tid=0,confirmAllowed=true;
 const context2d=new Proxy({createRadialGradient:()=>({addColorStop:noop})},{get:(o,k)=>k in o?o[k]:noop,set:(o,k,v)=>(o[k]=v,true)});
 function el(id){assert(validIds.has(id),id);if(!elements.has(id)){
 const e={id,style:{},disabled:false,hidden:false,textContent:'',value:({boardKind:'sphere',opponent:'ai',humanColor:'1',size:'4',komi:'6.5'})[id]||'',selectedIndex:1,checked:false,events:{},classList:{toggle:noop},getContext:()=>context2d,getBoundingClientRect:()=>({width:340,height:355,left:0,top:0}),setAttribute:noop,setPointerCapture:noop,addEventListener(k,f){this.events[k]=f},showModal(){this.open=true},close(){this.open=false}};
 if(id==='size'){let options=['3','4','5'],value='4';Object.defineProperty(e,'value',{get:()=>value,set:v=>value=String(v)});Object.defineProperty(e,'selectedIndex',{get:()=>options.indexOf(value),set:i=>value=options[i]??''});Object.defineProperty(e,'innerHTML',{set(v){this.html=v;options=[...v.matchAll(/value="([^"]+)"/g)].map(m=>m[1]);value=options[0]??''}});}elements.set(id,e);}return elements.get(id);}
 const storage={getItem(k){if(unavailable)throw Error('denied');return store.get(k)??null},setItem(k,v){if(unavailable)throw Error('quota');store.set(k,String(v))},removeItem(k){if(unavailable)throw Error('denied');store.delete(k)}};
 const realm=vm.createContext({console,URL,document:{getElementById:el},window:{devicePixelRatio:1,localStorage:storage,addEventListener:noop},localStorage:storage,ResizeObserver:class{constructor(f){this.f=f}observe(){this.f()}},confirm:()=>confirmAllowed,setTimeout:(f)=>{timers.set(++tid,f);return tid},clearTimeout:id=>timers.delete(id)});
 const cache=new Map();async function mod(url){const path=fileURLToPath(url);if(cache.has(path))return cache.get(path);const m=new vm.SourceTextModule(readFileSync(path,'utf8'),{context:realm,identifier:url.href,initializeImportMeta(meta){meta.url=url.href}});cache.set(path,m);await m.link((s,p)=>mod(new URL(s,p.identifier)));return m;}
 const app=await mod(new URL('app.js',base));await app.evaluate();
 return {el,timers,setConfirm:value=>confirmAllowed=value,async tick(){const ts=[...timers.values()];timers.clear();for(const f of ts)f();await Promise.resolve()},moves:()=>Number(el('moveCount').textContent.split(' ')[0]),saved:()=>JSON.parse([...store.values()][0])};
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
// Board-kind drafts are isolated from the live game and its persisted state.
store.clear();const m=await boot();human(m);play(m);const beforeDraft=store.get(STORAGE_KEY);
m.el('settingsOpen').onclick();assert.equal(m.el('boardKind').value,'sphere');
for(const [sphereSize,torusSize] of [['3','7'],['4','9'],['5','11']]){
 m.el('size').value=sphereSize;m.el('boardKind').value='torus';m.el('boardKind').onchange();assert.equal(m.el('size').value,torusSize,'size ordinal maps sphere to torus');
 m.el('boardKind').value='sphere';m.el('boardKind').onchange();assert.equal(m.el('size').value,sphereSize,'size ordinal maps torus to sphere');
}
m.el('boardKind').value='torus';m.el('boardKind').onchange();m.el('opponent').value='ai';m.el('humanColor').value='2';m.el('komi').value='9.5';
assert.equal(m.el('topologyName').textContent,'球面盤');assert.equal(m.moves(),1);assert.equal(store.get(STORAGE_KEY),beforeDraft,'editing draft does not save');
m.setConfirm(false);m.el('newGame').onclick();assert.equal(m.el('settingsDialog').open,true);assert.equal(m.el('topologyName').textContent,'球面盤');assert.equal(m.moves(),1);assert.equal(store.get(STORAGE_KEY),beforeDraft,'cancel reset leaves original save intact');
const n=await boot();assert.equal(n.el('boardKind').value,'sphere');assert.equal(n.el('size').value,'4');assert.equal(n.el('opponent').value,'human');assert.equal(n.el('komi').value,'6.5');assert.equal(n.moves(),1,'reload disregards drafts');
m.el('settingsClose').onclick();m.el('settingsOpen').onclick();assert.equal(m.el('boardKind').value,'sphere');assert.equal(m.el('size').value,'4');assert.equal(m.el('opponent').value,'human');assert.equal(m.el('komi').value,'6.5');
m.el('boardKind').value='torus';m.el('boardKind').onchange();m.el('size').value='11';m.setConfirm(true);m.el('newGame').onclick();assert.equal(m.el('settingsDialog').open,false);assert.equal(m.el('topologyName').textContent,'トーラス盤');assert.equal(m.moves(),0);assert.equal(m.el('nodeCount').textContent,'121 INTERSECTIONS · NO EDGES');
const o=await boot();assert.equal(o.el('boardKind').value,'torus');assert.equal(o.el('size').value,'11');assert.equal(o.el('opponent').value,'human');assert.equal(o.moves(),0);
// Escape/cancel then reopening also discards draft topology and sizes.
o.el('settingsOpen').onclick();o.el('boardKind').value='sphere';o.el('boardKind').onchange();o.el('size').value='3';const cancel=o.el('settingsDialog').events.cancel??o.el('settingsDialog').oncancel;if(cancel)cancel({preventDefault(){}});o.el('settingsDialog').close();o.el('settingsOpen').onclick();assert.equal(o.el('boardKind').value,'torus');assert.equal(o.el('size').value,'11');
console.log('Independent board-kind review passed: ordinal size mapping, isolated drafts, rejected reset, close/Escape reopen, confirmed start and fresh-context reload.');
// An AI response while the dialog is open saves only the live topology/settings.
store.clear();const q=await boot();play(q);q.el('settingsOpen').onclick();q.el('boardKind').value='torus';q.el('boardKind').onchange();q.el('size').value='11';q.el('komi').value='0.5';await q.tick();assert.equal(q.moves(),2);const r=await boot();assert.equal(r.el('topologyName').textContent,'球面盤');assert.equal(r.el('size').value,'4');assert.equal(r.el('komi').value,'6.5');assert.equal(r.moves(),2);
// Existing top-level topology tabs also ignore stale drafts and preserve actual options.
q.el('settingsClose').onclick();q.el('torusTab').onclick();assert.equal(q.el('size').value,'9');assert.equal(q.el('komi').value,'6.5');assert.equal(q.moves(),0);q.el('board').events.keydown({key:'Enter',preventDefault(){}});q.setConfirm(false);const liveBeforeTab=store.get(STORAGE_KEY);q.el('sphereTab').onclick();assert.equal(q.el('topologyName').textContent,'トーラス盤');assert.equal(store.get(STORAGE_KEY),liveBeforeTab);
console.log('AI-during-draft and existing topology-tab isolation checks passed.');
