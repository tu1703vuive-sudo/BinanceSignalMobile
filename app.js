'use strict';

const APP_VERSION='3.2.2';
const DATA_ENGINE_VERSION='ws-cache-v1';
const ENGINE_VERSION='short-v2.2';
const CANDLE_CACHE_LIMIT=300;
const CANDLE_CACHE_MAX_ENTRIES=35;
const CANDLE_CACHE_FRESH_MS=90000;
const TICKER_RENDER_INTERVAL=120;
const CHART_RENDER_INTERVAL=90;
const CHART_MAX_DPR=2;
const WS_RECONNECT_BASE_MS=1200;
const WS_RECONNECT_MAX_MS=12000;

const SHORT_STRATEGY=Object.freeze({
  timeframes:['15m','1h','4h'],
  weights:Object.freeze({'4h':45,'1h':35,'15m':20}),
  watchThreshold:45,
  minRR:1.5
});

const MARKET_CONFIG={
  futures:{
    label:'FUTURES',
    apiBases:['https://fapi.binance.com'],
    wsBase:'wss://fstream.binance.com/market/stream?streams=',
    klinesPath:'/fapi/v1/klines',
    ticker24Path:'/fapi/v1/ticker/24hr'
  }
};
const DEFAULT_SYMBOLS=['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT'];
const CHART_TIMEFRAMES=['15m','1h','4h','12h','1d','1w','1M'];
const ANALYSIS_TIMEFRAMES={swing:['1M','1w','1d','12h','4h'],short:[...SHORT_STRATEGY.timeframes]};
const storedMode=localStorage.getItem('bsm_mode')||'short';
const storedMarket='futures';

function safeJson(value,fallback){try{let x=JSON.parse(value);return x??fallback}catch{return fallback}}
function marketStoreKey(name,market){return `bsm_${name}_${market}`}
function loadMarketData(market){
  const symbols=safeJson(localStorage.getItem(marketStoreKey('symbols',market))||'null',null)||[...DEFAULT_SYMBOLS];
  const favorites=safeJson(localStorage.getItem(marketStoreKey('favorites',market))||'null',null)||['BTCUSDT'];
  let selected=localStorage.getItem(marketStoreKey('selected',market))||symbols[0]||'BTCUSDT';
  if(!symbols.includes(selected))selected=symbols[0]||'BTCUSDT';
  return{symbols:[...new Set(symbols)],favorites:new Set(favorites),selected};
}
const initialMarket='futures';
const initialMarketData=loadMarketData(initialMarket);
const state={
  market:'futures',
  mode:storedMode,
  chartTf:localStorage.getItem('bsm_chart_tf')||'4h',
  symbols:initialMarketData.symbols,
  favorites:initialMarketData.favorites,
  selected:initialMarketData.selected,
  tickers:new Map(), candles:{}, liveKlines:{},
  candleCache:new Map(), candleCacheMeta:new Map(), pendingKlines:new Map(),
  ws:null, klineWs:null, klineReconnectTimer:null, tickerReconnectTimer:null,
  klineReconnectAttempt:0, tickerReconnectAttempt:0, tickerRenderTimer:null, chartRenderTimer:null, chartRenderQueued:false,
  chartLastRenderAt:0, chartHoverTime:null, analysis:null, deferredPrompt:null, analysisToken:0
};
if(!CHART_TIMEFRAMES.includes(state.chartTf)) state.chartTf='4h';
const DEFAULT_MODE_VERSION='short-default-v1';
if(localStorage.getItem('bsm_mode_default_version')!==DEFAULT_MODE_VERSION){
  state.mode='short';
  state.chartTf='4h';
  localStorage.setItem('bsm_mode','short');
  localStorage.setItem('bsm_mode_default_version',DEFAULT_MODE_VERSION);
}


const $=id=>document.getElementById(id);
const els={
  conn:$('connStatus'), swing:$('modeSwing'), short:$('modeShort'), input:$('symbolInput'), add:$('addSymbolBtn'), refresh:$('refreshBtn'),
  watch:$('watchList'), count:$('watchCount'), symbol:$('selectedSymbol'), mode:$('modeLabel'), price:$('selectedPrice'), change:$('selectedChange'),
  badge:$('signalBadge'), score:$('scoreText'), tf:$('timeframes'), hint:$('planHint'), planTitle:$('inlinePlanTitle'), canvas:$('chartCanvas'), chartTitle:$('chartTitle'), updated:$('updatedAt'), chartStats:$('chartStats'), chartLive:$('chartLiveBadge'),
  entry:$('entryValue'), sl:$('slValue'), tp1:$('tp1Value'), tp2:$('tp2Value'), tp3:$('tp3Value'), invalid:$('invalidValue'), trigger:$('triggerText'), breakout:$('breakoutText'),
  supports:$('supportList'), resistances:$('resistanceList'), reasons:$('reasonsList'), install:$('installBtn'), tfSelector:$('timeframeSelector')
};

