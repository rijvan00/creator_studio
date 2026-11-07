/* FrameLab V1 — local recording with on-device MediaPipe face, hand, and COCO product detection.
   AI script generation and teleprompter are deliberately simulated. No user media goes to a cloud API. */
const $ = (id) => document.getElementById(id);
const API_BASE = window.__DAWNMATTER_CREATOR_STUDIO_API_BASE__ || '';
const CANVAS = $('cameraCanvas'), CTX = CANVAS.getContext('2d', {alpha:false});
const GUIDE = $('guideCanvas'), GCTX = GUIDE.getContext('2d');
const W=CANVAS.width, H=CANVAS.height;
const CHECK_GRACE_MS=2200;
const PRODUCT_CLASSES=new Set(['backpack','banana','bottle','book','cell phone','cup','handbag','remote','scissors','toothbrush']);
const el = {
  camera:$('cameraButton'), start:$('recordButton'),
  pause:$('pauseButton'), finish:$('finishScriptButton'), retake:$('retakeButton'), done:$('doneButton'),
  next:$('nextScript'), prev:$('prevScript'), productName:$('productName'), sellingPoint:$('sellingPoint'),
  apply:$('applyProduct'), scriptText:$('scriptText'), scriptWindow:$('scriptWindow'), scriptLabel:$('scriptLabel'),
  scriptNumber:$('scriptNumber'), takeNumber:$('takeNumber'), toast:$('toast'), activity:$('activity'),
  readyText:$('readyText'), alertPanel:$('alertPanel'), alertTitle:$('alertTitle'), alertBody:$('alertBody'),
  retakeModal:$('retakeModal'), modalBody:$('modalBody')
};
const state = {
  camera:false, checking:false, ready:false, recorder:null, recording:false, paused:false, saving:false,
  media:null, sourceStream:null, outputStream:null, faceDetector:null, handLandmarker:null, objectDetector:null,
  engineLoading:false, engineReady:false, modelsError:'', lastDraw:0, lastVision:0, visionTick:0,
  face:null, hands:[], checks:{face:false,head:false,hand:false,product:false},
  productBox:null, productLabel:'', productVerified:false,
  alignmentSince:0, issueSince:{}, lastCheckSeen:{}, lastWarnedAt:{},
  pendingDirection:1, scriptIndex:0, round:1, scripts:[], takeSeq:0, activeTake:null, takes:[], events:[],
  serverSession:null, seq:0, uploadQueue:Promise.resolve(), uploadedBytes:0, failedUpload:false,
  startedAt:0, pauseStarted:0, pausedAccum:0, finalMs:0, animation:0,
  analyser:null, audioArray:null, audioContext:null, micRms:0, lastAudio:0, lastActivityToast:0
};

const pad=(n)=>String(n).padStart(2,'0');
function formatClock(ms,long=false){const t=Math.floor(Math.max(0,ms)/1000);const h=Math.floor(t/3600);const m=Math.floor((t%3600)/60);const s=t%60;return long?`${pad(h)}:${pad(m)}:${pad(s)}`:`${pad(m+h*60)}:${pad(s)}`;}
function msElapsed(){if(!state.startedAt)return 0;const now=state.paused?state.pauseStarted:performance.now();return Math.max(0,Math.round(now-state.startedAt-state.pausedAccum));}
function logEvent(type,message,extra={}){
  const event={type,message,timeMs:state.recording?msElapsed():0,timeISO:new Date().toISOString(),...extra};
  state.events.push(event);
  if(state.events.length>15000)state.events.splice(0,1000);
  const entry=document.createElement('div');entry.className='activity-item'+(type==='warning'?' warn':'');
  const time=document.createElement('span');time.className='activity-time';time.textContent=state.recording?formatClock(event.timeMs):'–';
  const text=document.createElement('span');text.className='activity-text';text.textContent=message;
  entry.append(time,text); if(el.activity.querySelector('.activity-empty'))el.activity.innerHTML='';
  el.activity.prepend(entry);while(el.activity.children.length>14)el.activity.lastChild.remove();
}
let toastTimer;
function toast(message,bad=false){el.toast.textContent=message;el.toast.className='toaster show'+(bad?' bad':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.toast.className='toaster',4500);}
function showAlert(title,message){el.alertPanel.hidden=false;el.alertTitle.textContent=title;el.alertBody.textContent=message;}
function hideAlert(){el.alertPanel.hidden=true;}

