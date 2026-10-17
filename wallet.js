(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./legacy-engine.js'));else root.MoonFishingWallet=factory(root.MooncakeBlindBoxEngine);})(typeof self!=='undefined'?self:this,function(Box){
'use strict';
var KEY='moonfishing-save-v2';
function fresh(){return{version:2,tickets:0,totalScore:0,fishingWins:0,roundsPlayed:0,blindRound:null,creditedWins:[],records:[],fishingRecords:[]};}
function clone(v){return JSON.parse(JSON.stringify(v));}
function valid(v){
if(!v||v.version!==2||!['tickets','totalScore','fishingWins','roundsPlayed'].every(function(k){return Number.isSafeInteger(v[k])&&v[k]>=0;})||!Array.isArray(v.creditedWins)||!v.creditedWins.every(function(id){return typeof id==='string';})||new Set(v.creditedWins).size!==v.creditedWins.length||v.fishingWins!==v.creditedWins.length||v.tickets!==v.fishingWins-v.roundsPlayed||!Array.isArray(v.records)||(v.blindRound!==null&&!Box.valid(v.blindRound)))return false;
if(v.records.some(function(r){return !r||typeof r.id!=='string'||!Box.TYPES.includes(r.type)||r.score!==Box.AWARDS[r.type].score;})||new Set(v.records.map(function(r){return r.id;})).size!==v.records.length||v.totalScore!==v.records.reduce(function(sum,r){return sum+r.score;},0))return false;
if(v.blindRound&&v.blindRound.phase==='playing')return v.roundsPlayed===v.records.length+1&&!v.records.some(function(r){return r.id===v.blindRound.id;});
if(v.roundsPlayed!==v.records.length)return false;
if(v.blindRound){var last=v.records[v.records.length-1];return !!last&&last.id===v.blindRound.id&&last.type===v.blindRound.outcome.type;}
return true;
}
function validFishingRecord(r){
return !!r&&typeof r.id==='string'&&['success','failed'].includes(r.outcome)&&Number.isFinite(r.elapsedMs)&&r.elapsedMs>=0&&r.elapsedMs<=60000&&['shots','emptyReturns','obstacleReturns','fishReturns','moons','releases'].every(function(k){return Number.isSafeInteger(r[k])&&r[k]>=0;})&&r.moons<=3&&r.shots>=r.moons&&r.releases<=1&&(r.outcome==='success'?r.moons===3:r.elapsedMs===60000&&r.moons<3);
}
function sanitize(v){
if(!valid(v))return fresh();
var next=clone(v),seen=new Set();
next.blindRound=next.blindRound?Box.sanitize(next.blindRound):null;
next.fishingRecords=(Array.isArray(next.fishingRecords)?next.fishingRecords:[]).filter(function(r){if(!validFishingRecord(r)||seen.has(r.id)||(r.outcome==='success'?!next.creditedWins.includes(r.id):next.creditedWins.includes(r.id)))return false;seen.add(r.id);return true;});
return next;
}
function load(storage){try{var raw=storage.getItem(KEY);if(raw===null)return{state:fresh(),available:true,recovered:false};var parsed=JSON.parse(raw);return{state:sanitize(parsed),available:true,recovered:!valid(parsed)};}catch(_){return{state:fresh(),available:false,recovered:true};}}
function save(storage,state){try{storage.setItem(KEY,JSON.stringify(sanitize(state)));return true;}catch(_){return false;}}
function roundRecord(round){
if(!round||!round.metrics)return null;
var m=round.metrics,r={id:round.id,outcome:round.phase,elapsedMs:round.elapsedMs,shots:m.shots,emptyReturns:m.emptyReturns,obstacleReturns:m.obstacleReturns,fishReturns:m.fishReturns,moons:round.collected,releases:m.releases};
return validFishingRecord(r)?r:null;
}
function creditWin(state,round){var next=sanitize(state);if(!round||round.phase!=='success'||round.collected!==3||typeof round.id!=='string'||next.creditedWins.includes(round.id))return{state:next,accepted:false};next.tickets++;next.fishingWins++;next.creditedWins.push(round.id);var record=roundRecord(round);if(record)next.fishingRecords.push(record);return{state:next,accepted:true};}
function completeFishing(state,round){
if(round&&round.phase==='success')return creditWin(state,round);
var next=sanitize(state),record=roundRecord(round);
if(!record||record.outcome!=='failed'||next.creditedWins.includes(record.id)||next.fishingRecords.some(function(r){return r.id===record.id;}))return{state:next,accepted:false};
next.fishingRecords.push(record);return{state:next,accepted:true};
}
function collection(state){var next=sanitize(state),counts={rabbit:0,branch:0,mooncake:0};next.records.forEach(function(r){counts[r.type]++;});return counts;}
function personal(state){
var next=sanitize(state),records=next.fishingRecords,wins=records.filter(function(r){return r.outcome==='success';}),shots=records.reduce(function(sum,r){return sum+r.shots;},0),moons=records.reduce(function(sum,r){return sum+r.moons;},0);
return{completed:records.length,wins:next.fishingWins,recordedWins:wins.length,failed:records.length-wins.length,bestMs:wins.length?Math.min.apply(null,wins.map(function(r){return r.elapsedMs;})):null,bestShots:wins.length?Math.min.apply(null,wins.map(function(r){return r.shots;})):null,accuracy:shots?Math.round(moons/shots*100):null,recent:records.slice(-8).reverse()};
}
function beginBox(state,id){var next=sanitize(state);if(next.blindRound)return{state:next,accepted:false,reason:'existing'};if(next.tickets<1)return{state:next,accepted:false,reason:'empty'};next.tickets--;next.roundsPlayed++;next.blindRound=Box.createRound(id);return{state:next,accepted:true};}
function drawBox(state,index,rng){var next=sanitize(state),drawn=Box.draw(next.blindRound,index,rng);if(!drawn.accepted)return{state:next,accepted:false,award:null};next.blindRound=drawn.state;var firstCollection=false;if(drawn.award){firstCollection=!next.records.some(function(r){return r.type===drawn.award.type;});next.totalScore+=drawn.award.score;next.records.push({id:next.blindRound.id,type:drawn.award.type,score:drawn.award.score});}return{state:next,accepted:true,type:drawn.type,award:drawn.award,firstCollection:firstCollection};}
function finishBox(state){var next=sanitize(state);if(next.blindRound&&next.blindRound.phase==='result')next.blindRound=null;return next;}
return{KEY:KEY,fresh:fresh,sanitize:sanitize,valid:valid,load:load,save:save,creditWin:creditWin,completeFishing:completeFishing,personal:personal,collection:collection,validFishingRecord:validFishingRecord,beginBox:beginBox,drawBox:drawBox,finishBox:finishBox,clone:clone};
});