function persist(){
  localStorage.setItem('bsm_market','futures');
  localStorage.setItem('bsm_mode',state.mode);
  localStorage.setItem('bsm_chart_tf',state.chartTf);
  localStorage.setItem(marketStoreKey('symbols','futures'),JSON.stringify(state.symbols));
  localStorage.setItem(marketStoreKey('favorites','futures'),JSON.stringify([...state.favorites]));
  localStorage.setItem(marketStoreKey('selected','futures'),state.selected);
}
function marketCfg(market='futures'){return MARKET_CONFIG.futures}
function marketLabel(){return 'FUTURES'}
function clamp(x,a,b){return Math.max(a,Math.min(b,x));}
function avg(arr){return arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:0;}
function fmt(n){ if(n==null||!Number.isFinite(n)) return '--'; const a=Math.abs(n); let d=a>=1000?2:a>=1?4:a>=.01?6:8; return n.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:d}); }
function pct(n){return `${n>=0?'+':''}${Number(n||0).toFixed(2)}%`;}
function nowMs(){return Date.now();}
function closedCandles(c){return c.filter(x=>x.closeTime<nowMs());}
function ema(values,period){ if(!values.length)return 0; const seed=Math.min(period,values.length); let e=avg(values.slice(0,seed)),m=2/(period+1); for(let i=seed;i<values.length;i++) e=(values[i]-e)*m+e; return e; }
function emaSeries(v,p){if(!v.length)return[];let e=v[0],m=2/(p+1),r=[e];for(let i=1;i<v.length;i++){e=(v[i]-e)*m+e;r.push(e)}return r}
function rsi(closes,p=14){if(closes.length<=p)return 50;let g=0,l=0;for(let i=1;i<=p;i++){let d=closes[i]-closes[i-1];if(d>=0)g+=d;else l-=d}g/=p;l/=p;for(let i=p+1;i<closes.length;i++){let d=closes[i]-closes[i-1],gg=d>0?d:0,ll=d<0?-d:0;g=(g*(p-1)+gg)/p;l=(l*(p-1)+ll)/p}if(l===0)return 100;let rs=g/l;return 100-(100/(1+rs))}
function macd(closes){if(closes.length<35)return{line:0,signal:0,hist:0};let a=emaSeries(closes,12),b=emaSeries(closes,26),m=a.map((x,i)=>x-b[i]),s=emaSeries(m,9);return{line:m.at(-1),signal:s.at(-1),hist:m.at(-1)-s.at(-1)}}
function atr(c,p=14){if(c.length<2)return 0;let tr=[];for(let i=Math.max(1,c.length-p);i<c.length;i++){let x=c[i],pc=c[i-1].close;tr.push(Math.max(x.high-x.low,Math.abs(x.high-pc),Math.abs(x.low-pc)))}return avg(tr)}
function avgPrevVol(c,p=20){if(c.length<=1)return 0;let end=c.length-1,start=Math.max(0,end-p);return avg(c.slice(start,end).map(x=>x.volume))}
function recentSupport(c,p){return Math.min(...c.slice(-Math.min(p,c.length)).map(x=>x.low));}
function recentResistance(c,p){return Math.max(...c.slice(-Math.min(p,c.length)).map(x=>x.high));}
function marketStructure(c){if(c.length<24)return 0;let r=c.slice(-10),p=c.slice(-20,-10),rh=Math.max(...r.map(x=>x.high)),rl=Math.min(...r.map(x=>x.low)),ph=Math.max(...p.map(x=>x.high)),pl=Math.min(...p.map(x=>x.low));if(rh>ph&&rl>pl)return 1;if(rh<ph&&rl<pl)return-1;return 0}
function emaTrend(c){if(c.length<205)return 0;let v=c.map(x=>x.close),cl=v.at(-1),e50=ema(v,50),e200=ema(v,200);if(cl>e50&&e50>e200)return 1;if(cl<e50&&e50<e200)return-1;return 0}
function trend(c,fast,slow){if(c.length<slow+2)return 0;let v=c.map(x=>x.close),cl=v.at(-1),f=ema(v,fast),s=ema(v,slow);if(cl>f&&f>s)return 1;if(cl<f&&f<s)return-1;return 0}
function adaptiveTrend(c){if(c.length>=205){let t=emaTrend(c);if(t)return t}return trend(c,20,50)}
function safeAtr(c,fallback){let a=atr(c);return a>0?a:Math.max(fallback,1e-8)}
function pivotWindow(tf){return tf==='15m'?3:tf==='1H'?4:tf==='4H'?4:tf==='12H'?5:tf==='1D'?5:tf==='1W'?4:3}
function getPivotLevels(c,lookback,kind,tf){
  let subset=c.slice(-Math.min(lookback,c.length)); if(subset.length<9) return [];
  let w=pivotWindow(tf), out=[];
  for(let i=w;i<subset.length-w;i++){
    let cur=kind==='support'?subset[i].low:subset[i].high, ok=true;
    for(let j=1;j<=w;j++){
      if(kind==='support'){ if(cur>subset[i-j].low||cur>subset[i+j].low){ok=false;break} }
      else { if(cur<subset[i-j].high||cur<subset[i+j].high){ok=false;break} }
    }
    if(ok) out.push({price:cur,index:i,candle:subset[i]});
  }
  return out;
}
function pivotZones(c,lookback,tf,atrWidth,profile,kind,maxCount=1){
  let subset=c.slice(-Math.min(lookback,c.length)), ref=subset.at(-1)?.close||c.at(-1)?.close||0;
  let a=safeAtr(subset,Math.max(ref*.01,1e-8)), mr=profile==='swing'?.0016:.00065, width=Math.max(a*atrWidth*.72,Math.max(ref*mr,1e-8));
  let pivots=getPivotLevels(c,lookback,kind,tf).map(x=>x.price);
  let baseline=kind==='support'?recentSupport(subset,subset.length):recentResistance(subset,subset.length);
  if(!pivots.length) pivots=[baseline];
  let sameSide=kind==='support'?pivots.filter(v=>v<=ref):pivots.filter(v=>v>=ref);
  let usable=(sameSide.length?sameSide:pivots).sort((x,y)=>kind==='support'?y-x:x-y);
  let zones=[];
  for(let anchor of usable){
    if(zones.some(z=>Math.abs(z.mid-anchor)<=a*.45)) continue;
    let cluster=usable.filter(v=>Math.abs(v-anchor)<=a*.35);
    if(!cluster.length) cluster=[anchor];
    let low=Math.min(...cluster), high=Math.max(...cluster);
    let z=kind==='support'?zone(low,Math.max(high,anchor+width*.55),profile,tf):zone(Math.max(0,Math.min(low,anchor-width*.55)),high,profile,tf);
    zones.push(z);
    if(zones.length>=maxCount) break;
  }
  return zones.length?zones:[kind==='support'?zone(baseline,baseline+width,profile,tf):zone(Math.max(0,baseline-width),baseline,profile,tf)];
}
function strength(frames,profile){
  let s=new Set(frames);
  if(profile==='swing'){
    let hasM=s.has('1M'),hasW=s.has('1W'),hasD=s.has('1D'),has12=s.has('12H'),has4=s.has('4H');
    if(hasM||(hasW&&s.size>=2)||(hasD&&(has12||has4)))return'VERY STRONG';
    if(hasW||hasD)return'MAJOR';
    if(s.size>=2||has12)return'STRONG';
    return has4?'MEDIUM':'SWING';
  }
  let has4=s.has('4H'),has1=s.has('1H'),has15=s.has('15m');
  if(has4&&has1)return'VERY STRONG';
  if(has4||(has1&&has15))return'STRONG';
  if(has1||has15)return'MEDIUM';
  return'SHORT TERM';
}
function zone(low,high,profile,...frames){let fr=[...new Set(frames)];return{low:Math.min(low,high),high:Math.max(low,high),frames:fr,strength:strength(fr,profile),get mid(){return(this.low+this.high)/2}}}
function buildSupport(c,lookback,tf,atrWidth,profile){
  let n=Math.min(lookback,c.length),support=recentSupport(c,n),a=safeAtr(c,Math.max(support*.01,1e-8));
  let minWidthRatio=profile==='swing'?.0018:.0008;
  let width=Math.max(a*atrWidth,Math.max(support*minWidthRatio,1e-8));
  return zone(support,support+width,profile,tf);
}
function buildResistance(c,lookback,tf,atrWidth,profile){
  let n=Math.min(lookback,c.length),resistance=recentResistance(c,n),a=safeAtr(c,Math.max(resistance*.01,1e-8));
  let minWidthRatio=profile==='swing'?.0018:.0008;
  let width=Math.max(a*atrWidth,Math.max(resistance*minWidthRatio,1e-8));
  return zone(Math.max(0,resistance-width),resistance,profile,tf);
}
function buildSupportZones(c,lookback,tf,atrWidth,profile,maxCount=2){return[buildSupport(c,lookback,tf,atrWidth,profile)]}
function buildResistanceZones(c,lookback,tf,atrWidth,profile,maxCount=2){return[buildResistance(c,lookback,tf,atrWidth,profile)]}
function wickResistanceClusters4H(c,lookback){
  let all=closedCandles(c),subset=all.slice(-Math.min(lookback,all.length));
  if(!subset.length)return{zones:[],ref:0,atr:0,tol:0};
  let ref=subset.at(-1).close,a=safeAtr(subset,Math.max(ref*.008,1e-8));
  let tol=Math.max(a*.22,ref*.0012),pad=Math.max(a*.07,ref*.00035);
  let pts=[];
  subset.forEach((x,i)=>{
    let bodyTop=Math.max(x.open,x.close),range=Math.max(x.high-x.low,1e-8),wick=Math.max(0,x.high-bodyTop);
    let minWick=Math.max(range*.08,a*.025);
    if(wick<minWick)return;
    if(x.high<ref-a*.10)return;
    pts.push({price:x.high,wick,wickRatio:wick/range,age:subset.length-1-i});
  });
  if(!pts.length){
    let hi=recentResistance(subset,subset.length),z=Object.assign(zone(Math.max(ref,hi-pad),hi+pad,'short','4H'),{touches:1,wickScore:0,rankScore:1,source:'4H Wick Cluster',lookback});
    return{zones:[z],ref,atr:a,tol};
  }
  pts.sort((a,b)=>a.price-b.price);
  let clusters=[];
  for(let p of pts){
    let c0=clusters.at(-1);
    if(!c0||p.price-c0.max>tol){clusters.push({items:[p],min:p.price,max:p.price});continue}
    c0.items.push(p);c0.max=p.price;
  }
  let zones=clusters.map(c0=>{
    let prices=c0.items.map(x=>x.price),weights=c0.items.map(x=>1+Math.min(x.wickRatio,1));
    let wsum=weights.reduce((a,b)=>a+b,0),center=prices.reduce((s,v,i)=>s+v*weights[i],0)/wsum;
    let touches=c0.items.length,wickScore=c0.items.reduce((s,x)=>s+x.wickRatio,0);
    let recency=c0.items.reduce((s,x)=>s+1/(1+x.age*.08),0);
    let z=zone(Math.max(0,Math.min(...prices)-pad),Math.max(...prices)+pad,'short','4H');
    z.touches=touches;z.wickScore=wickScore;z.center=center;z.rankScore=touches*100+wickScore*18+recency*3;z.source='4H Wick Cluster';z.lookback=lookback;
    return z;
  }).filter(z=>z.high>=ref-a*.10);
  zones.sort((a,b)=>b.rankScore-a.rankScore||Math.abs(a.mid-ref)-Math.abs(b.mid-ref));
  return{zones,ref,atr:a,tol};
}
function buildAdaptiveWickResistanceR1R2(c){
  let all=closedCandles(c); if(!all.length) return [];
  let ref=all.at(-1).close, atr4=safeAtr(all.slice(-30), Math.max(ref*.008,1e-8));
  let scanWindows=[]; for(let w=18; w<=160; w+=6) scanWindows.push(w);
  let pool=[];
  for(let w of scanWindows){
    let data=wickResistanceClusters4H(c,w);
    (data.zones||[]).forEach(z=>{
      if(z.mid<=ref) return;
      let key=pool.find(p=>Math.abs(p.mid-z.mid)<=Math.max(atr4*.55, ref*.0018));
      if(!key){
        pool.push({low:z.low,high:z.high,mid:z.mid,touches:z.touches||1,wickScore:z.wickScore||0,scanHits:1,minLookback:w,maxLookback:w,source:'4H Adaptive Wick'});
      }else{
        key.low=Math.min(key.low,z.low); key.high=Math.max(key.high,z.high); key.mid=(key.low+key.high)/2;
        key.touches=Math.max(key.touches,z.touches||1); key.wickScore=Math.max(key.wickScore,z.wickScore||0); key.scanHits+=1; key.maxLookback=w;
      }
    });
    let current=pool.filter(z=>z.touches>=2 && z.mid>ref).sort((a,b)=>a.mid-b.mid);
    let minGap=Math.max(atr4*.9, ref*.003);
    if(current.length>=2){
      let r1c=current[0];
      let r2c=current.find(z=>z.mid>=r1c.mid+minGap && z.low>r1c.high-atr4*.15);
      if(r1c && r2c && w>=42) break;
    }
  }
  if(!pool.length){
    let hi=recentResistance(all,30), pad=Math.max(atr4*.12, ref*.0004); return [Object.assign(zone(Math.max(ref,hi-pad),hi+pad,'short','4H'),{label:'R1',touches:1,lookbackUsed:30,source:'4H Adaptive Wick'})];
  }
  let candidates=pool.filter(z=>z.mid>ref).map(z=>{
    let dist=Math.max(0,(z.mid-ref)/Math.max(atr4,1e-8));
    z.rankScore=(z.touches||1)*90 + (z.scanHits||1)*18 + (z.wickScore||0)*14 - dist*6;
    return z;
  }).sort((a,b)=> b.rankScore-a.rankScore || a.mid-b.mid);
  if(!candidates.length) candidates=pool.sort((a,b)=>a.mid-b.mid);
  let nearestSorted=[...candidates].sort((a,b)=>a.mid-b.mid);
  let r1=nearestSorted.find(z=>z.touches>=2) || nearestSorted[0] || candidates[0];
  if(!r1) return [];
  let minGap=Math.max(atr4*.9, ref*.003);
  let r2=candidates.filter(z=>z!==r1 && z.mid>=r1.mid+minGap && z.low>r1.high-atr4*.15)
                   .sort((a,b)=>b.rankScore-a.rankScore || a.mid-b.mid)[0];
  if(!r2){
    r2=nearestSorted.find(z=>z!==r1 && z.mid>r1.mid+minGap/2);
  }
  let out=[];
  let z1=Object.assign(zone(r1.low,r1.high,'short','4H'),{label:'R1',touches:r1.touches||1,lookbackUsed:r1.maxLookback||r1.minLookback||30,scanHits:r1.scanHits||1,source:'4H Adaptive Wick'});
  out.push(z1);
  if(r2){
    let z2=Object.assign(zone(r2.low,r2.high,'short','4H'),{label:'R2',touches:r2.touches||1,lookbackUsed:r2.maxLookback||r2.minLookback||60,scanHits:r2.scanHits||1,source:'4H Adaptive Wick'});
    out.push(z2);
  }
  return out.sort((a,b)=>a.mid-b.mid);
}
const frameOrder={'1M':0,'1W':1,'1D':2,'12H':3,'4H':4,'1H':5,'15m':6};
function mergeZones(zones,profile,tolFactor){let sorted=[...zones].sort((a,b)=>a.low-b.low),m=[];for(let z of sorted){if(!m.length){m.push(z);continue}let last=m.at(-1),tol=Math.max(Math.max(last.high-last.low,1e-8),Math.max(z.high-z.low,1e-8))*tolFactor;if(z.low<=last.high+tol){let fr=[...new Set([...last.frames,...z.frames])].sort((a,b)=>(frameOrder[a]??9)-(frameOrder[b]??9));m[m.length-1]=zone(Math.min(last.low,z.low),Math.max(last.high,z.high),profile,...fr)}else m.push(z)}return m}
function rankSupports(z,p){return [...z].sort((a,b)=>((a.mid>p?1:0)-(b.mid>p?1:0))||Math.abs(p-a.mid)-Math.abs(p-b.mid))}
function rankRes(z,p){return [...z].sort((a,b)=>((a.mid<p?1:0)-(b.mid<p?1:0))||Math.abs(a.mid-p)-Math.abs(b.mid-p))}
function nearestSupport(z,p){return rankSupports(z,p)[0]}
function nearestResistance(z,p){return rankRes(z,p)[0]}
function tf(name,s){return `${name} ${s>0?'↑':s<0?'↓':'→'}`}
function reasonTf(name,s,role){return s>0?`✓ ${name}: bullish (${role})`:s<0?`✓ ${name}: bearish (${role})`:`○ ${name}: chưa rõ xu hướng (${role})`}
function selectDistinct(candidates,risk,asc){let r=[],min=Math.max(risk*.1,1e-8);for(let c of candidates){if(r.length&&Math.abs(c-r.at(-1))<min)continue;r.push(c);if(r.length===3)break}while(r.length<3){let step=Math.max(risk,1e-8),anchor=r.length?r.at(-1):0;r.push(r.length===0?(asc?step:-step):(asc?anchor+step:anchor-step))}return r}
function longTargets(mid,risk,res){let min=mid+1.35*risk,c=[...res,mid+1.8*risk,mid+2.8*risk,mid+4*risk].filter(x=>x>=min).sort((a,b)=>a-b);return selectDistinct(c,risk,true)}
function shortTargets(mid,risk,sup){let max=mid-1.35*risk,c=[...sup,mid-1.8*risk,mid-2.8*risk,mid-4*risk].filter(x=>x<=max).sort((a,b)=>b-a);return selectDistinct(c,risk,false)}