function buildScripts(){
  const item=el.productName.value.trim()||'your product';
  const feature=el.sellingPoint.value.trim()||'something that might make an everyday routine easier';
  const collection=[
    ['THE INTRODUCTION',`Let me show you ${item}. If you have come across this and wondered what it actually looks like, here is a closer view. I'm holding it up so you can see the size, the packaging, and the details. One thing worth discussing is ${feature}. Let's look at it clearly, rather than just making a claim without showing anything.`],
    ['SHOW THE PRODUCT',`Here's ${item} up close. I'm turning it slowly so you can see each side, how it is designed, and how it looks in someone's hand. Notice the shape, the label and the finish. If you're comparing a few options, these physical details can be useful. I'll give you another close look so you can judge it for yourself.`],
    ['THE USE CASE',`Picture this: you're trying to make part of your day simpler. That's where a product like ${item} might fit in. The idea we want to explore today is ${feature}. Of course, whether it works for you depends on what you need. Let me show you the actual product while I explain the situation.`],
    ['A QUESTION HOOK',`Would you choose a product without seeing it properly first? Probably not. That's why I've got ${item} right here. Look at the size, the design and the way it sits in my hand. We can talk about ${feature}, but I think the first step is seeing the actual item and understanding what you would be getting.`],
    ['THREE THINGS',`Here are three things I would look at when considering ${item}. First, the overall shape and packaging. Second, how the item feels and fits into the way you plan to use it. And third, the specific benefit you care about, such as ${feature}. I'm showing you the item as I go, so you can make your own call.`],
    ['EVERYDAY SITUATION',`Imagine you're getting ready for your day, and you reach for the things you usually use. This is one scenario where someone might consider ${item}. The question to ask is whether it helps with ${feature}. I'm not here to promise an outcome. I just want to show it clearly and explain where it could fit into a routine.`],
    ['WHAT TO NOTICE',`Before you buy something like ${item}, take a moment to look at the actual details. Here is the front, and here is another angle. See the proportions and the design for yourself. The message we're focusing on is ${feature}. Use this as a starting point for checking the official product details and deciding if it suits your needs.`],
    ['THE DEMONSTRATION',`I'm holding ${item} right here, and I'll walk through the basics. First I'll show you the front. Now I'll rotate it so you can see the side. Finally, here's how it appears when held naturally. A useful point to consider is ${feature}. You can see the product in real time instead of relying only on a studio photo.`],
    ['COMMON CONCERN',`A question people often have is whether a product will be practical in their own daily life. So let's look at ${item} instead of guessing. I'll show it from a few angles and talk about the idea of ${feature}. Think about how you would use it, what matters most to you, and what details you'd still want to confirm.`],
    ['FINAL CLOSE-UP',`One last look at ${item}. Here's the front, here's the side, and here's how it looks next to my hand for scale. We talked about ${feature}, but the useful takeaway is to inspect the product and decide whether its features match what you need. That's the kind of clear demonstration I would want to see before making a decision.`]
  ];
  state.scripts=collection.map(([title,text],idx)=>({id:`R${state.round}-S${idx+1}`,title,text,targetSeconds:35}));
  renderScript();
}
function currentScript(){return state.scripts[state.scriptIndex];}
function renderScript(){const s=currentScript();if(!s)return;el.scriptLabel.textContent=`ROUND ${state.round} · ${s.title}`;el.scriptText.textContent=s.text;el.scriptNumber.textContent=`${pad(state.scriptIndex+1)} / ${pad(state.scripts.length)}`;el.scriptWindow.scrollTop=0;el.takeNumber.textContent=String(state.takes.filter(t=>t.scriptId===s.id).length+1);}

