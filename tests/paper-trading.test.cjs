const {test}=require('node:test');
const assert=require('node:assert/strict');
const core=require('../paper-trading.js');
const closeTo=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const signal=(extra={})=>({symbol:'BTCUSDT',side:'LONG',price:100,signalAt:1000000,score:75,rsi:{'15m':{confirmed:56,previous:54}},why:'RSI xác nhận',...extra});
const open=(cfg={},s={})=>core.acceptSignal(core.create({feePct:0,slippagePct:0,...cfg}),signal(s),{armedAt:999000,now:1000001}).book;
test('defaults and strict configuration bounds',()=>{
  const b=core.create();assert.equal(b.cash,10000);assert.equal(b.config.notional,100);assert.equal(b.config.slPct,1);assert.equal(b.config.tpPct,2);
  for(const cfg of [{notional:0},{slPct:0},{tpPct:NaN},{tpPct:100},{feePct:-1},{slippagePct:2},{initialCapital:0}])assert.throws(()=>core.create(cfg));
});
test('only a fresh confirmation after arming can enter',()=>{
  const book=core.create();
  for(const extra of [{side:'WATCH LONG'},{signalAt:998000},{signalAt:1000002},{price:0},{symbol:'<script>'}])assert.equal(core.acceptSignal(book,signal(extra),{armedAt:999000,now:1000001}).event,null);
  assert.equal(core.acceptSignal(book,signal(),{armedAt:999000,now:1030001}).event,null);
  assert.ok(core.acceptSignal(book,signal(),{armedAt:999000,now:1000001}).event);
});
test('BTC-only entry policy rejects altcoins without changing cash, signal dedup or history',()=>{
  const book=core.create();assert.equal(core.PAPER_SYMBOL,'BTCUSDT');
  for(const symbol of ['ETHUSDT','SOLUSDT','BTCUSDC','btcusdt']){const r=core.acceptSignal(book,signal({symbol}),{armedAt:999000,now:1000001});assert.equal(r.event,null);assert.strictEqual(r.book,book);assert.deepEqual(book,core.create())}
  assert.ok(core.acceptSignal(book,signal(),{armedAt:999000,now:1000001}).event);
});
test('reserve cash, apply entry slippage and preserve RSI audit',()=>{
  const b=open({feePct:.05,slippagePct:.02});closeTo(b.open.entry,100.02);closeTo(b.cash,9899.95);
  closeTo(b.open.qty,100/100.02);closeTo(b.open.sl,100.02*.99);closeTo(b.open.tp,100.02*1.02);
  assert.equal(b.open.rsi['15m'].previous,54);assert.equal(b.open.score,75);
});
test('LONG TP closes once, book equity and net cash agree',()=>{
  const b=open();const r=core.mark(b,103,1000002);assert.equal(r.event.type,'CLOSE');assert.equal(r.book.open,null);assert.equal(r.event.trade.reason,'TP');
  closeTo(r.event.trade.exit,102);closeTo(r.event.trade.netPnl,2);closeTo(r.book.cash,10002);
  assert.equal(core.mark(r.book,105,1000003).event,null);assert.equal(r.book.trades.length,1);
});
test('SHORT TP and SL are symmetric; stops fill at observed gap price',()=>{
  const b=open({}, {side:'SHORT'});assert.equal(b.open.sl,101);assert.equal(b.open.tp,98);
  closeTo(core.mark(b,97,1000002).book.trades[0].netPnl,2);
  const stopped=core.mark(b,105,1000002).book;closeTo(stopped.trades[0].netPnl,-5);assert.equal(stopped.trades[0].reason,'SL');
  closeTo(core.mark(open(),95,1000002).book.trades[0].exit,95);
});
test('round-trip fees and adverse exit slippage included in realized PnL',()=>{
  const b=open({feePct:.05,slippagePct:.02});const closed=core.close(b,102,1000002).book,t=closed.trades[0];
  closeTo(t.exit,102*.9998);closeTo(t.netPnl,t.grossPnl-t.entryFee-t.exitFee);closeTo(closed.cash,10000+t.netPnl);
  closeTo(core.stats(closed).equity,closed.cash);
});
test('one position maximum and same signal never re-enters, including after reload',()=>{
  const b=open();let result=core.acceptSignal(b,signal({symbol:'ETHUSDT',signalAt:1000010}),{now:1000011,armedAt:999000});
  assert.equal(result.event,null);assert.equal(result.book.open.symbol,'BTCUSDT');
  const closed=core.close(result.book,102,1000020).book;
  const restored=core.restore(JSON.stringify(closed));
  assert.equal(core.acceptSignal(restored,signal(),{now:1000021,armedAt:999000}).event,null);
  assert.equal(core.acceptSignal(restored,signal({symbol:'ETHUSDT',signalAt:1000010}),{now:1000021,armedAt:999000}).event,null);
});
test('insufficient cash cannot create a position or deduct fees',()=>{
  const b=core.create({initialCapital:100,notional:100});const r=core.acceptSignal(b,signal(),{now:1000001,armedAt:999000});
  assert.equal(r.event,null);assert.equal(r.book.cash,100);assert.equal(r.book.open,null);
});
test('config affects future positions, capital cannot rewrite existing account',()=>{
  const b=open(),next=core.configure(b,{...b.config,tpPct:5});assert.equal(next.open.tp,102);assert.equal(next.config.tpPct,5);
  assert.throws(()=>core.configure(b,{...b.config,initialCapital:20000}));
  const blank=core.configure(core.create(),{...core.DEFAULTS,initialCapital:20000});assert.equal(blank.cash,20000);
});
test('old and invalid quotes cannot close a position',()=>{
  const b=open();for(const p of [NaN,0,-1])assert.equal(core.mark(b,p,1000002).book,b);
  assert.equal(core.mark(b,1,1000000).event,null);assert.equal(core.close(b,1,1000000).event,null);
});
test('recovery uses SL first when full minute touches both levels',()=>{
  const b=open();const r=core.replay(b,[{openTime:1020000,closeTime:1079999,open:100,high:104,low:98,close:103}]);
  assert.equal(r.event.trade.reason,'SL');assert.equal(r.event.trade.ambiguous,true);assert.equal(r.book.trades[0].recovered,true);closeTo(r.event.trade.exit,99);
});
test('recovery does not reuse pre-entry extremes in a partial minute',()=>{
  const b=open();const c={openTime:960000,closeTime:1019999,open:100,high:110,low:90,close:100.5};
  const r=core.replay(b,[c]);assert.equal(r.event,null);assert.ok(r.book.open);
  const closed=core.replay(b,[{...c,close:98}]);assert.equal(closed.book.trades[0].recovered,true);assert.equal(closed.book.trades[0].partialMinute,true);
});
test('recovery ignores already-observed candles and captures opening gaps',()=>{
  const b=open();assert.equal(core.replay(b,[{openTime:900000,closeTime:959999,open:100,high:110,low:90,close:100}]).event,null);
  const r=core.replay(b,[{openTime:1020000,closeTime:1079999,open:95,high:96,low:93,close:94}]);assert.equal(r.event.trade.exit,95);
});
test('restore rejects corruption and never silently resets a known account',()=>{
  assert.throws(()=>core.restore('{'));assert.throws(()=>core.restore({...core.create(),schema:2}));assert.throws(()=>core.restore({...core.create(),cash:null}));
  const b=open();b.open.qty=-1;assert.throws(()=>core.restore(b));
  assert.equal(core.restore(JSON.stringify(open())).open.symbol,'BTCUSDT');
});
