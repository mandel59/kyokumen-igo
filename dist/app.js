import {createTopology,Game,chooseMove} from './engine.js';
import {renderSurface,highlightSurface} from './surface-renderer.js';
import {sphereProjection} from './sphere-projection.js';
import {loadSavedGame,saveGame} from './persistence.js';
const $=id=>document.getElementById(id),canvas=$('board'),ctx=canvas.getContext('2d'),map=$('map'),mctx=map.getContext('2d');
let mapView=false;
let restoreWarning='';
function persist(){return saveGame(game,settings,{mapView,rotX,rotY});}
let kind='sphere',game,settings={opponent:'ai',human:1},rotX=-.26,rotY=.57,selected=null,hover=null,screen=[],thinking=false,worker=null,requestId=0,timer=null,drag=null,keyboardIndex=0;
let width=0,height=0,scale=1,centerX=0,centerY=0;
const errors={occupied:'そこにはすでに石があります。',suicide:'呼吸点がなくなる手は打てません。',superko:'過去と同じ盤面になる手は打てません。',ended:'対局は終了しました。',invalid:'交点を選んでください。'};
let surfaceFrame=null,surfaceKey='',rasterRatio=1,renderQueued=false;
function requestRender(){
  if(typeof requestAnimationFrame!=='function'){render();return;}
  if(renderQueued)return;renderQueued=true;
  requestAnimationFrame(()=>{renderQueued=false;render();});
}
function render(){
  if(!game)return;
  if(mapView){renderMap();return;}
  if(!width||!height)return;
  const budget=drag?.moved?90000:3000000;
  // Supersample standard-DPI screens too: the CPU rasterizer has no native edge AA.
  rasterRatio=Math.min(drag?.moved?(window.devicePixelRatio||1):Math.max(1.5,window.devicePixelRatio||1),(drag?.moved ? .8 : 3),Math.sqrt(budget/Math.max(1,width*height)));
  const rw=Math.max(1,Math.round(width*rasterRatio)),rh=Math.max(1,Math.round(height*rasterRatio));
  if(canvas.width!==rw)canvas.width=rw;if(canvas.height!==rh)canvas.height=rh;
  const key=[kind,game.topology.size,game.board.join(''),game.lastMove,rotX,rotY,canvas.width,canvas.height].join('|');
  if(key!==surfaceKey){
    surfaceFrame=renderSurface({topology:game.topology,board:game.board,lastMove:game.lastMove,rotX,rotY,width:canvas.width,height:canvas.height,scale:scale*rasterRatio,centerX:centerX*rasterRatio,centerY:centerY*rasterRatio,pixelRatio:rasterRatio,interactive:!!drag?.moved});
    surfaceKey=key;
  }
  screen=surfaceFrame.points.map(p=>({...p,x:p.x/rasterRatio,y:p.y/rasterRatio}));
  const pixels=highlightSurface(surfaceFrame,selected,hover);
  // createImageData is available in browsers; headless DOM test doubles may omit it.
  const image=ctx.createImageData(canvas.width,canvas.height);
  if(image?.data){image.data.set(pixels);ctx.putImageData(image,0,0);}
}
function drawStone(c,x,y,r,color,last){c.save();c.shadowColor='#14231755';c.shadowBlur=4;c.shadowOffsetY=3;const g=c.createRadialGradient(x-r*.35,y-r*.45,r*.1,x,y,r);if(color===1){g.addColorStop(0,'#52605b');g.addColorStop(.45,'#25332e');g.addColorStop(1,'#15201d');}else{g.addColorStop(0,'#fffef1');g.addColorStop(.65,'#ede9d7');g.addColorStop(1,'#b7b6a3');}c.fillStyle=g;c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fill();c.shadowColor='transparent';if(last){c.strokeStyle=color===1?'#e1c58e':'#536a58';c.lineWidth=1.5;c.beginPath();c.arc(x,y,r*.36,0,Math.PI*2);c.stroke();}c.restore();}
let mapPoints=[];function renderMap(){const rect=map.getBoundingClientRect(),w=rect.width,h=rect.height,dpr=window.devicePixelRatio||1;if(map.width!==Math.round(w*dpr)||map.height!==Math.round(h*dpr)){map.width=Math.round(w*dpr);map.height=Math.round(h*dpr);}mctx.setTransform(dpr,0,0,dpr,0,0);mctx.clearRect(0,0,w,h);if(kind==='sphere'){renderSphereMap(w,h);return;}const size=game.topology.size,side=Math.max(20,Math.min(w-60,h-48)),step=side/(size-1),ox=(w-side)/2,oy=(h-side)/2;mapPoints=[];mctx.strokeStyle='#66705a80';mctx.lineWidth=1;for(let i=0;i<size;i++){mctx.beginPath();mctx.moveTo(ox+i*step,oy);mctx.lineTo(ox+i*step,oy+side);mctx.moveTo(ox,oy+i*step);mctx.lineTo(ox+side,oy+i*step);mctx.stroke();}mctx.fillStyle='#647357';mctx.font='11px sans-serif';mctx.textAlign='center';mctx.fillText('↕',w/2,oy-12);mctx.fillText('↕',w/2,oy+side+20);mctx.fillText('↔',ox-20,h/2);mctx.fillText('↔',ox+side+20,h/2);game.topology.vertices.forEach((v,i)=>{const x=ox+v.i*step,y=oy+v.j*step;mapPoints.push({x,y,i});if(game.board[i])drawStone(mctx,x,y,Math.min(step*.4,13),game.board[i],game.lastMove===i);else{mctx.fillStyle='#51604b';mctx.beginPath();mctx.arc(x,y,2,0,Math.PI*2);mctx.fill();}if(selected===i||selected!==null&&game.topology.neighbors[selected].includes(i)){mctx.strokeStyle='#a76a16';mctx.lineWidth=2;mctx.beginPath();mctx.arc(x,y,Math.min(step*.45,15),0,Math.PI*2);mctx.stroke();}});}