function analyzeSwing(data){
  let M=closedCandles(data['1M']),W=closedCandles(data['1w']),D=closedCandles(data['1d']),H12=closedCandles(data['12h']),H4=closedCandles(data['4h']);
  if(W.length<55||D.length<60||H12.length<60||H4.length<60)return basicWait('DÀI HẠN','Chưa đủ dữ liệu nến đã đóng ở khung lớn.');
  let reasons=[],tM=trend(M,6,12),tW=trend(W,20,50),tD=adaptiveTrend(D),t12=adaptiveTrend(H12),t4=trend(H4,20,50),strD=marketStructure(D);
  reasons.push(reasonTf('1M',tM,'chu kỳ lớn'),reasonTf('1W',tW,'xu hướng chính'),reasonTf('1D',tD,'cấu trúc chính'),reasonTf('12H',t12,'xác nhận'));
  reasons.push(strD>0?'✓ 1D: cấu trúc High/Low đang nâng dần':strD<0?'✓ 1D: cấu trúc High/Low đang hạ dần':'○ 1D: cấu trúc đang đi ngang / chưa xác nhận');
  let c4=H4.map(x=>x.close),r4=rsi(c4),m4=macd(c4),e20=ema(c4,20),last4=H4.at(-1),trig=0;
  if(last4.close>e20&&r4>=52&&r4<72&&m4.hist>0){trig=1;reasons.push(`✓ 4H: timing LONG xác nhận (RSI ${r4.toFixed(1)}, MACD dương)`)}
  else if(last4.close<e20&&r4<=48&&r4>28&&m4.hist<0){trig=-1;reasons.push(`✓ 4H: timing SHORT xác nhận (RSI ${r4.toFixed(1)}, MACD âm)`)}else reasons.push(`○ 4H: timing vào lệnh chưa rõ (RSI ${r4.toFixed(1)})`);
  // Trọng số Dài hạn: 1M 10% • 1W 25% • 1D 30% • 12H 20% • 4H 15%.
  let t4Score=trig||t4,score=clamp(tM*10+tW*25+tD*30+t12*20+t4Score*15,-100,100);
  let av=avgPrevVol(D,20),vr=av?D.at(-1).volume/av:0;reasons.push(vr>=1.2?`✓ Volume 1D nổi bật (${vr.toFixed(1)}x trung bình 20D)`:`○ Volume 1D bình thường (${vr.toFixed(1)}x trung bình 20D)`);
  let p=last4.close,a4=safeAtr(H4,p*.01),aD=safeAtr(D,p*.025);
  let su=[buildSupport(W,52,'1W',.75,'swing'),buildSupport(D,120,'1D',.65,'swing'),buildSupport(H12,140,'12H',.55,'swing'),buildSupport(H4,150,'4H',.50,'swing')];
  let re=[buildResistance(W,52,'1W',.75,'swing'),buildResistance(D,120,'1D',.65,'swing'),buildResistance(H12,140,'12H',.55,'swing'),buildResistance(H4,150,'4H',.50,'swing')];
  if(M.length>=8){su.push(buildSupport(M,Math.min(18,M.length),'1M',.85,'swing'));re.push(buildResistance(M,Math.min(18,M.length),'1M',.85,'swing'))}
  su=rankSupports(mergeZones(su,'swing',.55),p).slice(0,4);re=rankRes(mergeZones(re,'swing',.55),p).slice(0,4);
  let ps=nearestSupport(su,p),pr=nearestResistance(re,p);
  let mw=tM&&tW&&tM!==tW,wd=tW&&tD&&tW!==tD,longBias=tW>0&&tD>0&&tM>=0,shortBias=tW<0&&tD<0&&tM<=0;
  if(mw)reasons.unshift('⚠ 1M và 1W xung đột → chưa phù hợp để giữ vị thế dài.');else if(wd)reasons.unshift('⚠ 1W và 1D xung đột → ưu tiên WAIT.');
  let nearS=ps&&p>=ps.low-.25*a4&&p<=ps.high+.55*a4,nearR=pr&&p<=pr.high+.25*a4&&p>=pr.low-.55*a4;
  let closeR=pr&&pr.low>p&&pr.low-p<.75*aD,closeS=ps&&ps.high<p&&p-ps.high<.75*aD;
  let kind='WAIT';if(mw||wd)kind='WAIT';else if(longBias&&score>=65&&trig>0&&nearS&&!closeR)kind='LONG';else if(shortBias&&score<=-65&&trig<0&&nearR&&!closeS)kind='SHORT';else if(longBias&&score>=45)kind='WATCH LONG';else if(shortBias&&score<=-45)kind='WATCH SHORT';
  if(closeR&&longBias)reasons.unshift('⚠ Giá đang sát kháng cự khung lớn → chưa xác nhận LONG mới.');if(closeS&&shortBias)reasons.unshift('⚠ Giá đang sát hỗ trợ khung lớn → chưa xác nhận SHORT mới.');
  let out={kind,score,mode:'DÀI HẠN',timeframes:`${tf('1M',tM)}   ${tf('1W',tW)}   ${tf('1D',tD)}   ${tf('12H',t12)}   ${tf('4H',t4Score)}`,reasons:reasons.slice(0,9),supports:su,resistances:re,primarySupport:ps,primaryResistance:pr,ref:D.at(-1).close};
  if(kind==='LONG'&&ps){let lo=ps.low,hi=ps.high,sl=lo-.6*aD,mid=(lo+hi)/2,risk=mid-sl,t=longTargets(mid,risk,re.filter(z=>z.low>mid).map(z=>z.low));if(risk>0&&t[0]-mid>=1.35*risk){Object.assign(out,{entryLow:lo,entryHigh:hi,sl,tp1:t[0],tp2:t[1],tp3:t[2],trigger:'4H đóng xác nhận tăng tại vùng hỗ trợ; 1D/1W vẫn giữ bias tăng.',invalid:`Luận điểm LONG yếu đi nếu 1D đóng dưới ${fmt(sl)}.`})}else{out.kind='WATCH LONG'}}
  if(kind==='SHORT'&&pr){let lo=pr.low,hi=pr.high,sl=hi+.6*aD,mid=(lo+hi)/2,risk=sl-mid,t=shortTargets(mid,risk,su.filter(z=>z.high<mid).map(z=>z.high));if(risk>0&&mid-t[0]>=1.35*risk){Object.assign(out,{entryLow:lo,entryHigh:hi,sl,tp1:t[0],tp2:t[1],tp3:t[2],trigger:'4H đóng xác nhận giảm tại vùng kháng cự; 1D/1W vẫn giữ bias giảm.',invalid:`Luận điểm SHORT yếu đi nếu 1D đóng trên ${fmt(sl)}.`})}else{out.kind='WATCH SHORT'}}
  if(out.kind==='WATCH LONG'&&ps){out.watchLow=ps.low;out.watchHigh=ps.high;out.invalid=out.invalid||`Vùng canh mất ý nghĩa nếu 1D đóng dưới khoảng ${fmt(ps.low-.6*aD)}.`;out.hint=`CANH LONG vùng ${fmt(ps.low)} – ${fmt(ps.high)} [${ps.frames.join('+')}] ${ps.strength}. Đây là vùng chờ, chưa phải lệnh.`;if(pr)out.breakout=`Breakout thay thế: chờ 1D đóng trên ${fmt(pr.high)}, sau đó ưu tiên retest vùng vừa phá.`}
  else if(out.kind==='WATCH SHORT'&&pr){out.watchLow=pr.low;out.watchHigh=pr.high;out.invalid=out.invalid||`Vùng canh mất ý nghĩa nếu 1D đóng trên khoảng ${fmt(pr.high+.6*aD)}.`;out.hint=`CANH SHORT vùng ${fmt(pr.low)} – ${fmt(pr.high)} [${pr.frames.join('+')}] ${pr.strength}. Đây là vùng chờ, chưa phải lệnh.`;if(ps)out.breakout=`Breakdown thay thế: chờ 1D đóng dưới ${fmt(ps.low)}, sau đó ưu tiên retest vùng vừa phá.`}
  else if(out.kind==='WAIT') out.hint=ps&&pr?`WAIT - hỗ trợ gần ${fmt(ps.low)}–${fmt(ps.high)} [${ps.frames.join('+')}] • kháng cự gần ${fmt(pr.low)}–${fmt(pr.high)} [${pr.frames.join('+')}].`:'WAIT - chưa có setup vị thế rõ.';
  else out.hint=`${out.kind}: Entry ${fmt(out.entryLow)} – ${fmt(out.entryHigh)} | SL ${fmt(out.sl)} | TP1 ${fmt(out.tp1)}`;
  return out;
}

