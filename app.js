'use strict';

const API_BASES=['https://api.binance.com','https://api1.binance.com','https://api2.binance.com','https://api3.binance.com'];
const WS_BASE='wss://stream.binance.com:9443/stream?streams=';
const DEFAULT_SYMBOLS=['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT'];
const state={
  mode:localStorage.getItem('bsm_mode')||'swing',
  symbols:JSON.parse(localStorage.getItem('bsm_symbols')||'null')||DEFAULT_SYMBOLS,
  favorites:new Set(JSON.parse(localStorage.getItem('bsm_favorites')||'["BTCUSDT"]')),
  selected:localStorage.getItem('bsm_selected')||'BTCUSDT',
  tickers:new Map(), candles:new Map(), ws:null, analysis:null, deferredPrompt:null
};

const $=id=>document.getElementById(id);
const els={
  conn:$('connStatus'), swing:$('modeSwing'), short:$('modeShort'), input:$('symbolInput'), add:$('addSymbolBtn'), refresh:$('refreshBtn'),
  watch:$('watchList'), count:$('watchCount'), symbol:$('selectedSymbol'), mode:$('modeLabel'), price:$('selectedPrice'), change:$('selectedChange'),
  badge:$('signalBadge'), score:$('scoreText'), tf:$('timeframes'), hint:$('planHint'), canvas:$('chartCanvas'), chartTitle:$('chartTitle'), updated:$('updatedAt'),
  entry:$('entryValue'), sl:$('slValue'), tp1:$('tp1Value'), tp2:$('tp2Value'), tp3:$('tp3Value'), invalid:$('invalidValue'), trigger:$('triggerText'), breakout:$('breakoutText'),
  supports:$('supportList'), resistances:$('resistanceList'), reasons:$('reasonsList'), install:$('installBtn')
};