function renderSphereMap(w,h){
  const projection=sphereProjection(game.topology,w,h);mapPoints=projection.points;
  const selectedNeighbors=selected===null?[]:game.topology.neighbors[selected];
  for(const view of projection.views){
    const g=mctx.createRadialGradient(view.x-view.radius*.3,view.y-view.radius*.3,0,view.x,view.y,view.radius);g.addColorStop(0,'#f3e8ca');g.addColorStop(1,'#dbc79c');
    mctx.fillStyle=g;mctx.beginPath();mctx.arc(view.x,view.y,view.radius,0,Math.PI*2);mctx.fill();mctx.strokeStyle='#8b805d';mctx.lineWidth=1;mctx.stroke();
    mctx.font='10px sans-serif';mctx.textAlign='center';mctx.fillStyle='#62694f';mctx.fillText(view.name,view.x,view.y-view.radius-9);
  }
  for(const edge of projection.edges){
    mctx.beginPath();edge.path.forEach((p,i)=>i?mctx.lineTo(p.x,p.y):mctx.moveTo(p.x,p.y));
    mctx.strokeStyle=selected===edge.a||selected===edge.b?'#a76a16':'#66705a80';mctx.lineWidth=selected===edge.a||selected===edge.b?2:1;mctx.stroke();
  }
  const radius=Math.max(2,Math.min(projection.radius/game.topology.size*.30,10));
  for(const p of mapPoints){
    if(game.board[p.i])drawStone(mctx,p.x,p.y,radius,game.board[p.i],game.lastMove===p.i);
    else{mctx.fillStyle='#51604b';mctx.beginPath();mctx.arc(p.x,p.y,1.8,0,Math.PI*2);mctx.fill();}
    if(selected===p.i||hover===p.i||selectedNeighbors.includes(p.i)){
      mctx.strokeStyle=selected===p.i||hover===p.i?'#a05b08':'#bd8b36';mctx.lineWidth=2;mctx.beginPath();mctx.arc(p.x,p.y,radius+2,0,Math.PI*2);mctx.stroke();
      if(selected===p.i){mctx.fillStyle='#633d08';mctx.font='bold 9px sans-serif';mctx.fillText(String(p.i+1),p.x,p.y-radius-5);}
    }
  }
}
function resize(){
  const r=canvas.getBoundingClientRect();width=r.width;height=r.height;
  scale=Math.min(width*.405,height*.385);centerX=width/2;centerY=height*.46;render();
}new ResizeObserver(resize).observe(canvas);new ResizeObserver(()=>{if(game&&mapView)renderMap();}).observe(map);
function cancelAI(){requestId++;clearTimeout(timer);timer=null;if(worker){worker.terminate();worker=null;}thinking=false;}
function canPlay(){return!game.ended&&!thinking&&(settings.opponent==='human'||game.turn===settings.human);}
function update(message){$('blackCaptures').textContent=game.captures[1];$('whiteCaptures').textContent=game.captures[2];$('moveCount').textContent=game.moves+' 手';$('komiLabel').textContent='コミ '+game.komi+' 目';$('turnStone').className='stone '+(game.turn===1?'black':'white');$('blackWho').textContent=settings.opponent==='human'?'先手':settings.human===1?'あなた':'AI';$('whiteWho').textContent=settings.opponent==='human'?'後手':settings.human===2?'あなた':'AI';$('pass').disabled=!canPlay();$('undo').disabled=game.moves===0||settings.opponent==='ai'&&settings.human===2&&game.moves===1;
if(game.ended){const s=game.score();$('turnText').textContent=s.winner?(s.winner===1?'黒':'白')+'の '+s.margin+' 目勝ち':'引き分け';$('status').textContent=`終局 · 面積方式｜黒 ${s.black} / 白 ${s.white}（コミ込み）。死に石の判定なし。`;}else{$('turnText').textContent=thinking?'AI が考えています':settings.opponent==='human'?(game.turn===1?'黒':'白')+'の番です':'あなたの番です';$('status').textContent=message||(game.passes?'直前の手はパス。次のパスで終局です。':thinking?'次の一手を探しています。':'');}const saved=persist();if(!saved)$('status').textContent+=' このブラウザーでは対局を保存できません。';else if(restoreWarning)$('status').textContent+=' '+restoreWarning;render();}
function scheduleAI(){if(game.ended||settings.opponent!=='ai'||game.turn===settings.human){update();return;}thinking=true;const id=++requestId;update();timer=setTimeout(()=>{if(id!==requestId)return;const handle=result=>{if(id!==requestId)return;thinking=false;if(worker){worker.terminate();worker=null;}if(result===null)game.pass();else{const r=game.play(result);if(!r.ok){update('AI の着手に失敗しました。待った、または新しい対局を選んでください。');return;}}update();};try{worker=new Worker(new URL('./ai-worker.js',import.meta.url),{type:'module'});worker.onmessage=e=>{if(e.data.id!==id)return;if(e.data.error){thinking=false;update('AI の処理に失敗しました。待ったで戻せます。');worker.terminate();worker=null;}else handle(e.data.move);};worker.onerror=()=>{if(id!==requestId)return;worker.terminate();worker=null;handle(chooseMove(game));};worker.postMessage({id,game:game.toJSON()});}catch{handle(chooseMove(game));}},400);}
function act(i){if($('inspect').checked){selected=i;const ns=game.topology.neighbors[i],hidden=mapView?0:ns.filter(n=>!screen[n]?.visible).length;$('boardHint').textContent=`交点 ${i+1} · 隣接 ${ns.length} 点${hidden?' · '+hidden+' 点は裏側':''}`;render();return;}if(!canPlay())return;const r=game.play(i);if(!r.ok){update(errors[r.reason]);return;}selected=null;update();scheduleAI();}
function pick(e,points){const rect=e.currentTarget.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;if(e.currentTarget===canvas&&surfaceFrame)return surfaceFrame.pick(x*rasterRatio,y*rasterRatio,Math.max(10,Math.min(20,scale*.1))*rasterRatio);let nearest=null,distance=e.currentTarget===map?20:Math.max(14,Math.min(23,scale*.12));for(const s of points){if(s.visible===false)continue;const d=Math.hypot(s.x-x,s.y-y);if(d<distance){nearest=s.i;distance=d;}}return nearest;}
canvas.addEventListener('pointerdown',e=>{canvas.setPointerCapture(e.pointerId);drag={x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,moved:false};});canvas.addEventListener('pointermove',e=>{if(!drag){hover=pick(e,screen);requestRender();return;}if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>6)drag.moved=true;if(drag.moved){rotY+=(e.clientX-drag.lastX)*.009;rotX+=(e.clientY-drag.lastY)*.009;requestRender();}drag.lastX=e.clientX;drag.lastY=e.clientY;});canvas.addEventListener('pointerup',e=>{if(drag&&!drag.moved){const i=pick(e,screen);if(i!==null)act(i);}drag=null;render();persist();});canvas.addEventListener('pointercancel',()=>{drag=null;render();persist();});canvas.addEventListener('pointerleave',()=>{hover=null;render();});map.addEventListener('pointermove',e=>{hover=pick(e,mapPoints);render();});map.addEventListener('pointerleave',()=>{hover=null;render();});map.addEventListener('click',e=>{const i=pick(e,mapPoints);if(i!==null)act(i);});
function keyboard(e,points){if(!['ArrowRight','ArrowLeft','ArrowUp','ArrowDown','Enter',' '].includes(e.key))return;e.preventDefault();const ps=points.filter((p,j)=>p.visible!==false&&points.findIndex(q=>q.i===p.i)===j);if(!ps.length)return;if(e.key==='Enter'||e.key===' '){act(ps[keyboardIndex%ps.length].i);}else{keyboardIndex=(keyboardIndex+(e.key==='ArrowRight'||e.key==='ArrowDown'?1:-1)+ps.length)%ps.length;selected=ps[keyboardIndex].i;$('boardHint').textContent='交点 '+(selected+1)+' · Enter で着手';render();}}canvas.addEventListener('keydown',e=>keyboard(e,screen));map.addEventListener('keydown',e=>keyboard(e,mapPoints));
function sizeOptions(boardKind=$('boardKind').value){const old=$('size').selectedIndex;$('size').innerHTML=boardKind==='sphere'?'<option value="3">小 · 56 交点</option><option value="4">標準 · 98 交点</option><option value="5">大 · 152 交点</option>':'<option value="7">小 · 7 × 7</option><option value="9">標準 · 9 × 9</option><option value="11">大 · 11 × 11</option>';$('size').selectedIndex=Math.max(0,old);}
function startGame(){restoreWarning='';cancelAI();kind=$('boardKind').value;settings={opponent:$('opponent').value,human:Number($('humanColor').value)};game=new Game(createTopology(kind,Number($('size').value)),Number($('komi').value));selected=null;hover=null;rotX=kind==='sphere'?-.26:-.65;rotY=.57;mapView=false;showGame();}
function showGame(){$('sphereTab').classList.toggle('active',kind==='sphere');$('torusTab').classList.toggle('active',kind==='torus');$('sphereTab').setAttribute('aria-pressed',kind==='sphere');$('torusTab').setAttribute('aria-pressed',kind==='torus');syncView();$('topologyName').textContent=kind==='sphere'?'球面盤':'トーラス盤';$('nodeCount').textContent=game.board.length+' INTERSECTIONS · NO EDGES';$('humanColor').disabled=settings.opponent==='human';update();resize();scheduleAI();}
function syncView(){const showMap=mapView;$('surfaceSection').hidden=showMap;$('mapSection').hidden=!showMap;$('viewToggle').hidden=false;$('viewToggle').textContent=showMap?'立体盤':kind==='sphere'?'全球図':'展開図';$('viewToggle').setAttribute('aria-pressed',String(showMap));$('homeView').disabled=showMap;$('mapHint').textContent=kind==='sphere'?'表裏を正距方位で投影 · 円周上の点は両図で共通':'上下・左右の端がつながります';map.setAttribute('aria-label',kind==='sphere'?'球面の全交点を前後の半球に投影した全球図。交点をタップして着手':'上下左右がつながる展開図。交点をタップして着手');$('boardHint').textContent=showMap?(kind==='sphere'?'全 '+game.board.length+' 点 · タップで着手':'上下・左右がつながる盤'):'ドラッグで回転 · タップで着手';if(showMap)renderMap();else resize();}
// The dialog is a draft. Opening or cancelling it restores the applied settings.
function syncSettings(){
  $('boardKind').value=kind;
  sizeOptions(kind);
  $('size').value=String(game.topology.size);
  $('komi').value=String(game.komi);
  $('opponent').value=settings.opponent;
  $('humanColor').value=String(settings.human);
  $('humanColor').disabled=settings.opponent==='human';
}
function switchBoard(nextKind){
  if(kind===nextKind||!confirmReset())return;
  syncSettings();
  $('boardKind').value=nextKind;
  sizeOptions(nextKind);
  startGame();
}
$('boardKind').onchange=()=>sizeOptions();
$('settingsDialog').addEventListener('cancel',syncSettings);
function confirmReset(){return!game.moves||confirm('今の対局を終了して、新しい対局を始めますか？');}
$('sphereTab').onclick=()=>switchBoard('sphere');$('torusTab').onclick=()=>switchBoard('torus');$('newGame').onclick=()=>{if(confirmReset()){startGame();$('settingsDialog').close();}};$('pass').onclick=()=>{if(canPlay()){game.pass();selected=null;update();scheduleAI();}};$('undo').onclick=()=>{cancelAI();if(settings.opponent==='human')game.undo();else{do{game.undo();}while(game.moves>0&&game.turn!==settings.human);}selected=null;update('一手前に戻しました。');scheduleAI();};$('homeView').onclick=()=>{rotX=kind==='sphere'?-.26:-.65;rotY=.57;render();persist();};$('inspect').onchange=()=>{selected=null;$('boardHint').textContent=$('inspect').checked?'交点を選ぶと、隣接点が光ります':mapView?'全体表示 · タップで着手':'ドラッグで回転 · タップで着手';render();};$('opponent').onchange=()=>{$('humanColor').disabled=$('opponent').value==='human';};for(const id of ['rulesOpen'])$(id).onclick=()=>$('rulesDialog').showModal();for(const id of ['rulesClose','rulesDone'])$(id).onclick=()=>$('rulesDialog').close();$('settingsOpen').onclick=()=>{syncSettings();$('settingsDialog').showModal();};$('settingsClose').onclick=()=>{syncSettings();$('settingsDialog').close();};$('viewToggle').onclick=()=>{mapView=!mapView;syncView();update();};

const restored=loadSavedGame();
if(restored.state){
  ({game,settings}=restored.state);
  ({mapView,rotX,rotY}=restored.state.view);
  kind=game.topology.kind;
  syncSettings();
  showGame();
}else{
  startGame();
  restoreWarning=restored.error||'';
  if(restoreWarning)update();
}

