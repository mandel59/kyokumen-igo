import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('./dist/index.html',import.meta.url),'utf8'),css=readFileSync(new URL('./dist/style.css',import.meta.url),'utf8');const validIds=new Set([...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]));
let painted=null,paintCount=0;
const noop=()=>{};const context=new Proxy({createImageData:(width,height)=>({width,height,data:new Uint8ClampedArray(width*height*4)}),putImageData:image=>{painted=image;paintCount++;},createRadialGradient:()=>({addColorStop:noop})},{get:(o,k)=>k in o?o[k]:noop,set:(o,k,v)=>(o[k]=v,true)});
const viewport={width:Number(process.env.UI_WIDTH||360),height:Number(process.env.UI_HEIGHT||640)};const landscape=viewport.width>viewport.height&&viewport.height<540;const boardWidth=viewport.width-(landscape?218:20);const boardHeight=viewport.height-(landscape?132:285);
const elements=new Map();function el(id){assert.ok(validIds.has(id),'DOM ID exists: '+id);if(!elements.has(id)){const e={id,style:{},disabled:false,hidden:false,textContent:'',value:({boardKind:'sphere',opponent:'ai',humanColor:'1',size:'4',komi:'6.5'})[id]||'',selectedIndex:1,checked:false,events:{},classList:{toggle:noop},getContext:()=>context,getBoundingClientRect:()=>({width:boardWidth,height:boardHeight,left:0,top:0}),setAttribute:noop,setPointerCapture:noop,addEventListener(k,f){this.events[k]=f;},showModal(){this.open=true;},close(){this.open=false;},focus(){document.activeElement=this;}};Object.defineProperty(e,'innerHTML',{set(v){this.html=v;this.value=v.includes('value="7"')?'9':'4';}});elements.set(id,e);}return elements.get(id);}
globalThis.document={getElementById:el};globalThis.window={devicePixelRatio:Number(process.env.UI_DPR||1)};globalThis.ResizeObserver=class{constructor(f){this.f=f}observe(){this.f()}};globalThis.confirm=()=>true;
await import('./dist/app.js');
assert.equal(el('moveCount').textContent,'0 手');assert.equal(el('topologyName').textContent,'球面盤');assert.equal(el('nodeCount').textContent,'98 INTERSECTIONS · NO EDGES');
assert.doesNotMatch(el('status').textContent,/盤の裏側|黒から始め|両方の図から|展開図から/);

