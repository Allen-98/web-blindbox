(function () {
'use strict';
var Engine=window.MoonFishingEngine, Wallet=window.MoonFishingWallet, Box=window.MooncakeBlindBoxEngine;
var Feedback=window.MoonFishingFeedback;
var itemNames={moon:'月亮',fish:'小鱼',rock:'石头',debris:'碎片',rabbit:'玉兔',branch:'桂枝',mooncake:'月饼'};
var ASSETS={lake:'assets/moon-scene.webp',boat:'assets/rabbit-boat.webp',moon:'assets/moon.webp',fish:'assets/fish.webp',rock:'assets/rock.webp'};
var els={},screens={},screen='home',wallet=Wallet.fresh(),round=null,scene=null,game=null,sceneReady=false,pending=false,resultKind=null,resultHandled=null,lastFocus=null,storage=null,storageWorks=true,activeFrameAt=null,mutexDBPromise=null;
var reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
var collectionWallet=null,collectionCache=null;
function currentCollection(){if(collectionWallet!==wallet){collectionWallet=wallet;collectionCache=Wallet.collection(wallet);}return collectionCache;}
function id(prefix){return prefix+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);}
function text(el,value){if(el.textContent!==String(value))el.textContent=String(value);}
function toast(message){text(els.toast,message);els.toast.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(function(){els.toast.classList.remove('show');},2400);}
function announce(message){text(els.liveMessage,message);}
function storageStatus(){els.storageNote.hidden=storageWorks;document.body.classList.toggle('storage-unavailable',!storageWorks);}
function save(){var saved=Wallet.save(storage,wallet);if(!saved){storageWorks=false;storageStatus();}return saved;}
function load(){try{storage=window.localStorage;}catch(_){storage=null;}var loaded=Wallet.load(storage);wallet=loaded.state;storageWorks=loaded.available;storageStatus();if(loaded.recovered&&loaded.available){toast('存档已损坏，已恢复为初始进度');save();}}
function refreshWallet(){if(!storageWorks)return;var loaded=Wallet.load(storage);if(loaded.available)wallet=loaded.state;}
function walletMutexDB(){
if(mutexDBPromise)return mutexDBPromise;
mutexDBPromise=new Promise(function(resolve,reject){
var request;
try{request=window.indexedDB.open('moonfishing-wallet-lock-v2',1);}catch(error){reject(error);return;}
request.onupgradeneeded=function(){request.result.createObjectStore('mutex');};
request.onerror=function(){reject(request.error||new Error('Wallet lock unavailable'));};
request.onsuccess=function(){var db=request.result;db.onversionchange=function(){db.close();mutexDBPromise=null;};resolve(db);};
});
return mutexDBPromise;
}
async function withWalletMutex(commit){
var db=await walletMutexDB();
return new Promise(function(resolve,reject){
var result,commitError,transaction;
try{transaction=db.transaction('mutex','readwrite');}catch(error){reject(error);return;}
transaction.oncomplete=function(){resolve(result);};
transaction.onabort=function(){reject(commitError||transaction.error||new Error('Wallet lock aborted'));};
transaction.onerror=function(){};
// A readwrite transaction serializes this store across same-origin tabs.
// Keep the localStorage read/action/write synchronous inside this callback.
var request=transaction.objectStore('mutex').get('wallet');
request.onsuccess=function(){try{result=commit();}catch(error){commitError=error;transaction.abort();}};
});
}
async function transaction(action){
if(pending)return null;
pending=true;renderHUD();
var commit=function(){refreshWallet();var result=action(wallet);wallet=result.state;if(storageWorks)save();return result;};
try{
var result;
if(storageWorks&&navigator.locks&&navigator.locks.request)result=await navigator.locks.request('moonfishing-wallet-v2',commit);
else if(storageWorks)result=await withWalletMutex(commit);
else result=commit();
return result;
}catch(error){
// If cross-tab exclusion is unavailable, do not write another cached wallet.
// Continue this page in memory and clearly report that new progress is unsaved.
refreshWallet();storageWorks=false;storage=null;storageStatus();
var fallback=action(wallet);wallet=fallback.state;return fallback;
}finally{pending=false;renderHUD();}
}
function showScreen(name){
screen=name;Object.keys(screens).forEach(function(key){screens[key].hidden=key!==name;});renderHUD();
if(name==='fishing'&&game){requestAnimationFrame(function(){game.scale.refresh();});}
}
function renderHUD(){
text(els.homeTickets,wallet.tickets);text(els.homeScore,wallet.totalScore);text(els.ticketBalance,wallet.tickets);text(els.blindboxTickets,wallet.tickets);text(els.blindboxScore,wallet.totalScore);
text(els.startFishing,'开始捞月 →');
text(els.openBlindboxHome,wallet.blindRound?'继续本小局':wallet.tickets?'打开盲盒 · 1 张券':'先捞月，赢盲盒券');
text(els.homeHint,wallet.blindRound?'本小局已兑换，可随时继续打开。':wallet.tickets?'券可以累积，每一张只兑换一小局。':'初始 0 张券，捞月胜利才会获得。');
els.startFishing.disabled=pending;els.openBlindboxHome.disabled=pending;
var collected=currentCollection();text(els.homeCollection,Box.TYPES.filter(function(type){return collected[type]>0;}).length+'/3');
els.openRecords.disabled=pending;els.openCollection.disabled=pending;
text(els.soundButton,Feedback.isMuted()?'音效：关':'音效：开');text(els.pauseSound,Feedback.isMuted()?'音效：关':'音效：开');
els.soundButton.setAttribute('aria-pressed',String(!Feedback.isMuted()));els.pauseSound.setAttribute('aria-pressed',String(!Feedback.isMuted()));
if(round){
text(els.timer,Math.ceil(round.remainingMs/1000));text(els.collected,round.collected+' / 3');
els.timer.style.color=round.remainingMs<=10000?'#ffc27d':'';
var busy=round.hook.phase!=='idle';
els.fireButton.disabled=busy||round.phase!=='playing'||pending||!sceneReady;
els.fireButton.firstChild.nodeValue=busy?'回收中':'放钩';
if(round.hook.phase==='extending')els.fireButton.firstChild.nodeValue='出钩中';
els.releaseButton.disabled=pending||!sceneReady||!Engine.canRelease(round);
els.releaseButton.firstChild.nodeValue=round.releasesLeft?'松钩 · 1次':'松钩 · 已用';
els.releaseButton.classList.toggle('can-release',!els.releaseButton.disabled);
text(els.releaseButton.querySelector('.button-sub'),round.releasesLeft?'抓住后可放下':'下局恢复');
var hint=round.hook.phase==='retracting'&&round.hook.carriedIds.length?'正在拉回'+(round.hook.carriedIds.some(function(id){return round.entities.find(function(e){return e.id===id;}).type==='moon';})?'月亮':itemNames[round.hook.targetType])+(round.hook.targetType==='rock'?' · 石头较重，可考虑松钩':' · 回船才算收获'):round.hook.phase==='retracting'?'空钩回收中':round.hook.phase==='extending'?'钩子已出发，等待这次收获':'等钩子朝向月亮，再轻点放钩';
text(els.aimHint,hint);
}
els.pauseButton.disabled=pending;els.backHome.disabled=pending;
}
function showOverlay(which){
lastFocus=document.activeElement;
els.pauseOverlay.hidden=which!=='pause';els.resultOverlay.hidden=which!=='result';
document.getElementById('app').inert=true;
var button=which==='pause'?els.resumeButton:els.resultAction;requestAnimationFrame(function(){button.focus();});
}
function hideOverlays(){els.pauseOverlay.hidden=true;els.resultOverlay.hidden=true;document.getElementById('app').inert=false;if(lastFocus&&lastFocus.isConnected&&!lastFocus.closest('[hidden]'))lastFocus.focus();}
function modalOpen(){return !els.pauseOverlay.hidden||!els.resultOverlay.hidden;}
function pauseGame(){
if(!round||round.phase!=='playing'||screen!=='fishing'||pending)return;
advanceRoundTo(performance.now());activeFrameAt=null;
if(round.phase!=='playing')return;
round=Engine.pause(round);renderHUD();showOverlay('pause');announce('捞月已暂停');
if(scene)scene.tweens.pauseAll();
}
function resumeGame(){if(round&&round.phase==='paused'){Feedback.unlock();round=Engine.resume(round);activeFrameAt=performance.now();if(scene)scene.tweens.resumeAll();hideOverlays();renderHUD();announce('继续捞月');}}
function exitFishing(){hideOverlays();clearEffects();round=null;activeFrameAt=null;resultHandled=null;showScreen('home');renderScene();}
function startFishing(){
if(pending)return;
Feedback.unlock();clearEffects();if(scene)scene.tweens.resumeAll();
hideOverlays();round=Engine.createRound(Math.random,id('fish'));activeFrameAt=sceneReady?performance.now():null;resultHandled=null;resultKind=null;
showScreen('fishing');if(!game)createGame();else renderScene();announce('60秒捞月开始，捞回三颗月亮');
}
function fireHook(){
if(screen!=='fishing'||modalOpen()||pending||!sceneReady||!round)return;
advanceRoundTo(performance.now());
if(round.phase!=='playing'||pending||modalOpen())return;
var fired=Engine.fire(round);if(!fired.accepted)return;round=fired.state;renderHUD();renderScene();
consumeFeedback(round.events);
}
function releaseHook(){
if(screen!=='fishing'||modalOpen()||pending||!sceneReady||!round)return;
advanceRoundTo(performance.now());if(round.phase!=='playing'||pending||modalOpen())return;
var released=Engine.release(round);if(!released.accepted)return;
round=released.state;consumeFeedback(round.events);renderHUD();renderScene();announce('物品已放回水中，本局松钩机会已使用');
}
function advanceRoundTo(now){
if(screen==='fishing'&&round&&round.phase==='playing'&&sceneReady){
if(activeFrameAt===null){activeFrameAt=now;return;}
var delta=Math.max(0,now-activeFrameAt);activeFrameAt=now;
if(delta===0)return;
var previous=round.collected;round=Engine.tick(round,delta);
consumeFeedback(round.events);
if(round.collected!==previous){
announce('已捞回'+round.collected+'颗月亮');
els.collected.classList.remove('moon-arrived');void els.collected.offsetWidth;els.collected.classList.add('moon-arrived');
}
if(round.phase==='success'||round.phase==='failed'){activeFrameAt=null;finishFishing();}
}
}
function frame(){
if(!document.hidden&&!modalOpen())advanceRoundTo(performance.now());
else activeFrameAt=null;
renderScene();renderHUD();
}
async function finishFishing(){
if(!round||resultHandled===round.id)return;
resultHandled=round.id;var completed=round,success=round.phase==='success';
var result=await transaction(function(saved){var previous=Wallet.personal(saved),done=Wallet.completeFishing(saved,completed);done.newBest=success&&previous.bestMs!==null&&completed.elapsedMs<previous.bestMs;return done;});if(!result)return;
resultKind=success?'fishing-success':'fishing-failed';
text(els.resultKicker,success?'月满 · 礼成':'月影散去');
text(els.resultTitle,success?'捞月成功':'这次差一点');
text(els.resultSymbol,success?'☾':'⋆');
text(els.resultDetail,success?'三颗月亮已回船，1 张盲盒券已存入钱包。':'60 秒到了，捞回 '+completed.collected+' / 3 颗月亮。没有扣券，可以再试一次。');
renderResultStats(completed,result.newBest);Feedback.play(success?'win':'failed');
text(els.resultAction,success?'用 1 张券开盲盒':'再捞一次');
text(els.resultSecondary,success?'继续捞月，积累券':'回首页');
announce(success?'捞月成功，获得一张盲盒券':'捞月结束');
showOverlay('result');
}
function clearEffects(){if(!scene||!scene.fxViews)return;scene.fxViews.forEach(function(view){scene.tweens.killTweensOf(view);view.destroy();});scene.fxViews=[];}
function animateEffect(view,config){
scene.fxViews.push(view);config.targets=view;config.onComplete=function(){var index=scene.fxViews.indexOf(view);if(index>=0)scene.fxViews.splice(index,1);view.destroy();};scene.tweens.add(config);
}
function consumeFeedback(events){
(events||[]).forEach(function(event){
var sound=event.kind==='launch'?'launch':event.kind==='release'?'release':event.kind==='catch'?(event.moons?'catch':event.type==='rock'||event.type==='debris'?'rock':'catch'):event.moons?'moon':event.type==='empty'?'empty':null;
if(sound)Feedback.play(sound);
if(!scene)return;
var x=event.x,y=event.y;
if(event.kind==='launch'){
if(!reducedMotion){for(var i=0;i<2;i++){var ripple=scene.add.ellipse(x,y+3,18,6,0xa4dfed,0).setStrokeStyle(2,0xc7ecdf,.65).setDepth(15);animateEffect(ripple,{scaleX:3+i,scaleY:3+i,alpha:0,duration:450+i*100});}}
return;
}
if(event.kind==='delivery'&&!event.moons)return;
var label=event.kind==='release'?'已放回水中':event.kind==='delivery'?'☾ 月亮回船 +1':event.moons?'抓到月亮':itemNames[event.type]+'入钩';
var caption=scene.add.text(Math.max(85,Math.min(395,x)),Math.max(186,Math.min(568,y-38)),label,{fontFamily:'"Microsoft YaHei",sans-serif',fontSize:'16px',fontStyle:'bold',color:event.moons?'#fff0ac':'#d7eff0',backgroundColor:'#09263ee6',padding:{x:9,y:6}}).setOrigin(.5).setDepth(25);
animateEffect(caption,{alpha:0,y:caption.y-(reducedMotion?0:22),delay:reducedMotion?300:180,duration:reducedMotion?1:620});
if(event.kind==='delivery'&&event.moons&&!reducedMotion){
var glint=scene.add.image(Engine.ORIGIN.x,Engine.ORIGIN.y,'moon').setDisplaySize(34,34).setDepth(26);
animateEffect(glint,{x:350,y:22,scaleX:glint.scaleX*.3,scaleY:glint.scaleY*.3,alpha:0,duration:600});
}
});
}
function seconds(ms){return (ms/1000).toFixed(1)+' 秒';}
function renderResultStats(completed,newBest){
els.resultStats.hidden=false;els.resultStats.replaceChildren();
[[seconds(completed.elapsedMs),'本局用时'],[completed.metrics.shots+' 次','放钩'],[completed.collected+'/3','月亮回船']].forEach(function(pair){var cell=document.createElement('span'),value=document.createElement('b'),label=document.createElement('small');text(value,pair[0]);text(label,pair[1]);cell.append(value,label);els.resultStats.append(cell);});
var note=document.createElement('p');note.className='result-performance';text(note,(newBest?'刷新最快纪录 · ':completed.phase==='success'&&completed.metrics.shots===3?'一钩一月 · ':'')+'空钩 '+completed.metrics.emptyReturns+' · 障碍 '+completed.metrics.obstacleReturns+' · 松钩 '+completed.metrics.releases+'/1');els.resultStats.append(note);
}
function openJournal(tab){if(pending)return;hideOverlays();round=null;clearEffects();showScreen('journal');renderJournal(tab);}
function renderJournal(tab){
tab=tab||(!els.collectionPanel.hidden?'collection':'records');
els.recordsPanel.hidden=tab!=='records';els.collectionPanel.hidden=tab!=='collection';els.recordsTab.setAttribute('aria-pressed',String(tab==='records'));els.collectionTab.setAttribute('aria-pressed',String(tab==='collection'));
var stats=Wallet.personal(wallet);text(els.personalWins,stats.wins);text(els.personalTime,stats.bestMs===null?'—':seconds(stats.bestMs));text(els.personalShots,stats.bestShots===null?'—':stats.bestShots+' 次');text(els.personalAccuracy,stats.accuracy===null?'—':stats.accuracy+'%');
text(els.personalSummary,'本版已结算 '+stats.completed+' 局 · 胜利 '+stats.recordedWins+' 局 · 未完成目标 '+stats.failed+' 局');els.recentRecords.replaceChildren();
if(!stats.recent.length){var empty=document.createElement('li');empty.className='empty-records';text(empty,'湖上还没有新的足迹。完成一局捞月，留下第一份成绩。');els.recentRecords.append(empty);}
stats.recent.forEach(function(record){var row=document.createElement('li'),title=document.createElement('b'),detail=document.createElement('span');row.className=record.outcome==='success'?'record-success':'record-failed';text(title,record.outcome==='success'?'☾ 三月归舟':'月影待续 · '+record.moons+'/3');text(detail,seconds(record.elapsedMs)+' · '+record.shots+' 次放钩 · 松钩 '+record.releases+'/1');row.append(title,detail);els.recentRecords.append(row);});
var counts=Wallet.collection(wallet),unlocked=Box.TYPES.filter(function(type){return counts[type]>0;}).length; text(els.collectionSummary,'已收藏 '+unlocked+' / 3 类 · 盲盒累计获奖 '+wallet.records.length+' 次');els.collectionCards.replaceChildren();
var descriptions={rabbit:'月下捣药，捎来团圆的好消息。',branch:'一枝金桂，把湖上的秋香留住。',mooncake:'把圆满与甜意，藏进这一枚月饼。'};
Box.TYPES.forEach(function(type){var card=document.createElement('article');card.className='collection-card'+(counts[type]?' is-collected':' is-locked');card.dataset.type=type;var art=document.createElement('div');art.className='collection-art reveal-'+type;art.setAttribute('aria-hidden','true');var name=document.createElement('h3'),description=document.createElement('p'),count=document.createElement('strong');text(name,itemNames[type]);text(description,counts[type]?descriptions[type]:'在盲盒中集齐三个'+itemNames[type]+'，点亮这页收藏。');text(count,counts[type]?'已获得 '+counts[type]+' 次':'尚未收藏');card.append(art,name,description,count);els.collectionCards.append(card);});
}
function createGame(){
var FishingScene=new Phaser.Class({
Extends:Phaser.Scene,
initialize:function FishingScene(){Phaser.Scene.call(this,{key:'lake'});this.entityViews={};this.fxViews=[];},
preload:function(){var self=this;Object.keys(ASSETS).forEach(function(key){self.load.image(key,ASSETS[key]);});},
create:function(){
scene=this;
this.add.image(240,310,'lake').setDisplaySize(480,720).setAlpha(.64);
this.add.rectangle(240,389,480,466,0x052943,.59);
this.water=this.add.graphics().setDepth(2);
this.add.ellipse(232,153,225,16,0xe5c98b,.12).setDepth(3);
this.boat=this.add.image(216,108.57,'boat').setDisplaySize(240,100.08).setDepth(10);
this.rope=this.add.graphics().setDepth(12);
this.input.on('pointerdown',function(){fireHook();});
sceneReady=true;activeFrameAt=round&&round.phase==='playing'?performance.now():null;renderHUD();renderScene();
},
update:function(){frame();}
});
game=new Phaser.Game({type:Phaser.AUTO,parent:'game-canvas',width:Engine.WIDTH,height:Engine.HEIGHT,backgroundColor:'#08233d',scale:{mode:Phaser.Scale.FIT,autoCenter:Phaser.Scale.CENTER_BOTH},render:{antialias:true,pixelArt:false},input:{activePointers:2},scene:FishingScene,fps:{target:60,min:10}});
}
function renderScene(){
if(!scene)return;
var elapsed=round?round.elapsedMs:0;
scene.water.clear();scene.water.lineStyle(1,0x8ebec3,.14);
for(var i=0;i<13;i++){var yy=169+i*34,xx=20+(i*83)%390;var shift=reducedMotion?0:Math.sin(elapsed/3000+i)*9;scene.water.lineBetween(xx+shift,yy,xx+35+shift,yy);}
scene.water.lineStyle(2,0xe6ce90,.36);scene.water.lineBetween(150,158,330,158);
var alive={};
if(round){
round.entities.forEach(function(e){
if(e.status==='collected')return;
alive[e.id]=true;
var view=scene.entityViews[e.id];
if(!view){
view=scene.entityViews[e.id]={sprite:scene.add.image(e.x,e.y,e.type==='debris'?'rock':e.type).setDepth(e.type==='rock'||e.type==='debris'?4:6)};
if(e.type==='moon'){view.glow=scene.add.circle(e.x,e.y,28,0xffdb7b,.10).setDepth(5);view.sprite.setDisplaySize(59,59);}
else if(e.type==='fish')view.sprite.setDisplaySize(78,78);
else if(e.type==='debris')view.sprite.setDisplaySize(38,38).setTint(0x7dafb3).setRotation(.6);
else view.sprite.setDisplaySize(68,68);
if(e.type==='fish'&&e.moonId)view.spark=scene.add.text(e.x,e.y,'✦',{fontFamily:'Georgia',fontSize:'17px',color:'#fff0ac'}).setOrigin(.5).setDepth(9);
}
var x=e.x,y=e.y;
if(e.type==='moon'&&e.carriedBy){x+=12;y-=18;view.sprite.setDisplaySize(35,35);}
view.sprite.setPosition(x,y);
if(e.type==='fish')view.sprite.setFlipX(e.vx<0);
if(view.glow)view.glow.setPosition(x,y).setRadius(e.carriedBy?20:30);
if(view.spark)view.spark.setPosition(e.x-24,e.y-22).setAlpha(reducedMotion?.8:.6+Math.sin(elapsed/450)*.3);
});
}
Object.keys(scene.entityViews).forEach(function(key){if(!alive[key]){var view=scene.entityViews[key];Object.keys(view).forEach(function(part){view[part].destroy();});delete scene.entityViews[key];}});
scene.rope.clear();
if(!round)return;
var h=round.hook,o=Engine.ORIGIN;
if(h.phase==='idle'&&round.phase==='playing'){
scene.rope.lineStyle(1,0xfce1a0,.25);
for(var len=Engine.REST_DISTANCE+22;len<195;len+=15){scene.rope.lineBetween(o.x+Math.sin(h.angle)*len,o.y+Math.cos(h.angle)*len,o.x+Math.sin(h.angle)*(len+7),o.y+Math.cos(h.angle)*(len+7));}
}
scene.rope.lineStyle(5,0x05203a,.85);scene.rope.lineBetween(o.x,o.y,h.x,h.y);
scene.rope.lineStyle(2,0xf8e6b1,.95);scene.rope.lineBetween(o.x,o.y,h.x,h.y);
var shape=[[0,-9],[0,5],[3,10],[9,9],[12,4],[9,0]].map(function(p){return{x:h.x+p[0]*Math.cos(h.angle)+p[1]*Math.sin(h.angle),y:h.y-p[0]*Math.sin(h.angle)+p[1]*Math.cos(h.angle)};});
scene.rope.lineStyle(7,0x05203a,1);scene.rope.strokePoints(shape,false);
scene.rope.lineStyle(3.5,0xffe1a0,1);scene.rope.strokePoints(shape,false);
}
function renderBlindbox(){
var r=wallet.blindRound;if(!r)return;
text(els.countRabbit,r.counts.rabbit+'/3');text(els.countBranch,r.counts.branch+'/3');text(els.countMooncake,r.counts.mooncake+'/3');
if(els.blindboxBoard.childElementCount!==Box.BOX_COUNT){
els.blindboxBoard.replaceChildren();
r.boxes.forEach(function(box){
var button=document.createElement('button');button.type='button';button.className='blind-box';button.dataset.index=box.index;
button.innerHTML='<span class="box-face box-front" aria-hidden="true"><span class="box-mark">月兔<small>桂香</small></span></span><span class="box-face box-reveal" aria-hidden="true"><span class="reveal-icon"></span><span class="reveal-name"></span></span>';
els.blindboxBoard.appendChild(button);
});
}
var names={rabbit:'玉兔',branch:'桂枝',mooncake:'月饼'};
r.boxes.forEach(function(box){
var button=els.blindboxBoard.children[box.index];button.classList.toggle('is-revealed',box.opened);button.dataset.type=box.type||'';
button.disabled=box.opened||r.phase!=='playing'||pending;
button.setAttribute('aria-label',box.opened?'第'+(box.index+1)+'盒，'+names[box.type]:'打开第'+(box.index+1)+'盒');
button.querySelector('.reveal-icon').className='reveal-icon'+(box.type?' reveal-'+box.type:'');text(button.querySelector('.reveal-name'),box.type?names[box.type]:'');
});
renderHUD();
}
async function beginBlindbox(){
if(pending)return;
if(wallet.blindRound){hideOverlays();round=null;showScreen('blindbox');renderBlindbox();if(wallet.blindRound.phase==='result')showBlindboxResult();return;}
var result=await transaction(function(saved){return Wallet.beginBox(saved,id('box'));});
if(!result)return;
if(!result.accepted&&result.reason==='empty'){hideOverlays();round=null;showScreen('home');toast('先捞回三颗月亮，赢 1 张盲盒券');els.startFishing.focus();return;}
hideOverlays();round=null;showScreen('blindbox');renderBlindbox();
if(wallet.blindRound&&wallet.blindRound.phase==='result')showBlindboxResult();
else if(result.accepted)toast('已用 1 张券兑换本小局');
}
async function drawBlindbox(index){
if(pending||screen!=='blindbox'||modalOpen())return;
var result=await transaction(function(saved){return Wallet.drawBox(saved,index,Math.random);});
if(!result)return;
renderBlindbox();
if(result.accepted){Feedback.play(result.award?'win':'box');announce('打开盲盒，获得'+itemNames[result.type]);if(result.firstCollection)toast(itemNames[result.type]+'首次收入收藏图鉴');if(result.award)setTimeout(function(){if(screen==='blindbox'&&wallet.blindRound&&wallet.blindRound.phase==='result')showBlindboxResult();},420);}
}
function showBlindboxResult(){
var r=wallet.blindRound;if(!r||r.phase!=='result')return;
resultKind='blindbox';var award=r.outcome;els.resultStats.hidden=true;
text(els.resultKicker,award.tier);text(els.resultTitle,award.label);text(els.resultSymbol,'✦');text(els.resultDetail,'+'+award.score+' 分已入账 · '+itemNames[award.type]+'已收入图鉴（累计 '+Wallet.collection(wallet)[award.type]+' 次）');text(els.resultAction,wallet.tickets?'再用 1 张券开一局':'继续捞月，赢盲盒券');text(els.resultSecondary,'回首页');showOverlay('result');announce(award.label+'，获得'+award.score+'分');
}
async function settleBox(destination){
var result=await transaction(function(saved){return{state:Wallet.finishBox(saved),accepted:true};});if(!result)return;
hideOverlays();
if(destination==='box')beginBlindbox();else if(destination==='fish')startFishing();else showScreen('home');
}
function resultAction(){
if(pending)return;
if(resultKind==='blindbox')settleBox(wallet.tickets?'box':'fish');
else if(resultKind==='fishing-success')beginBlindbox();
else startFishing();
}
function resultSecondary(){
if(pending)return;
if(resultKind==='blindbox')settleBox('home');
else if(resultKind==='fishing-success')startFishing();
else exitFishing();
}
function collect(){
['home-screen','fishing-screen','blindbox-screen','home-tickets','home-score','home-hint','storage-note','start-fishing','open-blindbox-home','ticket-balance','timer','collected','pause-button','fire-button','back-home','blindbox-tickets','blindbox-score','count-rabbit','count-branch','count-mooncake','blindbox-board','box-home','pause-overlay','resume-button','pause-home','result-overlay','result-symbol','result-kicker','result-title','result-detail','result-action','result-secondary','toast','live-message'].forEach(function(name){els[name.replace(/-([a-z])/g,function(_,c){return c.toUpperCase();})]=document.getElementById(name);});
['release-button','aim-hint','sound-button','pause-sound','open-records','open-collection','home-collection','journal-screen','journal-home','records-tab','collection-tab','records-panel','collection-panel','personal-wins','personal-time','personal-shots','personal-accuracy','personal-summary','recent-records','collection-summary','collection-cards','result-stats'].forEach(function(name){els[name.replace(/-([a-z])/g,function(_,c){return c.toUpperCase();})]=document.getElementById(name);});
screens={home:els.homeScreen,fishing:els.fishingScreen,blindbox:els.blindboxScreen,journal:els.journalScreen};
}
function bind(){
els.startFishing.addEventListener('click',startFishing);els.openBlindboxHome.addEventListener('click',beginBlindbox);els.fireButton.addEventListener('click',fireHook);els.pauseButton.addEventListener('click',pauseGame);els.backHome.addEventListener('click',pauseGame);els.resumeButton.addEventListener('click',resumeGame);els.pauseHome.addEventListener('click',exitFishing);els.resultAction.addEventListener('click',resultAction);els.resultSecondary.addEventListener('click',resultSecondary);
els.releaseButton.addEventListener('click',releaseHook);els.openRecords.addEventListener('click',function(){openJournal('records');});els.openCollection.addEventListener('click',function(){openJournal('collection');});els.recordsTab.addEventListener('click',function(){renderJournal('records');});els.collectionTab.addEventListener('click',function(){renderJournal('collection');});els.journalHome.addEventListener('click',function(){showScreen('home');});
[els.soundButton,els.pauseSound].forEach(function(button){button.addEventListener('click',function(){Feedback.toggle();renderHUD();});});
document.addEventListener('pointerdown',function(){Feedback.unlock();});
els.boxHome.addEventListener('click',function(){if(!pending)showScreen('home');});
els.blindboxBoard.addEventListener('click',function(event){var button=event.target.closest('.blind-box');if(button)drawBlindbox(Number(button.dataset.index));});
document.addEventListener('keydown',function(event){
if(event.code==='Space'&&screen==='fishing'&&!modalOpen()){event.preventDefault();if(!event.repeat)fireHook();}
if(event.code==='Escape'&&screen==='fishing'){if(!els.pauseOverlay.hidden)resumeGame();else if(!modalOpen())pauseGame();}
if(event.code==='KeyR'&&screen==='fishing'&&!modalOpen()&&!event.repeat){event.preventDefault();releaseHook();}
if(event.code==='Tab'&&modalOpen()){var overlay=!els.pauseOverlay.hidden?els.pauseOverlay:els.resultOverlay;var buttons=Array.from(overlay.querySelectorAll('button'));var first=buttons[0],last=buttons[buttons.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
});
document.addEventListener('visibilitychange',function(){if(document.hidden)pauseGame();});
window.addEventListener('pagehide',function(){pauseGame();activeFrameAt=null;});
window.addEventListener('resize',function(){if(game)requestAnimationFrame(function(){game.scale.refresh();});});
window.addEventListener('storage',function(event){if(event.key==='moonfishing-sound-muted')return;if(event.key!==Wallet.KEY||pending||!storageWorks)return;refreshWallet();renderHUD();if(screen==='journal')renderJournal();if(screen==='blindbox'){if(wallet.blindRound){renderBlindbox();if(wallet.blindRound.phase==='result')showBlindboxResult();}else{hideOverlays();showScreen('home');toast('盲盒进度已在另一个页面更新');}}});
}
collect();load();bind();showScreen('home');
})();
