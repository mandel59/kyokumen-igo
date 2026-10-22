import {createTopology,Game} from './engine.js';
import {createJSAI} from './ai-js.js';
import {aiPosition} from './ai-position.js';
import {KOMI_MIN,KOMI_MAX,KOMI_STEP} from './komi.js';
import {renderSurface,highlightSurface,MARKER,MARKS,markerColor} from './surface-renderer.js';
import {analyzeBoard} from './board-analysis.js';
import {COUNTERS,MARK_KEYS,counterValues,loadDisplay,marksShown,saveDisplay} from './display.js';
import {sphereProjection} from './sphere-projection.js';
import {AI_CHOICES,loadAIChoice,saveAIChoice} from './ai-choice.js';
import {v3Supported} from './ai-support.js';
import {loadRevision} from './revision.js';
import {loadSavedGame,saveGame} from './persistence.js';
import {defaultOrientation,rotateByDrag} from './orientation.js';
import {encodeRecord,decodeRecord} from './record.js';
const $=id=>document.getElementById(id),canvas=$('board'),ctx=canvas.getContext('2d'),map=$('map'),mctx=map.getContext('2d');
let mapView=false,replay=null;
let restoreWarning='';
// Gesture words follow the input in use: touch says スワイプ/タップ, a mouse says ドラッグ/クリック.
// Start from the primary pointer, then follow whichever pointer the player actually uses.
const coarsePointer=window.matchMedia?.('(pointer: coarse)');
let touchInput=!!coarsePointer?.matches;
const inputWords=()=>touchInput?{rotate:'スワイプ',place:'タップ'}:{rotate:'ドラッグ',place:'クリック'};
function persist(){return replay?true:saveGame(game,settings,{mapView,orientation});}
let kind='sphere',game,settings={opponent:'ai',human:1},orientation=defaultOrientation('sphere'),selected=null,hover=null,screen=[],thinking=false,worker=null,requestId=0,timer=null,drag=null,keyboardIndex=0;
let fallbackAI=null;
// The AI this device runs, shown in the app info dialog. The worker loads at startup and reports its backend.
const aiQuery=globalThis.location?.search?new URLSearchParams(globalThis.location.search):null;
const AI_NAMES={v2:'Kyokugo AI v2',v3:'Kyokugo AI v3（実験版）'};
const AI_BACKENDS={wasm:'WebAssembly','generated-js':'JavaScript（WebAssembly を使えないため）','v3-webgpu':'WebGPU','v3-wasm':'WebAssembly'};
const AI_DESCRIPTIONS={v2:$('aiDescription').textContent,v3:'実験中のニューラルネットワーク AI です。局面を評価するモデルを端末内で動かし、モンテカルロ木探索で着手を選びます。'};
// ?ai=v2 or ?ai=v3 overrides the saved choice for this page load.
const aiAvailable=choice=>choice!=='v3'||v3Supported();
let aiChoice=AI_CHOICES.includes(aiQuery?.get('ai'))?aiQuery.get('ai'):loadAIChoice(),workerChoice=null;
// A device that cannot run v3 plays v2 whatever was asked for or saved earlier.
if(!aiAvailable(aiChoice))aiChoice='v2';
let aiInfo={ai:aiChoice,backend:null,mainThread:false,failed:false};
function renderAIInfo(){
  const {ai,backend,mainThread,failed}=aiInfo;
  for(const choice of AI_CHOICES){$('aiChoice_'+choice).checked=aiChoice===choice;$('aiChoice_'+choice).disabled=!aiAvailable(choice);}
  $('aiV3Note').textContent=aiAvailable('v3')?'初回に数 MB を取得':'この端末では使えません';
  $('aiNote').hidden=!(backend&&ai!==aiChoice);
  $('aiName').textContent=AI_NAMES[ai];$('aiDescription').textContent=AI_DESCRIPTIONS[ai];
  $('aiBackend').textContent=failed?'読み込めませんでした':backend?(AI_BACKENDS[backend]??backend)+(mainThread?'（Web Worker を使えないため画面側で実行）':''):'読み込み中…';
}
function setAIInfo(change){aiInfo={...aiInfo,...change};renderAIInfo();}
// Report a backend; a v3 request that fell back to v2 shows as v2.
const reportBackend=(backend,mainThread=false)=>setAIInfo({ai:backend.startsWith('v3-')?'v3':'v2',backend,mainThread,failed:false});
// Viewer choices (board marks, counter), saved apart from the game. Marks are derived from the position alone.
let display=loadDisplay(),analysisKey='',analysis=null,mapMarks=null;
function boardMarks(){
  if(!marksShown(display))return null;
  const key=kind+game.lastMove+game.board.join('');
  if(key!==analysisKey){analysis=analyzeBoard(game.topology,game.board,game.lastMove);analysisKey=key;}
  return Object.fromEntries(MARK_KEYS.map(name=>[name,display.marks[name]?analysis[name]:null]));
}
function renderCounters(){
  const [,black,white]=counterValues(game,display.counter);
  $('blackCount').textContent=black;$('whiteCount').textContent=white;$('counterCaption').textContent=COUNTERS[display.counter];
}
let width=0,height=0,scale=1,centerX=0,centerY=0;
const errors={occupied:'そこにはすでに石があります。',suicide:'呼吸点がなくなる手は打てません。',superko:'過去と同じ盤面になる手は打てません。',ended:'対局は終了しました。',invalid:'交点を選んでください。'};
let surfaceFrame=null,surfaceKey='',rasterRatio=1,renderQueued=false;
// Drag frames trade resolution for speed. Their pixel budget follows the measured frame
// time, so fast devices drag sharply while slow ones keep the original 90k-pixel floor.
const DRAG_FRAME_MS=16;let dragPixels=90000;
function adaptDragPixels(elapsed){
  if(elapsed>DRAG_FRAME_MS*1.25)dragPixels=Math.max(90000,dragPixels*Math.max(.6,DRAG_FRAME_MS/elapsed));
  else if(elapsed<DRAG_FRAME_MS*.7)dragPixels=Math.min(3000000,dragPixels*Math.min(1.3,DRAG_FRAME_MS/elapsed));
}
function requestRender(){
  if(typeof requestAnimationFrame!=='function'){render();return;}
  if(renderQueued)return;renderQueued=true;
  requestAnimationFrame(()=>{renderQueued=false;render();});
}
function render(){
  if(!game)return;
  if(mapView){renderMap();return;}
  if(!width||!height)return;
  const interactive=!!drag?.moved,started=interactive?performance.now():0;
  // Supersample standard-DPI screens too: the CPU rasterizer has no native edge AA.
  rasterRatio=Math.min(interactive?(window.devicePixelRatio||1):Math.max(1.5,window.devicePixelRatio||1),3,Math.sqrt((interactive?dragPixels:3000000)/Math.max(1,width*height)));
  const rw=Math.max(1,Math.round(width*rasterRatio)),rh=Math.max(1,Math.round(height*rasterRatio));
  if(canvas.width!==rw)canvas.width=rw;if(canvas.height!==rh)canvas.height=rh;
  const key=[kind,game.topology.size,game.board.join(''),game.lastMove,...orientation,canvas.width,canvas.height,MARK_KEYS.map(name=>display.marks[name]?1:0).join('')].join('|'),drawn=key!==surfaceKey;
  if(drawn){
    surfaceFrame=renderSurface({topology:game.topology,board:game.board,lastMove:game.lastMove,marks:boardMarks(),orientation,width:canvas.width,height:canvas.height,scale:scale*rasterRatio,centerX:centerX*rasterRatio,centerY:centerY*rasterRatio,pixelRatio:rasterRatio,interactive});
    surfaceKey=key;
  }
  screen=surfaceFrame.points.map(p=>({...p,x:p.x/rasterRatio,y:p.y/rasterRatio}));
  const pixels=highlightSurface(surfaceFrame,selected,hover);
  // createImageData is available in browsers; headless DOM test doubles may omit it.
  const image=ctx.createImageData(canvas.width,canvas.height);
  if(image?.data){image.data.set(pixels);ctx.putImageData(image,0,0);}
  if(interactive&&drawn)adaptDragPixels(performance.now()-started);
}
function drawStone(c,x,y,r,color,last){c.save();c.shadowColor='#14231755';c.shadowBlur=4;c.shadowOffsetY=3;const g=c.createRadialGradient(x-r*.35,y-r*.45,r*.1,x,y,r);if(color===1){g.addColorStop(0,'#52605b');g.addColorStop(.45,'#25332e');g.addColorStop(1,'#15201d');}else{g.addColorStop(0,'#fffef1');g.addColorStop(.65,'#ede9d7');g.addColorStop(1,'#b7b6a3');}c.fillStyle=g;c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fill();c.shadowColor='transparent';if(last){c.strokeStyle=color===1?'#e1c58e':'#536a58';c.lineWidth=1.5;c.beginPath();c.arc(x,y,r*.36,0,Math.PI*2);c.stroke();}c.restore();}
let mapPoints=[];function renderMap(){mapMarks=boardMarks();const rect=map.getBoundingClientRect(),w=rect.width,h=rect.height,dpr=window.devicePixelRatio||1;if(map.width!==Math.round(w*dpr)||map.height!==Math.round(h*dpr)){map.width=Math.round(w*dpr);map.height=Math.round(h*dpr);}mctx.setTransform(dpr,0,0,dpr,0,0);mctx.clearRect(0,0,w,h);if(kind==='sphere'){renderSphereMap(w,h);return;}const size=game.topology.size,side=Math.max(20,Math.min(w-60,h-48)),step=side/(size-1),ox=(w-side)/2,oy=(h-side)/2;mapPoints=[];mctx.strokeStyle='#66705a80';mctx.lineWidth=1;for(let i=0;i<size;i++){mctx.beginPath();mctx.moveTo(ox+i*step,oy);mctx.lineTo(ox+i*step,oy+side);mctx.moveTo(ox,oy+i*step);mctx.lineTo(ox+side,oy+i*step);mctx.stroke();}mctx.fillStyle='#647357';mctx.font='11px sans-serif';mctx.textAlign='center';mctx.fillText('↕',w/2,oy-12);mctx.fillText('↕',w/2,oy+side+20);mctx.fillText('↔',ox-20,h/2);mctx.fillText('↔',ox+side+20,h/2);game.topology.vertices.forEach((v,i)=>{const p={x:ox+v.i*step,y:oy+v.j*step,i};mapPoints.push(p);drawMapPoint(p,Math.min(step*.4,13),2);});}
// Both maps draw markers in the 3D board's style (MARKER): same colours, outline and ring sizes.
const rgb=([r,g,b])=>`rgb(${r},${g},${b})`;
function drawMapPoint(p,stoneRadius,dotRadius){
  const stone=game.board[p.i];
  if(stone)drawStone(mctx,p.x,p.y,stoneRadius,stone,game.lastMove===p.i);
  else{mctx.fillStyle='#51604b';mctx.beginPath();mctx.arc(p.x,p.y,dotRadius,0,Math.PI*2);mctx.fill();}
  drawMapMarks(p,stoneRadius);
  const active=selected===p.i||hover===p.i;
  if(!active&&(selected===null||!game.topology.neighbors[selected].includes(p.i)))return;
  const [outlineWidth,inkWidth]=active?MARKER.width.active:MARKER.width.neighbor;
  const ring=stone?Math.max(1,Math.min(stoneRadius*MARKER.onStone,stoneRadius-outlineWidth/2)):stoneRadius*MARKER.aroundPoint;
  for(const [width,ink] of [[outlineWidth,MARKER.outline],[inkWidth,markerColor(p.i,selected,hover)]]){mctx.strokeStyle=rgb(ink);mctx.lineWidth=width;mctx.beginPath();mctx.arc(p.x,p.y,ring,0,Math.PI*2);mctx.stroke();}
}