const expectedRatio=Math.min(Math.max(1.5,window.devicePixelRatio),3,Math.sqrt(3000000/(boardWidth*boardHeight)));
assert.equal(el('board').width,Math.round(boardWidth*expectedRatio));
assert.equal(el('board').height,Math.round(boardHeight*expectedRatio));
assert.ok(painted?.data.some((value,index)=>index%4===3&&value===255),'software framebuffer reaches canvas');
// Pointer input uses the rendered fragment/visible-intersection picker.
const {renderSurface}=await import('./dist/surface-renderer.js');
const {createTopology:makeTopology}=await import('./dist/engine.js');
const initialFrame=renderSurface({topology:makeTopology('sphere',4),board:new Int8Array(98),width:boardWidth,height:boardHeight});
const clickable=initialFrame.points.find(p=>p.visible&&initialFrame.pick(p.x,p.y)===p.i);
const pointer={currentTarget:el('board'),pointerId:1,clientX:clickable.x,clientY:clickable.y};
el('board').events.pointerdown(pointer);el('board').events.pointerup(pointer);
assert.equal(el('moveCount').textContent,'1 手');el('undo').onclick();
// Spherical global map: every original point has a clickable projected position.
const {sphereProjection}=await import('./dist/sphere-projection.js');
const {createTopology}=await import('./dist/engine.js');
assert.equal(el('viewToggle').hidden,false);assert.equal(el('viewToggle').textContent,'全球図');
el('viewToggle').onclick();assert.equal(el('mapSection').hidden,false);assert.equal(el('surfaceSection').hidden,true);
const layout=sphereProjection(createTopology('sphere',4),boardWidth,boardHeight);
el('inspect').checked=true;el('inspect').onchange();
const repeated=layout.points.find(p=>layout.points.filter(q=>q.i===p.i).length===2);
assert.ok(repeated,'equator points appear in both projections');
el('map').events.click({currentTarget:el('map'),clientX:repeated.x,clientY:repeated.y});
assert.match(el('boardHint').textContent,new RegExp('交点 '+(repeated.i+1)+' · 隣接'));
assert.doesNotMatch(el('boardHint').textContent,/裏側/);
el('inspect').checked=false;el('inspect').onchange();
el('map').events.click({currentTarget:el('map'),clientX:repeated.x,clientY:repeated.y});
assert.equal(el('moveCount').textContent,'1 手');
el('viewToggle').onclick();assert.equal(el('mapSection').hidden,true);assert.equal(el('moveCount').textContent,'1 手');
el('undo').onclick();assert.equal(el('moveCount').textContent,'0 手');
el('viewToggle').onclick();el('map').events.keydown({key:'ArrowRight',preventDefault:noop});el('map').events.keydown({key:'Enter',preventDefault:noop});
assert.equal(el('moveCount').textContent,'1 手');el('undo').onclick();el('viewToggle').onclick();
el('board').events.keydown({key:'Enter',preventDefault:noop});assert.equal(el('moveCount').textContent,'1 手');assert.equal(el('turnText').textContent,'AI が考えています');
await new Promise(r=>setTimeout(r,550));assert.equal(el('moveCount').textContent,'2 手');assert.equal(el('turnText').textContent,'あなたの番です');el('undo').onclick();assert.equal(el('moveCount').textContent,'0 手');
el('torusTab').onclick();assert.equal(el('topologyName').textContent,'トーラス盤');assert.equal(el('mapSection').hidden,true);assert.equal(el('viewToggle').hidden,false);el('viewToggle').onclick();assert.equal(el('mapSection').hidden,false);assert.equal(el('surfaceSection').hidden,true);el('map').events.keydown({key:'Enter',preventDefault:noop});await new Promise(r=>setTimeout(r,550));assert.equal(el('moveCount').textContent,'2 手');el('viewToggle').onclick();assert.equal(el('mapSection').hidden,true);assert.equal(el('surfaceSection').hidden,false);assert.equal(el('nodeCount').textContent,'81 INTERSECTIONS · NO EDGES');
el('settingsOpen').onclick();assert.equal(el('settingsDialog').open,true);el('opponent').value='human';el('newGame').onclick();assert.equal(el('settingsDialog').open,false);el('pass').onclick();el('pass').onclick();assert.match(el('status').textContent,/終局/);assert.equal(el('pass').disabled,true);el('undo').onclick();assert.equal(el('pass').disabled,false);
el('rulesOpen').onclick();assert.equal(el('rulesDialog').open,true);el('rulesClose').onclick();assert.equal(el('rulesDialog').open,false);
el('opponent').value='ai';el('humanColor').value='2';el('newGame').onclick();assert.equal(el('turnText').textContent,'AI が考えています');el('sphereTab').onclick();await new Promise(r=>setTimeout(r,550));assert.equal(el('moveCount').textContent,'1 手');assert.equal(el('turnText').textContent,'あなたの番です');
// Board-kind changes in the dialog are drafts until the new-game confirmation.
el('settingsOpen').onclick();
assert.equal(el('boardKind').value,'sphere');
el('boardKind').value='torus';el('boardKind').onchange();
assert.match(el('size').html,/value="9"/);
assert.equal(el('topologyName').textContent,'球面盤');
assert.equal(el('moveCount').textContent,'1 手');
el('settingsClose').onclick();
el('settingsOpen').onclick();
assert.equal(el('boardKind').value,'sphere');
assert.equal(el('size').value,'4');
el('boardKind').value='torus';el('boardKind').onchange();
el('opponent').value='human';
globalThis.confirm=()=>false;
el('newGame').onclick();
assert.equal(el('topologyName').textContent,'球面盤');
assert.equal(el('settingsDialog').open,true);
globalThis.confirm=()=>true;
el('newGame').onclick();
assert.equal(el('topologyName').textContent,'トーラス盤');
assert.equal(el('nodeCount').textContent,'81 INTERSECTIONS · NO EDGES');
assert.equal(el('moveCount').textContent,'0 手');
el('settingsOpen').onclick();
assert.equal(el('boardKind').value,'torus');
el('boardKind').value='sphere';el('boardKind').onchange();
el('settingsDialog').events.cancel();
assert.equal(el('boardKind').value,'torus');
assert.equal(el('size').value,'9');
// Drag frames coalesce, but pointerup flushes the final full-resolution camera.
const frames=[];globalThis.requestAnimationFrame=f=>{frames.push(f);};
const event={currentTarget:el('board'),pointerId:2,clientX:120,clientY:100};
el('board').events.pointerdown(event);
el('board').events.pointermove({...event,clientX:145,clientY:110});
el('board').events.pointermove({...event,clientX:170,clientY:120});
assert.equal(frames.length,1,'drag events coalesce into one scheduled frame');
frames.shift()();
assert.ok(el('board').width<Math.round(boardWidth*expectedRatio),'drag uses temporary low resolution');
el('board').events.pointermove({...event,clientX:180,clientY:125});
const beforeRelease=paintCount;
el('board').events.pointerup({...event,clientX:170,clientY:120});
assert.ok(paintCount>beforeRelease,'release flushes final frame without awaiting RAF');
assert.equal(el('board').width,Math.round(boardWidth*expectedRatio),'release restores high-DPI resolution');
const finalPixels=painted.data.slice();frames.shift()();
assert.deepEqual(painted.data,finalPixels,'queued frame cannot revert released camera');
// Information dialog is read-only: repeated opens/dismissals leave board, view and settings alone.
assert.match(html,/<dialog id="aboutDialog" aria-labelledby="aboutTitle">/);
assert.match(html,/<button id="aboutOpen"[^>]*aria-haspopup="dialog"[^>]*aria-controls="aboutDialog"/);
assert.match(html,/<button id="aboutClose"[^>]*autofocus/);
assert.match(html,/<a href="https:\/\/github.com\/mandel59\/kyokumen-igo" target="_blank" rel="noopener noreferrer">/);
const infoState=()=>JSON.stringify(['moveCount','topologyName','turnText','status','komiLabel','boardHint'].map(id=>el(id).textContent).concat(['opponent','humanColor','boardKind','size','komi'].map(id=>el(id).value),el('mapSection').hidden,el('surfaceSection').hidden));
const beforeInfo=infoState(),beforeInfoPaints=paintCount,beforeInfoPixels=painted.data.slice();
for(const closeId of ['aboutClose','aboutDone','aboutClose']){
 el('aboutOpen').onclick();assert.equal(el('aboutDialog').open,true);
 el('aboutOpen').onclick();assert.equal(el('aboutDialog').open,true);
 el(closeId).onclick();assert.equal(el('aboutDialog').open,false);
 assert.equal(infoState(),beforeInfo);assert.equal(paintCount,beforeInfoPaints);assert.deepEqual(painted.data,beforeInfoPixels);
}
// Escape is native dialog behavior; no cancellation override blocks it.
assert.equal(el('aboutDialog').events.cancel,undefined);
el('aboutOpen').onclick();el('aboutDialog').close();el('aboutOpen').onclick();el('aboutDone').onclick();
assert.equal(infoState(),beforeInfo);
// Tutorial is five one-idea pages, each with a figure, bounded navigation and a read-only live game.
assert.match(html,/<dialog id="rulesDialog" aria-labelledby="rulesTitle">/);
assert.match(html,/<details class="about-details"><summary>詳細ルールと得点<\/summary>/);
const tutorialHTML=html.slice(html.indexOf('<dialog id="rulesDialog"'),html.indexOf('<dialog id="aboutDialog"'));
assert.doesNotMatch(tutorialHTML,/スーパーコウ|正距方位|ニューラル|標準/);
assert.match(html.slice(html.indexOf('<dialog id="aboutDialog"')),/位置的スーパーコウ/);
const tutorialPages=[...tutorialHTML.matchAll(/<section id="rulesStep\d"[\s\S]*?<\/section>/g)].map(m=>m[0]);
assert.equal(tutorialPages.length,5);
for(const page of tutorialPages){
 assert.equal(page.match(/<svg class="tutorial-figure" viewBox="0 0 300 132" aria-hidden="true">/g)?.length,1,'one same-sized figure per page');
 assert.doesNotMatch(page,/\shidden[\s>]/,'pages are never removed from layout');
}
// Size stability: pages share one grid cell and inactive ones are inert and invisible, so paging cannot resize the dialog.
assert.match(css,/\.tutorial-step\{grid-area:1\/1/);
assert.match(css,/\.tutorial-step\[inert\]\{visibility:hidden\}/);
const checkPage=n=>{
 assert.match(el('rulesProgress').textContent,new RegExp('^'+(n+1)+' / 5 · '));
 for(let i=0;i<5;i++)assert.equal(el('rulesStep'+i).inert,i!==n);
 assert.deepEqual([...el('rulesDots').html.matchAll(/<i( class="current")?><\/i>/g)].map(m=>!!m[1]),[0,1,2,3,4].map(i=>i===n));
 assert.equal(el('rulesPrev').disabled,n===0);
 assert.equal(el('rulesDone').textContent,n===4?'盤に戻る':'次へ');
 assert.equal(el('rulesPages').scrollTop,0);
 assert.equal(infoState(),beforeInfo);assert.equal(paintCount,beforeInfoPaints);assert.deepEqual(painted.data,beforeInfoPixels);
};
el('rulesOpen').onclick();checkPage(0);el('rulesPrev').onclick();checkPage(0);
for(let i=1;i<5;i++){el('rulesPages').scrollTop=90;el('rulesDone').onclick();checkPage(i);}
el('rulesPrev').onclick();checkPage(3);el('rulesDone').onclick();checkPage(4);
el('rulesDone').onclick();assert.equal(el('rulesDialog').open,false);
el('rulesOpen').onclick();checkPage(0);el('rulesDone').onclick();checkPage(1);
// Returning to the first page moves focus off the button that becomes disabled.
document.activeElement=el('rulesPrev');el('rulesPrev').onclick();checkPage(0);assert.equal(document.activeElement,el('rulesDone'));
el('rulesClose').onclick();
el('rulesOpen').onclick();checkPage(0);
assert.equal(el('rulesDialog').events.cancel,undefined,'native Escape dismissal not blocked');
el('rulesDone').onclick();el('rulesDialog').close();el('rulesOpen').onclick();checkPage(0);el('rulesClose').onclick();
// A finished game is shared as a URL-fragment record; opening one is a read-only replay.
const {decodeRecord}=await import('./dist/record.js');
el('board').events.keydown({key:'Enter',preventDefault:noop});el('pass').onclick();el('pass').onclick();
assert.equal(el('pass').hidden,true);assert.equal(el('shareRecord').hidden,false);
let copied=null;Object.defineProperty(globalThis,'navigator',{value:{clipboard:{writeText:async text=>{copied=text;}}},configurable:true});
window.location={href:'https://example.test/igo/?x=1#old',pathname:'/igo/',search:'?x=1',hash:'#old'};
window.history={replaceState(state,title,url){window.location.hash='';window.location.href='https://example.test'+url;}};
await el('shareRecord').onclick();
assert.match(el('status').textContent,/コピーしました/);
assert.match(copied,/^https:\/\/example\.test\/igo\/\?x=1#kifu=[A-Za-z0-9_-]+$/);
const sharedCode=copied.split('#kifu=')[1],sharedGame=decodeRecord(sharedCode).game;
assert.equal(sharedGame.moves,3);assert.equal(sharedGame.ended,true);
el('undo').onclick();assert.equal(el('shareRecord').hidden,true);assert.equal(el('pass').hidden,false);
const ownMoves=el('moveCount').textContent;
window.location.hash='#kifu='+sharedCode;window.onhashchange();
assert.equal(el('replayControls').hidden,false);assert.equal(el('gameActions').hidden,true);
assert.equal(el('moveCount').textContent,'3 / 3 手');assert.match(el('turnText').textContent,/^棋譜 · /);assert.match(el('status').textContent,/^終局/);
assert.equal(el('blackWho').textContent,'先手');assert.equal(el('whiteWho').textContent,'後手');
el('board').events.keydown({key:'Enter',preventDefault:noop});assert.equal(el('moveCount').textContent,'3 / 3 手','replay never places stones');
el('replayPrev').onclick();assert.equal(el('moveCount').textContent,'2 / 3 手');assert.equal(el('status').textContent,'2 手目 · 白がパス');
el('replaySlider').value='0';el('replaySlider').oninput();assert.equal(el('moveCount').textContent,'0 / 3 手');assert.equal(el('status').textContent,'対局開始');assert.equal(el('replayPrev').disabled,true);
el('replayNext').onclick();assert.equal(el('moveCount').textContent,'1 / 3 手');assert.equal(el('status').textContent,'1 手目 · 黒');assert.equal(el('replaySlider').value,1);
el('replayClose').onclick();
assert.equal(el('replayControls').hidden,true);assert.equal(el('gameActions').hidden,false);assert.equal(el('moveCount').textContent,ownMoves);
assert.equal(window.location.hash,'');
// A damaged link leaves the current game alone.
window.location.hash='#kifu=AAAA';window.onhashchange();
assert.equal(el('replayControls').hidden,true);assert.equal(el('moveCount').textContent,ownMoves);
assert.equal(el('status').textContent,'共有された棋譜を読み込めませんでした。');assert.equal(window.location.hash,'');
// A new game can be started straight from a record. The settings draft and the confirmation
// refer to the player's own game (a 9×9 torus with moves), not to the small sphere on screen.
const engine=await import('./dist/engine.js'),{encodeRecord}=await import('./dist/record.js');
const smallRecord=new engine.Game(engine.createTopology('sphere',3),.5);smallRecord.pass();smallRecord.pass();
const openSmallRecord=()=>{window.location.hash='#kifu='+encodeRecord(smallRecord,1);window.onhashchange();assert.equal(el('replayControls').hidden,false);assert.equal(el('topologyName').textContent,'球面盤');};
openSmallRecord();
el('settingsOpen').onclick();assert.equal(el('settingsDialog').open,true);
assert.equal(el('boardKind').value,'torus','draft starts from the own board, not the record');assert.equal(el('size').value,'9');
globalThis.confirm=()=>false;el('newGame').onclick();
assert.equal(el('replayControls').hidden,false,'declining keeps the record open');assert.equal(el('moveCount').textContent,'2 / 2 手');
globalThis.confirm=()=>true;el('newGame').onclick();
assert.equal(el('settingsDialog').open,false);assert.equal(el('replayControls').hidden,true);assert.equal(el('gameActions').hidden,false);
assert.equal(el('topologyName').textContent,'トーラス盤');assert.equal(el('moveCount').textContent,'0 手');assert.equal(window.location.hash,'');
// Board tabs start a new game from a record too; the tab of the board already on screen does nothing.
openSmallRecord();
el('sphereTab').onclick();assert.equal(el('replayControls').hidden,false);
el('torusTab').onclick();assert.equal(el('replayControls').hidden,true);assert.equal(el('topologyName').textContent,'トーラス盤');assert.equal(window.location.hash,'');
delete window.location;delete window.history;
// Size tabs start a new game on the same shape; shape tabs keep the size on screen.
assert.equal(el('nodeCount').textContent,'49 INTERSECTIONS · NO EDGES','the small record board carried over its size');
el('board').events.keydown({key:'Enter',preventDefault:noop});assert.equal(el('moveCount').textContent,'1 手');
globalThis.confirm=()=>false;el('sizeLarge').onclick();assert.equal(el('nodeCount').textContent,'49 INTERSECTIONS · NO EDGES','declined');assert.equal(el('moveCount').textContent,'1 手');
globalThis.confirm=()=>true;el('sizeLarge').onclick();assert.equal(el('nodeCount').textContent,'121 INTERSECTIONS · NO EDGES');assert.equal(el('moveCount').textContent,'0 手');
el('sphereTab').onclick();assert.equal(el('nodeCount').textContent,'152 INTERSECTIONS · NO EDGES');assert.equal(el('topologyName').textContent,'球面盤');
el('sizeStandard').onclick();assert.equal(el('nodeCount').textContent,'98 INTERSECTIONS · NO EDGES');
el('board').events.keydown({key:'Enter',preventDefault:noop});globalThis.confirm=()=>{throw new Error('the current size tab must not ask');};
el('sizeStandard').onclick();assert.equal(el('moveCount').textContent,'1 手');globalThis.confirm=()=>true;
// Maps mark the hovered point and the つながり selection in the 3D board's marker style:
// every coloured ring sits on a dark outline ring of the same radius.
const {MARKER}=await import('./dist/surface-renderer.js'),rgb=([r,g,b])=>`rgb(${r},${g},${b})`;
const strokes=[],labels=[];let lastArc=null;
context.arc=(x,y,r)=>{lastArc={x,y,r};};context.stroke=()=>{strokes.push({...lastArc,style:context.strokeStyle});};context.fillText=text=>labels.push(text);
el('torusTab').onclick();el('viewToggle').onclick();assert.equal(el('mapSection').hidden,false);
const torusSide=Math.max(20,Math.min(boardWidth-60,boardHeight-48)),torusTarget=40,torusVertex=makeTopology('torus',9).vertices[torusTarget];
const torusAt={x:(boardWidth-torusSide)/2+torusVertex.i*torusSide/8,y:(boardHeight-torusSide)/2+torusVertex.j*torusSide/8};
strokes.length=0;el('map').events.pointermove({currentTarget:el('map'),clientX:torusAt.x+2,clientY:torusAt.y-1});
const ringsAt=(style,at)=>strokes.filter(s=>s.style===style&&(!at||Math.hypot(s.x-at.x,s.y-at.y)<1e-6));
assert.equal(ringsAt(rgb(MARKER.hover),torusAt).length,1,'hovered torus point is ringed');assert.equal(ringsAt(rgb(MARKER.outline),torusAt).length,1,'on a dark outline');
el('inspect').checked=true;el('inspect').onchange();strokes.length=0;labels.length=0;
el('map').events.click({currentTarget:el('map'),clientX:torusAt.x,clientY:torusAt.y});
assert.equal(ringsAt(rgb(MARKER.selected),torusAt).length,1,'selection in the selected colour');assert.equal(ringsAt(rgb(MARKER.neighbor)).length,4,'four neighbours');
assert.equal(ringsAt(rgb(MARKER.outline)).length,5,'each marker has an outline');assert.ok(labels.includes(String(torusTarget+1)),'selection is numbered');
el('inspect').checked=false;el('inspect').onchange();el('map').events.pointerleave();el('viewToggle').onclick();
delete context.arc;delete context.stroke;delete context.fillText;
delete globalThis.requestAnimationFrame;
console.log(viewport.width+'x'+viewport.height+' canvas simulation: UI integration tests passed: required DOM IDs, shared board/map toggle, map AI moves, settings/help/about dialogs, read-only about reopen/dismissals, AI fallback, undo, pass/end, reset cancellation, white start, staged board-kind selection, close/Escape cancellation, confirmed topology switch.');
