// Same RSI strategy and ledger as the mobile app. Cloud execution uses CLOSED 1m bars.
import core from '../paper-trading.js';
import rsi from '../rsi-mtf.js';
import binance from '../market-data.js';
const TF=rsi.FRAMES.map(f=>f.tf);
const STEP={'1m':60000,'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000};
export function nextOpen(t,tf){if(tf==='1M'){const d=new Date(t);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)}return t+STEP[tf]}
export function validate(cs,tf){
  if(!Array.isArray(cs)||!cs.length)throw new Error(`Thiếu nến ${tf}`);
  cs.forEach((c,i)=>{if(![c.openTime,c.closeTime,c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite)||Math.min(c.open,c.close,c.low)<=0||c.volume<0||c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close)||c.closeTime!==nextOpen(c.openTime,tf)-1||(i&&c.openTime!==nextOpen(cs[i-1].openTime,tf)))throw new Error(`Nến ${tf} thiếu hoặc sai`)});return cs;
}
export function notification(event,at){
  const t=event.trade;return {id:t.id+'-'+event.type,title:event.type==='OPEN'?`PAPER · ${t.side} ${t.symbol}${t.strategy?' · '+t.strategy:''}`:`PAPER · Đóng ${t.symbol} · ${t.reason}`,body:event.type==='OPEN'?`${core.sourceLabel(t)} · Giá ${t.entry.toPrecision(7)} · SL ${t.sl.toPrecision(7)} · TP ${t.tp.toPrecision(7)} · Bối cảnh ${t.score}`:`${core.sourceLabel(t)} · PnL ròng ${t.netPnl.toFixed(2)} USDT · nến đóng 1 phút`,at,type:event.type,tradeId:t.id};
}
const decode=rows=>{if(!Array.isArray(rows))throw new Error('Nguồn giá trả dữ liệu sai');return rows.map(r=>({openTime:+r[0],open:+r[1],high:+r[2],low:+r[3],close:+r[4],volume:+r[5],closeTime:+r[6]}))};
export class CloudEngine{
  constructor(store,{now=Date.now,market,fetcher=fetch,wait=ms=>new Promise(r=>setTimeout(r,ms)),executionLabel='Cloudflare'}={}){
    this.store=store;this.now=now;this.fetcher=fetcher;this.wait=wait;this.executionLabel=executionLabel;this.marketQueue=Promise.resolve();this.market=market||this.fetchMarket.bind(this);
    if(!store.get('account'))store.put('account',{ledger:core.create(),autoEnabled:true,symbol:'BTCUSDT',armedAt:now(),strategyVersion:rsi.VERSION,priceSource:core.PRICE_SOURCE});
    this.runtime=store.get('runtime')||{health:{state:'starting',detail:'Đang khởi động Cloudflare'},frames:null,bucket:null,frameSymbol:null,retryAt:0,errors:0};
    const s=this.read();
    if(s.symbol!==core.PAPER_SYMBOL||s.strategyVersion!==rsi.VERSION||s.priceSource!==core.PRICE_SOURCE||this.runtime.priceSource!==core.PRICE_SOURCE){s.symbol=core.PAPER_SYMBOL;s.strategyVersion=rsi.VERSION;s.priceSource=core.PRICE_SOURCE;s.armedAt=now();this.write(s);Object.assign(this.runtime,{priceSource:core.PRICE_SOURCE,frames:null,candleRows:null,bucket:null,frameSymbol:null,retryAt:0,errors:0,rateLimitStreak:0,health:{state:'starting',detail:'Đang đồng bộ OKX Spot',lastTick:0,lastSignalCheck:0}});this.store.put('marketDiagnostic',null);this.saveRuntime()}
  }
  read(){const s=this.store.get('account');s.ledger=core.restore(s.ledger);return s}
  saveRuntime(){this.store.put('runtime',this.runtime)}
  write(s,event){
    s.ledger.revision++;
    this.store.atomic(()=>{
      this.store.put('account',s);
      if(event)this.store.enqueue(notification(event,this.now()));
    });
  }
  snapshot(){const s=this.read();return {...s,stats:core.stats(s.ledger),frames:this.runtime.frames,health:this.runtime.health,serverTime:this.now(),platform:'cloudflare',execution:'closed-1m',subscriptionCount:this.store.subscriptionCount()}}
  auto(enabled){if(typeof enabled!=='boolean')throw new Error('enabled phải là boolean');const s=this.read();if(enabled&&!s.autoEnabled)s.armedAt=this.now();s.autoEnabled=enabled;this.write(s)}
  monitor(symbol){if(symbol!==core.PAPER_SYMBOL)throw new Error('Paper Trading chỉ chạy BTCUSDT; đổi coin trên chart không đổi bot');}
  configure(input){const s=this.read();s.ledger=core.configure(s.ledger,input);this.write(s)}
  importBook(input){const s=this.read();if(s.ledger.open||s.ledger.trades.length)throw new Error('Cloud đã có lệnh; không ghi đè sổ hiện tại');const ledger=core.restore(input);if(ledger.open&&ledger.open.symbol!==core.PAPER_SYMBOL)throw new Error('Đóng lệnh coin khác trong sổ cũ trước khi chuyển; cloud chỉ mở lệnh BTCUSDT');if(ledger.open&&core.sourceOf(ledger.open)!==core.PRICE_SOURCE)throw new Error('Đóng lệnh khác nguồn trong sổ cũ trước khi nhập sang OKX Spot');s.ledger=ledger;s.symbol=core.PAPER_SYMBOL;s.armedAt=this.now();this.write(s);this.runtime.retryAt=0;this.saveRuntime()}
  async fetchMarket(path,source=core.PRICE_SOURCE){
    try{if(this.runtime.retryAt>this.now()&&this.runtime.health.upstream?.priceSource===source)throw this.cooldownError();return await binance.request(path,{source,now:this.now,fetcher:this.fetcher,beforeRequest:()=>this.requestSlot(),onRequest:()=>this.store.count('marketRequests')})}
    catch(e){e.upstream=e.upstream||{priceSource:source,category:'CONNECTION_ERROR',message:String(e.message).slice(0,300),route:path.split('?')[0],checkedAt:this.now()};this.recordFailure(e);throw e}
  }
  cooldownError(){
    const e=new Error(this.runtime.health.detail+' · đang giữ thời gian chờ, chưa gửi yêu cầu mới');e.paperAlreadyRecorded=true;e.upstream=this.runtime.health.upstream;e.retryAfter=Math.max(0,this.runtime.retryAt-this.now());return e;
  }
  async requestSlot(){
    const take=this.marketQueue.then(async()=>{
      if(this.runtime.retryAt>this.now()&&this.runtime.health.upstream?.priceSource===core.PRICE_SOURCE)throw this.cooldownError();
      const next=this.store.get('marketPacing')?.nextAt||0;
      if(next>this.now())await this.wait(Math.min(600,next-this.now()));
      if(this.runtime.retryAt>this.now()&&this.runtime.health.upstream?.priceSource===core.PRICE_SOURCE)throw this.cooldownError();
      this.store.put('marketPacing',{nextAt:this.now()+600});
    });
    this.marketQueue=take.catch(()=>{});return take;
  }
  recordFailure(e){
    if(e.paperAlreadyRecorded)return;e.paperAlreadyRecorded=true;
    const rt=this.runtime;rt.errors=(rt.errors||0)+1;
    const rate=e.upstream?.category==='RATE_LIMIT';if(rate)rt.rateLimitStreak=(rt.rateLimitStreak||0)+1;
    const delay=Math.max(e.retryAfter||0,rate?Math.min(900000,60000*2**Math.min(rt.rateLimitStreak-1,4)):Math.min(900000,10000*2**Math.min(rt.errors-1,7)));
    if(e.upstream?.priceSource===core.PRICE_SOURCE){rt.frames=null;rt.bucket=null;}
    rt.retryAt=this.now()+delay;if(e.upstream?.priceSource&&e.upstream.priceSource!==core.PRICE_SOURCE)e.message='Lệnh khác nguồn cũ: '+e.message+'; chờ đúng nguồn để quản lý';rt.health={...rt.health,state:'error',detail:String(e.message).slice(0,240),retryAt:rt.retryAt,upstream:e.upstream||null};this.saveRuntime();
  }
  async price(symbol,source=core.PRICE_SOURCE){const q=await this.market(binance.quotePath(symbol,source),source);return binance.quote(q,source,this.now()).price}
  async frame(symbol,tf){
    const rt=this.runtime;rt.candleRows=rt.candleRows||{};
    const cached=rt.frameSymbol===symbol?rt.candleRows[tf]:null,last=cached?.at(-1),now=this.now();let limit=450;
    if(last){const d=new Date(now),prev=new Date(+last[0]);const elapsed=tf==='1M'?(d.getUTCFullYear()-prev.getUTCFullYear())*12+d.getUTCMonth()-prev.getUTCMonth():Math.floor((now-(+last[0]))/STEP[tf]);limit=Math.min(450,Math.max(2,elapsed+2))}
    const fresh=await this.market(binance.candlesPath(symbol,tf,{limit}));
    try{
      const merged=[...new Map([...(limit<450?cached||[]:[]),...fresh].map(r=>[+r[0],r])).values()].sort((a,b)=>+a[0]-+b[0]).slice(-450);
      if(merged.some(r=>r[7]==='0'&&r[6]<this.now()))throw new Error('Nến OKX cũ chưa được xác nhận');
      const cs=validate(decode(merged),tf);rt.candleRows[tf]=merged;
      return [tf,{...rsi.frame(cs,this.now(),tf),healthy:cs.at(-1).closeTime>=this.now()-15000}];
    }catch(e){delete rt.candleRows[tf];throw e}
  }
  // Bound each recovery to one page. Persist its cursor before requesting the next page.
  async recover(){
    let s=this.read(),t=s.ledger.open;if(!t)return true;
    const start=Math.floor(t.lastObservedAt/60000)*60000,end=Math.floor(this.now()/60000)*60000;
    if(start>=end)return true;
    const pageEnd=Math.min(end,start+1000*60000);
    const cs=validate(decode(await this.market(binance.candlesPath(t.symbol,'1m',{startTime:start,endTime:pageEnd-1,limit:1000},core.sourceOf(t)),core.sourceOf(t))),'1m');
    if(cs[0].openTime!==start||cs.at(-1).closeTime!==pageEnd-1)throw new Error('Thiếu nến khôi phục; giữ lệnh và thử lại');
    s=this.read();if(s.ledger.open?.id!==t.id)return !s.ledger.open;
    const r=core.replay(s.ledger,cs);s.ledger=r.book;this.write(s,r.event);
    return !s.ledger.open||s.ledger.open.lastObservedAt>=end;
  }
  async manualClose(id){
    const t=this.read().ledger.open;if(!t||t.id!==id)throw new Error('Không có lệnh mở tương ứng');
    if(!await this.recover())throw new Error('Đang khôi phục lịch sử; thử lại sau');
    if(!this.read().ledger.open)return;
    const p=await this.price(t.symbol,core.sourceOf(t)),s=this.read();if(s.ledger.open?.id!==id)throw new Error('Lệnh đã đóng');const r=core.close(s.ledger,p,this.now(),'MANUAL');s.ledger=r.book;this.write(s,r.event);
  }
  async tick(){
    const rt=this.runtime;if(this.now()<rt.retryAt)return;
    try{
      if(!await this.recover()){rt.health={...rt.health,state:'recovering',detail:'Đang khôi phục lịch sử theo từng trang'};rt.retryAt=this.now()+5000;this.saveRuntime();return}
      let s=this.read(),now=this.now(),bucket=Math.floor(now/900000);
      if(s.autoEnabled&&(bucket!==rt.bucket||rt.frameSymbol!==s.symbol)){
        const symbol=s.symbol;
        // Fetch sequentially; each physical page also shares the persisted request pacing.
        const entries=[];for(const tf of TF)entries.push(await this.frame(symbol,tf));
        rt.frames=Object.fromEntries(entries);rt.frameSymbol=symbol;rt.bucket=bucket;rt.health.lastSignalCheck=this.now();
      }
      s=this.read();now=this.now();
      if(s.autoEnabled&&rt.frames&&rt.frameSymbol===s.symbol&&rt.bucket===Math.floor(now/900000)){
        const result=rsi.evaluate(rt.frames),signalAt=rt.frames['15m'].closedAt+1;
        if(['LONG','SHORT'].includes(result.signal)&&signalAt>s.armedAt&&now-signalAt<=30000&&(s.ledger.lastSignals[s.symbol]||0)<signalAt){
          const p=await this.price(s.symbol);
          const r=core.acceptSignal(s.ledger,{symbol:s.symbol,side:result.signal,price:p,priceSource:core.PRICE_SOURCE,signalAt,score:result.score,strategyVersion:result.version,ruleSet:result.ruleSet,strategy:result.winner.strategy,checks:result.winner.checks,riskPctSuggested:result.winner.riskPct,rsi:Object.fromEntries(TF.map(tf=>[tf,{confirmed:rt.frames[tf].confirmed,previous:rt.frames[tf].previous,closedAt:rt.frames[tf].closedAt}])),why:result.winner.reason+' · '+this.executionLabel+' · SL/TP nến đóng 1 phút'},{now:this.now(),armedAt:s.armedAt});s.ledger=r.book;this.write(s,r.event);
        }
      }
      rt.errors=0;rt.rateLimitStreak=0;rt.retryAt=0;rt.health={...rt.health,state:'live',detail:'Cloudflare · OKX Spot · RSI 5 khung · SL/TP nến đóng 1 phút',lastTick:this.now(),retryAt:0,upstream:null};
    }catch(e){this.recordFailure(e);}
    this.saveRuntime();
  }
  nextDue(){
    const s=this.read(),now=this.now(),rt=this.runtime;
    if(!s.autoEnabled&&!s.ledger.open)return null;
    if(rt.retryAt>now)return rt.retryAt;
    if(rt.health.state==='starting'||s.autoEnabled&&(!rt.frames||rt.frameSymbol!==s.symbol))return now+1000;
    const due=[];
    if(s.ledger.open)due.push(s.ledger.open.lastObservedAt<Math.floor(now/60000)*60000?now+1000:(Math.floor(now/60000)+1)*60000+2000);
    if(s.autoEnabled)due.push((Math.floor(now/900000)+1)*900000+2000);
    return Math.min(...due);
  }
}
