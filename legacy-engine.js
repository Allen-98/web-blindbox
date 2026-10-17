(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.MooncakeBlindBoxEngine=factory();})(typeof self!=='undefined'?self:this,function(){
'use strict';
var TYPES=['rabbit','branch','mooncake'];
var BOX_COUNT=12;
var AWARDS={rabbit:{tier:'一等奖',label:'玉兔团圆奖',score:50},branch:{tier:'二等奖',label:'桂枝满月奖',score:30},mooncake:{tier:'三等奖',label:'月饼盈香奖',score:10}};
function clone(v){return JSON.parse(JSON.stringify(v));}
function createRound(id){return{id:String(id),phase:'playing',boxes:Array.from({length:BOX_COUNT},function(_,index){return{index:index,opened:false,type:null};}),counts:{rabbit:0,branch:0,mooncake:0},openedCount:0,outcome:null};}
function valid(round){
if(!round||typeof round.id!=='string'||!['playing','result'].includes(round.phase)||!Array.isArray(round.boxes)||![BOX_COUNT,20].includes(round.boxes.length))return false;
var counts={rabbit:0,branch:0,mooncake:0},opened=0;
for(var i=0;i<round.boxes.length;i++){var b=round.boxes[i];if(!b||b.index!==i||typeof b.opened!=='boolean'||(b.opened?!TYPES.includes(b.type):b.type!==null))return false;if(b.opened){counts[b.type]++;opened++;}}
if(round.openedCount!==opened||!round.counts||TYPES.some(function(t){return round.counts[t]!==counts[t];}))return false;
var wins=TYPES.filter(function(t){return counts[t]>=3;});
if(round.phase==='playing')return wins.length===0&&round.outcome===null;
return wins.length===1&&counts[wins[0]]===3&&round.outcome&&round.outcome.type===wins[0]&&round.outcome.score===AWARDS[wins[0]].score;
}
function sanitize(r){
if(!valid(r))return null;
var next=clone(r);
if(next.boxes.length===20){
  var boxes=createRound(next.id).boxes;
  next.boxes.filter(function(b){return b.opened&&b.index<BOX_COUNT;}).forEach(function(b){boxes[b.index]=clone(b);});
  next.boxes.filter(function(b){return b.opened&&b.index>=BOX_COUNT;}).forEach(function(b){var slot=boxes.findIndex(function(item){return !item.opened;});boxes[slot]={index:slot,opened:true,type:b.type};});
  next.boxes=boxes;
}
return next;
}
function draw(round,index,rng){
var next=sanitize(round);
if(!next||next.phase!=='playing'||!Number.isInteger(index)||index<0||index>=BOX_COUNT||next.boxes[index].opened)return{state:next,accepted:false,award:null};
var n=(rng||Math.random)();n=Number.isFinite(n)?Math.max(0,Math.min(.99999999,n)):.5;
var type=TYPES[Math.floor(n*3)];next.boxes[index]={index:index,opened:true,type:type};next.counts[type]++;next.openedCount++;
var award=null;if(next.counts[type]===3){award=Object.assign({type:type},AWARDS[type]);next.outcome=clone(award);next.phase='result';}
return{state:next,accepted:true,type:type,award:award};
}
return{TYPES:TYPES.slice(),AWARDS:clone(AWARDS),BOX_COUNT:BOX_COUNT,createRound:createRound,sanitize:sanitize,valid:valid,draw:draw,clone:clone};
});