function syncControls(){
  el.camera.disabled=state.recording||state.saving;
  el.camera.innerHTML=state.camera?'◉ Camera connected':'◉ Start camera';
  el.start.disabled=!state.camera||!state.ready||state.recording||state.saving||!state.engineReady;
  el.pause.disabled=!state.recording||state.saving;
  el.pause.textContent=state.paused?'▶ Resume':'Ⅱ Pause';
  el.finish.disabled=!state.recording||state.paused||state.saving;
  el.retake.disabled=!state.recording||state.paused||state.saving;
  el.done.disabled=!state.recording||state.saving;
  el.next.disabled=state.saving;
  el.prev.disabled=state.saving;
  el.apply.disabled=state.recording||state.saving;
  el.productName.disabled=state.recording||state.saving;
  el.sellingPoint.disabled=state.recording||state.saving;
  $('recStatus').innerHTML=state.recording?`<span class="dot ${state.paused?'muted':'red'}"></span> ${state.paused?'Recording paused':'Recording in progress'}`:`<span class="dot muted"></span> ${state.saving?'Saving…':'Not recording'}`;
  $('cameraChip').textContent=state.camera?'Camera live':'Camera off';
  $('engineChip').innerHTML=state.engineReady?'<span class="dot green"></span> Vision active':state.modelsError?'<span class="dot red"></span> Vision unavailable':state.engineLoading?'<span class="dot muted"></span> Loading vision…':'<span class="dot muted"></span> Vision idle';
  $('previewBadge').textContent=state.recording?(state.paused?'PAUSED':'● RECORDING'):'PREVIEW';
}

