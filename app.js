'use strict';

const API_BASES=['https://api.binance.com','https://api1.binance.com','https://api2.binance.com','https://api3.binance.com'];
const WS_BASE='wss://stream.binance.com:9443/stream?streams=';
const DEFAULT_SYMBOLS=['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT'];
const CHART_TIMEFRAMES=['15m','1h','4h','12h','1d','1w','1M'];
const ANALYSIS_TIMEFRAMES={swing:['1M','1w','1d','12h','4h'],short:['15m','1h','4h']};
const storedMode=localStorage.getItem('bsm_mode')||'swing';
const state={
  mode:storedMode,
  chartTf:localStorage.getItem('bsm_chart_tf')||'4h',
  symbols:JSON.parse(localStorage.getItem('bsm_symbols')||'null')||DEFAULT_SYMBOLS,
  favorites:new Set(JSON.parse(localStorage.getItem('bsm_favorites')||'["BTCUSDT"]')),
  selected:localStorage.getItem('bsm_selected')||'BTCUSDT',
  tickers:new Map(), candles:new Map(), ws:null, analysis:null, deferredPrompt:null
};
if(!CHART_TIMEFRAMES.includes(state.chartTf)) state.chartTf='4h';

const $=id=>document.getElementById(id);
const els={
  conn:$('connStatus'), swing:$('modeSwing'), short:$('modeShort'), input:$('symbolInput'), add:$('addSymbolBtn'), refresh:$('refreshBtn'),
  watch:$('watchList'), count:$('watchCount'), symbol:$('selectedSymbol'), mode:$('modeLabel'), price:$('selectedPrice'), change:$('selectedChange'),
  badge:$('signalBadge'), score:$('scoreText'), tf:$('timeframes'), hint:$('planHint'), canvas:$('chartCanvas'), chartTitle:$('chartTitle'), updated:$('updatedAt'),
  entry:$('entryValue'), sl:$('slValue'), tp1:$('tp1Value'), tp2:$('tp2Value'), tp3:$('tp3Value'), invalid:$('invalidValue'), trigger:$('triggerText'), breakout:$('breakoutText'),
  supports:$('supportList'), resistances:$('resistanceList'), reasons:$('reasonsList'), install:$('installBtn'), tfSelector:$('timeframeSelector')
};

