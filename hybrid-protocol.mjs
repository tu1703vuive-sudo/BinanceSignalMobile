import core from './paper-trading.js';
import rsi from './rsi-mtf.js';

export const PROTOCOL='paper-hybrid-v1',VERSION='3.8.0',MAX_BYTES=1024*1024;
export const clone=value=>JSON.parse(JSON.stringify(value));
const fail=message=>{throw new Error('Hybrid: '+message)};
const integer=value=>Number.isSafeInteger(value)&&value>=0;
export function equivalent(a,b){
  if(typeof a==='number'&&typeof b==='number')return Number.isFinite(a)&&Number.isFinite(b)&&(Number.isSafeInteger(a)&&Number.isSafeInteger(b)?a===b:Math.abs(a-b)<=1e-10*Math.max(1,Math.abs(a),Math.abs(b)));
  if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
  const ak=Object.keys(a).filter(k=>a[k]!==undefined).sort(),bk=Object.keys(b).filter(k=>b[k]!==undefined).sort();
  return ak.length===bk.length&&ak.every((k,i)=>k===bk[i]&&equivalent(a[k],b[k]));
}
export function runtimeCopy(input={}){
  const out={};
  for(const key of ['priceSource','health','frames','candleRows','bucket','frameSymbol','retryAt','errors','rateLimitStreak'])if(input[key]!==undefined)out[key]=clone(input[key]);
  out.priceSource=core.PRICE_SOURCE;out.health=out.health||{state:'starting',detail:'Đang đồng bộ'};
  if(!['starting','live','error','recovering'].includes(out.health.state))fail('trạng thái không hợp lệ');
  for(const key of ['retryAt','errors','rateLimitStreak'])if(out[key]!==undefined&&!integer(out[key]))fail('thời gian chờ/bộ đếm không hợp lệ');
  if(out.frames){for(const [tf,f] of Object.entries(out.frames)){
    if(!rsi.FRAMES.some(x=>x.tf===tf)||!f||typeof f!=='object')fail('khung RSI không hợp lệ');
    for(const key of ['confirmed','previous','live'])if(f[key]!==null&&f[key]!==undefined&&(!Number.isFinite(f[key])||f[key]<0||f[key]>100))fail('giá trị RSI không hợp lệ');
    if(f.closedAt!==null&&f.closedAt!==undefined&&!integer(f.closedAt))fail('thời gian RSI không hợp lệ');
  }}
  if(out.candleRows){for(const [tf,rows] of Object.entries(out.candleRows)){
    if(!rsi.FRAMES.some(f=>f.tf===tf)||!Array.isArray(rows)||rows.length>450)fail('cache nến không hợp lệ');
    for(const row of rows)if(!Array.isArray(row)||row.length<7||row.length>8||!row.slice(0,7).every(v=>Number.isFinite(+v)))fail('cache nến không hợp lệ');
  }}
  return out;
}
export function makeJob(account,runtime,action,{id,now=Date.now(),pacing=null,tradeId=null}={}){
  const count=account.ledger.trades.length,state=clone({...Object.fromEntries(['autoEnabled','symbol','armedAt','strategyVersion','priceSource'].map(key=>[key,account[key]])),ledger:{...account.ledger,trades:[]}});state.ledger=core.restore(state.ledger);
  return {protocol:PROTOCOL,jobId:id,action,sentAt:now,expiresAt:now+45000,baseRevision:state.ledger.revision,tradesOffset:count,account:state,runtime:runtimeCopy(runtime),pacing:clone(pacing),tradeId};
}
export function validateJob(job,now=Date.now()){
  if(!job||job.protocol!==PROTOCOL||typeof job.jobId!=='string'||!/^[a-zA-Z0-9-]{12,80}$/.test(job.jobId)||!['tick','close','diagnose'].includes(job.action))fail('yêu cầu không hợp lệ');
  if(!integer(job.sentAt)||!integer(job.expiresAt)||job.expiresAt-job.sentAt!==45000||job.sentAt>now+5000||job.expiresAt<=now)fail('yêu cầu đã hết hạn');
  if(!integer(job.baseRevision)||!integer(job.tradesOffset))fail('revision không hợp lệ');
  const a=job.account;
  if(!a||a.symbol!==core.PAPER_SYMBOL||a.priceSource!==core.PRICE_SOURCE||a.strategyVersion!==rsi.VERSION||typeof a.autoEnabled!=='boolean'||!integer(a.armedAt))fail('tài khoản không hợp lệ');
  if(a.ledger?.priceSource!==core.PRICE_SOURCE||a.ledger?.revision!==job.baseRevision||a.ledger?.trades?.length!==0)fail('sổ gửi đi phải chỉ chứa trạng thái hiện tại');
  core.restore(a.ledger);runtimeCopy(job.runtime);
  if(job.action==='close'&&(typeof job.tradeId!=='string'||job.tradeId!==a.ledger.open?.id))fail('lệnh đóng không khớp');
  if(job.pacing&&(!integer(job.pacing.nextAt)||job.pacing.nextAt>now+10000))fail('lịch gọi dữ liệu không hợp lệ');
  return job;
}
function unchangedAccount(before,after){
  for(const key of ['symbol','priceSource','strategyVersion','autoEnabled','armedAt'])if(!equivalent(before[key],after[key]))fail('Vercel không được sửa cài đặt tài khoản');
  if(!equivalent(before.ledger.config,after.ledger.config))fail('Vercel không được sửa vốn/cấu hình');
}
function winnerSignal(frames,account,now){
  const result=rsi.evaluate(frames||{}),signalAt=frames?.['15m']?.closedAt+1;
  if(!account.autoEnabled||!result.winner||!integer(signalAt)||signalAt<=account.armedAt||signalAt>now||now-signalAt>30000)fail('tín hiệu không còn hợp lệ để ghi lệnh');
  return {result,signalAt};
}
function validatedTransition(before,after,account,frames,now){
  const old=core.restore(before),next=core.restore(after),events=[];
  if(next.revision!==old.revision+1||!equivalent(next.config,old.config))fail('revision/cấu hình đề xuất không hợp lệ');
  const appended=next.trades.length-old.trades.length;
  if(appended<0||appended>1||!equivalent(next.trades.slice(0,old.trades.length),old.trades))fail('không được sửa lịch sử');
  let expected;
  if(appended){
    const t=next.trades.at(-1),open=old.open;
    if(!open||next.open||t.id!==open.id||!['SL','TP','MANUAL'].includes(t.reason)||t.exitAt>now+5000||t.lastObservedAt<open.lastObservedAt||t.lastObservedAt>t.exitAt)fail('đề xuất đóng lệnh không hợp lệ');
    const moving={...open,lastObservedAt:t.lastObservedAt,lastPrice:t.lastPrice};
    const raw=t.exit/(1-(t.side==='LONG'?1:-1)*t.slippagePct/100),extras={};
    for(const key of ['recovered','ambiguous','partialMinute'])if(t[key]!==undefined){if(typeof t[key]!=='boolean')fail('cờ khôi phục không hợp lệ');extras[key]=t[key]}
    if(t.timeAccuracy!==undefined){if(t.timeAccuracy!=='1m')fail('thời gian khôi phục không hợp lệ');extras.timeAccuracy=t.timeAccuracy}
    const closed=core.close({...old,open:moving},raw,t.exitAt,t.reason,extras);expected=closed.book;
    if(!closed.event)fail('không đóng được lệnh');events.push(closed.event);
  }else if(!old.open&&next.open){
    const t=next.open,{result,signalAt}=winnerSignal(frames,account,now);
    if(t.entryAt>now+5000||t.entryAt<signalAt||t.side!==result.signal||t.strategy!==result.winner.strategy||!t.why?.startsWith(result.winner.reason))fail('đề xuất mở lệnh không khớp RSI');
    const raw=t.entry/(1+(t.side==='LONG'?1:-1)*next.config.slippagePct/100);
    const signal={symbol:core.PAPER_SYMBOL,side:result.signal,priceSource:core.PRICE_SOURCE,price:raw,signalAt,score:result.score,strategyVersion:result.version,ruleSet:result.ruleSet,strategy:result.winner.strategy,checks:result.winner.checks,riskPctSuggested:result.winner.riskPct,why:t.why,rsi:Object.fromEntries(rsi.FRAMES.map(({tf})=>[tf,{confirmed:frames[tf].confirmed,previous:frames[tf].previous,closedAt:frames[tf].closedAt}]))};
    const opened=core.acceptSignal(old,signal,{now:t.entryAt,armedAt:account.armedAt});expected=opened.book;
    if(!opened.event)fail('không mở được lệnh');events.push(opened.event);
  }else{
    if(!!old.open!==!!next.open)fail('lệnh biến mất mà không có lịch sử');
    expected=clone(old);
    if(old.open){if(next.open.lastObservedAt<old.open.lastObservedAt||next.open.lastObservedAt>now+5000)fail('tiến độ khôi phục không hợp lệ');expected.open.lastPrice=next.open.lastPrice;expected.open.lastObservedAt=next.open.lastObservedAt}
    if(!equivalent(next.lastSignals,old.lastSignals)){
      const {signalAt}=winnerSignal(frames,account,now);expected.lastSignals={...old.lastSignals,[core.PAPER_SYMBOL]:signalAt};
      if(!old.open&&old.cash>=old.config.notional*(1+old.config.feePct/100))fail('bỏ qua tín hiệu dù có thể mở lệnh');
    }
  }
  expected.revision=next.revision;
  if(!equivalent(expected,next))fail('số dư, PnL hoặc thuộc tính lệnh không khớp');
  return {book:next,events};
}
export function validateResult(job,result,current,now=Date.now()){
  if(!result||result.protocol!==PROTOCOL||result.jobId!==job.jobId||result.baseRevision!==job.baseRevision||current.ledger.revision!==job.baseRevision||current.ledger.trades.length!==job.tradesOffset)fail('phản hồi cũ hoặc khác sổ');
  if(typeof result.executorVersion!=='string'||result.executorVersion!==VERSION||!integer(result.completedAt)||result.completedAt<job.sentAt-5000||result.completedAt>now+5000||now>job.expiresAt+10000)fail('phiên bản/thời gian phản hồi không hợp lệ');
  const runtime=runtimeCopy(result.runtime),journal=result.journal;
  if(!Array.isArray(journal)||journal.length>4||!result.account)fail('nhật ký phản hồi không hợp lệ');
  let book=core.restore(job.account.ledger),events=[];
  for(const state of journal){unchangedAccount(job.account,state);if(state.ledger?.priceSource!==core.PRICE_SOURCE)fail('nguồn sổ không hợp lệ');const next=validatedTransition(book,state.ledger,job.account,runtime.frames,now);book=next.book;events.push(...next.events)}
  unchangedAccount(job.account,result.account);
  if(!equivalent(book,result.account.ledger))fail('kết quả không khớp nhật ký');
  if(job.action==='diagnose'&&journal.length)fail('chẩn đoán không được ghi sổ');
  if(job.action==='close'&&events.some(e=>e.type==='OPEN'))fail('đóng tay không được mở lệnh');
  if(events.length>2||!integer(result.marketRequests)||result.marketRequests>50)fail('phản hồi quá giới hạn');
  if(result.pacing&&(!integer(result.pacing.nextAt)||result.pacing.nextAt>now+10000))fail('lịch gọi phản hồi không hợp lệ');
  if(job.action==='diagnose'&&(!result.diagnostic||typeof result.diagnostic.ok!=='boolean'||result.diagnostic.priceSource!==core.PRICE_SOURCE))fail('thiếu chẩn đoán đúng nguồn');
  return {account:{...current,ledger:{...book,trades:[...current.ledger.trades,...book.trades]}},runtime,pacing:result.pacing||null,events,marketRequests:result.marketRequests,diagnostic:result.diagnostic||null};
}