async function initVision(){
  state.engineLoading=true;state.modelsError='';syncControls();
  try{
    const localAssets=(await fetch('/vendor/assets.json',{cache:'no-store'})).ok;
    const bundle=localAssets?'/vendor/vision_bundle.mjs':'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs';
    const wasmRoot=localAssets?'/vendor/wasm':'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
    const faceModel=localAssets?'/vendor/models/face_detector.tflite':'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
    const handModel=localAssets?'/vendor/models/hand_landmarker.task':'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
    const objectModel=localAssets?'/vendor/models/object_detector.tflite':'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float32/1/efficientdet_lite0.tflite';
    const {FilesetResolver,FaceDetector,HandLandmarker,ObjectDetector}=await import(bundle);
    const vision=await FilesetResolver.forVisionTasks(wasmRoot);
    state.faceDetector=await FaceDetector.createFromOptions(vision,{baseOptions:{modelAssetPath:faceModel,delegate:'CPU'},runningMode:'VIDEO',minDetectionConfidence:.45});
    state.handLandmarker=await HandLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:handModel,delegate:'CPU'},runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:.4});
    state.objectDetector=await ObjectDetector.createFromOptions(vision,{baseOptions:{modelAssetPath:objectModel,delegate:'CPU'},runningMode:'VIDEO',scoreThreshold:.35,maxResults:5});
    state.engineReady=true;beginChecking();
    toast('Live detection started. Hold a supported product near your hand.');
  }catch(err){state.modelsError=err?.message||String(err);console.error('Vision init failed',err);showAlert('Vision models unavailable','Connect to the internet, then refresh the page and start the camera again. The MediaPipe models must load to enable recording.');toast('AI vision could not load. Check internet connection.',true);}
  finally{state.engineLoading=false;syncControls();}
}
async function startCamera(){
  if(state.camera)return;
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera access is unavailable. Open the studio at http://localhost:8765 in Chrome or Edge.');
    const stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:30},facingMode:'user'},audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    state.sourceStream=stream;
    const video=$('sourceVideo');video.srcObject=stream;await video.play();
    const AC=window.AudioContext||window.webkitAudioContext;
    if(AC){state.audioContext=new AC();await state.audioContext.resume();const source=state.audioContext.createMediaStreamSource(stream);state.analyser=state.audioContext.createAnalyser();state.analyser.fftSize=1024;state.audioArray=new Uint8Array(state.analyser.fftSize);source.connect(state.analyser);}
    $('placeholder').hidden=true;state.camera=true;logEvent('info','Camera and microphone opened');
    syncControls();state.animation=requestAnimationFrame(frameLoop);initVision();
    state.sourceStream.getTracks().forEach(track=>track.addEventListener('ended',()=>{if(state.recording)showAlert('Camera / mic disconnected','Recording device stopped. Click Done & save to finalize captured footage.');}));
  }catch(err){toast('Could not start camera: '+(err.message||err),true);showAlert('Camera access failed','Allow camera and microphone permissions in Chrome/Edge and close other apps that use the camera.');}
}
function drawPortrait(){
  const video=$('sourceVideo');if(video.readyState<2||!video.videoWidth)return;
  const vw=video.videoWidth,vh=video.videoHeight;const ratio=W/H;
  let sx=0,sy=0,sw=vw,sh=vh;
  if(vw/vh>ratio){sw=vh*ratio;sx=(vw-sw)/2;}else{sh=vw/ratio;sy=(vh-sh)/2;}
  CTX.save();CTX.translate(W,0);CTX.scale(-1,1);
  CTX.drawImage(video,sx,sy,sw,sh,0,0,W,H);
  CTX.restore();
}
function analyzeAudio(now){
  if(!state.analyser||now-state.lastAudio<90)return;
  state.lastAudio=now;state.analyser.getByteTimeDomainData(state.audioArray);
  let sum=0;for(const a of state.audioArray){const v=(a-128)/128;sum+=v*v;}
  state.micRms=Math.sqrt(sum/state.audioArray.length);
  $('audioBar').style.width=`${Math.min(100,Math.round(state.micRms*650))}%`;
}
function frameLoop(now){
  if(!state.camera)return;
  state.animation=requestAnimationFrame(frameLoop);
  if(now-state.lastDraw<38)return;
  state.lastDraw=now;drawPortrait();analyzeAudio(now);
  if(state.checking&&state.engineReady&&!state.paused&&now-state.lastVision>430){
    state.lastVision=now;
    try{performVision(now);}catch(err){console.error('Vision check error',err);if(!state.modelsError){state.modelsError=err.message||'Vision error';showAlert('Vision processing error','A camera check failed. Reload the studio after saving any active recording.');}state.ready=false;syncControls();}
  }
  drawGuides();
  if(state.recording){const elapsed=msElapsed();$('sessionTimer').textContent=formatClock(elapsed,true);$('stageTimer').textContent=formatClock(elapsed);if(state.activeTake){const takeProgress=elapsed-state.activeTake.startMs;if($('autoScroll').checked&&!state.paused){const speed=Number($('scrollPace').value);const target=35000*(1.5-.18*speed);const p=Math.min(1,takeProgress/target);el.scriptWindow.scrollTop=p*(el.scriptWindow.scrollHeight-el.scriptWindow.clientHeight);}}}
}
function rectDistancePoint(x,y,r){const dx=Math.max(r.x-x,0,x-r.x-r.w),dy=Math.max(r.y-y,0,y-r.y-r.h);return Math.sqrt(dx*dx+dy*dy*1.7);}
function nearHand(rect,hands){return hands.some(lm=>[0,5,9,13,17].some(i=>lm[i]&&rectDistancePoint(lm[i].x,lm[i].y,rect)<.19));}
function detectProduct(now){
  const candidates=(state.objectDetector.detectForVideo(CANVAS,now).detections||[]).map(d=>{
    const category=d.categories?.[0],box=d.boundingBox;
    if(!box||!PRODUCT_CLASSES.has(category?.categoryName))return null;
    return {label:category.categoryName,score:category.score,rect:{x:box.originX/W,y:box.originY/H,w:box.width/W,h:box.height/H}};
  }).filter(Boolean).filter(item=>nearHand(item.rect,state.hands));
  const product=candidates.sort((a,b)=>b.score-a.score)[0];
  if(!product)return false;
  state.productBox=product.rect;state.productLabel=product.label;state.productConfidence=Math.round(product.score*100);state.productVerified=true;
  return true;
}
function performVision(now){
  const faceResult=state.faceDetector.detectForVideo(CANVAS,now);
  const handResult=state.handLandmarker.detectForVideo(CANVAS,now);
  state.face=faceResult.detections?.[0]?.boundingBox||null;
  state.hands=handResult.landmarks||[];
  const f=state.face;let faceOK=false,headOK=false;
  if(f){
    const cx=(f.originX+f.width/2)/W;const top=f.originY/H;const width=f.width/W;
    faceOK=cx>=.35&&cx<=.65&&width>.13&&width<.59;
    headOK=top>=.1;
  }
  const handOK=state.hands.some(lm=>{const wrist=lm[0];return wrist&&wrist.y>.25&&wrist.y<.94;});
  const productOK=handOK&&(detectProduct(now)||(state.recording&&state.productVerified));
  const rawChecks={face:faceOK,head:headOK,hand:handOK,product:productOK};
  for(const key of Object.keys(rawChecks)){
    if(rawChecks[key])state.lastCheckSeen[key]=now;
    // MediaPipe can miss an otherwise stable subject for one frame.
    state.checks[key]=rawChecks[key]||(state.checks[key]&&now-(state.lastCheckSeen[key]||0)<CHECK_GRACE_MS);
  }
  updateChecklist();
  const all=Object.values(state.checks).every(Boolean);
  if(all){if(!state.alignmentSince)state.alignmentSince=now;}else state.alignmentSince=0;
  const wasReady=state.ready;
  state.ready=all&&!!state.alignmentSince&&now-state.alignmentSince>=2000;
  if(wasReady!==state.ready)syncControls();
  if(state.recording&&!state.paused)watchIssues(now);
  if(!state.recording&&state.checking){
    if(!f)el.readyText.innerHTML='<span class="dot muted"></span> Move into view so your face is visible.';
    else if(!state.checks.product)el.readyText.innerHTML='<span class="dot muted"></span> Hold a supported product in your visible hand.';
    else if(state.ready)el.readyText.innerHTML='<span class="dot green"></span> Framing locked — you can start recording.';
    else el.readyText.innerHTML='<span class="dot muted"></span> Adjust the red checks and hold steady for 2 seconds.';
  }
}
function updateChecklist(){
  const labels={face:[state.face?'Move into the center of the frame':'No face detected','Centered'],head:['Lower your head slightly to keep the top gap','10% top gap'],hand:['Show a hand holding the product','Hand visible'],product:['Hold a supported product near your visible hand','Product visible']};
  let passed=0;
  for(const key of ['face','head','hand','product']){
    const success=state.checks[key];if(success)passed++;
    const row=$(key+'Row'),ico=row.querySelector('.check-icon');row.className='check-row '+(success?'passed':state.checking?'failed':'');ico.textContent=success?'✓':state.checking?'!':'○';
    $(key+'State').textContent=success?'PASS':state.checking?'FIX':'WAIT';$(key+'Detail').textContent=success?labels[key][1]:labels[key][0];
  }
  $('checkCount').textContent=`${passed} / 4`;
}
function watchIssues(now){
  const messages={face:'Face moved out of the center',head:'Top gap above your head is too small',hand:'Your hand is no longer clearly visible',product:'Product appearance could not be confirmed near your hand'};
  for(const key of Object.keys(messages)){
    if(state.checks[key]){delete state.issueSince[key];continue;}
    if(!state.issueSince[key])state.issueSince[key]=now;
    if(now-state.issueSince[key]>1700&&state.activeTake){
      const active=state.activeTake;
      if(!active.warnings.some(w=>w.rule===key)){
        active.needsRetake=true;
        const warning={rule:key,message:messages[key],atMs:msElapsed()};active.warnings.push(warning);
        logEvent('warning',`Retake flagged: ${messages[key]}`,{scriptId:active.scriptId,rule:key});
        toast(messages[key]+' — current script flagged for retake',true);
      }
      const banner=$('liveBanner');banner.hidden=false;banner.textContent=`⚠ ${messages[key]} — recording continues. Re-record this script.`;
    }
  }
  if(Object.values(state.checks).every(Boolean)){$('liveBanner').hidden=true;}
}
function drawGuides(){
  GCTX.clearRect(0,0,W,H);
  if(!state.camera||!state.checking)return;
  GCTX.strokeStyle='#adf0df6b';GCTX.lineWidth=2;GCTX.setLineDash([7,8]);
  GCTX.strokeRect(W*.17,H*.065,W*.66,H*.73);
  GCTX.beginPath();GCTX.moveTo(W*.5,H*.06);GCTX.lineTo(W*.5,H*.89);GCTX.stroke();
  GCTX.setLineDash([]);
  GCTX.strokeStyle='#ffd78a';GCTX.lineWidth=3;GCTX.beginPath();GCTX.moveTo(W*.16,H*.1);GCTX.lineTo(W*.84,H*.1);GCTX.stroke();
  GCTX.fillStyle='#fff0b8';GCTX.font='bold 16px system-ui';GCTX.fillText('KEEP HEAD BELOW THIS LINE',W*.18,H*.1-10);
  if(state.face){const f=state.face;GCTX.strokeStyle=state.checks.face&&state.checks.head?'#63efcf':'#ff9b83';GCTX.lineWidth=3;GCTX.strokeRect(f.originX,f.originY,f.width,f.height);}
  if(state.productBox){const r=state.productBox;GCTX.lineWidth=4;GCTX.strokeStyle=state.checks.product?'#63efcf':'#ffb883';GCTX.strokeRect(r.x*W,r.y*H,r.w*W,r.h*H);GCTX.font='bold 20px system-ui';GCTX.fillStyle=GCTX.strokeStyle;GCTX.fillText('PRODUCT',r.x*W,Math.max(22,r.y*H-10));}
}

