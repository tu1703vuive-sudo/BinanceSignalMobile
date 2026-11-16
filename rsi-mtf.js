/* RSI Momentum: independent of Short V2.2 / Swing and their trade plans. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RsiMtf=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const FRAMES=Object.freeze([
    Object.freeze({tf:'1M',label:'1M',name:'Tháng',weight:10}),
    Object.freeze({tf:'1d',label:'1D',name:'Ngày',weight:20}),
    Object.freeze({tf:'4h',label:'4H',name:'4 giờ',weight:30}),
    Object.freeze({tf:'1h',label:'1H',name:'1 giờ',weight:25}),
    Object.freeze({tf:'15m',label:'15M',name:'15 phút',weight:15})
  ]);
  function series(closes,p=14){
    const out=Array(closes.length).fill(null);
    if(closes.length<=p||!closes.every(Number.isFinite))return out;
    let gain=0,loss=0;
    for(let i=1;i<=p;i++){const d=closes[i]-closes[i-1];gain+=Math.max(d,0);loss+=Math.max(-d,0)}
    gain/=p;loss/=p;
    const value=()=>gain===0&&loss===0?50:loss===0?100:100-100/(1+gain/loss);
    out[p]=value();
    for(let i=p+1;i<closes.length;i++){
      const d=closes[i]-closes[i-1];
      gain=(gain*(p-1)+Math.max(d,0))/p;loss=(loss*(p-1)+Math.max(-d,0))/p;
      out[i]=value();
    }
    return out;
  }
  function classify(value){return !Number.isFinite(value)?null:value>=55?1:value<=45?-1:0}
  function frame(candles,now=Date.now()){
    const closed=candles.filter(c=>c.closeTime<now);
    const values=series(closed.map(c=>c.close));
    const confirmed=values.at(-1)??null,previous=values.at(-2)??null;
    const live=series(candles.map(c=>c.close)).at(-1)??null;
    return {live,confirmed,previous,slope:Number.isFinite(previous)&&Number.isFinite(confirmed)?confirmed-previous:null,
      closedCount:closed.length,closedAt:closed.at(-1)?.closeTime??null,
      ready:Number.isFinite(confirmed)&&Number.isFinite(previous)};
  }
  function evaluate(frames){
    const missing=FRAMES.filter(f=>!frames[f.tf]?.ready||frames[f.tf]?.healthy!==true||!Number.isFinite(frames[f.tf]?.confirmed)||!Number.isFinite(frames[f.tf]?.previous)).map(f=>f.tf);
    if(missing.length)return {score:null,bias:0,signal:'WAIT',missing};
    const score=FRAMES.reduce((sum,f)=>sum+classify(frames[f.tf].confirmed)*f.weight,0);
    const bias=score>=35?1:score<=-35?-1:0;
    const h4=frames['4h'].confirmed,h1=frames['1h'].confirmed,m15=frames['15m'];
    const crossLong=m15.previous<55&&m15.confirmed>=55;
    const crossShort=m15.previous>45&&m15.confirmed<=45;
    const long=bias===1&&h4>=55&&h1>=55&&crossLong;
    const short=bias===-1&&h4<=45&&h1<=45&&crossShort;
    return {score,bias,signal:long?'LONG':short?'SHORT':bias===1?'WATCH LONG':bias===-1?'WATCH SHORT':'WAIT',missing:[],crossLong,crossShort};
  }
  return Object.freeze({FRAMES,series,classify,frame,evaluate});
});