function persist(){
  localStorage.setItem('bsm_mode',state.mode); localStorage.setItem('bsm_chart_tf',state.chartTf); localStorage.setItem('bsm_symbols',JSON.stringify(state.symbols));
  localStorage.setItem('bsm_favorites',JSON.stringify([...state.favorites])); localStorage.setItem('bsm_selected',state.selected);
}
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
function strength(frames,profile){let s=new Set(frames);if(profile==='swing'){if(s.has('1M')||(s.has('1W')&&s.size>=2)||(s.has('1D')&&(s.has('12H')||s.has('4H'))))return'VERY STRONG';if(s.has('1W')||s.has('1D'))return'MAJOR';if(s.size>=2||s.has('12H'))return'STRONG';return s.has('4H')?'MEDIUM':'SWING'}if(s.has('4H')&&s.has('1H'))return'VERY STRONG';if(s.size>=2||(s.has('1H')&&s.has('15m')))return'STRONG';if(s.has('4H')||s.has('1H'))return'MEDIUM';return'SHORT TERM'}
function zone(low,high,profile,...frames){let fr=[...new Set(frames)];return{low:Math.min(low,high),high:Math.max(low,high),frames:fr,strength:strength(fr,profile),get mid(){return(this.low+this.high)/2}}}
function buildSupport(c,lookback,tf,atrWidth,profile){return pivotZones(c,lookback,tf,atrWidth,profile,'support',1)[0]}
function buildResistance(c,lookback,tf,atrWidth,profile){return pivotZones(c,lookback,tf,atrWidth,profile,'resistance',1)[0]}
function buildSupportZones(c,lookback,tf,atrWidth,profile,maxCount=2){return pivotZones(c,lookback,tf,atrWidth,profile,'support',maxCount)}
function buildResistanceZones(c,lookback,tf,atrWidth,profile,maxCount=2){return pivotZones(c,lookback,tf,atrWidth,profile,'resistance',maxCount)}
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
function rankSupports(z,p){return [...z].sort((a,b)=>{let ac=a.high<=p?0:(a.low<=p?1:2),bc=b.high<=p?0:(b.low<=p?1:2);return ac-bc||Math.abs(p-a.mid)-Math.abs(p-b.mid)})}
function rankRes(z,p){return [...z].sort((a,b)=>{let ac=a.low>=p?0:(a.high>=p?1:2),bc=b.low>=p?0:(b.high>=p?1:2);return ac-bc||Math.abs(a.mid-p)-Math.abs(b.mid-p)})}
function nearestSupport(z,p){let list=rankSupports(z,p);return list.find(x=>x.high<=p)||list.find(x=>x.low<=p&&x.high>=p)||list[0]}
function nearestResistance(z,p){let list=rankRes(z,p);return list.find(x=>x.low>=p)||list.find(x=>x.low<=p&&x.high>=p)||list[0]}
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
  if(C15.length<210||H1.length<210||H4.length<210)return basicWait('NGẮN HẠN','Chưa đủ dữ liệu nến đã đóng ở 15m / 1H / 4H.');
  let reasons=[],t4=emaTrend(H4),t1=emaTrend(H1),str=marketStructure(H1);
  reasons.push(t4>0?'✓ 4H: xu hướng chính tăng (giá > EMA50 > EMA200)':t4<0?'✓ 4H: xu hướng chính giảm (giá < EMA50 < EMA200)':'○ 4H: xu hướng chính chưa rõ',t1>0?'✓ 1H: cấu trúc xu hướng tăng đồng thuận':t1<0?'✓ 1H: cấu trúc xu hướng giảm đồng thuận':'○ 1H: xu hướng chưa rõ',str>0?'✓ 1H: High/Low đang nâng dần':str<0?'✓ 1H: High/Low đang hạ dần':'○ 1H: cấu trúc giá đi ngang / chưa xác nhận');
  let v15=C15.map(x=>x.close),r15=rsi(v15),m15=macd(v15),e20=ema(v15,20),e50=ema(v15,50),a15=safeAtr(C15,C15.at(-1).close*.002),last15=C15.at(-1),t15=0;
  if(last15.close>e20&&r15>=52&&r15<72&&m15.hist>0){t15=1;reasons.push(`✓ 15m: timing LONG xác nhận (RSI ${r15.toFixed(1)}, MACD dương)`)}
  else if(last15.close<e20&&r15<=48&&r15>28&&m15.hist<0){t15=-1;reasons.push(`✓ 15m: timing SHORT xác nhận (RSI ${r15.toFixed(1)}, MACD âm)`)}else reasons.push(`○ 15m: timing chưa đồng thuận (RSI ${r15.toFixed(1)})`);
  if(r15>72)reasons.push('⚠ 15m: RSI cao, tránh đuổi LONG');else if(r15<28)reasons.push('⚠ 15m: RSI thấp, tránh đuổi SHORT');
  // Trọng số Ngắn hạn: 4H 50% • 1H 30% • 15m 20%. Không dùng 5m trong engine.
  let score=clamp(t4*50+t1*30+t15*20,-100,100);
  let av=avgPrevVol(C15,20),vr=av?last15.volume/av:0;if(vr>=1.2){reasons.push(last15.close>=last15.open?`✓ Volume 15m mua tăng (${vr.toFixed(1)}x trung bình)`:`✓ Volume 15m bán tăng (${vr.toFixed(1)}x trung bình)`)}else reasons.push('○ Volume 15m chưa nổi bật');
  let nearL=last15.close>=e20-.3*a15&&last15.close<=e20+.8*a15&&last15.close>e50,nearS=last15.close<=e20+.3*a15&&last15.close>=e20-.8*a15&&last15.close<e50;
  if(t4>0&&t1>0&&nearL)reasons.push('✓ 15m: giá đang ở vùng pullback hợp lý quanh EMA20');else if(t4<0&&t1<0&&nearS)reasons.push('✓ 15m: giá đang ở vùng hồi hợp lý quanh EMA20');
  let p=last15.close,su=rankSupports(mergeZones([
    ...buildSupportZones(H4,80,'4H',.4,'short',2),
    ...buildSupportZones(H1,100,'1H',.32,'short',2),
    ...buildSupportZones(C15,120,'15m',.25,'short',1)
  ],'short',.24),p).slice(0,4),re=buildAdaptiveWickResistanceR1R2(H4);
  reasons.push(`✓ Kháng cự 4H: quét thích ứng theo cụm râu nến${re[0]?.touches?` • ${re.map(z=>(z.label||'R')+': '+z.touches+' râu / '+(z.lookbackUsed||0)+' nến').join(' / ')}`:''}`);
  let ps=nearestSupport(su,p),pr=nearestResistance(re,p),s15=recentSupport(C15,20),r15level=recentResistance(C15,20),wll=Math.max(s15,e20-.5*a15),wlh=e20+.25*a15;if(wll>wlh)wll=e20-.25*a15;let wsl=e20-.25*a15,wsh=Math.min(r15level,e20+.5*a15);if(wsh<wsl)wsh=e20+.25*a15;
  let conflict=t4&&t1&&t4!==t1,kind='WAIT';if(conflict){reasons.unshift('⚠ 4H và 1H xung đột → ưu tiên WAIT.')}else if(t4>0&&t1>0&&t15>0&&nearL&&r15<72)kind='LONG';else if(t4<0&&t1<0&&t15<0&&nearS&&r15>28)kind='SHORT';else if(score>=45&&t4>0&&t1>=0)kind='WATCH LONG';else if(score<=-45&&t4<0&&t1<=0)kind='WATCH SHORT';
  let out={kind,score,mode:'NGẮN HẠN',timeframes:`${tf('4H',t4)}   ${tf('1H',t1)}   ${tf('15m',t15)}`,reasons:reasons.slice(0,9),supports:su,resistances:re,primarySupport:ps,primaryResistance:pr,ref:last15.close};
  if(kind==='LONG'){let lo=Math.max(s15,e20-.25*a15),hi=e20+.2*a15;if(lo>hi)[lo,hi]=[hi,lo];let mid=(lo+hi)/2,sl=Math.min(s15,lo)-.35*a15,risk=mid-sl;if(risk>0)Object.assign(out,{entryLow:lo,entryHigh:hi,sl,tp1:mid+1.5*risk,tp2:mid+2.5*risk,trigger:'15m đóng trên EMA20, RSI > 52 và MACD dương',invalid:`Setup LONG mất hiệu lực nếu 15m đóng dưới khoảng ${fmt(sl)}.`});else out.kind='WATCH LONG'}
  if(kind==='SHORT'){let hi=Math.min(r15level,e20+.25*a15),lo=e20-.2*a15;if(lo>hi)[lo,hi]=[hi,lo];let mid=(lo+hi)/2,sl=Math.max(r15level,hi)+.35*a15,risk=sl-mid;if(risk>0)Object.assign(out,{entryLow:lo,entryHigh:hi,sl,tp1:mid-1.5*risk,tp2:mid-2.5*risk,trigger:'15m đóng dưới EMA20, RSI < 48 và MACD âm',invalid:`Setup SHORT mất hiệu lực nếu 15m đóng trên khoảng ${fmt(sl)}.`});else out.kind='WATCH SHORT'}
  if(out.kind==='WATCH LONG'){out.watchLow=wll;out.watchHigh=wlh;out.invalid=out.invalid||`Vùng canh yếu đi nếu 15m đóng dưới khoảng ${fmt(wll-.35*a15)}.`;out.hint=`CANH LONG quanh ${fmt(wll)} – ${fmt(wlh)} [15m]. Đây là vùng chờ, chưa phải Entry.`;out.breakout=`Breakout nhanh: chờ 15m đóng trên ${fmt(r15level)}, sau đó chờ 15m retest/giữ vùng vừa phá.`}
  else if(out.kind==='WATCH SHORT'){out.watchLow=wsl;out.watchHigh=wsh;out.invalid=out.invalid||`Vùng canh yếu đi nếu 15m đóng trên khoảng ${fmt(wsh+.35*a15)}.`;out.hint=`CANH SHORT quanh ${fmt(wsl)} – ${fmt(wsh)} [15m]. Đây là vùng chờ, chưa phải Entry.`;out.breakout=`Breakdown nhanh: chờ 15m đóng dưới ${fmt(s15)}, sau đó chờ 15m retest/giữ vùng vừa phá.`}
  else if(out.kind==='WAIT'){let nextR=(re||[]).find(z=>z!==pr&&z.low>=(pr?.high??0));let nextS=(su||[]).find(z=>z!==ps&&z.high<=(ps?.low??Infinity));out.hint=ps&&pr?`WAIT - hỗ trợ gần ${fmt(ps.low)}–${fmt(ps.high)} [${ps.frames.join('+')}] • kháng cự 4H #1 ${fmt(pr.low)}–${fmt(pr.high)}${pr.touches?` (${pr.touches} râu)`:''}${nextR?` • kháng cự 4H #2 ${fmt(nextR.low)}–${fmt(nextR.high)}${nextR.touches?` (${nextR.touches} râu)`:''}`:''}.`:'WAIT - chưa có setup ngắn hạn rõ.';}
  else out.hint=`${out.kind}: Entry ${fmt(out.entryLow)} – ${fmt(out.entryHigh)} | SL ${fmt(out.sl)} | TP1 ${fmt(out.tp1)}`;
  return out;
}
function basicWait(mode,msg){return{kind:'WAIT',score:0,mode,timeframes:'--',reasons:[msg],supports:[],resistances:[],hint:'WAIT - đang chờ đủ dữ liệu.'}}