function beginChecking(){if(!state.camera||!state.engineReady||state.checking)return;state.checking=true;state.alignmentSince=0;state.ready=false;state.issueSince={};state.lastCheckSeen={};syncControls();logEvent('info','Live alignment checks activated automatically');}

function advanceScript(direction){
  if(direction>0&&state.scriptIndex===state.scripts.length-1){state.round++;state.scriptIndex=0;buildScripts();logEvent('info',`New simulated script round ${state.round}`);}
  else state.scriptIndex=Math.max(0,Math.min(state.scripts.length-1,state.scriptIndex+direction));
  renderScript();
  if(state.recording)startTake();
}
function startTake(){
  const s=currentScript();const num=state.takes.filter(t=>t.scriptId===s.id).length+1;
  state.activeTake={takeId:`take-${++state.takeSeq}`,scriptId:s.id,scriptTitle:s.title,
                    scriptText:s.text,attempt:num,startMs:msElapsed(),warnings:[],needsRetake:false};
  state.issueSince={};$('liveBanner').hidden=true;renderScript();
  logEvent('info',`Started ${s.id} · take ${num}`,{scriptId:s.id});
}
function finishTake(reason='finished'){
  if(!state.activeTake)return null;
  const current=state.activeTake;current.endMs=msElapsed();current.durationMs=Math.max(0,current.endMs-current.startMs);
  current.status=reason==='retake'?'replaced':current.needsRetake?'retake-recommended':'accepted';
  state.takes.push(current);state.activeTake=null;
  $('takeCount').textContent=`${state.takes.length} take${state.takes.length===1?'':'s'}`;
  logEvent('info',`${current.scriptId} · ${current.status} (${formatClock(current.durationMs)})`,{scriptId:current.scriptId});
  return current;
}
function finishAndNext(direction=1){
  if(!state.recording){advanceScript(direction);return;}
  if(state.paused){toast('Resume recording before changing scripts.',true);return;}
  const take=finishTake();
  if(take?.needsRetake){state.pendingDirection=direction;el.retakeModal.hidden=false;el.modalBody.textContent=`${take.warnings.length} alignment issue(s) were detected during ${take.scriptId}. Recording is still running. Re-record this script or continue with the flagged take.`;}
  else advanceScript(direction);
}
function retakeNow(){
  if(!state.recording||state.paused)return;
  finishTake('retake');startTake();toast('Retake started. Keep framing and the product in view.');
}

