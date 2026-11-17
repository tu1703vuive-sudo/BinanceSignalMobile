/* TriSignal v4.1 entry rules, ported from the supplied strategy.py. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RsiMtf=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const VERSION='RSI14-V41-1',SOURCE_VERSION='RSI14-ADAPTIVE-v3.0';
  const STRATEGIES=Object.freeze(['REVERSAL','MOMENTUM','BREAKOUT']),PRIORITY=Object.freeze(['BREAKOUT','REVERSAL','MOMENTUM']);
  const MIN_CANDLES=Object.freeze({'15m':100,'1h':100,'4h':100,'1d':100,'1M':30});
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
  function classify(value){return !Number.isFinite(value)?null:value>=55?1:value<45?-1:0}
  const context=value=>classify(value)===1?'BULL':classify(value)===-1?'BEAR':'NEUTRAL';
  function frame(candles,now=Date.now(),tf='15m'){
    const closed=candles.filter(c=>c.closeTime<now);
    const values=series(closed.map(c=>c.close));
    const confirmed=values.at(-1)??null,previous=values.at(-2)??null;
    const live=series(candles.map(c=>c.close)).at(-1)??null;
    return {live,confirmed,previous,slope:Number.isFinite(previous)&&Number.isFinite(confirmed)?confirmed-previous:null,
      closedCount:closed.length,closedAt:closed.at(-1)?.closeTime??null,
      minimum:MIN_CANDLES[tf],ready:closed.length>=MIN_CANDLES[tf]&&Number.isFinite(confirmed)&&Number.isFinite(previous)};
  }
  function evaluateSide(frames,strategy,side){
    if(!STRATEGIES.includes(strategy)||!['LONG','SHORT'].includes(side))throw new Error('Bộ RSI hoặc hướng không hợp lệ');
    const r=Object.fromEntries(FRAMES.map(f=>[f.tf,frames[f.tf].confirmed])),p=Object.fromEntries(FRAMES.map(f=>[f.tf,frames[f.tf].previous]));
    const bull=side==='LONG',checks=[],n=v=>v.toFixed(2),rising=bull?r['1h']>p['1h']:r['1h']<p['1h'];
    const check=(tf,name,passed,detail)=>checks.push({tf,name,passed:!!passed,detail});
    let trigger;
    if(strategy==='REVERSAL'){
      check('1d','Bối cảnh ngày',bull?r['1d']>=25:r['1d']<=75,`RSI 1D ${n(r['1d'])}; ${bull?'≥25':'≤75'}`);
      const lo=bull?30:45,hi=bull?55:70;
      check('4h','RSI nền',r['4h']>=lo&&r['4h']<=hi,`RSI 4H ${n(r['4h'])}; vùng ${lo}–${hi}`);
      check('1h','RSI xác nhận',r['1h']>=lo&&r['1h']<=hi&&rising,`RSI 1H ${n(p['1h'])} → ${n(r['1h'])}; vùng ${lo}–${hi}, ${bull?'tăng':'giảm'}`);
      trigger=bull?p['15m']<30&&r['15m']>=30&&r['15m']<=40:p['15m']>70&&r['15m']<=70&&r['15m']>=60;
      check('15m','Kích hoạt 15M',trigger,`RSI ${n(p['15m'])} → ${n(r['15m'])}; ${bull?'cắt lên 30, mới ≤40':'cắt xuống 70, mới ≥60'}`);
    }else if(strategy==='MOMENTUM'){
      check('1d','Bối cảnh ngày',bull?r['1d']>=40:r['1d']<=60,`RSI 1D ${n(r['1d'])}; ${bull?'≥40':'≤60'}`);
      const lo4=bull?52:30,hi4=bull?70:48,lo1=bull?50:32,hi1=bull?68:50;
      check('4h','RSI nền',r['4h']>=lo4&&r['4h']<=hi4,`RSI 4H ${n(r['4h'])}; vùng ${lo4}–${hi4}`);
      check('1h','RSI xác nhận',r['1h']>=lo1&&r['1h']<=hi1&&rising,`RSI 1H ${n(p['1h'])} → ${n(r['1h'])}; vùng ${lo1}–${hi1}, ${bull?'tăng':'giảm'}`);
      trigger=bull?p['15m']<50&&r['15m']>=50&&r['15m']<=65:p['15m']>50&&r['15m']<=50&&r['15m']>=35;
      check('15m','Kích hoạt 15M',trigger,`RSI ${n(p['15m'])} → ${n(r['15m'])}; ${bull?'cắt lên 50, mới ≤65':'cắt xuống 50, mới ≥35'}`);
    }else{
      check('1d','Bối cảnh ngày',bull?r['1d']>=50:r['1d']<=50,`RSI 1D ${n(r['1d'])}; ${bull?'≥50':'≤50'}`);
      check('4h','RSI nền',bull?r['4h']>=60:r['4h']<=40,`RSI 4H ${n(r['4h'])}; ${bull?'≥60':'≤40'}`);
      check('1h','RSI xác nhận',(bull?r['1h']>=60:r['1h']<=40)&&rising,`RSI 1H ${n(p['1h'])} → ${n(r['1h'])}; ${bull?'≥60 và tăng':'≤40 và giảm'}`);
      trigger=bull?p['15m']<70&&r['15m']>=70&&r['15m']<=85:p['15m']>30&&r['15m']<=30&&r['15m']>=15;
      check('15m','Kích hoạt 15M',trigger,`RSI ${n(p['15m'])} → ${n(r['15m'])}; ${bull?'cắt lên 70, mới ≤85':'cắt xuống 30, mới ≥15'}`);
    }
    const env={'1d':context(r['1d']),'1M':context(r['1M'])},favor=bull?'BULL':'BEAR',oppose=bull?'BEAR':'BULL';
    const supporters=Object.values(env).filter(x=>x===favor).length,opponents=Object.values(env).filter(x=>x===oppose).length;
    const blocked=opponents===2&&strategy!=='REVERSAL',riskPct=supporters===2 ? 0.5 : opponents===2 ? 0.15 : 0.3;
    check('1M','Adaptive Risk',!blocked,`Tháng ${n(r['1M'])} (${env['1M']}), ngày ${n(r['1d'])} (${env['1d']}); ${blocked?'chặn ngược cả ngày và tháng':`rủi ro bối cảnh ${riskPct.toFixed(2)}%`}`);
    const passed=checks.filter(c=>c.passed).length;
    return {strategy,side,allowed:passed===checks.length,passed,total:checks.length,checks,riskPct,context:env,trigger,
      reason:`v4.1 ${strategy} ${side}: ${passed}/${checks.length} điều kiện. `+checks.map(c=>`${c.tf} ${c.name}: ${c.passed?'ĐẠT':'KHÔNG ĐẠT'} [${c.detail}]`).join('; ')};
  }
  function arbitrate(candidates){
    if(new Set(candidates.map(c=>c.side)).size>1)return {winner:null,conflict:true};
    return {winner:[...candidates].sort((a,b)=>PRIORITY.indexOf(a.strategy)-PRIORITY.indexOf(b.strategy))[0]||null,conflict:false};
  }
  function evaluate(frames){
    const missing=FRAMES.filter(f=>!frames[f.tf]?.ready||frames[f.tf]?.healthy!==true||!Number.isFinite(frames[f.tf]?.confirmed)||!Number.isFinite(frames[f.tf]?.previous)).map(f=>f.tf);
    if(missing.length)return {version:VERSION,ruleSet:'v41',score:null,bias:0,signal:'WAIT',missing,evaluations:{},candidates:[],winner:null,conflict:false};
    const score=FRAMES.reduce((sum,f)=>sum+classify(frames[f.tf].confirmed)*f.weight,0);
    const evaluations=Object.fromEntries(STRATEGIES.map(st=>[st,Object.fromEntries(['LONG','SHORT'].map(side=>[side,evaluateSide(frames,st,side)]))]));
    const candidates=STRATEGIES.flatMap(st=>['LONG','SHORT'].map(side=>evaluations[st][side]).filter(e=>e.allowed));
    const {winner,conflict}=arbitrate(candidates),bias=winner?(winner.side==='LONG'?1:-1):0;
    return {version:VERSION,ruleSet:'v41',score,bias,signal:winner?.side||'WAIT',missing:[],evaluations,candidates,winner,conflict};
  }
  return Object.freeze({VERSION,SOURCE_VERSION,STRATEGIES,PRIORITY,MIN_CANDLES,FRAMES,series,classify,frame,evaluateSide,arbitrate,evaluate});
});