async function apiFetch(path){let last;for(let base of API_BASES){try{let r=await fetch(base+path,{cache:'no-store'});if(!r.ok)throw new Error(`${r.status}`);return await r.json()}catch(e){last=e}}throw last||new Error('Không kết nối được Binance')}
async function getKlines(symbol,interval,limit=260){let rows=await apiFetch(`/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`);return rows.map(r=>({openTime:+r[0],open:+r[1],high:+r[2],low:+r[3],close:+r[4],volume:+r[5],closeTime:+r[6]}))}
async function validateSymbol(s){let j=await apiFetch(`/api/v3/ticker/24hr?symbol=${encodeURIComponent(s)}`);return{symbol:s,price:+j.lastPrice,change:+j.priceChangePercent}}

function connectTicker(){
  if(state.ws){try{state.ws.close()}catch{}}
  if(!state.symbols.length)return;let streams=state.symbols.map(s=>`${s.toLowerCase()}@miniTicker`).join('/');
  let ws=new WebSocket(WS_BASE+streams);state.ws=ws;setConn('connecting');
  ws.onopen=()=>setConn('online');ws.onmessage=e=>{try{let d=JSON.parse(e.data).data,s=d.s,p=+d.c,o=+d.o,ch=o?((p-o)/o*100):0;state.tickers.set(s,{price:p,change:ch});renderWatchlist();if(s===state.selected)renderSelectedTicker()}catch{}};
  ws.onerror=()=>setConn('offline');ws.onclose=()=>{setConn('offline');setTimeout(()=>{if(state.ws===ws)connectTicker()},2500)};
}
function setConn(s){els.conn.classList.toggle('online',s==='online');els.conn.classList.toggle('offline',s==='offline');els.conn.querySelector('span:last-child').textContent=s==='online'?'Realtime':s==='connecting'?'Đang kết nối':'Mất kết nối'}
function renderWatchlist(){
  els.count.textContent=`${state.symbols.length} cặp`;let syms=[...state.symbols].sort((a,b)=>(state.favorites.has(b)-state.favorites.has(a))||a.localeCompare(b));
  els.watch.innerHTML=syms.map(s=>{let t=state.tickers.get(s),active=s===state.selected?' active':'',fav=state.favorites.has(s)?' on':'';return `<div class="watch-item${active}" data-symbol="${s}"><button class="star${fav}" data-star="${s}" aria-label="Yêu thích">★</button><div><div class="wi-symbol">${s.replace('USDT','/USDT')}</div><div class="wi-change ${t&&t.change>=0?'up':'down'}">${t?pct(t.change):'--'}</div></div><div class="wi-price">${t?fmt(t.price):'--'}</div><button class="delete-coin" data-delete="${s}" aria-label="Xóa ${s}" title="Xóa coin">×</button></div>`}).join('');
  els.watch.querySelectorAll('[data-symbol]').forEach(x=>x.addEventListener('click',e=>{if(e.target.closest('[data-star],[data-delete]'))return;selectSymbol(x.dataset.symbol)}));
  els.watch.querySelectorAll('[data-star]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();let s=b.dataset.star;state.favorites.has(s)?state.favorites.delete(s):state.favorites.add(s);persist();renderWatchlist()}));
  els.watch.querySelectorAll('[data-delete]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();removeSymbol(b.dataset.delete)}));
}
function renderSelectedTicker(){let t=state.tickers.get(state.selected);els.symbol.textContent=state.selected;els.price.textContent=t?fmt(t.price):'--';els.change.textContent=t?pct(t.change):'--';els.change.className='change '+(t&&t.change>=0?'up':'down')}
function signalClass(k){return k==='LONG'?'long':k==='SHORT'?'short':k.startsWith('WATCH')?'watch':'wait'}
function renderAnalysis(a){
  state.analysis=a;els.mode.textContent=a.mode;els.badge.textContent=a.kind;els.badge.className=`signal ${signalClass(a.kind)}`;els.score.textContent=`Score ${a.score>=0?'+':''}${a.score}`;els.tf.textContent=a.timeframes;els.hint.textContent=a.hint||'--';els.updated.textContent=new Date().toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'});
  els.entry.textContent=a.entryLow!=null?`${fmt(a.entryLow)} – ${fmt(a.entryHigh)}`:(a.watchLow!=null?`Canh ${fmt(a.watchLow)} – ${fmt(a.watchHigh)}`:'--');els.sl.textContent=fmt(a.sl);els.tp1.textContent=fmt(a.tp1);els.tp2.textContent=fmt(a.tp2);els.tp3.textContent=fmt(a.tp3);els.invalid.textContent=a.invalid||'--';els.trigger.textContent=a.trigger||'';els.breakout.textContent=a.breakout||'';
  els.supports.innerHTML=(a.supports||[]).map(z=>`<div class="level"><strong>${fmt(z.low)} – ${fmt(z.high)}</strong><small>${z.frames.join('+')} • ${z.strength}</small></div>`).join('')||'<div class="muted">--</div>';
  els.resistances.innerHTML=(a.resistances||[]).map(z=>`<div class="level"><strong>${z.label?z.label+' • ':''}${fmt(z.low)} – ${fmt(z.high)}</strong><small>${z.frames.join('+')} • ${z.strength}${z.touches?` • ${z.touches} râu`:''}${z.lookback?` • ${z.lookback} nến`:''}</small></div>`).join('')||'<div class="muted">--</div>';
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
  els.chartTitle.textContent=`${state.selected} • ${chartTfLabel(tf)}`;
  try{
    let candles=state.candles?.[tf];
    if(!candles){
      els.updated.textContent='Đang tải...';
      candles=await getKlines(state.selected,tf,260);
      if(!state.candles||Array.isArray(state.candles))state.candles={};
      state.candles[tf]=candles;
    }
    drawChart(candles,state.analysis||{});
    els.updated.textContent=new Date().toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'});
  }catch(e){
    els.updated.textContent='Lỗi tải biểu đồ';
  }
}
async function analyzeSelected(){
  renderSelectedTicker();els.hint.textContent='Đang tải dữ liệu Binance và phân tích...';els.refresh.disabled=true;
  try{
    let analysisIntervals=ANALYSIS_TIMEFRAMES[state.mode]||ANALYSIS_TIMEFRAMES.short;
    let intervals=[...new Set([...analysisIntervals,state.chartTf])];
    let data={};await Promise.all(intervals.map(async i=>{data[i]=await getKlines(state.selected,i,260)}));state.candles=data;
    let a=state.mode==='swing'?analyzeSwing(data):analyzeShort(data);renderAnalysis(a);updateTimeframeButtons();els.chartTitle.textContent=`${state.selected} • ${chartTfLabel(state.chartTf)}`;drawChart(data[state.chartTf],a);
  }catch(e){renderAnalysis(basicWait(state.mode==='swing'?'DÀI HẠN':'NGẮN HẠN',`Không tải được Binance: ${e.message||e}`));}
  finally{els.refresh.disabled=false}
}
function drawChart(candles,a){
  const cvs=els.canvas,ctx=cvs.getContext('2d');let dpr=window.devicePixelRatio||1,w=cvs.clientWidth,h=cvs.clientHeight;cvs.width=Math.floor(w*dpr);cvs.height=Math.floor(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);ctx.fillStyle='#060a0f';ctx.fillRect(0,0,w,h);
  if(!candles?.length)return;
  let visible=w<420?42:w<900?52:58;
  let data=closedCandles(candles).slice(-visible);if(!data.length)return;
  let lo=Math.min(...data.map(x=>x.low)),hi=Math.max(...data.map(x=>x.high));let extra=(hi-lo)*.12||1;lo-=extra;hi+=extra;
  let pad={l:10,r:68,t:12,b:18},cw=w-pad.l-pad.r,ch=h-pad.t-pad.b,xstep=cw/data.length,scaleY=v=>pad.t+(hi-v)/(hi-lo)*ch;
  ctx.strokeStyle='#25364a';ctx.lineWidth=1.1;for(let i=0;i<5;i++){let y=pad.t+i*ch/4;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();let val=hi-(hi-lo)*i/4;ctx.fillStyle='#c8d4e4';ctx.font='11px -apple-system,BlinkMacSystemFont,sans-serif';ctx.fillText(fmt(val),w-pad.r+5,y+4)}
  function band(z,fill,stroke){if(!z)return;let y1=scaleY(z.high),y2=scaleY(z.low),bh=Math.max(3,y2-y1);ctx.fillStyle=fill;ctx.fillRect(pad.l,y1,cw,bh);ctx.strokeStyle=stroke;ctx.lineWidth=1.35;ctx.strokeRect(pad.l+.5,y1+.5,cw-1,Math.max(1,bh-1));ctx.beginPath();ctx.moveTo(pad.l,y1);ctx.lineTo(pad.l+cw,y1);ctx.moveTo(pad.l,y2);ctx.lineTo(pad.l+cw,y2);ctx.stroke()}
  let supportZones=(a.supports||[]).slice(0,2), resistanceZones=(a.resistances||[]).slice(0,2);
  supportZones.forEach((z,i)=>band(z,i===0?'rgba(0,255,163,.18)':'rgba(0,255,163,.10)',i===0?'rgba(20,255,170,.92)':'rgba(20,255,170,.55)'));
  resistanceZones.forEach((z,i)=>band(z,i===0?'rgba(255,78,110,.18)':'rgba(255,78,110,.10)',i===0?'rgba(255,98,126,.92)':'rgba(255,98,126,.55)'));
  data.forEach((c,i)=>{let x=pad.l+i*xstep+xstep*.5,yo=scaleY(c.open),yc=scaleY(c.close),yh=scaleY(c.high),yl=scaleY(c.low),up=c.close>=c.open,color=up?'#19ffb2':'#ff5b78';
    ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=Math.max(2.2,Math.min(3.2,xstep*.28));ctx.beginPath();ctx.moveTo(x,yh);ctx.lineTo(x,yl);ctx.stroke();
    let bw=Math.max(6,Math.min(12,xstep*.78)),top=Math.min(yo,yc),bh=Math.max(4,Math.abs(yc-yo));
    ctx.shadowColor=color;ctx.shadowBlur=6;ctx.fillRect(x-bw/2,top,bw,bh);ctx.shadowBlur=0;ctx.strokeStyle=color;ctx.lineWidth=1;ctx.strokeRect(x-bw/2,top,bw,bh);
  });
}
async function selectSymbol(s){state.selected=s;state.candles={};persist();renderWatchlist();renderSelectedTicker();await analyzeSelected()}
async function removeSymbol(s){
  if(state.symbols.length<=1){alert('Cần giữ lại ít nhất 1 coin trong danh sách.');return}
  if(!confirm(`Xóa ${s.replace('USDT','/USDT')} khỏi danh sách?`))return;
  let wasSelected=state.selected===s;state.symbols=state.symbols.filter(x=>x!==s);state.favorites.delete(s);state.tickers.delete(s);
  if(wasSelected)state.selected=state.symbols[0];state.candles={};persist();renderWatchlist();renderSelectedTicker();connectTicker();if(wasSelected)await analyzeSelected();
}
async function addSymbol(){let s=els.input.value.toUpperCase().replace(/[^A-Z0-9]/g,'').trim();if(!s)return;if(!s.endsWith('USDT'))s+='USDT';els.add.disabled=true;try{let t=await validateSymbol(s);state.tickers.set(s,{price:t.price,change:t.change});if(!state.symbols.includes(s))state.symbols.push(s);state.selected=s;state.candles={};els.input.value='';persist();renderWatchlist();connectTicker();await analyzeSelected()}catch{alert('Không tìm thấy cặp coin này trên Binance Spot hoặc Binance đang chặn kết nối từ mạng hiện tại.')}finally{els.add.disabled=false}}
function setMode(m){state.mode=m;state.chartTf='4h';els.swing.classList.toggle('active',m==='swing');els.short.classList.toggle('active',m==='short');updateTimeframeButtons();persist();analyzeSelected()}
els.swing.onclick=()=>setMode('swing');els.short.onclick=()=>setMode('short');els.add.onclick=addSymbol;els.input.addEventListener('keydown',e=>{if(e.key==='Enter')addSymbol()});els.refresh.onclick=analyzeSelected;els.tfSelector?.querySelectorAll('[data-tf]').forEach(b=>b.addEventListener('click',()=>setChartTimeframe(b.dataset.tf)));window.addEventListener('resize',()=>{if(state.candles?.[state.chartTf])drawChart(state.candles[state.chartTf],state.analysis||{})});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.deferredPrompt=e;els.install.classList.remove('hidden')});els.install.onclick=async()=>{if(state.deferredPrompt){state.deferredPrompt.prompt();await state.deferredPrompt.userChoice;state.deferredPrompt=null;els.install.classList.add('hidden')}};
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));

(async function init(){
  if(!state.symbols.includes(state.selected))state.selected=state.symbols[0]||'BTCUSDT';if(state.mode==='short') state.chartTf='4h';els.swing.classList.toggle('active',state.mode==='swing');els.short.classList.toggle('active',state.mode==='short');updateTimeframeButtons();renderWatchlist();renderSelectedTicker();connectTicker();
  try{let t=await validateSymbol(state.selected);state.tickers.set(state.selected,{price:t.price,change:t.change});renderWatchlist();renderSelectedTicker()}catch{}
  analyzeSelected();
})();