function persist(){
  localStorage.setItem('bsm_mode',state.mode); localStorage.setItem('bsm_symbols',JSON.stringify(state.symbols));
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
function strength(frames,profile){let s=new Set(frames);if(profile==='swing'){if(s.has('1M')||(s.has('1W')&&s.size>=2)||(s.has('1D')&&(s.has('12H')||s.has('4H'))))return'VERY STRONG';if(s.has('1W')||s.has('1D'))return'MAJOR';if(s.size>=2||s.has('12H'))return'STRONG';return s.has('4H')?'MEDIUM':'SWING'}if((s.has('4H')&&s.has('1H'))||(s.has('1H')&&s.has('15m')&&s.has('5m')))return'VERY STRONG';if(s.has('4H')||(s.has('1H')&&s.has('15m')))return'STRONG';if(s.has('1H')||(s.has('15m')&&s.has('5m')))return'MEDIUM';return'SHORT TERM'}
function zone(low,high,profile,...frames){let fr=[...new Set(frames)];return{low:Math.min(low,high),high:Math.max(low,high),frames:fr,strength:strength(fr,profile),get mid(){return(this.low+this.high)/2}}}
function buildSupport(c,lookback,tf,atrWidth,profile){let s=recentSupport(c,Math.min(lookback,c.length)),a=safeAtr(c,Math.max(s*.01,1e-8)),mr=profile==='swing'?.0018:.0008,w=Math.max(a*atrWidth,Math.max(s*mr,1e-8));return zone(s,s+w,profile,tf)}
function buildResistance(c,lookback,tf,atrWidth,profile){let r=recentResistance(c,Math.min(lookback,c.length)),a=safeAtr(c,Math.max(r*.01,1e-8)),mr=profile==='swing'?.0018:.0008,w=Math.max(a*atrWidth,Math.max(r*mr,1e-8));return zone(Math.max(0,r-w),r,profile,tf)}
const frameOrder={'1M':0,'1W':1,'1D':2,'12H':3,'4H':4,'1H':5,'15m':6,'5m':7};
function mergeZones(zones,profile,tolFactor){let sorted=[...zones].sort((a,b)=>a.low-b.low),m=[];for(let z of sorted){if(!m.length){m.push(z);continue}let last=m.at(-1),tol=Math.max(Math.max(last.high-last.low,1e-8),Math.max(z.high-z.low,1e-8))*tolFactor;if(z.low<=last.high+tol){let fr=[...new Set([...last.frames,...z.frames])].sort((a,b)=>(frameOrder[a]??9)-(frameOrder[b]??9));m[m.length-1]=zone(Math.min(last.low,z.low),Math.max(last.high,z.high),profile,...fr)}else m.push(z)}return m}
function rankSupports(z,p){return [...z].sort((a,b)=>((a.mid>p?1:0)-(b.mid>p?1:0))||Math.abs(p-a.mid)-Math.abs(p-b.mid))}
function rankRes(z,p){return [...z].sort((a,b)=>((a.mid<p?1:0)-(b.mid<p?1:0))||Math.abs(a.mid-p)-Math.abs(b.mid-p))}
function tf(name,s){return `${name} ${s>0?'↑':s<0?'↓':'→'}`}
function reasonTf(name,s,role){return s>0?`✓ ${name}: bullish (${role})`:s<0?`✓ ${name}: bearish (${role})`:`○ ${name}: chưa rõ xu hướng (${role})`}
function selectDistinct(candidates,risk,asc){let r=[],min=Math.max(risk*.1,1e-8);for(let c of candidates){if(r.length&&Math.abs(c-r.at(-1))<min)continue;r.push(c);if(r.length===3)break}while(r.length<3){let step=Math.max(risk,1e-8),anchor=r.length?r.at(-1):0;r.push(r.length===0?(asc?step:-step):(asc?anchor+step:anchor-step))}return r}
function longTargets(mid,risk,res){let min=mid+1.35*risk,c=[...res,mid+1.8*risk,mid+2.8*risk,mid+4*risk].filter(x=>x>=min).sort((a,b)=>a-b);return selectDistinct(c,risk,true)}
function shortTargets(mid,risk,sup){let max=mid-1.35*risk,c=[...sup,mid-1.8*risk,mid-2.8*risk,mid-4*risk].filter(x=>x<=max).sort((a,b)=>b-a);return selectDistinct(c,risk,false)}

function analyzeSwing(data){
  let M=closedCandles(data['1M']),W=closedCandles(data['1w']),D=closedCandles(data['1d']),H12=closedCandles(data['12h']),H4=closedCandles(data['4h']);
  if(W.length<55||D.length<60||H12.length<60||H4.length<60)return basicWait('SWING / POSITION','Chưa đủ dữ liệu nến đã đóng ở khung lớn.');
  let reasons=[],tM=trend(M,6,12),tW=trend(W,20,50),tD=adaptiveTrend(D),t12=adaptiveTrend(H12),t4=trend(H4,20,50),strD=marketStructure(D);
  let score=tM*15+tW*25+tD*25+t12*15+strD*10;
  reasons.push(reasonTf('1M',tM,'chu kỳ lớn'),reasonTf('1W',tW,'xu hướng chính'),reasonTf('1D',tD,'setup chính'),reasonTf('12H',t12,'bối cảnh vào vùng'));
  reasons.push(strD>0?'✓ 1D: cấu trúc High/Low đang nâng dần':strD<0?'✓ 1D: cấu trúc High/Low đang hạ dần':'○ 1D: cấu trúc đang đi ngang / chưa xác nhận');
  let c4=H4.map(x=>x.close),r4=rsi(c4),m4=macd(c4),e20=ema(c4,20),last4=H4.at(-1),trig=0;
  if(last4.close>e20&&r4>=52&&r4<72&&m4.hist>0){trig=1;score+=10;reasons.push(`✓ 4H: trigger tăng (RSI ${r4.toFixed(1)}, MACD dương)`)}
  else if(last4.close<e20&&r4<=48&&r4>28&&m4.hist<0){trig=-1;score-=10;reasons.push(`✓ 4H: trigger giảm (RSI ${r4.toFixed(1)}, MACD âm)`)}else reasons.push(`○ 4H: chưa có trigger rõ (RSI ${r4.toFixed(1)})`);
  let av=avgPrevVol(D,20),vr=av?D.at(-1).volume/av:0;reasons.push(vr>=1.2?`✓ Volume 1D nổi bật (${vr.toFixed(1)}x trung bình 20D)`:`○ Volume 1D bình thường (${vr.toFixed(1)}x trung bình 20D)`);
  score=clamp(score,-100,100);let p=last4.close,a4=safeAtr(H4,p*.01),aD=safeAtr(D,p*.025);
  let su=[buildSupport(W,52,'1W',.75,'swing'),buildSupport(D,120,'1D',.65,'swing'),buildSupport(H12,140,'12H',.55,'swing'),buildSupport(H4,150,'4H',.50,'swing')];
  let re=[buildResistance(W,52,'1W',.75,'swing'),buildResistance(D,120,'1D',.65,'swing'),buildResistance(H12,140,'12H',.55,'swing'),buildResistance(H4,150,'4H',.50,'swing')];
  if(M.length>=8){su.push(buildSupport(M,Math.min(18,M.length),'1M',.85,'swing'));re.push(buildResistance(M,Math.min(18,M.length),'1M',.85,'swing'))}
  su=rankSupports(mergeZones(su,'swing',.55),p).slice(0,4);re=rankRes(mergeZones(re,'swing',.55),p).slice(0,4);
  let ps=su.find(z=>z.low<=p+.25*a4)||su[0],pr=re.find(z=>z.high>=p-.25*a4)||re[0];
  let mw=tM&&tW&&tM!==tW,wd=tW&&tD&&tW!==tD,longBias=tW>0&&tD>0&&tM>=0,shortBias=tW<0&&tD<0&&tM<=0;
  if(mw)reasons.unshift('⚠ 1M và 1W xung đột → chưa phù hợp để giữ vị thế dài.');else if(wd)reasons.unshift('⚠ 1W và 1D xung đột → ưu tiên WAIT.');
  let nearS=ps&&p>=ps.low-.25*a4&&p<=ps.high+.55*a4,nearR=pr&&p<=pr.high+.25*a4&&p>=pr.low-.55*a4;
  let closeR=pr&&pr.low>p&&pr.low-p<.75*aD,closeS=ps&&ps.high<p&&p-ps.high<.75*aD;
  let kind='WAIT';if(mw||wd)kind='WAIT';else if(longBias&&score>=65&&trig>0&&nearS&&!closeR)kind='LONG';else if(shortBias&&score<=-65&&trig<0&&nearR&&!closeS)kind='SHORT';else if(longBias&&score>=45)kind='WATCH LONG';else if(shortBias&&score<=-45)kind='WATCH SHORT';
  if(closeR&&longBias)reasons.unshift('⚠ Giá đang sát kháng cự khung lớn → chưa xác nhận LONG mới.');if(closeS&&shortBias)reasons.unshift('⚠ Giá đang sát hỗ trợ khung lớn → chưa xác nhận SHORT mới.');
  let out={kind,score,mode:'SWING / POSITION',timeframes:`${tf('1M',tM)}   ${tf('1W',tW)}   ${tf('1D',tD)}   ${tf('12H',t12)}   ${tf('4H',trig||t4)}`,reasons:reasons.slice(0,9),supports:su,resistances:re,primarySupport:ps,primaryResistance:pr,ref:D.at(-1).close};
  if(kind==='LONG'&&ps){let lo=ps.low,hi=ps.high,sl=lo-.6*aD,mid=(lo+hi)/2,risk=mid-sl,t=longTargets(mid,risk,re.filter(z=>z.low>mid).map(z=>z.low));if(risk>0&&t[0]-mid>=1.35*risk){Object.assign(out,{entryLow:lo,entryHigh:hi,sl,tp1:t[0],tp2:t[1],tp3:t[2],trigger:'4H đóng xác nhận tăng tại vùng hỗ trợ; 1D/1W vẫn giữ bias tăng.',invalid:`Luận điểm LONG yếu đi nếu 1D đóng dưới ${fmt(sl)}.`})}else{out.kind='WATCH LONG'}}
  if(kind==='SHORT'&&pr){let lo=pr.low,hi=pr.high,sl=hi+.6*aD,mid=(lo+hi)/2,risk=sl-mid,t=shortTargets(mid,risk,su.filter(z=>z.high<mid).map(z=>z.high));if(risk>0&&mid-t[0]>=1.35*risk){Object.assign(out,{entryLow:lo,entryHigh:hi,sl,tp1:t[0],tp2:t[1],tp3:t[2],trigger:'4H đóng xác nhận giảm tại vùng kháng cự; 1D/1W vẫn giữ bias giảm.',invalid:`Luận điểm SHORT yếu đi nếu 1D đóng trên ${fmt(sl)}.`})}else{out.kind='WATCH SHORT'}}
  if(out.kind==='WATCH LONG'&&ps){out.watchLow=ps.low;out.watchHigh=ps.high;out.invalid=out.invalid||`Vùng canh mất ý nghĩa nếu 1D đóng dưới khoảng ${fmt(ps.low-.6*aD)}.`;out.hint=`CANH LONG vùng ${fmt(ps.low)} – ${fmt(ps.high)} [${ps.frames.join('+')}] ${ps.strength}. Đây là vùng chờ, chưa phải lệnh.`;if(pr)out.breakout=`Breakout thay thế: chờ 1D đóng trên ${fmt(pr.high)}, sau đó ưu tiên retest vùng vừa phá.`}
  else if(out.kind==='WATCH SHORT'&&pr){out.watchLow=pr.low;out.watchHigh=pr.high;out.invalid=out.invalid||`Vùng canh mất ý nghĩa nếu 1D đóng trên khoảng ${fmt(pr.high+.6*aD)}.`;out.hint=`CANH SHORT vùng ${fmt(pr.low)} – ${fmt(pr.high)} [${pr.frames.join('+')}] ${pr.strength}. Đây là vùng chờ, chưa phải lệnh.`;if(ps)out.breakout=`Breakdown thay thế: chờ 1D đóng dưới ${fmt(ps.low)}, sau đó ưu tiên retest vùng vừa phá.`}
  else if(out.kind==='WAIT') out.hint=ps&&pr?`WAIT - hỗ trợ gần ${fmt(ps.low)}–${fmt(ps.high)} [${ps.frames.join('+')}] • kháng cự gần ${fmt(pr.low)}–${fmt(pr.high)} [${pr.frames.join('+')}].`:'WAIT - chưa có setup vị thế rõ.';
  else out.hint=`${out.kind}: Entry ${fmt(out.entryLow)} – ${fmt(out.entryHigh)} | SL ${fmt(out.sl)} | TP1 ${fmt(out.tp1)}`;
  return out;
}

function analyzeShort(data){
  let C5=closedCandles(data['5m']),C15=closedCandles(data['15m']),H1=closedCandles(data['1h']),H4=closedCandles(data['4h']);
  if(C5.length<210||C15.length<210||H1.length<210||H4.length<210)return basicWait('SHORT TERM','Chưa đủ dữ liệu nến đã đóng để phân tích ngắn hạn an toàn.');
  let reasons=[],t4=emaTrend(H4),t1=emaTrend(H1),str=marketStructure(H1),score=t4*25+t1*20+str*15;
  reasons.push(t4>0?'✓ 4H: giá > EMA50 > EMA200':t4<0?'✓ 4H: giá < EMA50 < EMA200':'○ 4H: xu hướng EMA chưa rõ',t1>0?'✓ 1H: xu hướng tăng đồng thuận':t1<0?'✓ 1H: xu hướng giảm đồng thuận':'○ 1H: xu hướng chưa rõ',str>0?'✓ 1H: cấu trúc High/Low đang nâng dần':str<0?'✓ 1H: cấu trúc High/Low đang hạ dần':'○ 1H: cấu trúc giá đi ngang / chưa xác nhận');
  let v15=C15.map(x=>x.close),r15=rsi(v15),m15=macd(v15),e20=ema(v15,20),e50=ema(v15,50),a15=safeAtr(C15,C15.at(-1).close*.002),last15=C15.at(-1),mom=0;
  if(r15>=52&&r15<=70&&m15.hist>0){mom=1;score+=15;reasons.push(`✓ 15m: RSI ${r15.toFixed(1)} + MACD bullish`)}else if(r15<=48&&r15>=30&&m15.hist<0){mom=-1;score-=15;reasons.push(`✓ 15m: RSI ${r15.toFixed(1)} + MACD bearish`)}else reasons.push(`○ 15m: momentum chưa đồng thuận (RSI ${r15.toFixed(1)})`);
  if(r15>72)reasons.push('⚠ 15m: RSI cao, tránh đuổi LONG');else if(r15<28)reasons.push('⚠ 15m: RSI thấp, tránh đuổi SHORT');
  let v5=C5.map(x=>x.close),r5=rsi(v5),m5=macd(v5),e205=ema(v5,20),last5=C5.at(-1),trig=0;if(last5.close>e205&&r5>52&&m5.hist>0){trig=1;score+=10;reasons.push('✓ 5m: có xác nhận tăng ngắn hạn')}else if(last5.close<e205&&r5<48&&m5.hist<0){trig=-1;score-=10;reasons.push('✓ 5m: có xác nhận giảm ngắn hạn')}else reasons.push('○ 5m: chưa có trigger rõ');
  let av=avgPrevVol(C15,20),vr=av?last15.volume/av:0;if(vr>=1.2){if(last15.close>last15.open){score+=5;reasons.push(`✓ Volume 15m mua tăng (${vr.toFixed(1)}x trung bình)`)}else if(last15.close<last15.open){score-=5;reasons.push(`✓ Volume 15m bán tăng (${vr.toFixed(1)}x trung bình)`)}}else reasons.push('○ Volume 15m chưa nổi bật');
  let nearL=last15.close>=e20-.3*a15&&last15.close<=e20+.8*a15&&last15.close>e50,nearS=last15.close<=e20+.3*a15&&last15.close>=e20-.8*a15&&last15.close<e50;if(t4>0&&t1>0&&nearL){score+=10;reasons.push('✓ 15m: giá đang ở vùng pullback hợp lý quanh EMA20')}else if(t4<0&&t1<0&&nearS){score-=10;reasons.push('✓ 15m: giá đang ở vùng hồi hợp lý quanh EMA20')}
  score=clamp(score,-100,100);let p=last15.close,su=rankSupports(mergeZones([buildSupport(H4,80,'4H',.4,'short'),buildSupport(H1,100,'1H',.32,'short'),buildSupport(C15,120,'15m',.25,'short'),buildSupport(C5,150,'5m',.2,'short')],'short',.28),p).slice(0,4),re=rankRes(mergeZones([buildResistance(H4,80,'4H',.4,'short'),buildResistance(H1,100,'1H',.32,'short'),buildResistance(C15,120,'15m',.25,'short'),buildResistance(C5,150,'5m',.2,'short')],'short',.28),p).slice(0,4);
  let ps=su[0],pr=re[0],s15=recentSupport(C15,20),r15level=recentResistance(C15,20),wll=Math.max(s15,e20-.5*a15),wlh=e20+.25*a15;if(wll>wlh)wll=e20-.25*a15;let wsl=e20-.25*a15,wsh=Math.min(r15level,e20+.5*a15);if(wsh<wsl)wsh=e20+.25*a15;
  let conflict=t4&&t1&&t4!==t1,kind='WAIT';if(conflict){reasons.unshift('⚠ 4H và 1H xung đột → ưu tiên WAIT.')}else if(t4>0&&t1>0&&score>=65&&mom>0&&trig>0&&nearL&&r15<72)kind='LONG';else if(t4<0&&t1<0&&score<=-65&&mom<0&&trig<0&&nearS&&r15>28)kind='SHORT';else if(score>=40&&t4>=0&&t1>=0)kind='WATCH LONG';else if(score<=-40&&t4<=0&&t1<=0)kind='WATCH SHORT';
  let out={kind,score,mode:'SHORT TERM',timeframes:`${tf('4H',t4)}   ${tf('1H',t1)}   ${tf('15m',mom)}   ${tf('5m',trig)}`,reasons:reasons.slice(0,9),supports:su,resistances:re,primarySupport:ps,primaryResistance:pr,ref:last15.close};
  if(kind==='LONG'){let lo=Math.max(s15,e20-.25*a15),hi=e20+.2*a15;if(lo>hi)[lo,hi]=[hi,lo];let mid=(lo+hi)/2,sl=Math.min(s15,lo)-.35*a15,risk=mid-sl;if(risk>0)Object.assign(out,{entryLow:lo,entryHigh:hi,sl,tp1:mid+1.5*risk,tp2:mid+2.5*risk,trigger:'Nến 5m duy trì trên EMA20 và RSI > 52',invalid:`Setup LONG mất hiệu lực nếu 15m đóng dưới khoảng ${fmt(sl)}.`});else out.kind='WATCH LONG'}
  if(kind==='SHORT'){let hi=Math.min(r15level,e20+.25*a15),lo=e20-.2*a15;if(lo>hi)[lo,hi]=[hi,lo];let mid=(lo+hi)/2,sl=Math.max(r15level,hi)+.35*a15,risk=sl-mid;if(risk>0)Object.assign(out,{entryLow:lo,entryHigh:hi,sl,tp1:mid-1.5*risk,tp2:mid-2.5*risk,trigger:'Nến 5m duy trì dưới EMA20 và RSI < 48',invalid:`Setup SHORT mất hiệu lực nếu 15m đóng trên khoảng ${fmt(sl)}.`});else out.kind='WATCH SHORT'}
  if(out.kind==='WATCH LONG'){out.watchLow=wll;out.watchHigh=wlh;out.invalid=out.invalid||`Vùng canh yếu đi nếu 15m đóng dưới khoảng ${fmt(wll-.35*a15)}.`;out.hint=`CANH LONG quanh ${fmt(wll)} – ${fmt(wlh)} [15m]. Đây là vùng chờ, chưa phải Entry.`;out.breakout=`Breakout nhanh: chờ 15m đóng trên ${fmt(r15level)}, sau đó quan sát 5m retest/giữ vùng.`}
  else if(out.kind==='WATCH SHORT'){out.watchLow=wsl;out.watchHigh=wsh;out.invalid=out.invalid||`Vùng canh yếu đi nếu 15m đóng trên khoảng ${fmt(wsh+.35*a15)}.`;out.hint=`CANH SHORT quanh ${fmt(wsl)} – ${fmt(wsh)} [15m]. Đây là vùng chờ, chưa phải Entry.`;out.breakout=`Breakdown nhanh: chờ 15m đóng dưới ${fmt(s15)}, sau đó quan sát 5m retest/giữ vùng.`}
  else if(out.kind==='WAIT')out.hint=ps&&pr?`WAIT - hỗ trợ gần ${fmt(ps.low)}–${fmt(ps.high)} [${ps.frames.join('+')}] • kháng cự gần ${fmt(pr.low)}–${fmt(pr.high)} [${pr.frames.join('+')}].`:'WAIT - chưa có setup ngắn hạn rõ.';
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
  els.watch.innerHTML=syms.map(s=>{let t=state.tickers.get(s),active=s===state.selected?' active':'',fav=state.favorites.has(s)?' on':'';return `<div class="watch-item${active}" data-symbol="${s}"><button class="star${fav}" data-star="${s}" aria-label="Yêu thích">★</button><div><div class="wi-symbol">${s.replace('USDT','/USDT')}</div><div class="wi-change ${t&&t.change>=0?'up':'down'}">${t?pct(t.change):'--'}</div></div><div class="wi-price">${t?fmt(t.price):'--'}</div></div>`}).join('');
  els.watch.querySelectorAll('[data-symbol]').forEach(x=>x.addEventListener('click',e=>{if(e.target.dataset.star)return;selectSymbol(x.dataset.symbol)}));
  els.watch.querySelectorAll('[data-star]').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();let s=b.dataset.star;state.favorites.has(s)?state.favorites.delete(s):state.favorites.add(s);persist();renderWatchlist()}));
}
function renderSelectedTicker(){let t=state.tickers.get(state.selected);els.symbol.textContent=state.selected;els.price.textContent=t?fmt(t.price):'--';els.change.textContent=t?pct(t.change):'--';els.change.className='change '+(t&&t.change>=0?'up':'down')}
function signalClass(k){return k==='LONG'?'long':k==='SHORT'?'short':k.startsWith('WATCH')?'watch':'wait'}
function renderAnalysis(a){
  state.analysis=a;els.mode.textContent=a.mode;els.badge.textContent=a.kind;els.badge.className=`signal ${signalClass(a.kind)}`;els.score.textContent=`Score ${a.score>=0?'+':''}${a.score}`;els.tf.textContent=a.timeframes;els.hint.textContent=a.hint||'--';els.updated.textContent=new Date().toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'});
  els.entry.textContent=a.entryLow!=null?`${fmt(a.entryLow)} – ${fmt(a.entryHigh)}`:(a.watchLow!=null?`Canh ${fmt(a.watchLow)} – ${fmt(a.watchHigh)}`:'--');els.sl.textContent=fmt(a.sl);els.tp1.textContent=fmt(a.tp1);els.tp2.textContent=fmt(a.tp2);els.tp3.textContent=fmt(a.tp3);els.invalid.textContent=a.invalid||'--';els.trigger.textContent=a.trigger||'';els.breakout.textContent=a.breakout||'';
  els.supports.innerHTML=(a.supports||[]).map(z=>`<div class="level"><strong>${fmt(z.low)} – ${fmt(z.high)}</strong><small>${z.frames.join('+')} • ${z.strength}</small></div>`).join('')||'<div class="muted">--</div>';
  els.resistances.innerHTML=(a.resistances||[]).map(z=>`<div class="level"><strong>${fmt(z.low)} – ${fmt(z.high)}</strong><small>${z.frames.join('+')} • ${z.strength}</small></div>`).join('')||'<div class="muted">--</div>';
  els.reasons.innerHTML=(a.reasons||[]).map(r=>`<div class="reason">${escapeHtml(r)}</div>`).join('');
}
function escapeHtml(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
async function analyzeSelected(){
  renderSelectedTicker();els.hint.textContent='Đang tải dữ liệu Binance và phân tích...';els.refresh.disabled=true;
  try{
    let intervals=state.mode==='swing'?['1M','1w','1d','12h','4h']:['5m','15m','1h','4h'];
    let data={};await Promise.all(intervals.map(async i=>{data[i]=await getKlines(state.selected,i,state.mode==='swing'?260:260)}));state.candles=data;
    let a=state.mode==='swing'?analyzeSwing(data):analyzeShort(data);renderAnalysis(a);let chartTf=state.mode==='swing'?'4h':'15m';els.chartTitle.textContent=`${state.selected} • ${chartTf}`;drawChart(data[chartTf],a);
  }catch(e){renderAnalysis(basicWait(state.mode==='swing'?'SWING / POSITION':'SHORT TERM',`Không tải được Binance: ${e.message||e}`));}
  finally{els.refresh.disabled=false}
}
function drawChart(candles,a){
  const cvs=els.canvas,ctx=cvs.getContext('2d');let dpr=window.devicePixelRatio||1,w=cvs.clientWidth,h=cvs.clientHeight;cvs.width=Math.floor(w*dpr);cvs.height=Math.floor(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);ctx.fillStyle='#0a1016';ctx.fillRect(0,0,w,h);
  if(!candles?.length)return;let data=closedCandles(candles).slice(-90),lo=Math.min(...data.map(x=>x.low)),hi=Math.max(...data.map(x=>x.high));let extra=(hi-lo)*.08||1;lo-=extra;hi+=extra;let pad={l:10,r:56,t:12,b:18},cw=w-pad.l-pad.r,ch=h-pad.t-pad.b,xstep=cw/data.length,scaleY=v=>pad.t+(hi-v)/(hi-lo)*ch;
  ctx.strokeStyle='#17222d';ctx.lineWidth=1;for(let i=0;i<5;i++){let y=pad.t+i*ch/4;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();let val=hi-(hi-lo)*i/4;ctx.fillStyle='#718190';ctx.font='10px sans-serif';ctx.fillText(fmt(val),w-pad.r+5,y+3)}
  function band(z,color){if(!z)return;let y1=scaleY(z.high),y2=scaleY(z.low);ctx.fillStyle=color;ctx.fillRect(pad.l,y1,cw,Math.max(1,y2-y1))}
  band(a.primarySupport,'rgba(36,209,143,.08)');band(a.primaryResistance,'rgba(255,100,114,.08)');
  data.forEach((c,i)=>{let x=pad.l+i*xstep+xstep*.5,yo=scaleY(c.open),yc=scaleY(c.close),yh=scaleY(c.high),yl=scaleY(c.low),up=c.close>=c.open;ctx.strokeStyle=up?'#24d18f':'#ff6472';ctx.fillStyle=ctx.strokeStyle;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,yh);ctx.lineTo(x,yl);ctx.stroke();let bw=Math.max(1,xstep*.58),top=Math.min(yo,yc),bh=Math.max(1,Math.abs(yc-yo));ctx.fillRect(x-bw/2,top,bw,bh)});
}
async function selectSymbol(s){state.selected=s;persist();renderWatchlist();renderSelectedTicker();await analyzeSelected()}
async function addSymbol(){let s=els.input.value.toUpperCase().replace(/[^A-Z0-9]/g,'').trim();if(!s)return;if(!s.endsWith('USDT'))s+='USDT';els.add.disabled=true;try{let t=await validateSymbol(s);state.tickers.set(s,{price:t.price,change:t.change});if(!state.symbols.includes(s))state.symbols.push(s);state.selected=s;els.input.value='';persist();renderWatchlist();connectTicker();await analyzeSelected()}catch{alert('Không tìm thấy cặp coin này trên Binance Spot hoặc Binance đang chặn kết nối từ mạng hiện tại.')}finally{els.add.disabled=false}}
function setMode(m){state.mode=m;els.swing.classList.toggle('active',m==='swing');els.short.classList.toggle('active',m==='short');persist();analyzeSelected()}
els.swing.onclick=()=>setMode('swing');els.short.onclick=()=>setMode('short');els.add.onclick=addSymbol;els.input.addEventListener('keydown',e=>{if(e.key==='Enter')addSymbol()});els.refresh.onclick=analyzeSelected;window.addEventListener('resize',()=>{if(state.candles){let tf=state.mode==='swing'?'4h':'15m';drawChart(state.candles[tf],state.analysis||{})}});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.deferredPrompt=e;els.install.classList.remove('hidden')});els.install.onclick=async()=>{if(state.deferredPrompt){state.deferredPrompt.prompt();await state.deferredPrompt.userChoice;state.deferredPrompt=null;els.install.classList.add('hidden')}};
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));

(async function init(){
  if(!state.symbols.includes(state.selected))state.selected=state.symbols[0]||'BTCUSDT';els.swing.classList.toggle('active',state.mode==='swing');els.short.classList.toggle('active',state.mode==='short');renderWatchlist();renderSelectedTicker();connectTicker();
  try{let t=await validateSymbol(state.selected);state.tickers.set(state.selected,{price:t.price,change:t.change});renderWatchlist();renderSelectedTicker()}catch{}
  analyzeSelected();
})();