// Board marks in the 3D board's shapes and colours (MARKS), each with a dark under-stroke.
function drawMapMarks(p,radius){
  if(!mapMarks)return;
  const line=Math.max(1,radius*.14),trace=(shape,ink,width)=>{mctx.strokeStyle=rgb(ink);mctx.lineWidth=width;mctx.lineCap='round';mctx.beginPath();shape();mctx.stroke();};
  if(!game.board[p.i]){
    const owner=mapMarks.territory?.[p.i],half=radius*MARKS.territorySquare;
    if(!owner)return;
    mctx.fillStyle=rgb(MARKS.outline);mctx.fillRect(p.x-half*1.3,p.y-half*1.3,half*2.6,half*2.6);
    mctx.fillStyle=rgb(MARKS.territory[owner]);mctx.fillRect(p.x-half,p.y-half,half*2,half*2);
    return;
  }
  if(mapMarks.atari?.[p.i]){const ring=()=>mctx.arc(p.x,p.y,radius*MARKS.atariRing,0,Math.PI*2);trace(ring,MARKS.outline,line+1.8);trace(ring,MARKS.atari,line);}
  if(mapMarks.alive?.[p.i]){
    const dot=Math.max(1.3,radius*MARKS.aliveDot);
    for(const [ink,size] of [[MARKS.outline,dot+.9],[MARKS.alive,dot]]){mctx.fillStyle=rgb(ink);mctx.beginPath();mctx.arc(p.x,p.y,size,0,Math.PI*2);mctx.fill();}
  }
  if(mapMarks.dead?.[p.i]){
    const arm=radius*MARKS.deadArm,cross=()=>{mctx.moveTo(p.x-arm,p.y-arm);mctx.lineTo(p.x+arm,p.y+arm);mctx.moveTo(p.x+arm,p.y-arm);mctx.lineTo(p.x-arm,p.y+arm);};
    trace(cross,MARKS.outline,line+1.8);trace(cross,MARKS.dead,line);
  }
}

