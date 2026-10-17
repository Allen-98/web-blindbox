(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MoonFishingEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var WIDTH = 480, HEIGHT = 620, ROUND_MS = 60000;
  var ORIGIN = { x: 240, y: 112 }, MAX_ANGLE = 65 * Math.PI / 180, REST_DISTANCE = 112;
  var EXTEND_SPEED = 430, RETURN_SPEED = { empty: 620, moon: 440, fish: 580, debris: 280, rock: 140 };
  function copy(v) { return JSON.parse(JSON.stringify(v)); }
  function random(rng) { var n = (rng || Math.random)(); return Number.isFinite(n) ? Math.max(0, Math.min(.99999999, n)) : .5; }
  function distance(a,b) { return Math.hypot(a.x-b.x,a.y-b.y); }
  function emit(round,kind,type,x,y,moons){round.events.push({kind:kind,type:type,x:x,y:y,moons:moons||0});}
  function aim(round) { return Math.sin(round.elapsedMs/1000*1.45)*MAX_ANGLE; }
  function hookPosition(hook) { hook.x=ORIGIN.x+Math.sin(hook.angle)*hook.distance; hook.y=ORIGIN.y+Math.cos(hook.angle)*hook.distance; }
  function reachable(p) { return p.x>=42 && p.x<=438 && p.y>=225 && p.y<=535 && Math.abs(Math.atan2(p.x-ORIGIN.x,p.y-ORIGIN.y))<=56*Math.PI/180 && distance(p,ORIGIN)<=505; }
  function place(rng,entities,radius) {
    function clear(p) { return reachable(p) && entities.every(function(e) { return distance(p,e)>radius+e.radius+22; }); }
    for(var i=0;i<180;i++) { var p={x:48+random(rng)*384,y:232+random(rng)*296}; if(clear(p)) return p; }
    for(var y=238;y<=526;y+=72) for(var x=54;x<=426;x+=62) { var point={x:x,y:y}; if(clear(point)) return point; }
    throw new Error('Unable to place reachable targets');
  }
  function createRound(rng,id) {
    var entities=[];
    function add(type,n,radius) { var p=place(rng,entities,radius), e={id:type+'-'+n,type:type,x:p.x,y:p.y,radius:radius,status:'free',carriedBy:null,moonId:null}; entities.push(e); return e; }
    for(var i=1;i<=3;i++) add('moon',i,24);
    for(var r=1;r<=2;r++) add('rock',r,28);
    for(var d=1;d<=2;d++) add('debris',d,17);
    if(random(rng)<.3) {
      var moon=entities[Math.floor(random(rng)*3)];
      var fish={id:'fish-1',type:'fish',x:moon.x,y:moon.y,radius:26,status:'free',moonId:moon.id,carriedBy:null};
      moon.carriedBy=fish.id; entities.push(fish);
    } else add('fish',1,25);
    add('fish',2,25);
    entities.forEach(function(e) { if(e.type==='fish') { e.vx=(random(rng)<.5?-1:1)*(48+random(rng)*18); e.minX=Math.max(38,e.x-65); e.maxX=Math.min(442,e.x+65); } });
    return {version:2,id:String(id||('round-'+Date.now()+'-'+Math.random().toString(36).slice(2))),phase:'playing',elapsedMs:0,remainingMs:ROUND_MS,collected:0,entities:entities,releasesLeft:1,metrics:{shots:0,emptyReturns:0,obstacleReturns:0,fishReturns:0,moonReturns:0,releases:0},events:[],hook:{phase:'idle',angle:0,distance:REST_DISTANCE,x:ORIGIN.x,y:ORIGIN.y+REST_DISTANCE,carriedIds:[],targetType:'empty',released:false},lastDelivery:null};
  }
  function fire(round) {
    var next=copy(round);
    if(next.phase!=='playing'||next.hook.phase!=='idle') return {state:next,accepted:false};
    next.events=[];next.metrics.shots++;next.hook.released=false;
    next.hook.phase='extending'; next.hook.angle=aim(next); next.hook.distance=REST_DISTANCE; next.hook.carriedIds=[]; next.hook.targetType='empty'; hookPosition(next.hook);
    emit(next,'launch','empty',next.hook.x,next.hook.y);
    // The resting hook can already touch a nearby target. Scan its initial
    // ray before extending, so changing rope length cannot skip that target.
    var target=null,first=2;
    next.entities.forEach(function(e){if(e.status!=='free'||e.carriedBy)return;var t=segmentHit(ORIGIN,next.hook,e);if(t!==null&&t<first){first=t;target=e;}});
    if(target){retract(next,target);moveCarried(next);}
    return {state:next,accepted:true};
  }
  function segmentHit(from,to,e) {
    var dx=to.x-from.x,dy=to.y-from.y,fx=from.x-e.x,fy=from.y-e.y,r=e.radius+7;
    var a=dx*dx+dy*dy,c=fx*fx+fy*fy-r*r;
    if(c<=0) return 0; if(!a) return null;
    var b=2*(fx*dx+fy*dy),disc=b*b-4*a*c;
    if(disc<0) return null;
    var t=(-b-Math.sqrt(disc))/(2*a); return t>=0&&t<=1?t:null;
  }
  function retract(round,target) {
    var h=round.hook; h.phase='retracting'; h.targetType=target?target.type:'empty';
    if(!target) return;
    target.dropOrigin={x:target.x,y:target.y};
    target.status='hooked'; h.carriedIds=[target.id];
    if(target.moonId) { var m=round.entities.find(function(e){return e.id===target.moonId;}); if(m&&m.status!=='collected'){m.dropOrigin={x:m.x,y:m.y};m.status='hooked';h.carriedIds.push(m.id);} }
    emit(round,'catch',target.type,h.x,h.y,h.carriedIds.some(function(id){return round.entities.find(function(e){return e.id===id;}).type==='moon';})?1:0);
  }
  function canRelease(round){return !!round&&round.phase==='playing'&&round.remainingMs>0&&round.releasesLeft===1&&round.hook.phase==='retracting'&&round.hook.carriedIds.length>0;}
  function release(round){
    var next=copy(round);
    if(!canRelease(next))return{state:next,accepted:false};
    var h=next.hook;next.events=[];
    h.carriedIds.forEach(function(id){var e=next.entities.find(function(item){return item.id===id;});e.status='free';e.x=e.dropOrigin.x;e.y=e.dropOrigin.y;delete e.dropOrigin;});
    next.releasesLeft=0;next.metrics.releases++;emit(next,'release',h.targetType,h.x,h.y);
    h.carriedIds=[];h.targetType='empty';h.released=true;
    return{state:next,accepted:true};
  }
  function moveCarried(round) { round.hook.carriedIds.forEach(function(id){var e=round.entities.find(function(item){return item.id===id;});if(e){e.x=round.hook.x;e.y=round.hook.y;}}); }
  function advance(round,dt) {
    var h=round.hook,seconds=dt/1000;
    round.elapsedMs+=dt; round.remainingMs=Math.max(0,ROUND_MS-round.elapsedMs);
    round.entities.forEach(function(e) {
      if(e.type!=='fish'||e.status!=='free') return;
      e.x+=e.vx*seconds;
      if(e.x<e.minX||e.x>e.maxX) { e.x=Math.max(e.minX,Math.min(e.maxX,e.x));e.vx*=-1; }
      if(e.moonId) { var m=round.entities.find(function(item){return item.id===e.moonId;});if(m&&m.status==='free'){m.x=e.x;m.y=e.y;} }
    });
    if(h.phase==='idle') {h.angle=aim(round);h.distance=REST_DISTANCE;hookPosition(h);}
    else if(h.phase==='extending') {
      var from={x:h.x,y:h.y};h.distance+=EXTEND_SPEED*seconds;hookPosition(h);
      var target=null,first=2;
      round.entities.forEach(function(e){if(e.status!=='free'||e.carriedBy)return;var t=segmentHit(from,h,e);if(t!==null&&t<first){first=t;target=e;}});
      var boundary=1;
      if(h.x<12) boundary=Math.min(boundary,(12-from.x)/(h.x-from.x));
      if(h.x>468) boundary=Math.min(boundary,(468-from.x)/(h.x-from.x));
      if(h.y>602) boundary=Math.min(boundary,(602-from.y)/(h.y-from.y));
      if(target&&first<=boundary) {h.x=from.x+(h.x-from.x)*first;h.y=from.y+(h.y-from.y)*first;h.distance=distance(h,ORIGIN);retract(round,target);moveCarried(round);}
      else if(boundary<1||h.distance>=650){h.x=from.x+(h.x-from.x)*boundary;h.y=from.y+(h.y-from.y)*boundary;h.distance=distance(h,ORIGIN);retract(round,null);}
    } else if(h.phase==='retracting') {
      h.distance=Math.max(0,h.distance-RETURN_SPEED[h.targetType]*seconds);hookPosition(h);moveCarried(round);
      if(h.distance===0) {
        var moons=0;
        h.carriedIds.forEach(function(id){var e=round.entities.find(function(item){return item.id===id;});e.status='collected';delete e.dropOrigin;if(e.type==='moon'){round.collected++;moons++;}});
        if(moons)round.metrics.moonReturns+=moons;
        if(h.targetType==='empty'&&!h.released)round.metrics.emptyReturns++;
        if(h.targetType==='rock'||h.targetType==='debris')round.metrics.obstacleReturns++;
        if(h.targetType==='fish')round.metrics.fishReturns++;
        emit(round,'delivery',h.released?'released':h.targetType,ORIGIN.x,ORIGIN.y,moons);
        round.lastDelivery={type:h.targetType,at:round.elapsedMs};h.phase='idle';h.carriedIds=[];h.targetType='empty';h.distance=REST_DISTANCE;hookPosition(h);
        if(round.collected===3)round.phase='success';
      }
    }
    if(round.remainingMs===0&&round.phase!=='success')round.phase='failed';
  }
  function tick(round,dt) {
    var next=copy(round); if(next.phase!=='playing'||!Number.isFinite(dt)||dt<=0)return next;
    next.events=[];var remaining=Math.min(dt,next.remainingMs);
    while(remaining>0&&next.phase==='playing'){var step=Math.min(16,remaining);advance(next,step);remaining-=step;}
    return next;
  }
  function pause(round){var next=copy(round);if(next.phase==='playing')next.phase='paused';return next;}
  function resume(round){var next=copy(round);if(next.phase==='paused')next.phase='playing';return next;}
  return {WIDTH:WIDTH,HEIGHT:HEIGHT,ROUND_MS:ROUND_MS,ORIGIN:copy(ORIGIN),MAX_ANGLE:MAX_ANGLE,REST_DISTANCE:REST_DISTANCE,EXTEND_SPEED:EXTEND_SPEED,RETURN_SPEED:copy(RETURN_SPEED),createRound:createRound,tick:tick,fire:fire,release:release,canRelease:canRelease,pause:pause,resume:resume,aimAngle:aim,clone:copy,reachable:reachable};
});
