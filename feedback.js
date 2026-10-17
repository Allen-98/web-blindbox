(function(root){
'use strict';
var context=null,master=null,muted=false,KEY='moonfishing-sound-muted';
try{muted=localStorage.getItem(KEY)==='true';}catch(_){}
function unlock(){
  if(muted)return;
  try{
    var Audio=root.AudioContext||root.webkitAudioContext;
    if(!Audio)return;
    if(!context){context=new Audio();master=context.createGain();master.gain.value=.12;master.connect(context.destination);}
    if(context.state==='suspended')context.resume().catch(function(){});
  }catch(_){}
}
function tone(frequency,end,start,duration,wave){
  var oscillator=context.createOscillator(),gain=context.createGain();
  oscillator.type=wave||'sine';oscillator.frequency.setValueAtTime(frequency,start);oscillator.frequency.exponentialRampToValueAtTime(end,start+duration);
  gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(.32,start+.012);gain.gain.exponentialRampToValueAtTime(.0001,start+duration);
  oscillator.connect(gain);gain.connect(master);oscillator.start(start);oscillator.stop(start+duration+.02);
  oscillator.onended=function(){oscillator.disconnect();gain.disconnect();};
}
function play(kind){
  if(muted||!context||context.state!=='running'||document.hidden)return;
  try{
    var now=context.currentTime;
    if(kind==='launch')tone(360,130,now,.11,'triangle');
    else if(kind==='rock')tone(110,70,now,.16,'triangle');
    else if(kind==='release')tone(450,220,now,.16,'sine');
    else if(kind==='empty')tone(160,120,now,.08,'sine');
    else if(kind==='catch')tone(620,850,now,.13,'sine');
    else if(kind==='box')tone(440,660,now,.15,'triangle');
    else if(kind==='failed')tone(330,220,now,.3,'sine');
    else{
      [523.25,659.25,783.99].forEach(function(f,index){tone(f,f,now+index*.09,.26,'sine');});
    }
  }catch(_){}
}
function toggle(){muted=!muted;try{localStorage.setItem(KEY,String(muted));}catch(_){}if(master)master.gain.value=muted?0:.12;if(!muted){unlock();play('catch');}return muted;}
root.MoonFishingFeedback={unlock:unlock,play:play,toggle:toggle,isMuted:function(){return muted;}};
})(window);