function analyzeShort(data){
  let C15=closedCandles(data['15m']),H1=closedCandles(data['1h']),H4=closedCandles(data['4h']);
  if(C15.length<210||H1.length<210||H4.length<210)return basicWait('NGẮN HẠN','Chưa đủ dữ liệu nến đã đóng để tính tín hiệu và S/R.');

  let reasons=[],t4=emaTrend(H4),t1=emaTrend(H1),str=marketStructure(H1);
  reasons.push(
    t4>0?'✓ 4H: xu hướng chính tăng (giá > EMA50 > EMA200)':t4<0?'✓ 4H: xu hướng chính giảm (giá < EMA50 < EMA200)':'○ 4H: xu hướng chính chưa rõ',
    t1>0?'✓ 1H: cấu trúc xu hướng tăng đồng thuận':t1<0?'✓ 1H: cấu trúc xu hướng giảm đồng thuận':'○ 1H: xu hướng chưa rõ',
    str>0?'✓ 1H: High/Low đang nâng dần':str<0?'✓ 1H: High/Low đang hạ dần':'○ 1H: cấu trúc giá đi ngang / chưa xác nhận'
  );

  let v15=C15.map(x=>x.close),r15=rsi(v15),m15=macd(v15),e20=ema(v15,20),e50=ema(v15,50);
  let a15=safeAtr(C15,C15.at(-1).close*.002),a4=safeAtr(H4,H4.at(-1).close*.01),last15=C15.at(-1),t15=0;
  if(last15.close>e20&&r15>=52&&r15<72&&m15.hist>0){t15=1;reasons.push(`✓ 15m: timing LONG xác nhận (RSI ${r15.toFixed(1)}, MACD dương)`)}
  else if(last15.close<e20&&r15<=48&&r15>28&&m15.hist<0){t15=-1;reasons.push(`✓ 15m: timing SHORT xác nhận (RSI ${r15.toFixed(1)}, MACD âm)`)}
  else reasons.push(`○ 15m: timing chưa đồng thuận (RSI ${r15.toFixed(1)})`);
  if(r15>72)reasons.push('⚠ 15m: RSI cao, tránh đuổi LONG');else if(r15<28)reasons.push('⚠ 15m: RSI thấp, tránh đuổi SHORT');

  reasons.push(`○ Short ${ENGINE_VERSION}: S/R dùng 4H + 1H + 15m; 5m đã loại hoàn toàn.`);
  // Canonical Short V2.2: 4H 45% • 1H 35% • 15m 20%.
  let score=clamp(
    t4*SHORT_STRATEGY.weights['4h']+
    t1*SHORT_STRATEGY.weights['1h']+
    t15*SHORT_STRATEGY.weights['15m'],
    -100,100
  );
  let av=avgPrevVol(C15,20),vr=av?last15.volume/av:0;
  if(vr>=1.2)reasons.push(last15.close>=last15.open?`✓ Volume 15m mua tăng (${vr.toFixed(1)}x trung bình)`:`✓ Volume 15m bán tăng (${vr.toFixed(1)}x trung bình)`);
  else reasons.push('○ Volume 15m chưa nổi bật');

  let nearL=last15.close>=e20-.3*a15&&last15.close<=e20+.8*a15&&last15.close>e50;
  let nearS=last15.close<=e20+.3*a15&&last15.close>=e20-.8*a15&&last15.close<e50;
  if(t4>0&&t1>0&&nearL)reasons.push('✓ 15m: giá đang ở vùng pullback hợp lý quanh EMA20');
  else if(t4<0&&t1<0&&nearS)reasons.push('✓ 15m: giá đang ở vùng hồi hợp lý quanh EMA20');

  let p=last15.close;
  let rawSupports=[
    buildSupport(H4,80,'4H',.40,'short'),
    buildSupport(H1,100,'1H',.32,'short'),
    buildSupport(C15,120,'15m',.25,'short')
  ];
  let rawResistances=[
    buildResistance(H4,80,'4H',.40,'short'),
    buildResistance(H1,100,'1H',.32,'short'),
    buildResistance(C15,120,'15m',.25,'short')
  ];
  let su=rankSupports(mergeZones(rawSupports,'short',.28),p).slice(0,4);
  let re=rankRes(mergeZones(rawResistances,'short',.28),p).slice(0,4);
  let ps=su.find(z=>z.mid<=p)||su[0],pr=re.find(z=>z.mid>=p)||re[0];

  // S/R quyết định vùng giao dịch; EMA20 15m chỉ dùng để thu hẹp timing bên trong vùng.
  let nearSupport=!!ps&&p>=ps.low-.20*a4&&p<=ps.high+.45*a4;
  let nearResistance=!!pr&&p<=pr.high+.20*a4&&p>=pr.low-.45*a4;
  if(nearSupport)reasons.push(`✓ Giá đang gần vùng hỗ trợ ${fmt(ps.low)}–${fmt(ps.high)} [${ps.frames.join('+')}]`);
  if(nearResistance)reasons.push(`✓ Giá đang gần vùng kháng cự ${fmt(pr.low)}–${fmt(pr.high)} [${pr.frames.join('+')}]`);

  let conflict=t4&&t1&&t4!==t1,kind='WAIT';
  if(conflict){reasons.unshift('⚠ 4H và 1H xung đột → ưu tiên WAIT.');}
  else if(t4>0&&t1>0&&t15>0&&nearL&&nearSupport&&r15<72)kind='LONG';
  else if(t4<0&&t1<0&&t15<0&&nearS&&nearResistance&&r15>28)kind='SHORT';
  else if(score>=SHORT_STRATEGY.watchThreshold&&t4>0&&t1>=0&&ps)kind='WATCH LONG';
  else if(score<=-SHORT_STRATEGY.watchThreshold&&t4<0&&t1<=0&&pr)kind='WATCH SHORT';

  let out={kind,score,mode:'NGẮN HẠN',timeframes:`${tf('4H',t4)}   ${tf('1H',t1)}   ${tf('15m',t15)}`,reasons:reasons.slice(0,10),supports:su,resistances:re,primarySupport:ps,primaryResistance:pr,ref:last15.close};

  if(kind==='LONG'&&ps){
    let timingLow=e20-.35*a15,timingHigh=e20+.35*a15;
    let lo=Math.max(ps.low,timingLow),hi=Math.min(ps.high,timingHigh);
    if(lo>hi){lo=ps.low;hi=ps.high}
    let mid=(lo+hi)/2,sl=ps.low-.35*a4,risk=mid-sl;
    let targets=re.filter(z=>z.low>mid).map(z=>z.low).sort((a,b)=>a-b);
    let tp1=targets[0],tp2=targets[1],tp3=targets[2];
    let rr1=risk>0&&tp1!=null?(tp1-mid)/risk:0;
    if(risk<=0||tp1==null||rr1<SHORT_STRATEGY.minRR){
      out.kind='WAIT';
      out.hint=tp1==null?'WAIT - chưa có kháng cự phía trên đủ rõ để đặt TP1.':`WAIT - TP1 chỉ đạt khoảng ${rr1.toFixed(2)}R, thấp hơn mức tối thiểu ${SHORT_STRATEGY.minRR.toFixed(1)}R.`;
      out.reasons.unshift(tp1==null?'⚠ Chưa xác định được TP1 từ vùng kháng cự phía trên.':`⚠ Risk/Reward tới TP1 = ${rr1.toFixed(2)}R < ${SHORT_STRATEGY.minRR.toFixed(1)}R → không vào LONG.`);
    }else{
      Object.assign(out,{entryLow:lo,entryHigh:hi,sl,tp1,tp2,tp3,trigger:'Giá ở Support + 15m đóng xác nhận tăng (EMA20 / RSI / MACD).',invalid:`Setup LONG mất hiệu lực nếu giá phá xuống dưới khoảng ${fmt(sl)}.`,rr1});
      out.reasons.unshift(`✓ LONG: Entry theo Support, SL dưới Support 0.35 ATR4H, TP1 tại Resistance gần nhất (${rr1.toFixed(2)}R).`);
    }
  }

  if(kind==='SHORT'&&pr){
    let timingLow=e20-.35*a15,timingHigh=e20+.35*a15;
    let lo=Math.max(pr.low,timingLow),hi=Math.min(pr.high,timingHigh);
    if(lo>hi){lo=pr.low;hi=pr.high}
    let mid=(lo+hi)/2,sl=pr.high+.35*a4,risk=sl-mid;
    let targets=su.filter(z=>z.high<mid).map(z=>z.high).sort((a,b)=>b-a);
    let tp1=targets[0],tp2=targets[1],tp3=targets[2];
    let rr1=risk>0&&tp1!=null?(mid-tp1)/risk:0;
    if(risk<=0||tp1==null||rr1<SHORT_STRATEGY.minRR){
      out.kind='WAIT';
      out.hint=tp1==null?'WAIT - chưa có hỗ trợ phía dưới đủ rõ để đặt TP1.':`WAIT - TP1 chỉ đạt khoảng ${rr1.toFixed(2)}R, thấp hơn mức tối thiểu ${SHORT_STRATEGY.minRR.toFixed(1)}R.`;
      out.reasons.unshift(tp1==null?'⚠ Chưa xác định được TP1 từ vùng hỗ trợ phía dưới.':`⚠ Risk/Reward tới TP1 = ${rr1.toFixed(2)}R < ${SHORT_STRATEGY.minRR.toFixed(1)}R → không vào SHORT.`);
    }else{
      Object.assign(out,{entryLow:lo,entryHigh:hi,sl,tp1,tp2,tp3,trigger:'Giá ở Resistance + 15m đóng xác nhận giảm (EMA20 / RSI / MACD).',invalid:`Setup SHORT mất hiệu lực nếu giá phá lên trên khoảng ${fmt(sl)}.`,rr1});
      out.reasons.unshift(`✓ SHORT: Entry theo Resistance, SL trên Resistance 0.35 ATR4H, TP1 tại Support gần nhất (${rr1.toFixed(2)}R).`);
    }
  }

  if(out.kind==='WATCH LONG'&&ps){
    out.watchLow=ps.low;out.watchHigh=ps.high;
    out.invalid=`Vùng canh yếu đi nếu giá phá xuống dưới khoảng ${fmt(ps.low-.35*a4)}.`;
    out.hint=`CANH LONG vùng Support ${fmt(ps.low)} – ${fmt(ps.high)} [${ps.frames.join('+')}]. Chờ 15m xác nhận tăng trước khi vào.`;
    if(pr)out.breakout=`Breakout thay thế: chờ 15m đóng trên ${fmt(pr.high)}, sau đó retest và giữ vùng vừa phá.`;
  }else if(out.kind==='WATCH SHORT'&&pr){
    out.watchLow=pr.low;out.watchHigh=pr.high;
    out.invalid=`Vùng canh yếu đi nếu giá phá lên trên khoảng ${fmt(pr.high+.35*a4)}.`;
    out.hint=`CANH SHORT vùng Resistance ${fmt(pr.low)} – ${fmt(pr.high)} [${pr.frames.join('+')}]. Chờ 15m xác nhận giảm trước khi vào.`;
    if(ps)out.breakout=`Breakdown thay thế: chờ 15m đóng dưới ${fmt(ps.low)}, sau đó retest và giữ vùng vừa phá.`;
  }else if(out.kind==='WAIT'){
    if(!out.hint){let nextR=(re||[]).find(z=>z!==pr),nextS=(su||[]).find(z=>z!==ps);out.hint=ps&&pr?`WAIT - hỗ trợ gần ${fmt(ps.low)}–${fmt(ps.high)} [${ps.frames.join('+')}] • kháng cự gần ${fmt(pr.low)}–${fmt(pr.high)} [${pr.frames.join('+')}]${nextR?` • kháng cự kế tiếp ${fmt(nextR.low)}–${fmt(nextR.high)} [${nextR.frames.join('+')}]`:''}${nextS?` • hỗ trợ kế tiếp ${fmt(nextS.low)}–${fmt(nextS.high)} [${nextS.frames.join('+')}]`:''}.`:'WAIT - chưa có setup ngắn hạn rõ.';}
  }else{
    out.hint=`${out.kind}: Entry ${fmt(out.entryLow)} – ${fmt(out.entryHigh)} | SL ${fmt(out.sl)} | TP1 ${fmt(out.tp1)}${out.rr1?` | RR ${out.rr1.toFixed(2)}R`:''}`;
  }
  return out;
}