function renderSphereMap(w,h){
  const projection=sphereProjection(game.topology,w,h);mapPoints=projection.points;
  for(const view of projection.views){
    const g=mctx.createRadialGradient(view.x-view.radius*.3,view.y-view.radius*.3,0,view.x,view.y,view.radius);g.addColorStop(0,'#f3e8ca');g.addColorStop(1,'#dbc79c');
    mctx.fillStyle=g;mctx.beginPath();mctx.arc(view.x,view.y,view.radius,0,Math.PI*2);mctx.fill();mctx.strokeStyle='#8b805d';mctx.lineWidth=1;mctx.stroke();
    mctx.font='10px sans-serif';mctx.textAlign='center';mctx.fillStyle='#62694f';mctx.fillText(view.name,view.x,view.y-view.radius-9);
  }
  const trace=edge=>{mctx.beginPath();edge.path.forEach((p,i)=>i?mctx.lineTo(p.x,p.y):mctx.moveTo(p.x,p.y));};
  const links=projection.edges.filter(edge=>selected===edge.a||selected===edge.b);
  mctx.strokeStyle='#66705a80';mctx.lineWidth=1;
  for(const edge of projection.edges)if(!links.includes(edge)){trace(edge);mctx.stroke();}
  // Edges from the selection lead to its neighbours, so they take the neighbour colour.
  mctx.strokeStyle=rgb(MARKER.neighbor);mctx.lineWidth=2;
  for(const edge of links){trace(edge);mctx.stroke();}
  const radius=Math.max(2,Math.min(projection.radius/game.topology.size*.30,10));
  for(const p of mapPoints)drawMapPoint(p,radius,1.8);
}
function resize(){
  const r=canvas.getBoundingClientRect();width=r.width;height=r.height;
  scale=Math.min(width*.405,height*.385);centerX=width/2;centerY=height*.46;render();
}new ResizeObserver(resize).observe(canvas);new ResizeObserver(()=>{if(game&&mapView)renderMap();}).observe(map);
// Only a search in flight needs stopping; an idle worker stays loaded, and a stopped one is replaced at once.
function cancelAI(){const searching=thinking;requestId++;clearTimeout(timer);timer=null;thinking=false;if(searching&&worker){worker.terminate();worker=null;startAIWorker();}}
function mainThreadAI(){
  fallbackAI??=createJSAI().catch(error=>{fallbackAI=null;throw error;});
  fallbackAI.then(ai=>{if(!worker)reportBackend(ai.backend,true);},()=>{if(!worker)setAIInfo({failed:true});});
  return fallbackAI;
}
function workerInfo(source,data){
  if(worker!==source)return;
  if(!data.error){reportBackend(data.backend);return;}
  source.terminate();worker=null;mainThreadAI().catch(()=>{});
}
// Phones run v3 on WASM; ?backend=webgpu asks for WebGPU anyway, ?backend=wasm forces WASM anywhere.
function v3UsesWasm(){
  const requested=aiQuery?.get('backend');
  if(requested)return requested==='wasm';
  const nav=globalThis.navigator;
  return nav?.userAgentData?.mobile??/Android|iPhone|iPod|Mobile/i.test(nav?.userAgent??'');
}
function ensureWorker(){
  if(worker&&workerChoice!==aiChoice){worker.terminate();worker=null;}
  if(worker)return worker;
  const url=new URL('./ai-worker.js',import.meta.url);
  if(aiChoice==='v3')url.search='ai=v3'+(v3UsesWasm()?'&backend=wasm':'');
  const started=new Worker(url,{type:'module'});
  started.onmessage=e=>{if(e.data.type==='info')workerInfo(started,e.data);};
  started.onerror=()=>{if(worker!==started||thinking)return;started.terminate();worker=null;mainThreadAI().catch(()=>{});};
  worker=started;workerChoice=aiChoice;setAIInfo({backend:null,mainThread:false,failed:false});
  return started;
}
// A search in flight is restarted with the newly chosen AI.
function chooseAI(choice){
  if(choice===aiChoice||!aiAvailable(choice))return;
  const searching=thinking;
  aiChoice=choice;saveAIChoice(choice);
  setAIInfo({ai:choice,backend:null,mainThread:false,failed:false});
  cancelAI();startAIWorker();
  if(searching)scheduleAI();
}
for(const choice of AI_CHOICES)$('aiChoice_'+choice).onchange=()=>chooseAI(choice);
function startAIWorker(){try{ensureWorker();}catch{mainThreadAI().catch(()=>{});}}
function canPlay(){return!replay&&!game.ended&&!thinking&&(settings.opponent==='human'||game.turn===settings.human);}
const resultText=s=>s.winner?(s.winner===1?'黒':'白')+'の '+s.margin+' 目勝ち':'引き分け';
function who(color){if(replay)return replay.ai===color?'AI':color===1?'先手':'後手';return settings.opponent==='human'?(color===1?'先手':'後手'):settings.human===color?'あなた':'AI';}
// After one pass, name both sides: the game ends only when the other player passes as well.
function passMessage(){const name=color=>settings.opponent==='human'?(color===1?'黒':'白'):color===settings.human?'あなた':'AI ';return `${name(3-game.turn)}がパスしました。${name(game.turn)}もパスすると終局です。`;}
function update(message){const outcome=replay?.result??(game.ended?game.score():null);$('turnStone').hidden=outcome?.winner===0;renderCounters();$('moveCount').textContent=replay?`${game.moves} / ${replay.moves.length} 手`:game.moves+' 手';$('komiLabel').textContent='コミ '+game.komi+' 目';$('turnStone').className='stone '+((replay?replay.result.winner||1:game.turn)===1?'black':'white');$('blackWho').textContent=who(1);$('whiteWho').textContent=who(2);$('pass').disabled=!canPlay();$('pass').hidden=game.ended;$('shareRecord').hidden=!game.ended;syncReplay();syncBoardTabs();$('undo').disabled=game.moves===0||settings.opponent==='ai'&&settings.human===2&&game.moves===1;
if(replay){const s=replay.result;$('turnText').textContent='棋譜 · '+resultText(s);$('status').textContent=game.ended?`終局 · 面積方式｜黒 ${s.black} / 白 ${s.white}（コミ込み）`:game.moves?`${game.moves} 手目 · ${game.turn===1?'白':'黒'}${game.lastMove===null?'がパス':''}`:'対局開始';}else if(game.ended){const s=game.score();$('turnText').textContent=resultText(s);$('status').textContent=`終局 · 面積方式｜黒 ${s.black} / 白 ${s.white}（コミ込み）。死に石の判定なし。`;}else{$('turnText').textContent=thinking?'AI が考えています':settings.opponent==='human'?(game.turn===1?'黒':'白')+'の番です':'あなたの番です';$('status').textContent=message||(game.passes?passMessage():thinking?'次の一手を探しています。':'');}const saved=persist();if(!saved)$('status').textContent+=' このブラウザーでは対局を保存できません。';else if(restoreWarning&&!replay)$('status').textContent+=' '+restoreWarning;render();}
function scheduleAI(){
 if(replay||game.ended||settings.opponent!=='ai'||game.turn===settings.human){update();return;}
 const started=Date.now();
 thinking=true;const id=++requestId;update();
 timer=setTimeout(()=>{
  if(id!==requestId)return;timer=null;
  let answered=false;
  const handle=result=>{
   if(id!==requestId||!thinking||answered)return;
   answered=true;
   const finish=()=>{
    if(id!==requestId||!thinking)return;timer=null;
    thinking=false;
    if(result===null)game.pass();
    else {
     const played=game.play(result);
     if(!played.ok){update('AI の着手に失敗しました。待った、または新しい対局を選んでください。');return;}
    }
    update();
   };
   // Compute immediately; only hold back replies that would make the turn too brief.
   const remaining=400-(Date.now()-started);
   if(remaining>0)timer=setTimeout(finish,remaining);
   else finish();
  };
  const fallback=async()=>{
   try{
    const ai=await mainThreadAI();
    if(id!==requestId||!thinking||answered)return;
    handle(ai.chooseMove(aiPosition(game),{depth:4}));
   }catch{
    if(id!==requestId||!thinking||answered)return;
    answered=true;thinking=false;update('AIを実行できませんでした。待った、または新しい対局を選んでください。');
   }
  };
  try{
   const activeWorker=ensureWorker();
   const workerFallback=()=>{
    if(id!==requestId||worker!==activeWorker)return;
    activeWorker.terminate();worker=null;void fallback();
   };
   activeWorker.onmessage=e=>{
    if(e.data.type==='info'){workerInfo(activeWorker,e.data);return;}
    if(id!==requestId||worker!==activeWorker||e.data.id!==id||!thinking)return;
    if(e.data.error){workerFallback();return;}
    // The UI's JS rules remain authoritative, including positional superko.
    if(e.data.move!==null&&!game.analyze(e.data.move).ok){workerFallback();return;}
    if(e.data.backend)reportBackend(e.data.backend);
    handle(e.data.move);
   };
   activeWorker.onerror=workerFallback;
   activeWorker.onmessageerror=workerFallback;
   const position=aiPosition(game);
   activeWorker.postMessage({id,position},[position.moves.buffer]);
  }catch{
   if(worker){worker.terminate();worker=null;}
   void fallback();
  }
 },0);
}
function act(i){if($('inspect').checked){selected=i;const ns=game.topology.neighbors[i],hidden=mapView?0:ns.filter(n=>!screen[n]?.visible).length;$('boardHint').textContent=`交点 ${i+1} · 隣接 ${ns.length} 点${hidden?' · '+hidden+' 点は裏側':''}`;render();return;}if(!canPlay())return;const r=game.play(i);if(!r.ok){update(errors[r.reason]);return;}selected=null;update();scheduleAI();}
function pick(e,points){const rect=e.currentTarget.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;if(e.currentTarget===canvas&&surfaceFrame)return surfaceFrame.pick(x*rasterRatio,y*rasterRatio,Math.max(10,Math.min(20,scale*.1))*rasterRatio);let nearest=null,distance=e.currentTarget===map?20:Math.max(14,Math.min(23,scale*.12));for(const s of points){if(s.visible===false)continue;const d=Math.hypot(s.x-x,s.y-y);if(d<distance){nearest=s.i;distance=d;}}return nearest;}
canvas.addEventListener('pointerdown',e=>{canvas.setPointerCapture(e.pointerId);drag={x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,moved:false};});canvas.addEventListener('pointermove',e=>{if(!drag){hover=pick(e,screen);requestRender();return;}if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>6)drag.moved=true;if(drag.moved){orientation=rotateByDrag(orientation,e.clientX-drag.lastX,e.clientY-drag.lastY);requestRender();}drag.lastX=e.clientX;drag.lastY=e.clientY;});canvas.addEventListener('pointerup',e=>{if(drag&&!drag.moved){const i=pick(e,screen);if(i!==null)act(i);}drag=null;render();persist();});canvas.addEventListener('pointercancel',()=>{drag=null;render();persist();});canvas.addEventListener('pointerleave',()=>{hover=null;render();});map.addEventListener('pointermove',e=>{hover=pick(e,mapPoints);render();});map.addEventListener('pointerleave',()=>{hover=null;render();});map.addEventListener('click',e=>{const i=pick(e,mapPoints);if(i!==null)act(i);});
function keyboard(e,points){if(!['ArrowRight','ArrowLeft','ArrowUp','ArrowDown','Enter',' '].includes(e.key))return;e.preventDefault();const ps=points.filter((p,j)=>p.visible!==false&&points.findIndex(q=>q.i===p.i)===j);if(!ps.length)return;if(e.key==='Enter'||e.key===' '){act(ps[keyboardIndex%ps.length].i);}else{keyboardIndex=(keyboardIndex+(e.key==='ArrowRight'||e.key==='ArrowDown'?1:-1)+ps.length)%ps.length;selected=ps[keyboardIndex].i;$('boardHint').textContent='交点 '+(selected+1)+(replay?'':' · Enter で着手');render();}}canvas.addEventListener('keydown',e=>keyboard(e,screen));map.addEventListener('keydown',e=>keyboard(e,mapPoints));
// Switching the board kind keeps the size's position (small, standard, large).
function sizeOptions(boardKind=$('boardKind').value){
  const size=Number($('size').value),ordinal=Math.max(0,BOARD_SIZES.sphere.indexOf(size),BOARD_SIZES.torus.indexOf(size));
  $('size').value=String(BOARD_SIZES[boardKind][ordinal]);
  syncChoices();
}
function startGame(){restoreWarning='';cancelAI();if(replay){replay=null;clearSharedRecordURL();}kind=$('boardKind').value;settings={opponent:$('opponent').value,human:Number($('humanColor').value)};game=new Game(createTopology(kind,Number($('size').value)),Number($('komi').value));selected=null;hover=null;orientation=defaultOrientation(kind);showGame();}
function showGame(){$('sphereTab').classList.toggle('active',kind==='sphere');$('torusTab').classList.toggle('active',kind==='torus');$('sphereTab').setAttribute('aria-pressed',kind==='sphere');$('torusTab').setAttribute('aria-pressed',kind==='torus');SIZE_TABS.forEach((id,i)=>{const active=BOARD_SIZES[kind][i]===game.topology.size;$(id).classList.toggle('active',active);$(id).setAttribute('aria-pressed',active);});syncView();$('topologyName').textContent=kind==='sphere'?'球面盤':'トーラス盤';$('nodeCount').textContent=game.board.length+' INTERSECTIONS';update();resize();scheduleAI();}
function syncView(){const showMap=mapView;$('surfaceSection').hidden=showMap;$('mapSection').hidden=!showMap;$('viewToggle').hidden=false;$('viewToggle').textContent=showMap?'立体盤':kind==='sphere'?'全球図':'展開図';$('viewToggle').setAttribute('aria-pressed',String(showMap));$('homeView').disabled=showMap;$('mapHint').textContent=kind==='sphere'?'表裏を正距方位で投影 · 円周上の点は両図で共通':'上下・左右の端がつながります';applyInputWords();$('boardHint').textContent=defaultHint();if(showMap)renderMap();else resize();}
// The board hint when nothing is selected; contextual hints (a selected point) replace it.
function defaultHint(){
  if($('inspect').checked)return '交点を選ぶと、隣接点が光ります';
  const {rotate,place}=inputWords();
  return (mapView?`全 ${game.board.length} 点`:`${rotate}で回転`)+(replay?'':` · ${place}で着手`);
}
function applyInputWords(){
  const {rotate,place}=inputWords();
  canvas.setAttribute('aria-label',replay?`${rotate}で回転。矢印キーで交点を選択`:`${rotate}で回転、交点を${place}して着手。矢印キーで交点を選びEnterで着手`);
  map.setAttribute('aria-label',(kind==='sphere'?'球面の全交点を前後の半球に投影した全球図':'上下左右がつながる展開図')+(replay?'':`。交点を${place}して着手`));
  $('rulesPlaceWord').textContent=place;$('rulesRotateWord').textContent=rotate;$('rulesRotateCaption').textContent=rotate+'で回転';
}
function setTouchInput(touch){
  if(touch===touchInput)return;
  const showingDefault=!!game&&$('boardHint').textContent===defaultHint();
  touchInput=touch;applyInputWords();
  if(showingDefault)$('boardHint').textContent=defaultHint();
}
window.onpointerdown=e=>{if(e.pointerType)setTouchInput(e.pointerType!=='mouse');};
if(coarsePointer)coarsePointer.onchange=e=>setTouchInput(e.matches);
// The dialog is a draft. Opening or cancelling it restores the applied settings of the
// player's own game, even while a shared record is on screen.
function syncSettings(){
  const own=replay?replay.own:{game,kind};
  $('boardKind').value=own.kind;
  sizeOptions(own.kind);
  $('size').value=String(own.game.topology.size);
  $('komi').value=String(own.game.komi);
  $('opponent').value=settings.opponent;
  $('humanColor').value=String(settings.human);
  syncChoices();
}
// Board tabs pick the board before the first move and after the game ends. During a game
// or a record they give way to a plain summary, so a stray tap never resets the game.
const boardLocked=()=>!!replay||game.moves>0&&!game.ended;
function syncBoardTabs(){
  const locked=boardLocked(),ordinal=BOARD_SIZES[kind].indexOf(game.topology.size);
  $('kindTabs').inert=locked;$('sizeTabs').inert=locked;$('boardSummary').hidden=!locked;
  $('boardSummary').textContent=`${kind==='sphere'?'球面':'トーラス'} · ${['小','標準','大'][ordinal]} · ${SIZE_DETAILS[kind][ordinal]}`;
}
// Board tabs start a new game on the board they pick, keeping the other choice that is on screen
// (the shape or the size), with the player's own opponent and komi.
const BOARD_SIZES={sphere:[3,4,5],torus:[7,9,11]},SIZE_TABS=['sizeSmall','sizeStandard','sizeLarge'];
function switchBoard(nextKind,nextSize=BOARD_SIZES[nextKind][BOARD_SIZES[kind].indexOf(game.topology.size)]){
  if(boardLocked()||kind===nextKind&&game.topology.size===nextSize||!confirmReset())return;
  syncSettings();
  $('boardKind').value=nextKind;
  sizeOptions(nextKind);
  $('size').value=String(nextSize);
  startGame();
}
$('boardKind').onchange=()=>sizeOptions();
// The dialog shows segmented radio groups and a komi stepper. They write into hidden fields
// (#opponent, #humanColor, #boardKind, #size, #komi), which syncSettings and startGame use.
const CHOICES={opponent:['ai','human'],humanColor:['1','2'],boardKind:['sphere','torus'],size:['0','1','2']};
const SIZE_DETAILS={sphere:['56 交点','98 交点','152 交点'],torus:['7 × 7','9 × 9','11 × 11']},KOMI_RANGE=[KOMI_MIN,KOMI_MAX];
function syncChoices(){
  const boardKind=$('boardKind').value,ordinal=String(BOARD_SIZES[boardKind].indexOf(Number($('size').value)));
  for(const [field,values] of Object.entries(CHOICES))for(const value of values)$(field+'_'+value).checked=(field==='size'?ordinal:$(field).value)===value;
  for(const value of CHOICES.humanColor)$('humanColor_'+value).disabled=$('opponent').value==='human';
  SIZE_DETAILS[boardKind].forEach((text,i)=>{$('sizeDetail'+i).textContent=text;});
  const komi=Number($('komi').value);
  $('komiValue').textContent=komi+' 目';$('komiDown').disabled=komi<=KOMI_RANGE[0];$('komiUp').disabled=komi>=KOMI_RANGE[1];
}
for(const [field,values] of Object.entries(CHOICES))for(const value of values)$(field+'_'+value).onchange=()=>{
  if(field==='size')$('size').value=String(BOARD_SIZES[$('boardKind').value][Number(value)]);else $(field).value=value;
  $(field).onchange?.();syncChoices();
};
const stepKomi=delta=>{$('komi').value=String(Math.min(KOMI_RANGE[1],Math.max(KOMI_RANGE[0],Number($('komi').value)+delta)));syncChoices();};
$('komiDown').onclick=()=>stepKomi(-KOMI_STEP);$('komiUp').onclick=()=>stepKomi(KOMI_STEP);
$('settingsDialog').addEventListener('cancel',syncSettings);
// Display choices apply as soon as they are made; unlike the new-game settings there is no draft.
const MARK_CONTROLS={alive:'markAlive',dead:'markDead',atari:'markAtari',territory:'markTerritory'};
function syncDisplay(){
  for(const name of MARK_KEYS)$(MARK_CONTROLS[name]).checked=display.marks[name];
  for(const value of Object.keys(COUNTERS))$('counter_'+value).checked=display.counter===value;
}
function changeDisplay(change){change();saveDisplay(display);renderCounters();render();}
for(const name of MARK_KEYS)$(MARK_CONTROLS[name]).onchange=()=>changeDisplay(()=>{display.marks[name]=$(MARK_CONTROLS[name]).checked;});
for(const value of Object.keys(COUNTERS))$('counter_'+value).onchange=()=>changeDisplay(()=>{display.counter=value;});
$('displayOpen').onclick=()=>{syncDisplay();$('displayDialog').showModal();};
for(const id of ['displayClose','displayDone'])$(id).onclick=()=>$('displayDialog').close();
const tutorialTitles=['石を置く','石を取る','つながった石','盤を見渡す','つながり表示','終局と勝敗'];
let tutorialStep=0;
function showTutorialStep(next){
 tutorialStep=Math.max(0,Math.min(tutorialTitles.length-1,next));
 // Inactive pages stay laid out (inert, invisible) so paging never resizes the dialog.
 tutorialTitles.forEach((_,i)=>{$('rulesStep'+i).inert=i!==tutorialStep;});
 $('rulesDots').innerHTML=tutorialTitles.map((_,i)=>i===tutorialStep?'<i class="current"></i>':'<i></i>').join('');
 $('rulesProgress').textContent=`${tutorialStep+1} / ${tutorialTitles.length} · ${tutorialTitles[tutorialStep]}`;
 if(tutorialStep===0&&document.activeElement===$('rulesPrev'))$('rulesDone').focus();
 $('rulesPrev').disabled=tutorialStep===0;
 $('rulesDone').textContent=tutorialStep===tutorialTitles.length-1?'盤に戻る':'次へ';
 $('rulesPages').scrollTop=0;
}
// Shared records travel in the URL fragment, so they never reach the server. Viewing one
// sets the player's own game aside without saving it, and restores it unchanged afterwards.
const sharedRecordCode=()=>/^#kifu=([A-Za-z0-9_-]+)/.exec(window.location?.hash||'')?.[1]??null;
function clearSharedRecordURL(){window.history.replaceState(null,'',window.location.pathname+window.location.search);}
function openSharedRecord(){
 const code=sharedRecordCode();
 if(!code){if(replay)closeReplay();return;}
 let shared;
 try{shared=decodeRecord(code);}catch{clearSharedRecordURL();$('status').textContent='共有された棋譜を読み込めませんでした。';return;}
 cancelAI();
 replay={own:replay?.own??{game,kind,orientation,mapView},moves:shared.game.history.slice(1).map(s=>s.lastMove),topology:shared.game.topology,komi:shared.game.komi,ai:shared.ai,result:shared.game.score()};
 game=shared.game;kind=game.topology.kind;orientation=defaultOrientation(kind);mapView=false;selected=null;hover=null;
 showGame();
}
function showReplayStep(step){
 game=new Game(replay.topology,replay.komi);
 for(const move of replay.moves.slice(0,Math.max(0,step)))if(move===null)game.pass();else game.play(move);
 selected=null;update();
}
function syncReplay(){
 $('gameActions').hidden=!!replay;$('replayControls').hidden=!replay;
 if(!replay)return;
 $('replaySlider').max=replay.moves.length;$('replaySlider').value=game.moves;
 $('replayPrev').disabled=game.moves===0;$('replayNext').disabled=game.moves===replay.moves.length;
}
function closeReplay(){
 ({game,kind,orientation,mapView}=replay.own);replay=null;selected=null;hover=null;
 clearSharedRecordURL();showGame();
}
async function shareRecord(){
 const url=window.location.href.split('#')[0]+'#kifu='+encodeRecord(game,settings.opponent==='ai'?3-settings.human:0);
 const text=`曲面囲碁の棋譜（${kind==='sphere'?'球面盤':'トーラス盤'} · ${resultText(game.score())}）`;
 if(navigator.share)try{await navigator.share({title:'曲面囲碁の棋譜',text,url});return;}catch(error){if(error.name==='AbortError')return;}
 try{await navigator.clipboard.writeText(url);$('status').textContent='棋譜のリンクをコピーしました。';}
 catch{prompt('このリンクをコピーして共有してください。',url);}
}
$('shareRecord').onclick=shareRecord;$('replayPrev').onclick=()=>showReplayStep(game.moves-1);$('replayNext').onclick=()=>showReplayStep(game.moves+1);$('replaySlider').oninput=()=>showReplayStep(Number($('replaySlider').value));$('replayClose').onclick=closeReplay;window.onhashchange=openSharedRecord;
// Starting a new game from a shared record still replaces the player's own saved game.
function confirmReset(){const own=replay?replay.own.game:game;return!own.moves||confirm(replay?'自分の対局を終了して、新しい対局を始めますか？':own.ended?'新しい対局を始めますか？ 棋譜をシェアしていない場合、終局した対局は残りません。':'今の対局を終了して、新しい対局を始めますか？');}
$('sphereTab').onclick=()=>switchBoard('sphere');$('torusTab').onclick=()=>switchBoard('torus');SIZE_TABS.forEach((id,i)=>{$(id).onclick=()=>switchBoard(kind,BOARD_SIZES[kind][i]);});$('newGame').onclick=()=>{if(confirmReset()){startGame();$('settingsDialog').close();}};$('pass').onclick=()=>{if(canPlay()){game.pass();selected=null;update();scheduleAI();}};$('undo').onclick=()=>{cancelAI();if(settings.opponent==='human')game.undo();else{do{game.undo();}while(game.moves>0&&game.turn!==settings.human);}selected=null;update('一手前に戻しました。');scheduleAI();};$('homeView').onclick=()=>{orientation=defaultOrientation(kind);render();persist();};$('inspect').onchange=()=>{selected=null;$('boardHint').textContent=defaultHint();render();};$('opponent').onchange=syncChoices;
// Dialog tabs: the selected tab stays selected while the dialog is closed. Arrow keys, Home and End move between tabs.
function dialogTabs(prefix,count){
 const show=(next,focus=false)=>{
  for(let i=0;i<count;i++){$(prefix+'Panel'+i).inert=i!==next;$(prefix+'Tab'+i).setAttribute('aria-selected',String(i===next));$(prefix+'Tab'+i).tabIndex=i===next?0:-1;}
  if(focus)$(prefix+'Tab'+next).focus();
 };
 for(let i=0;i<count;i++){
  $(prefix+'Tab'+i).onclick=()=>show(i);
  $(prefix+'Tab'+i).onkeydown=e=>{
   const next={ArrowRight:(i+1)%count,ArrowLeft:(i+count-1)%count,Home:0,End:count-1}[e.key];
   if(next===undefined)return;
   e.preventDefault();show(next,true);
  };
 }
}
dialogTabs('about',5);dialogTabs('display',2);
$('aboutOpen').onclick=()=>$('aboutDialog').showModal();for(const id of ['aboutClose','aboutDone'])$(id).onclick=()=>$('aboutDialog').close();$('aboutTutorial').onclick=()=>{$('aboutDialog').close();$('rulesOpen').onclick();};$('rulesOpen').onclick=()=>{showTutorialStep(0);$('rulesDialog').showModal();};$('rulesClose').onclick=()=>$('rulesDialog').close();$('rulesPrev').onclick=()=>showTutorialStep(tutorialStep-1);$('rulesDone').onclick=()=>{if(tutorialStep<tutorialTitles.length-1)showTutorialStep(tutorialStep+1);else $('rulesDialog').close();};$('settingsOpen').onclick=()=>{syncSettings();$('settingsDialog').showModal();};$('settingsClose').onclick=()=>{syncSettings();$('settingsDialog').close();};$('viewToggle').onclick=()=>{mapView=!mapView;syncView();update();};

const restored=loadSavedGame();
if(restored.state){
  ({game,settings}=restored.state);
  ({mapView,orientation}=restored.state.view);
  kind=game.topology.kind;
  syncSettings();
  showGame();
}else{
  startGame();
  restoreWarning=restored.error||'';
  if(restoreWarning)update();
}
renderAIInfo();startAIWorker();
void loadRevision().then(revision=>{if(revision){$('appRevision').textContent='('+revision+')';$('appRevision').hidden=false;}});
openSharedRecord();

