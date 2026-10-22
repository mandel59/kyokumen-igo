const $=id=>document.getElementById(id);let worker=null;
function stop(message){worker?.terminate();worker=null;$('start').disabled=false;$('stop').disabled=true;$('status').textContent=message;}
$('start').onclick=()=>{
 if(worker)return;
 $('rows').replaceChildren();$('result').value='';$('recommendation').textContent='';$('copy').disabled=true;
 $('start').disabled=true;$('stop').disabled=false;$('status').textContent='モデルを初期化しています…';
 worker=new Worker(new URL('./ai-benchmark-worker.js',import.meta.url),{type:'module'});
 worker.onmessage=({data})=>{
  if(data.error){stop('測定できませんでした：'+data.error);return;}
  if(data.progress){const p=data.progress;
   if(p.stage==='warming')$('status').textContent='初期化後の準備運転をしています（'+p.backend+'）…';
   if(p.stage==='measuring')$('status').textContent=p.visits+'訪問を測定中：'+p.completed+' / '+p.total+'（'+p.backend+'）';
   if(p.stage==='budget-complete'){
    const tr=document.createElement('tr');for(const value of[p.run.visits,p.run.p95Ms.toFixed(1)+'ms',p.run.worstBoardP95Ms.toFixed(1)+'ms']){const td=document.createElement('td');td.textContent=value;tr.append(td);}$('rows').append(tr);
   }
  }
  if(data.result){
   const r=data.result;
   const shared={...r,runs:r.runs.map(({samples,...run})=>({...run,sampleCount:samples.length,excludedCertifiedLoss:samples.filter(s=>s.provenLoss).length}))};
   $('result').value=JSON.stringify(shared,null,2);$('copy').disabled=false;
   $('recommendation').textContent=r.recommendedVisits?'共通設定の候補：'+r.recommendedVisits+'訪問':'8訪問でも余裕を含む目標を超えました。結果を共有してください。';
   stop('測定完了（'+r.backend+'）');
  }
 };
 worker.onerror=event=>stop('測定できませんでした：'+event.message);worker.postMessage({});
};
$('stop').onclick=()=>stop('測定を中止しました。');
document.addEventListener('visibilitychange',()=>{if(document.hidden&&worker)stop('画面が非表示になったため中止しました。画面を開いたまま再度測定してください。');});
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText($('result').value);$('status').textContent='結果をコピーしました。';}catch{$('result').focus();$('result').select();$('status').textContent='結果を選択しました。コピーして共有してください。';}};