function basicWait(mode,msg){return{kind:'WAIT',score:0,mode,timeframes:'--',reasons:[msg],supports:[],resistances:[],hint:'WAIT - đang chờ đủ dữ liệu.'}}

function candleCacheKey(symbol,interval,market=state.market){return `${market}:${symbol}:${interval}`}
function touchCandleCache(key,patch={}){
  let meta=state.candleCacheMeta.get(key)||{};
  meta.lastAccess=Date.now();Object.assign(meta,patch);state.candleCacheMeta.set(key,meta);return meta;
}
function pruneCandleCache(){
  if(state.candleCache.size<=CANDLE_CACHE_MAX_ENTRIES)return;
  let currentPrefix=`${state.market}:${state.selected}:`;
  let victims=[...state.candleCache.keys()]
    .filter(k=>!k.startsWith(currentPrefix))
    .sort((a,b)=>(state.candleCacheMeta.get(a)?.lastAccess||0)-(state.candleCacheMeta.get(b)?.lastAccess||0));
  while(state.candleCache.size>CANDLE_CACHE_MAX_ENTRIES&&victims.length){
    let k=victims.shift();state.candleCache.delete(k);state.candleCacheMeta.delete(k);
  }
}
function normalizeCandles(candles){
  let m=new Map();for(let c of candles||[]){if(c&&Number.isFinite(c.openTime))m.set(c.openTime,c)}
  return [...m.values()].sort((a,b)=>a.openTime-b.openTime).slice(-CANDLE_CACHE_LIMIT);
}
function setCachedCandles(symbol,interval,candles,market=state.market,hydrated=true){
  let key=candleCacheKey(symbol,interval,market),arr=normalizeCandles(candles);
  state.candleCache.set(key,arr);touchCandleCache(key,{hydrated,lastUpdateAt:Date.now()});pruneCandleCache();
  if(symbol===state.selected&&market===state.market)state.candles[interval]=arr;
  return arr;
}
function getCachedCandles(symbol,interval,market=state.market){
  let key=candleCacheKey(symbol,interval,market),arr=state.candleCache.get(key);
  if(arr)touchCandleCache(key);return arr||null;
}
function cacheIsFresh(symbol,interval,market=state.market){
  let key=candleCacheKey(symbol,interval,market),meta=state.candleCacheMeta.get(key);
  return !!(meta?.hydrated&&meta.lastUpdateAt&&Date.now()-meta.lastUpdateAt<=CANDLE_CACHE_FRESH_MS);
}
function updateCachedCandle(symbol,interval,candle,market=state.market){
  let key=candleCacheKey(symbol,interval,market),arr=state.candleCache.get(key);
  if(!arr){arr=[];state.candleCache.set(key,arr)}
  let last=arr.at(-1);
  if(last?.openTime===candle.openTime)arr[arr.length-1]=candle;
  else if(!last||candle.openTime>last.openTime)arr.push(candle);
  else{
    let idx=arr.findIndex(x=>x.openTime===candle.openTime);if(idx>=0)arr[idx]=candle;
  }
  if(arr.length>CANDLE_CACHE_LIMIT)arr.splice(0,arr.length-CANDLE_CACHE_LIMIT);
  touchCandleCache(key,{lastUpdateAt:Date.now()});pruneCandleCache();
  if(symbol===state.selected&&market===state.market)state.candles[interval]=arr;
  return arr;
}
function scheduleChartRender(immediate=false){
  if(state.chartRenderQueued)return;
  const run=()=>{
    state.chartRenderTimer=null;state.chartRenderQueued=true;
    requestAnimationFrame(()=>{
      state.chartRenderQueued=false;state.chartLastRenderAt=performance.now();
      let arr=state.candles?.[state.chartTf];if(arr?.length)drawChart(arr,state.analysis||{});
    });
  };
  let elapsed=performance.now()-(state.chartLastRenderAt||0);
  if(immediate||elapsed>=CHART_RENDER_INTERVAL){run();return}
  if(!state.chartRenderTimer)state.chartRenderTimer=setTimeout(run,Math.max(0,CHART_RENDER_INTERVAL-elapsed));
}
function scheduleTickerRender(){
  if(state.tickerRenderTimer)return;
  state.tickerRenderTimer=setTimeout(()=>{state.tickerRenderTimer=null;renderWatchlist();renderSelectedTicker()},TICKER_RENDER_INTERVAL);
}
function reconnectDelay(attempt){return Math.min(WS_RECONNECT_MAX_MS,WS_RECONNECT_BASE_MS*Math.pow(1.7,Math.max(0,attempt-1)))}

