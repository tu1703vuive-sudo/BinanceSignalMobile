// Same RSI strategy and ledger as the mobile app. Cloud execution uses CLOSED 1m bars.
import core from '../paper-trading.js';
import rsi from '../rsi-mtf.js';
const TF=rsi.FRAMES.map(f=>f.tf);
const STEP={'1m':60000,'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000};
export function nextOpen(t,tf){if(tf==='1M'){const d=new Date(t);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)}return t+STEP[tf]}
export function validate(cs,tf){
  if(!Array.isArray(cs)||!cs.length)throw new Error(`Thiếu nến ${tf}`);
  cs.forEach((c,i)=>{if(![c.openTime,c.closeTime,c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite)||Math.min(c.open,c.close,c.low)<=0||c.volume<0||c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close)||c.closeTime!==nextOpen(c.openTime,tf)-1||(i&&c.openTime!==nextOpen(cs[i-1].openTime,tf)))throw new Error(`Nến ${tf} thiếu hoặc sai`)});return cs;
}
const decode=rows=>{if(!Array.isArray(rows))throw new Error('Binance trả dữ liệu sai');return rows.map(r=>({openTime:+r[0],open:+r[1],high:+r[2],low:+r[3],close:+r[4],volume:+r[5],closeTime:+r[6]}))};
export class CloudEngine{
  constructor(store,{now=Date.now,market}={}){
    this.store=store;this.now=now;this.market=market||this.fetchMarket.bind(this);
    if(!store.get('account'))store.put('account',{ledger:core.create(),autoEnabled:true,symbol:'BTCUSDT',armedAt:now()});
    this.runtime=store.get('runtime')||{health:{state:'starting',detail:'Đang khởi động Cloudflare'},frames:null,bucket:null,frameSymbol:null,retryAt:0,errors:0};
    this.read();
  }
  read(){const s=this.store.get('account');s.ledger=core.restore(s.ledger);return s}
  saveRuntime(){this.store.put('runtime',this.runtime)}
  write(s,event){
    s.ledger.revision++;
    this.store.atomic(()=>{
      this.store.put('account',s);
      if(event){const t=event.trade,payload={id:t.id+'-'+event.type,title:event.type==='OPEN'?`PAPER · ${t.side} ${t.symbol}`:`PAPER · Đóng ${t.symbol} · ${t.reason}`,body:event.type==='OPEN'?`Giá ${t.entry.toPrecision(7)} · SL ${t.sl.toPrecision(7)} · TP ${t.tp.toPrecision(7)} · RSI ${t.score}`:`PnL ròng ${t.netPnl.toFixed(2)} USDT · nến đóng 1 phút`,at:this.now(),type:event.type,tradeId:t.id};this.store.enqueue(payload)}
    });
  }
  snapshot(){const s=this.read();return {...s,stats:core.stats(s.ledger),frames:this.runtime.frames,health:this.runtime.health,serverTime:this.now(),platform:'cloudflare',execution:'closed-1m',subscriptionCount:this.store.subscriptionCount()}}
  auto(enabled){if(typeof enabled!=='boolean')throw new Error('enabled phải là boolean');const s=this.read();if(enabled&&!s.autoEnabled)s.armedAt=this.now();s.autoEnabled=enabled;this.write(s)}
  monitor(symbol){if(!/^[A-Z0-9]{1,30}USDT$/.test(symbol||''))throw new Error('Symbol không hợp lệ');const s=this.read();if(s.symbol!==symbol){s.symbol=symbol;s.armedAt=this.now();this.runtime.frames=null;this.runtime.bucket=null;this.runtime.retryAt=0;this.write(s);this.saveRuntime()}}
  configure(input){const s=this.read();s.ledger=core.configure(s.ledger,input);this.write(s)}
  importBook(input){const s=this.read();if(s.ledger.open||s.ledger.trades.length)throw new Error('Cloud đã có lệnh; không ghi đè sổ hiện tại');s.ledger=core.restore(input);if(s.ledger.open)s.symbol=s.ledger.open.symbol;s.armedAt=this.now();this.write(s);this.runtime.retryAt=0;this.saveRuntime()}
  async fetchMarket(path){
    this.store.count('marketRequests');
    const response=await fetch('https://fapi.binance.com'+path,{signal:AbortSignal.timeout(8000)});
    if(!response.ok){const e=new Error(`Binance HTTP ${response.status}; chưa thể giao dịch giả`);e.retryAfter=Math.max(0,Number(response.headers.get('retry-after'))||0)*1000;if([418,429].includes(response.status))e.retryAfter=Math.max(60000,e.retryAfter);throw e}return response.json();
  }
  async price(symbol){const q=await this.market(`/fapi/v1/ticker/price?symbol=${symbol}`),p=+q.price;if(!Number.isFinite(p)||p<=0||(q.time&&(this.now()-q.time>10000||q.time-this.now()>5000)))throw new Error('Giá không hợp lệ hoặc đã cũ');return p}
  // Bound each recovery to one page. Persist its cursor before requesting the next page.
  async recover(){
    let s=this.read(),t=s.ledger.open;if(!t)return true;
    const start=Math.floor(t.lastObservedAt/60000)*60000,end=Math.floor(this.now()/60000)*60000;
    if(start>=end)return true;
    const pageEnd=Math.min(end,start+1000*60000);
    const cs=validate(decode(await this.market(`/fapi/v1/klines?symbol=${t.symbol}&interval=1m&startTime=${start}&endTime=${pageEnd-1}&limit=1000`)),'1m');
    if(cs[0].openTime!==start||cs.at(-1).closeTime!==pageEnd-1)throw new Error('Thiếu nến khôi phục; giữ lệnh và thử lại');
    s=this.read();if(s.ledger.open?.id!==t.id)return !s.ledger.open;
    const r=core.replay(s.ledger,cs);s.ledger=r.book;this.write(s,r.event);
    return !s.ledger.open||s.ledger.open.lastObservedAt>=end;
  }
  async manualClose(id){
    const t=this.read().ledger.open;if(!t||t.id!==id)throw new Error('Không có lệnh mở tương ứng');
    if(!await this.recover())throw new Error('Đang khôi phục lịch sử; thử lại sau');
    if(!this.read().ledger.open)return;
    const p=await this.price(t.symbol),s=this.read();if(s.ledger.open?.id!==id)throw new Error('Lệnh đã đóng');const r=core.close(s.ledger,p,this.now(),'MANUAL');s.ledger=r.book;this.write(s,r.event);
  }
  async tick(){
    const rt=this.runtime;if(this.now()<rt.retryAt)return;
    try{
      if(!await this.recover()){rt.health={...rt.health,state:'recovering',detail:'Đang khôi phục lịch sử theo từng trang'};rt.retryAt=this.now()+5000;this.saveRuntime();return}
      let s=this.read(),now=this.now(),bucket=Math.floor(now/900000);
      if(s.autoEnabled&&(bucket!==rt.bucket||rt.frameSymbol!==s.symbol)){
        const symbol=s.symbol;
        const entries=await Promise.all(TF.map(async tf=>{const cs=validate(decode(await this.market(`/fapi/v1/klines?symbol=${symbol}&interval=${tf}&limit=260`)),tf);return [tf,{...rsi.frame(cs,this.now()),healthy:cs.at(-1).closeTime>=this.now()-15000}]}));
        rt.frames=Object.fromEntries(entries);rt.frameSymbol=symbol;rt.bucket=bucket;rt.health.lastSignalCheck=this.now();
      }
      s=this.read();now=this.now();
      if(s.autoEnabled&&rt.frames&&rt.frameSymbol===s.symbol&&rt.bucket===Math.floor(now/900000)){
        const result=rsi.evaluate(rt.frames),signalAt=rt.frames['15m'].closedAt+1;
        if(['LONG','SHORT'].includes(result.signal)&&signalAt>s.armedAt&&now-signalAt<=30000&&(s.ledger.lastSignals[s.symbol]||0)<signalAt){
          const p=await this.price(s.symbol);
          const r=core.acceptSignal(s.ledger,{symbol:s.symbol,side:result.signal,price:p,signalAt,score:result.score,rsi:Object.fromEntries(TF.map(tf=>[tf,{confirmed:rt.frames[tf].confirmed,previous:rt.frames[tf].previous,closedAt:rt.frames[tf].closedAt}])),why:'RSI 5 khung nến đóng · Cloudflare · SL/TP theo nến đóng 1 phút'},{now:this.now(),armedAt:s.armedAt});s.ledger=r.book;this.write(s,r.event);
        }
      }
      rt.errors=0;rt.retryAt=0;rt.health={...rt.health,state:'live',detail:'Cloudflare · RSI 5 khung · SL/TP nến đóng 1 phút',lastTick:this.now()};
    }catch(e){rt.errors=(rt.errors||0)+1;const delay=Math.max(e.retryAfter||0,Math.min(900000,10000*2**Math.min(rt.errors-1,7)));rt.retryAt=this.now()+delay;rt.health={...rt.health,state:'error',detail:String(e.message).slice(0,240),retryAt:rt.retryAt};}
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
