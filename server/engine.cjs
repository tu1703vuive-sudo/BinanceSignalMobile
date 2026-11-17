'use strict';
const {DatabaseSync}=require('node:sqlite'),core=require('../paper-trading.js'),rsi=require('../rsi-mtf.js');
const TF=rsi.FRAMES.map(f=>f.tf),STEP={'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000,'1m':60000};
function nextOpen(t,tf){if(tf==='1M'){const d=new Date(t);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)}return t+STEP[tf]}
function validate(candles,tf){
 if(!Array.isArray(candles)||!candles.length)throw new Error(`Thiếu nến ${tf}`);
 candles.forEach((c,i)=>{if(![c.openTime,c.closeTime,c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite)||c.low<=0||c.volume<0||c.high<Math.max(c.open,c.close)||c.low>Math.min(c.open,c.close)||c.closeTime!==nextOpen(c.openTime,tf)-1||(i&&c.openTime!==nextOpen(candles[i-1].openTime,tf)))throw new Error(`Nến ${tf} thiếu hoặc sai`)});return candles;
}
const decode=rows=>rows.map(r=>({openTime:+r[0],open:+r[1],high:+r[2],low:+r[3],close:+r[4],volume:+r[5],closeTime:+r[6]}));
class Engine{
 constructor({file=':memory:',market,now=Date.now}={}){
  this.db=new DatabaseSync(file);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS subscriptions(id TEXT PRIMARY KEY,json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,subscription_id TEXT,payload TEXT NOT NULL,attempt INTEGER DEFAULT 0,next_at INTEGER DEFAULT 0,status TEXT DEFAULT \'pending\');');
  this.db.exec("CREATE INDEX IF NOT EXISTS deliveries_pending ON deliveries(status,next_at)");
  this.market=market||this.fetchMarket;this.now=now;this.health={state:'starting',detail:'Đang khởi động',lastTick:0,lastSignalCheck:0};this.busy=false;this.frames=null;this.bucket=null;this.frameSymbol=null;this.lastFrameTry=0;this.recoverId=null;this.lastFeedAt=0;this.retryAt=0;this.errors=0;
  if(!this.db.prepare('SELECT id FROM state WHERE id=1').get())this.db.prepare('INSERT INTO state VALUES(1,?)').run(JSON.stringify({ledger:core.create(),autoEnabled:true,symbol:'BTCUSDT',armedAt:now(),strategyVersion:rsi.VERSION}));
  const s=this.read();if(s.symbol!==core.PAPER_SYMBOL||s.strategyVersion!==rsi.VERSION){s.symbol=core.PAPER_SYMBOL;s.strategyVersion=rsi.VERSION;s.armedAt=now();this.write(s)}
 }
 read(){const state=JSON.parse(this.db.prepare('SELECT json FROM state WHERE id=1').get().json);state.ledger=core.restore(state.ledger);return state}
 write(state,event){
  state.ledger.revision++;this.db.exec('BEGIN IMMEDIATE');
  try{this.db.prepare('UPDATE state SET json=? WHERE id=1').run(JSON.stringify(state));
   if(event){const t=event.trade,payload={id:t.id+'-'+event.type,title:event.type==='OPEN'?`PAPER · ${t.side} ${t.symbol}${t.strategy?' · '+t.strategy:''}`:`PAPER · Đóng ${t.symbol} · ${t.reason}`,body:event.type==='OPEN'?`Giá ${t.entry.toPrecision(7)} · SL ${t.sl.toPrecision(7)} · TP ${t.tp.toPrecision(7)} · Bối cảnh ${t.score}`:`PnL ròng ${t.netPnl.toFixed(2)} USDT${t.recovered?' · khôi phục nến 1 phút':''}`,at:this.now(),type:event.type,tradeId:t.id};
    for(const s of this.db.prepare('SELECT id FROM subscriptions').all())this.db.prepare('INSERT OR IGNORE INTO deliveries(id,subscription_id,payload,next_at) VALUES(?,?,?,?)').run(payload.id+'-'+s.id,s.id,JSON.stringify(payload),this.now());
   }this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e}
 }
 snapshot(){const s=this.read();return {...s,stats:core.stats(s.ledger),health:{...this.health},frames:this.frames,serverTime:this.now(),subscriptionCount:this.db.prepare('SELECT COUNT(*) AS n FROM subscriptions').get().n}}
 setAuto(enabled){const s=this.read();if(typeof enabled!=='boolean')throw new Error('autoEnabled phải là boolean');if(enabled&&!s.autoEnabled)s.armedAt=this.now();s.autoEnabled=enabled;this.write(s);return this.snapshot()}
 setSymbol(symbol){if(symbol!==core.PAPER_SYMBOL)throw new Error('Paper Trading chỉ chạy BTCUSDT; đổi coin trên chart không đổi bot');return this.snapshot()}
 configure(input){const s=this.read();s.ledger=core.configure(s.ledger,input);this.write(s);return this.snapshot()}
 importBook(input){const s=this.read();if(s.ledger.open||s.ledger.trades.length)throw new Error('Máy chủ đã có lệnh; không ghi đè sổ hiện tại');const ledger=core.restore(input);if(ledger.open&&ledger.open.symbol!==core.PAPER_SYMBOL)throw new Error('Đóng lệnh coin khác trong sổ cũ trước khi chuyển; máy chủ chỉ mở lệnh BTCUSDT');s.ledger=ledger;s.symbol=core.PAPER_SYMBOL;this.write(s);this.recoverId=null;return this.snapshot()}
 async fetchMarket(path){const response=await fetch('https://fapi.binance.com'+path,{signal:AbortSignal.timeout(8000)});if(!response.ok){const error=new Error(`Binance HTTP ${response.status}`);error.retryAfter=Math.max(0,Number(response.headers.get('retry-after'))||0)*1000;if(response.status===418||response.status===429)error.retryAfter=Math.max(error.retryAfter,60000);throw error;}return response.json()}
 async price(symbol){const q=await this.market(`/fapi/v1/ticker/price?symbol=${encodeURIComponent(symbol)}`),p=+q.price;if(!Number.isFinite(p)||p<=0||(q.time&&(this.now()-q.time>10000||q.time-this.now()>5000)))throw new Error('Giá không hợp lệ hoặc đã cũ');return p}
 async recovery(symbol,since,until){let cursor=Math.floor(since/60000)*60000,end=Math.floor(until/60000)*60000,out=[];
  for(let page=0;cursor<end&&page<100;page++){const rows=await this.market(`/fapi/v1/klines?symbol=${symbol}&interval=1m&startTime=${cursor}&endTime=${end-1}&limit=1000`),cs=validate(decode(rows),'1m');for(const c of cs){if(c.openTime!==cursor||c.closeTime>=end)throw new Error('Khoảng khôi phục bị thiếu nến');out.push(c);cursor+=60000}}
  if(cursor<end)throw new Error('Chưa đủ lịch sử khôi phục');return out;
 }
 async manualClose(id){
  const before=this.read().ledger.open;if(!before||before.id!==id)throw new Error('Không có lệnh mở tương ứng');
  if(this.busy||this.health.state!=='live'||this.recoverId!==id)throw new Error('Đang đồng bộ; chờ bot kiểm tra lịch sử trước khi đóng tay');
  const p=await this.price(before.symbol),s=this.read();if(s.ledger.open?.id!==id)throw new Error('Lệnh đã được đóng');const r=core.close(s.ledger,p,this.now(),'MANUAL');s.ledger=r.book;this.write(s,r.event);return this.snapshot();
 }
 async tick(){
  if(this.busy||this.now()<this.retryAt)return;this.busy=true;
  try{
   let s=this.read(),t=s.ledger.open,now=this.now();
   if(t&&(this.recoverId!==t.id||now-this.lastFeedAt>10000)){
    this.health.state='recovering';const cs=await this.recovery(t.symbol,t.lastObservedAt,now);s=this.read();
    if(s.ledger.open?.id===t.id){const r=core.replay(s.ledger,cs);s.ledger=r.book;this.write(s,r.event)}
    this.recoverId=t.id;this.lastFeedAt=this.now();
   }
   s=this.read();t=s.ledger.open;
   if(t){const p=await this.price(t.symbol);s=this.read();if(s.ledger.open?.id===t.id){const r=core.mark(s.ledger,p,this.now());s.ledger=r.book;this.write(s,r.event)}this.lastFeedAt=this.now()}
   s=this.read();now=this.now();const bucket=Math.floor(now/900000);
   if((bucket!==this.bucket||this.frameSymbol!==s.symbol)&&now-this.lastFrameTry>5000){
    this.lastFrameTry=now;const symbol=s.symbol;
    const entries=await Promise.all(TF.map(async tf=>{const rows=await this.market(`/fapi/v1/klines?symbol=${symbol}&interval=${tf}&limit=450`),cs=validate(decode(rows),tf);return [tf,{...rsi.frame(cs,this.now(),tf),healthy:cs.at(-1).closeTime>=this.now()-15000}]}));
    if(this.read().symbol===symbol){this.frames=Object.fromEntries(entries);this.bucket=bucket;this.frameSymbol=symbol;this.health.lastSignalCheck=this.now()}
   }
   s=this.read();now=this.now();
   if(this.frames&&this.frameSymbol===s.symbol&&this.bucket===Math.floor(now/900000)){
    const result=rsi.evaluate(this.frames),signalAt=this.frames['15m'].closedAt+1;
    if(s.autoEnabled&&['LONG','SHORT'].includes(result.signal)&&signalAt>s.armedAt&&now-signalAt<=30000&&(s.ledger.lastSignals[s.symbol]||0)<signalAt){
     const symbol=s.symbol,p=await this.price(symbol);s=this.read();
     if(s.autoEnabled&&s.symbol===symbol){const r=core.acceptSignal(s.ledger,{symbol,side:result.signal,price:p,signalAt,score:result.score,strategyVersion:result.version,ruleSet:result.ruleSet,strategy:result.winner.strategy,checks:result.winner.checks,riskPctSuggested:result.winner.riskPct,rsi:Object.fromEntries(TF.map(tf=>[tf,{confirmed:this.frames[tf].confirmed,previous:this.frames[tf].previous,closedAt:this.frames[tf].closedAt}])),why:result.winner.reason+' · máy chủ 24/7'},{now:this.now(),armedAt:s.armedAt});s.ledger=r.book;this.write(s,r.event);if(r.event){this.recoverId=r.event.trade.id;this.lastFeedAt=this.now()}}
    }
   }
   this.errors=0;this.retryAt=0;this.health={...this.health,state:'live',detail:'Máy chủ đang theo dõi RSI và lệnh giả',lastTick:this.now()};
  }catch(e){this.errors++;const delay=Math.max(e.retryAfter||0,Math.min(60000,3000*2**Math.min(this.errors-1,6)));this.retryAt=this.now()+delay;this.health={...this.health,state:'error',detail:e.message+' · thử lại sau '+Math.ceil(delay/1000)+' giây',retryAt:this.retryAt};}
  finally{this.busy=false}
 }
 close(){this.db.close()}
}
module.exports={Engine,validate,decode};