async function apiFetch(path,market=state.market){
  let last,cfg=marketCfg(market);
  for(let base of cfg.apiBases){
    try{
      let controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
      let r=await fetch(base+path,{cache:'no-store',signal:controller.signal});
      clearTimeout(timer);
      if(!r.ok)throw new Error(`${r.status}`);
      return await r.json();
    }catch(e){last=e}
  }
  throw last||new Error(`Không kết nối được Binance ${marketLabel(market)}`);
}
async function getKlines(symbol,interval,limit=260,market=state.market){
  let cfg=marketCfg(market);
  let rows=await apiFetch(`${cfg.klinesPath}?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`,market);
  return rows.map(r=>({openTime:+r[0],open:+r[1],high:+r[2],low:+r[3],close:+r[4],volume:+r[5],closeTime:+r[6]}));
}
async function getKlinesCached(symbol,interval,market=state.market,{forceRest=false}={}){
  let cached=getCachedCandles(symbol,interval,market);
  if(!forceRest&&cached&&cacheIsFresh(symbol,interval,market))return cached;
  let key=candleCacheKey(symbol,interval,market);
  if(state.pendingKlines.has(key))return state.pendingKlines.get(key);
  let p=getKlines(symbol,interval,260,market)
    .then(rows=>setCachedCandles(symbol,interval,mergeLiveCandle(interval,rows,symbol,market),market,true))
    .finally(()=>state.pendingKlines.delete(key));
  state.pendingKlines.set(key,p);return p;
}

function mergeLiveCandle(interval,candles,symbol=state.selected,market=state.market){
  let live=(symbol===state.selected&&market===state.market)?state.liveKlines?.[interval]:null;if(!live)return normalizeCandles(candles);
  let out=[...(candles||[])],last=out.at(-1);
  if(last&&last.openTime===live.openTime)out[out.length-1]=live;
  else if(!last||live.openTime>last.openTime)out.push(live);
  return normalizeCandles(out);
}
function applyLiveKline(interval,candle,symbol=state.selected,market=state.market){
  if(symbol===state.selected&&market===state.market)state.liveKlines[interval]=candle;
  updateCachedCandle(symbol,interval,candle,market);
  if(interval===state.chartTf&&symbol===state.selected&&market===state.market)scheduleChartRender();
}
function connectKlines(){
  if(state.klineReconnectTimer){clearTimeout(state.klineReconnectTimer);state.klineReconnectTimer=null}
  if(state.klineWs){try{state.klineWs.onclose=null;state.klineWs.close()}catch{}state.klineWs=null}
  let symbol=(state.selected||'').toLowerCase();if(!symbol)return;
  let marketAtConnect=state.market,selectedAtConnect=state.selected,cfg=marketCfg(marketAtConnect);
  let streams=CHART_TIMEFRAMES.map(tf=>`${symbol}@kline_${tf}`).join('/');
  let ws=new WebSocket(cfg.wsBase+streams);state.klineWs=ws;
  ws.onopen=()=>{
    if(state.klineWs!==ws)return;
    let wasReconnect=state.klineReconnectAttempt>0;state.klineReconnectAttempt=0;
    if(wasReconnect)setTimeout(()=>{if(state.klineWs===ws&&state.selected===selectedAtConnect)analyzeSelected({forceRest:true,source:'ws-resync'})},300);
  };
  ws.onmessage=e=>{try{
    if(state.market!==marketAtConnect||state.selected!==selectedAtConnect)return;
    let payload=JSON.parse(e.data),d=payload.data||payload,k=d.k;if(!k||d.s!==selectedAtConnect)return;
    let candle={openTime:+k.t,open:+k.o,high:+k.h,low:+k.l,close:+k.c,volume:+k.v,closeTime:+k.T};
    applyLiveKline(k.i,candle,selectedAtConnect,marketAtConnect);
    if(k.i===state.chartTf){
      let t=state.tickers.get(state.selected)||{};state.tickers.set(state.selected,{price:candle.close,change:t.change||0});renderSelectedTicker();
    }
    if(k.x&&(ANALYSIS_TIMEFRAMES[state.mode]||[]).includes(k.i)){
      clearTimeout(connectKlines._analysisTimer);
      connectKlines._analysisTimer=setTimeout(()=>analyzeSelected({forceRest:false,source:'closed-kline'}),180);
    }
  }catch{}};
  ws.onclose=()=>{
    if(state.klineWs!==ws)return;
    state.klineReconnectAttempt++;
    state.klineReconnectTimer=setTimeout(connectKlines,reconnectDelay(state.klineReconnectAttempt));
  };
  ws.onerror=()=>{};
}
async function validateSymbol(s,market=state.market){
  let cfg=marketCfg(market);
  let j=await apiFetch(`${cfg.ticker24Path}?symbol=${encodeURIComponent(s)}`,market);
  return{symbol:s,price:+j.lastPrice,change:+j.priceChangePercent};
}

