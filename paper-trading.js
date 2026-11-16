/* Deterministic 1x paper ledger. Never signs or submits an exchange order. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PaperTrading=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const DEFAULTS=Object.freeze({initialCapital:10000,notional:100,slPct:1,tpPct:2,feePct:.05,slippagePct:.02});
  const clone=x=>JSON.parse(JSON.stringify(x));
  const positive=x=>Number.isFinite(x)&&x>0;
  function config(input={}){
    const out={...DEFAULTS,...input};
    const ranges={initialCapital:[10,1e9],notional:[1,1e9],slPct:[.1,20],tpPct:[.1,99.9],feePct:[0,1],slippagePct:[0,1]};
    for(const [k,[lo,hi]] of Object.entries(ranges))if(!Number.isFinite(out[k])||out[k]<lo||out[k]>hi)throw new Error(`Cấu hình ${k} không hợp lệ (${lo}–${hi}).`);
    return Object.fromEntries(Object.keys(DEFAULTS).map(k=>[k,out[k]]));
  }
  function create(input){const cfg=config(input);return {schema:1,revision:0,config:cfg,cash:cfg.initialCapital,open:null,trades:[],lastSignals:{}}}
  function restore(raw){
    if(raw==null)return create();
    const b=typeof raw==='string'?JSON.parse(raw):clone(raw);
    if(b.schema!==1||!Number.isFinite(b.cash)||!Number.isSafeInteger(b.revision)||b.revision<0||!Array.isArray(b.trades)||!b.lastSignals||typeof b.lastSignals!=='object'||Array.isArray(b.lastSignals))throw new Error('Dữ liệu paper không hợp lệ. Dữ liệu cũ được giữ lại.');
    b.config=config(b.config);
    const validTrade=t=>t&&/^[A-Z0-9]{1,30}USDT$/.test(t.symbol)&&['LONG','SHORT'].includes(t.side)&&positive(t.entry)&&positive(t.qty)&&positive(t.notional)&&positive(t.entryAt)&&Number.isFinite(t.entryFee)&&t.entryFee>=0&&Number.isFinite(t.feePct)&&t.feePct>=0&&t.feePct<=1&&Number.isFinite(t.slippagePct)&&t.slippagePct>=0&&t.slippagePct<=1&&positive(t.sl)&&positive(t.tp)&&positive(t.lastPrice)&&Number.isFinite(t.score)&&t.rsi&&typeof t.rsi==='object'&&!Array.isArray(t.rsi)&&Object.values(t.rsi).every(v=>v&&Number.isFinite(v.confirmed)&&Number.isFinite(v.previous))&&Number.isFinite(t.lastObservedAt)&&t.lastObservedAt>=t.entryAt&&typeof t.id==='string';
    if((b.open&&!validTrade(b.open))||b.trades.some(t=>!validTrade(t)||!positive(t.exit)||!Number.isFinite(t.netPnl)||!Number.isFinite(t.exitFee)||!Number.isFinite(t.exitAt)||t.exitAt<t.entryAt)||Object.values(b.lastSignals).some(t=>!Number.isSafeInteger(t)||t<=0))throw new Error('Lịch sử paper bị lỗi. Không ghi đè dữ liệu cũ.');
    return b;
  }
  function configure(book,input){
    const next=clone(book),cfg=config(input);
    if((book.open||book.trades.length)&&cfg.initialCapital!==book.config.initialCapital)throw new Error('Vốn ban đầu đã khóa sau lệnh đầu tiên.');
    if(!book.open&&!book.trades.length)next.cash=cfg.initialCapital;
    next.config=cfg;return next;
  }
  function acceptSignal(book,signal,{now=Date.now(),armedAt=now}={}){
    if(!signal||!['LONG','SHORT'].includes(signal.side)||!/^[A-Z0-9]{1,30}USDT$/.test(signal.symbol)||!positive(signal.price)||!Number.isSafeInteger(signal.signalAt)||signal.signalAt<=armedAt||now<signal.signalAt||now-signal.signalAt>30000||!Number.isFinite(signal.score))return {book,event:null,skip:'Tín hiệu cũ hoặc không hợp lệ'};
    if((book.lastSignals[signal.symbol]||0)>=signal.signalAt)return {book,event:null,skip:'Đã xử lý tín hiệu này'};
    const next=clone(book);next.lastSignals[signal.symbol]=signal.signalAt;
    if(book.open)return {book:next,event:null,skip:'Đã có một lệnh đang mở'};
    const cfg=book.config,entry=signal.price*(1+(signal.side==='LONG'?1:-1)*cfg.slippagePct/100),entryFee=cfg.notional*cfg.feePct/100;
    if(book.cash<cfg.notional+entryFee)return {book:next,event:null,skip:'Không đủ số dư ảo'};
    const side=signal.side==='LONG'?1:-1;
    const trade={id:`paper-${signal.symbol}-${signal.signalAt}`,symbol:signal.symbol,side:signal.side,entry,entryAt:now,signalAt:signal.signalAt,
      qty:cfg.notional/entry,notional:cfg.notional,entryFee,feePct:cfg.feePct,slippagePct:cfg.slippagePct,
      sl:entry*(1-side*cfg.slPct/100),tp:entry*(1+side*cfg.tpPct/100),slPct:cfg.slPct,tpPct:cfg.tpPct,
      score:signal.score,rsi:clone(signal.rsi||{}),why:signal.why||'RSI 5 khung xác nhận',lastObservedAt:now,lastPrice:signal.price};
    next.cash-=cfg.notional+entryFee;next.open=trade;
    return {book:next,event:{type:'OPEN',trade:clone(trade)}};
  }
  function close(book,price,at,reason='MANUAL',extra={}){
    const t=book.open;
    if(!t||!positive(price)||!Number.isFinite(at)||at<t.lastObservedAt)return {book,event:null};
    const sign=t.side==='LONG'?1:-1,exit=price*(1-sign*t.slippagePct/100),exitFee=exit*t.qty*t.feePct/100;
    const grossPnl=sign*(exit-t.entry)*t.qty,netPnl=grossPnl-t.entryFee-exitFee;
    const trade={...clone(t),exit,exitAt:at,exitFee,grossPnl,netPnl,reason,...extra};
    const next=clone(book);next.open=null;next.cash+=t.notional+grossPnl-exitFee;next.trades.push(trade);
    return {book:next,event:{type:'CLOSE',trade}};
  }
  function mark(book,price,at){
    const t=book.open;if(!t||!positive(price)||!Number.isFinite(at)||at<t.lastObservedAt)return {book,event:null};
    const long=t.side==='LONG',stop=long?price<=t.sl:price>=t.sl,take=long?price>=t.tp:price<=t.tp;
    if(stop)return close(book,price,at,'SL');
    if(take)return close(book,t.tp,at,'TP');
    const next=clone(book);next.open.lastPrice=price;next.open.lastObservedAt=at;return {book:next,event:null};
  }
  function replay(book,candles){
    let next=book;
    for(const c of candles){
      const t=next.open;if(!t)break;
      if(![c.openTime,c.closeTime,c.open,c.high,c.low,c.close].every(Number.isFinite)||c.closeTime<c.openTime||c.low>Math.min(c.open,c.close)||c.high<Math.max(c.open,c.close)||c.low<=0)throw new Error('Nến khôi phục không hợp lệ');
      const at=c.closeTime+1;if(at<=t.lastObservedAt)continue;
      // The minute straddling a known tick/entry has unknown post-tick extremes.
      if(c.openTime<t.lastObservedAt){
        const long=t.side==='LONG',stop=long?c.close<=t.sl:c.close>=t.sl,take=long?c.close>=t.tp:c.close<=t.tp;
        if(stop||take)return close(next,stop?c.close:t.tp,at,stop?'SL':'TP',{recovered:true,partialMinute:true,timeAccuracy:'1m'});
        next=mark(next,c.close,at).book;continue;
      }
      const long=t.side==='LONG',stop=long?c.low<=t.sl:c.high>=t.sl,take=long?c.high>=t.tp:c.low<=t.tp;
      if(stop||take){
        const reason=stop?'SL':'TP',price=stop?(long?Math.min(c.open,t.sl):Math.max(c.open,t.sl)):t.tp;
        return close(next,price,at,reason,{recovered:true,ambiguous:stop&&take,timeAccuracy:'1m'});
      }
      next=mark(next,c.close,at).book;
    }
    return {book:next,event:null};
  }
  function stats(book,price=book.open?.lastPrice){
    const t=book.open,unrealized=t&&positive(price)?(t.side==='LONG'?1:-1)*(price-t.entry)*t.qty-t.entryFee-price*t.qty*t.feePct/100:0;
    const realized=book.trades.reduce((s,t)=>s+t.netPnl,0),wins=book.trades.filter(t=>t.netPnl>0).length;
    return {cash:book.cash,realized,unrealized,equity:book.cash+(t?t.notional+unrealized+t.entryFee:0),closed:book.trades.length,wins};
  }
  return Object.freeze({DEFAULTS,config,create,restore,configure,acceptSignal,close,mark,replay,stats});
});