async function api(path,options={}){
  const response=await fetch(`${API_BASE}${path}`,{cache:'no-store',...options});let body;
  try{body=await response.json();}catch{throw Error('Local recording server returned an invalid response');}
  if(!response.ok)throw Error(body.error||`Server returned ${response.status}`);
  return body;
}
function preferredMime(){return ['video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus','video/webm'].find(m=>window.MediaRecorder?.isTypeSupported(m))||'';}
async function startRecording(){
  if(state.recording||!state.ready||!state.engineReady)return;
  if(!CANVAS.captureStream||!window.MediaRecorder){toast('This browser cannot record canvas video. Please use current Chrome or Edge.',true);return;}
  el.start.disabled=true;
  try{
    const session=await api('/api/session/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({productName:el.productName.value,sellingPoint:el.sellingPoint.value})});
    state.serverSession=session;state.seq=0;state.uploadQueue=Promise.resolve();state.failedUpload=false;state.uploadedBytes=0;
    state.outputStream=CANVAS.captureStream(24);
    const tracks=[...state.outputStream.getVideoTracks(),...state.sourceStream.getAudioTracks()];
    if(!state.sourceStream.getAudioTracks().length)throw Error('Microphone missing; record cannot start without audio.');
    const recordStream=new MediaStream(tracks);const mime=preferredMime();
    if(!mime)throw Error('WebM recording is unsupported. Use Chrome or Edge.');
    state.recorder=new MediaRecorder(recordStream,{mimeType:mime,videoBitsPerSecond:1800000,audioBitsPerSecond:128000});
    state.recorder.addEventListener('dataavailable',event=>{
      if(!event.data||event.data.size===0)return;
      const seq=state.seq++;const chunk=event.data;
      state.uploadQueue=state.uploadQueue.then(()=>uploadChunk(seq,chunk));
    });
    state.recorder.onerror=(event)=>{showAlert('Recorder error',event.error?.message||'Recorder stopped unexpectedly. Click Done & save.');};
    state.startedAt=performance.now();state.pausedAccum=0;state.pauseStarted=0;
    state.takes=[];state.takeSeq=0;state.events=[];el.activity.innerHTML='';
    state.recording=true;state.paused=false;state.recorder.start(2500);
    startTake();syncControls();
    toast('Recording started! Video chunks are saving to your local laptop.');
    el.readyText.innerHTML='<span class="dot green"></span> Live monitoring is active. Invalid takes will be flagged.';
  }catch(error){console.error(error);showAlert('Recording could not start',error.message||String(error));toast('Start failed: '+error.message,true);syncControls();}
}
async function uploadChunk(seq,chunk){
  const url=`/api/session/${state.serverSession.id}/chunk/${seq}`;
  for(let retry=0;retry<40;retry++){
    try{
      const r=await api(url,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:chunk});
      state.uploadedBytes+=chunk.size;
      if(state.failedUpload){state.failedUpload=false;toast('Local save connection restored. Resume when ready.');}
      return r;
    }catch(e){
      if(!state.failedUpload){state.failedUpload=true;
        if(state.recorder?.state==='recording'){state.recorder.pause();state.paused=true;state.pauseStarted=performance.now();syncControls();}
        showAlert('Local saving interrupted','The connection to the local Python server was lost. Recording has paused while it retries. Keep this tab open and restart the server if needed.');logEvent('warning','Local server disconnected; recording paused');}
      if(retry===39)throw Error('Unable to store recording chunk after retries: '+e.message);
      await new Promise(resolve=>setTimeout(resolve,1800));
    }
  }
}
async function togglePause(){
  if(!state.recording||state.saving)return;
  if(!state.paused){
    state.recorder.pause();state.paused=true;state.pauseStarted=performance.now();
    logEvent('info','Recording manually paused');toast('Recording paused. Click Resume when ready.');
  }else{
    if(state.failedUpload){toast('Still reconnecting to the local server. Cannot resume.',true);return;}
    state.pausedAccum+=performance.now()-state.pauseStarted;state.paused=false;state.pauseStarted=0;
    state.recorder.resume();state.issueSince={};logEvent('info','Recording resumed');toast('Recording resumed.');
  }
  syncControls();
}
function buildMetadata(){
  return {schemaVersion:'1.0',sessionId:state.serverSession?.id||null,
    productName:el.productName.value.trim(),sellingPoint:el.sellingPoint.value.trim(),
    recordedAt:new Date().toISOString(),durationMs:state.finalMs,
    video:{format:'webm',width:W,height:H,portrait:true,codec:state.recorder?.mimeType||'',bytesUploaded:state.uploadedBytes},
    disclaimer:'A supported product class is verified before recording. During recording, rotation is allowed while a hand remains visible; product identity is not continuously verified.',
    takes:state.takes,events:state.events};
}
async function doneAndSave(){
  if(!state.recording||state.saving)return;
  state.saving=true;state.finalMs=msElapsed();state.ready=false;hideAlert();$('liveBanner').hidden=true;
  if(state.activeTake)finishTake();
  state.recording=false;state.paused=false;el.retakeModal.hidden=true;syncControls();
  $('sessionTimer').textContent=formatClock(state.finalMs,true);
  $('recStatus').innerHTML='<span class="dot muted"></span> Finalizing local files…';
  showAlert('Finalizing recording','Closing the video and writing your take/timestamp log to the recordings folder. Keep this tab open until the confirmation appears.');
  try{
    const recorder=state.recorder;
    if(recorder&&recorder.state!=='inactive')await new Promise((resolve,reject)=>{
      recorder.addEventListener('stop',resolve,{once:true});
      recorder.addEventListener('error',()=>reject(Error('Recorder stopped with an error')),{once:true});
      recorder.stop();
    });
    await state.uploadQueue;
    if(!state.seq)throw Error('No non-empty video chunks were recorded');
    const metadata=buildMetadata();
    const result=await api(`/api/session/${state.serverSession.id}/finish`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lastChunk:state.seq-1,metadata})});
    hideAlert();$('savedPanel').hidden=false;$('savedDetails').textContent=`Saved ${Math.round(result.bytes/1024/1024)} MB + ${state.takes.length} takes in ${result.storage}.`;
    $('videoLink').href=result.videoUrl;$('metadataLink').href=result.metadataUrl;
    logEvent('info','Recording and session log saved locally');toast('Saved locally! Video and session log are ready.');await refreshSessions();
    $('savedPanel').scrollIntoView({behavior:'smooth',block:'center'});
  }catch(error){console.error(error);showAlert('Save did not finish',`${error.message}. Your received video chunks remain in the recordings folder as recording.webm.part. Use “Recover” in Previous sessions if needed.`);toast('Could not finalize video; see recovery option.',true);await refreshSessions();}
  finally{state.saving=false;state.outputStream?.getTracks().forEach(t=>t.stop());state.startedAt=0;syncControls();}
}
async function refreshSessions(){
  try{
    const data=await api('/api/sessions');const list=$('previousSessions');list.innerHTML='';
    if(!data.items.length){list.textContent='No sessions recorded yet.';return;}
    for(const s of data.items){
      const row=document.createElement('div');row.className='past-item';
      const left=document.createElement('div'),name=document.createElement('strong'),detail=document.createElement('small');
      name.textContent=s.productName||'Untitled session';detail.textContent=`${s.status} · ${new Date(s.createdAt).toLocaleString()} · ${(s.size/1024/1024).toFixed(1)} MB`;
      left.append(name,detail);row.append(left);
      if(s.hasVideo){const a=document.createElement('a');a.href=`/api/session/${s.id}/video`;a.textContent='Download video ↓';row.append(a);}
      else if(s.hasPartial&&s.chunks){const btn=document.createElement('button');btn.textContent='Recover partial video';btn.addEventListener('click',async()=>{if(state.recording){toast('Finish the active recording before recovering a previous file.',true);return;}try{await api(`/api/session/${s.id}/recover`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});toast('Partial video recovered. Playback is not guaranteed.');await refreshSessions();}catch(err){toast(err.message,true);}});row.append(btn);}
      list.append(row);
    }
  }catch(error){$('previousSessions').textContent='Cannot read local sessions. Make sure the Python server is running.';}
}