function connectTicker(){
  if(state.tickerReconnectTimer){clearTimeout(state.tickerReconnectTimer);state.tickerReconnectTimer=null}
  if(state.ws){try{state.ws.onclose=null;state.ws.close()}catch{}state.ws=null}
  if(!state.symbols.length)return;
  let marketAtConnect=state.market,cfg=marketCfg(marketAtConnect),streams=state.symbols.map(s=>`${s.toLowerCase()}@miniTicker`).join('/');
  let ws=new WebSocket(cfg.wsBase+streams);state.ws=ws;setConn('connecting');
  ws.onopen=()=>{if(state.ws===ws&&state.market===marketAtConnect){state.tickerReconnectAttempt=0;setConn('online')}};
  ws.onmessage=e=>{try{
    if(state.market!==marketAtConnect)return;
    let payload=JSON.parse(e.data),d=payload.data||payload,s=d.s,p=+d.c,o=+d.o,ch=o?((p-o)/o*100):0;if(!s)return;
    state.tickers.set(s,{price:p,change:ch});scheduleTickerRender();
  }catch{}};
  ws.onerror=()=>{if(state.market===marketAtConnect)setConn('offline')};
  ws.onclose=()=>{
    if(state.ws!==ws||state.market!==marketAtConnect)return;
    setConn('offline');state.tickerReconnectAttempt++;
    state.tickerReconnectTimer=setTimeout(()=>{if(state.ws===ws)connectTicker()},reconnectDelay(state.tickerReconnectAttempt));
  };
}
function setConn(s){els.conn.classList.toggle('online',s==='online');els.conn.classList.toggle('offline',s==='offline');els.conn.querySelector('span:last-child').textContent=s==='online'?'Realtime':s==='connecting'?'Đang kết nối':'Mất kết nối'}
function renderWatchlist(){
  els.count.textContent=`${state.symbols.length} cặp · ${marketLabel()}`;let syms=[...state.symbols].sort((a,b)=>(state.favorites.has(b)-state.favorites.has(a))||a.localeCompare(b));
  els.watch.innerHTML=syms.map(s=>{let t=state.tickers.get(s),active=s===state.selected?' active':'',fav=state.favorites.has(s)?' on':'';return `<div class="watch-item${active}" data-symbol="${s}"><button class="star${fav}" data-star="${s}" aria-label="Yêu thích">★</button><div><div class="wi-symbol">${s.replace('USDT','/USDT')}</div><div class="wi-change ${t&&t.change>=0?'up':'down'}">${t?pct(t.change):'--'}</div></div><div class="wi-price">${t?fmt(t.price):'--'}</div><button class="delete-coin" data-delete="${s}" aria-label="Xóa ${s}" title="Xóa coin">×</button></div>`}).join('');
  els.watch.querySelectorAll('[data-symbol]').forEach(x=>x.addEventListener('click',e=>{if(e.target.closest('[data-star],[data-delete]'))return;selectSymbol(x.dataset.symbol)}));
  els.watch.querySelectorAll('[data-star]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();let s=b.dataset.star;state.favorites.has(s)?state.favorites.delete(s):state.favorites.add(s);persist();renderWatchlist()}));
  els.watch.querySelectorAll('[data-delete]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();removeSymbol(b.dataset.delete)}));
}
function renderSelectedTicker(){let t=state.tickers.get(state.selected);els.symbol.textContent=state.selected;els.price.textContent=t?fmt(t.price):'--';els.change.textContent=t?pct(t.change):'--';els.change.className='change '+(t&&t.change>=0?'up':'down')}
function signalClass(k){return k==='LONG'?'long':k==='SHORT'?'short':k.startsWith('WATCH')?'watch':'wait'}
function renderAnalysis(a){
  state.analysis=a;els.mode.textContent=`${marketLabel()} · ${a.mode}`;els.badge.textContent=a.kind;els.badge.className=`signal ${signalClass(a.kind)}`;els.score.textContent=`Score ${a.score>=0?'+':''}${a.score}`;els.tf.textContent=a.timeframes;els.hint.textContent=a.hint||'--';if(els.planTitle)els.planTitle.textContent=`${a.kind} · KẾ HOẠCH`;els.updated.textContent=new Date().toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'});
  els.entry.textContent=a.entryLow!=null?`${fmt(a.entryLow)} – ${fmt(a.entryHigh)}`:(a.watchLow!=null?`Canh ${fmt(a.watchLow)} – ${fmt(a.watchHigh)}`:'--');els.sl.textContent=fmt(a.sl);els.tp1.textContent=fmt(a.tp1);els.tp2.textContent=fmt(a.tp2);els.tp3.textContent=fmt(a.tp3);els.invalid.textContent=a.invalid||'--';els.trigger.textContent=a.trigger||'';els.breakout.textContent=a.breakout||'';
  els.supports.innerHTML=(a.supports||[]).map(z=>`<div class="level"><strong>${fmt(z.low)} – ${fmt(z.high)}</strong><small>${z.frames.join('+')} • ${z.strength}</small></div>`).join('')||'<div class="muted">--</div>';
  els.resistances.innerHTML=(a.resistances||[]).map(z=>`<div class="level"><strong>${fmt(z.low)} – ${fmt(z.high)}</strong><small>${z.frames.join('+')} • ${z.strength}</small></div>`).join('')||'<div class="muted">--</div>';
  els.reasons.innerHTML=(a.reasons||[]).map(r=>`<div class="reason">${escapeHtml(r)}</div>`).join('');
}
function escapeHtml(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function updateTimeframeButtons(){
  els.tfSelector?.querySelectorAll('[data-tf]').forEach(b=>b.classList.toggle('active',b.dataset.tf===state.chartTf));
}
function chartTfLabel(tf){return tf==='1M'?'1M':tf}
async function setChartTimeframe(tf){
  if(!CHART_TIMEFRAMES.includes(tf))return;
  state.chartTf=tf;persist();updateTimeframeButtons();
  let requestSymbol=state.selected,requestMarket=state.market;
  els.chartTitle.textContent=`${requestSymbol} • ${chartTfLabel(tf)}`;
  try{
    let candles=state.candles?.[tf]||getCachedCandles(requestSymbol,tf,requestMarket);
    if(!candles||!cacheIsFresh(requestSymbol,tf,requestMarket)){
      els.updated.textContent='Đang tải...';candles=await getKlinesCached(requestSymbol,tf,requestMarket);
    }
    if(requestSymbol!==state.selected||requestMarket!==state.market||tf!==state.chartTf)return;
    state.candles[tf]=candles;drawChart(candles,state.analysis||{});
    els.updated.textContent=new Date().toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'});
  }catch(e){if(requestSymbol===state.selected&&tf===state.chartTf)els.updated.textContent='Lỗi tải biểu đồ'}
}
async function analyzeSelected({forceRest=false,source='ui'}={}){
  const token=++state.analysisToken,requestMarket=state.market,requestSymbol=state.selected,requestMode=state.mode,requestChartTf=state.chartTf;
  renderSelectedTicker();if(source!=='closed-kline')els.hint.textContent=`Đang tải Binance ${marketLabel(requestMarket)} và phân tích...`;els.refresh.disabled=true;
  try{
    let analysisIntervals=ANALYSIS_TIMEFRAMES[requestMode]||ANALYSIS_TIMEFRAMES.short;
    let intervals=[...new Set([...analysisIntervals,requestChartTf])],data={};
    await Promise.all(intervals.map(async i=>{data[i]=await getKlinesCached(requestSymbol,i,requestMarket,{forceRest})}));
    if(token!==state.analysisToken||requestMarket!==state.market||requestSymbol!==state.selected||requestMode!==state.mode||requestChartTf!==state.chartTf)return;
    state.candles={...state.candles,...data};
    let a=requestMode==='swing'?analyzeSwing(data):analyzeShort(data);
    renderAnalysis(a);updateTimeframeButtons();els.chartTitle.textContent=`${requestSymbol} · ${marketLabel(requestMarket)} • ${chartTfLabel(requestChartTf)}`;drawChart(data[requestChartTf],a);
  }catch(e){
    if(token===state.analysisToken&&requestMarket===state.market)renderAnalysis(basicWait(requestMode==='swing'?'DÀI HẠN':'NGẮN HẠN',`Không tải được Binance ${marketLabel(requestMarket)}: ${e.message||e}`));
  }finally{if(token===state.analysisToken)els.refresh.disabled=false}
}
function chartVisibleCount(w){return w<350?46:w<410?52:58}
function chartTimeLabel(openTime,tf){
  let d=new Date(openTime),opt=(tf==='1d'||tf==='1w'||tf==='1M')?{day:'2-digit',month:'2-digit'}:{hour:'2-digit',minute:'2-digit'};
  return d.toLocaleString('vi-VN',opt);
}
function drawChart(candles,a){
  const cvs=els.canvas;if(!cvs)return;
  const ctx=cvs.getContext('2d',{alpha:false});
  let w=Math.max(280,Math.round(cvs.clientWidth||cvs.getBoundingClientRect().width||320));
  let h=Math.max(240,Math.round(cvs.clientHeight||280));
  let dpr=Math.min(CHART_MAX_DPR,window.devicePixelRatio||1),bw=Math.round(w*dpr),bh=Math.round(h*dpr);
  if(cvs.width!==bw||cvs.height!==bh){cvs.width=bw;cvs.height=bh}
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  let bg=ctx.createLinearGradient(0,0,0,h);bg.addColorStop(0,'#0a1119');bg.addColorStop(1,'#05090e');ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
  if(!candles?.length)return;

  let visible=chartVisibleCount(w),data=candles.slice(-visible);if(!data.length)return;
  let pad={l:11,r:68,t:25,b:25},cw=w-pad.l-pad.r,ch=h-pad.t-pad.b,volumeH=Math.max(26,ch*.15),priceH=ch-volumeH-7;
  let rawLo=Math.min(...data.map(x=>x.low)),rawHi=Math.max(...data.map(x=>x.high)),rawRange=Math.max(rawHi-rawLo,Math.abs(rawHi)*.001,1e-8);
  let overlay=[a?.entryLow,a?.entryHigh,a?.watchLow,a?.watchHigh,a?.sl,a?.tp1,a?.tp2,a?.tp3].filter(Number.isFinite).filter(v=>v>=rawLo-rawRange*.35&&v<=rawHi+rawRange*.35);
  let lo=Math.min(rawLo,...overlay),hi=Math.max(rawHi,...overlay),extra=Math.max((hi-lo)*.10,rawRange*.06,1e-8);lo-=extra;hi+=extra;
  let xstep=cw/data.length,scaleY=v=>pad.t+(hi-v)/(hi-lo)*priceH,priceBottom=pad.t+priceH,volumeBottom=pad.t+ch;

  // Soft grid + right price scale.
  ctx.font='10px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';ctx.textBaseline='middle';
  for(let i=0;i<5;i++){
    let y=pad.t+i*priceH/4,val=hi-(hi-lo)*i/4;
    ctx.strokeStyle='rgba(118,145,174,.14)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(pad.l,y+.5);ctx.lineTo(w-pad.r,y+.5);ctx.stroke();
    ctx.fillStyle='#8799ae';ctx.fillText(fmt(val),w-pad.r+6,y);
  }
  for(let i=1;i<4;i++){
    let x=pad.l+cw*i/4;ctx.strokeStyle='rgba(118,145,174,.07)';ctx.beginPath();ctx.moveTo(x,pad.t);ctx.lineTo(x,priceBottom);ctx.stroke();
  }
  ctx.strokeStyle='rgba(118,145,174,.12)';ctx.beginPath();ctx.moveTo(pad.l,priceBottom+4);ctx.lineTo(w-pad.r,priceBottom+4);ctx.stroke();

  function band(z,fill,stroke,label){
    if(!z)return;let top=Math.min(scaleY(z.high),scaleY(z.low)),bottom=Math.max(scaleY(z.high),scaleY(z.low));
    if(bottom<pad.t||top>priceBottom)return;top=Math.max(pad.t,top);bottom=Math.min(priceBottom,bottom);let hh=Math.max(3,bottom-top);
    ctx.fillStyle=fill;ctx.fillRect(pad.l,top,cw,hh);ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.setLineDash([4,5]);ctx.strokeRect(pad.l+.5,top+.5,cw-1,Math.max(1,hh-1));ctx.setLineDash([]);
    if(label){ctx.fillStyle=stroke;ctx.font='bold 9px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';ctx.fillText(label,pad.l+5,top+Math.min(9,hh/2));}
  }
  let supportZones=(a.supports||[]).slice(0,2),resistanceZones=(a.resistances||[]).slice(0,2);
  supportZones.forEach((z,i)=>band(z,i===0?'rgba(25,230,162,.115)':'rgba(25,230,162,.055)',i===0?'rgba(25,230,162,.66)':'rgba(25,230,162,.34)',i===0?'SUP':''));
  resistanceZones.forEach((z,i)=>band(z,i===0?'rgba(255,91,120,.115)':'rgba(255,91,120,.055)',i===0?'rgba(255,91,120,.66)':'rgba(255,91,120,.34)',i===0?'RES':''));
  let entryLow=Number.isFinite(a.entryLow)?a.entryLow:a.watchLow,entryHigh=Number.isFinite(a.entryHigh)?a.entryHigh:a.watchHigh;
  if(Number.isFinite(entryLow)&&Number.isFinite(entryHigh))band({low:Math.min(entryLow,entryHigh),high:Math.max(entryLow,entryHigh)},'rgba(240,185,11,.12)','rgba(240,185,11,.72)','ENTRY');

  // Volume strip: useful context with very little visual noise.
  let maxVol=Math.max(...data.map(x=>x.volume||0),1);
  data.forEach((c,i)=>{
    let x=pad.l+i*xstep+xstep*.5,bh=(c.volume||0)/maxVol*(volumeH-4),up=c.close>=c.open;
    ctx.fillStyle=up?'rgba(25,230,162,.18)':'rgba(255,91,120,.18)';ctx.fillRect(x-Math.max(1,xstep*.28),volumeBottom-bh,Math.max(2,xstep*.56),bh);
  });

  // Candles. Avoid expensive shadowBlur on every websocket tick.
  data.forEach((c,i)=>{
    let x=pad.l+i*xstep+xstep*.5,yo=scaleY(c.open),yc=scaleY(c.close),yh=scaleY(c.high),yl=scaleY(c.low),up=c.close>=c.open,color=up?'#21dca2':'#ff627e';
    ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=Math.max(1.15,Math.min(1.8,xstep*.20));ctx.beginPath();ctx.moveTo(x,yh);ctx.lineTo(x,yl);ctx.stroke();
    let bw=Math.max(3.5,Math.min(8.5,xstep*.66)),top=Math.min(yo,yc),bodyH=Math.max(2,Math.abs(yc-yo));ctx.fillRect(x-bw/2,top,bw,bodyH);
  });

  function priceLine(value,label,color,dash=[5,5]){
    if(!Number.isFinite(value))return;let y=scaleY(value);if(y<pad.t||y>priceBottom)return;
    ctx.save();ctx.strokeStyle=color;ctx.lineWidth=1;ctx.setLineDash(dash);ctx.beginPath();ctx.moveTo(pad.l,y+.5);ctx.lineTo(w-pad.r,y+.5);ctx.stroke();ctx.setLineDash([]);
    ctx.font='bold 9px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';let text=`${label} ${fmt(value)}`,tw=ctx.measureText(text).width+10,x=Math.max(pad.l,w-pad.r-tw-2);
    ctx.fillStyle='rgba(4,8,12,.86)';ctx.fillRect(x,y-8,tw,16);ctx.fillStyle=color;ctx.fillText(text,x+5,y);ctx.restore();
  }
  priceLine(a.sl,'SL','#ff718a',[3,4]);priceLine(a.tp3,'TP3','#4fd6a5',[3,5]);priceLine(a.tp2,'TP2','#3bd59b',[3,5]);priceLine(a.tp1,'TP1','#24e2a0',[3,5]);

  let last=data.at(-1),lastY=scaleY(last.close);
  if(lastY>=pad.t&&lastY<=priceBottom){
    ctx.strokeStyle='rgba(106,169,255,.72)';ctx.lineWidth=1;ctx.setLineDash([2,3]);ctx.beginPath();ctx.moveTo(pad.l,lastY+.5);ctx.lineTo(w-pad.r,lastY+.5);ctx.stroke();ctx.setLineDash([]);
    let txt=fmt(last.close),tw=ctx.measureText(txt).width+12;ctx.fillStyle='#6aa9ff';ctx.fillRect(w-pad.r+1,lastY-9,Math.min(pad.r-3,tw),18);ctx.fillStyle='#07101c';ctx.font='bold 9px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';ctx.fillText(txt,w-pad.r+6,lastY);
  }

  // Time anchors.
  ctx.fillStyle='#667b92';ctx.font='9px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';ctx.textBaseline='alphabetic';
  [0,Math.floor((data.length-1)/2),data.length-1].forEach((idx,j)=>{let x=pad.l+idx*xstep+xstep*.5,label=chartTimeLabel(data[idx].openTime,state.chartTf),tw=ctx.measureText(label).width;ctx.fillText(label,Math.max(pad.l,Math.min(w-pad.r-tw,x-tw/2)),h-5)});

  // Pointer crosshair + OHLC readout.
  if(state.chartHoverTime!=null){
    let idx=data.findIndex(c=>c.openTime===state.chartHoverTime);if(idx>=0){let c=data[idx],x=pad.l+idx*xstep+xstep*.5,y=scaleY(c.close);
      ctx.strokeStyle='rgba(220,232,246,.36)';ctx.lineWidth=1;ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(x,pad.t);ctx.lineTo(x,priceBottom);ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();ctx.setLineDash([]);
      ctx.fillStyle='#e8f0fa';ctx.beginPath();ctx.arc(x,y,2.6,0,Math.PI*2);ctx.fill();
      let info=`O ${fmt(c.open)}   H ${fmt(c.high)}   L ${fmt(c.low)}   C ${fmt(c.close)}`;ctx.font='bold 9px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';let tw=ctx.measureText(info).width+14;
      ctx.fillStyle='rgba(7,12,18,.92)';ctx.fillRect(pad.l+3,pad.t+3,Math.min(tw,cw-6),19);ctx.fillStyle='#dce8f6';ctx.fillText(info,pad.l+9,pad.t+13);
    }
  }

  if(els.chartStats)els.chartStats.textContent=`${data.length} nến · cache realtime`;
  if(els.chartLive){let live=state.klineWs?.readyState===1;els.chartLive.classList.toggle('online',live);els.chartLive.querySelector('span:last-child').textContent=live?'LIVE':'SYNC';}
}
async function selectSymbol(s){state.selected=s;state.candles={};state.liveKlines={};persist();renderWatchlist();renderSelectedTicker();connectKlines();await analyzeSelected()}
async function removeSymbol(s){
  if(state.symbols.length<=1){alert('Cần giữ lại ít nhất 1 coin trong danh sách.');return}
  if(!confirm(`Xóa ${s.replace('USDT','/USDT')} khỏi danh sách?`))return;
  let wasSelected=state.selected===s;state.symbols=state.symbols.filter(x=>x!==s);state.favorites.delete(s);state.tickers.delete(s);
  if(wasSelected)state.selected=state.symbols[0];state.candles={};if(wasSelected)state.liveKlines={};persist();renderWatchlist();renderSelectedTicker();connectTicker();if(wasSelected){connectKlines();await analyzeSelected();}
}
async function addSymbol(){let s=els.input.value.toUpperCase().replace(/[^A-Z0-9]/g,'').trim();if(!s)return;if(!s.endsWith('USDT'))s+='USDT';els.add.disabled=true;try{let t=await validateSymbol(s,state.market);state.tickers.set(s,{price:t.price,change:t.change});if(!state.symbols.includes(s))state.symbols.push(s);state.selected=s;state.candles={};state.liveKlines={};els.input.value='';persist();renderWatchlist();connectTicker();connectKlines();await analyzeSelected()}catch{alert(`Không tìm thấy ${s} trên Binance USDⓈ-M Futures hoặc Binance đang chặn kết nối từ mạng hiện tại.`)}finally{els.add.disabled=false}}
function setMode(m){state.mode=m;state.chartTf='4h';els.swing.classList.toggle('active',m==='swing');els.short.classList.toggle('active',m==='short');updateTimeframeButtons();persist();analyzeSelected()}
els.swing.onclick=()=>setMode('swing');els.short.onclick=()=>setMode('short');els.add.onclick=addSymbol;els.input.addEventListener('keydown',e=>{if(e.key==='Enter')addSymbol()});els.refresh.onclick=()=>analyzeSelected({forceRest:true,source:'manual'});els.tfSelector?.querySelectorAll('[data-tf]').forEach(b=>b.addEventListener('click',()=>setChartTimeframe(b.dataset.tf)));
function updateChartPointer(e){
  let arr=state.candles?.[state.chartTf];if(!arr?.length||!els.canvas)return;let r=els.canvas.getBoundingClientRect(),x=e.clientX-r.left,w=r.width,padL=11,padR=68,cw=w-padL-padR;if(x<padL||x>w-padR)return;
  let data=arr.slice(-chartVisibleCount(w)),step=cw/data.length,idx=clamp(Math.floor((x-padL)/step),0,data.length-1);state.chartHoverTime=data[idx]?.openTime??null;scheduleChartRender(true);
}
els.canvas?.addEventListener('pointermove',updateChartPointer,{passive:true});
els.canvas?.addEventListener('pointerdown',updateChartPointer,{passive:true});
els.canvas?.addEventListener('pointerleave',()=>{state.chartHoverTime=null;scheduleChartRender(true)});
window.addEventListener('resize',()=>scheduleChartRender(true));
window.addEventListener('pagehide',()=>{clearTimeout(state.klineReconnectTimer);clearTimeout(state.tickerReconnectTimer);clearTimeout(state.tickerRenderTimer);clearTimeout(state.chartRenderTimer);clearTimeout(connectKlines._analysisTimer);try{state.klineWs?.close()}catch{};try{state.ws?.close()}catch{}});
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState!=='visible')return;
  if(!state.ws||state.ws.readyState>=2)connectTicker();
  if(!state.klineWs||state.klineWs.readyState>=2)connectKlines();
  let intervals=[...new Set([...(ANALYSIS_TIMEFRAMES[state.mode]||ANALYSIS_TIMEFRAMES.short),state.chartTf])];
  if(intervals.some(tf=>!cacheIsFresh(state.selected,tf,state.market)))setTimeout(()=>analyzeSelected({forceRest:true,source:'resume'}),120);
});
window.addEventListener('online',()=>{connectTicker();connectKlines();setTimeout(()=>analyzeSelected({forceRest:true,source:'online'}),150)});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.deferredPrompt=e;els.install.classList.remove('hidden')});els.install.onclick=async()=>{if(state.deferredPrompt){state.deferredPrompt.prompt();await state.deferredPrompt.userChoice;state.deferredPrompt=null;els.install.classList.add('hidden')}};
if('serviceWorker' in navigator)window.addEventListener('load',async()=>{try{let r=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});await r.update()}catch{}});

(async function init(){
  if(!state.symbols.includes(state.selected))state.selected=state.symbols[0]||'BTCUSDT';
  if(state.mode==='short') state.chartTf='4h';
  els.swing.classList.toggle('active',state.mode==='swing');els.short.classList.toggle('active',state.mode==='short');
  updateTimeframeButtons();renderWatchlist();renderSelectedTicker();connectTicker();connectKlines();
  try{let t=await validateSymbol(state.selected,state.market);state.tickers.set(state.selected,{price:t.price,change:t.change});renderWatchlist();renderSelectedTicker()}catch{}
  analyzeSelected();
})();