el.camera.addEventListener('click',startCamera);
el.start.addEventListener('click',startRecording);
el.pause.addEventListener('click',togglePause);
el.finish.addEventListener('click',()=>finishAndNext(1));
el.retake.addEventListener('click',retakeNow);
el.done.addEventListener('click',doneAndSave);
el.next.addEventListener('click',()=>finishAndNext(1));
el.prev.addEventListener('click',()=>finishAndNext(-1));
el.apply.addEventListener('click',()=>{state.scriptIndex=0;state.round=1;buildScripts();toast('Sample scripts updated.');});
$('confirmRetake').addEventListener('click',()=>{el.retakeModal.hidden=true;startTake();toast('Re-recording the same script.');});
$('skipRetake').addEventListener('click',()=>{el.retakeModal.hidden=true;advanceScript(state.pendingDirection);toast('Take kept with a retake warning in the session log.');});
$('refreshSessions').addEventListener('click',refreshSessions);
window.addEventListener('beforeunload',ev=>{if(state.recording||state.saving){ev.preventDefault();ev.returnValue='';}});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.recording&&!state.paused){logEvent('warning','Browser tab hidden: video frames may freeze in background');if(state.activeTake){state.activeTake.needsRetake=true;state.activeTake.warnings.push({rule:'tab-hidden',message:'Tab moved to background',atMs:msElapsed()});}}});

buildScripts();updateChecklist();syncControls();refreshSessions();
