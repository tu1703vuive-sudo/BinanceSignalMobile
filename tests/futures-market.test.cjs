const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const fresh=()=>{delete require.cache[require.resolve('../futures-market.js')];return require('../futures-market.js')};
const now=Date.UTC(2026,10,18,3,0,1);
const candle=(tf='15m')=>{const m=fresh(),t=tf==='1M'?Date.UTC(2026,10,1):Math.floor(now/900000)*900000;return [t,'100','102','99','101','500',m.closeTime(t,tf)]};

test('all REST and stream routes use public USD-M Futures; monthly case is preserved',async()=>{
  const m=fresh(),calls=[];
  assert.equal(m.SOURCE,'binance-futures');
  for(const tf of ['1M','1d','4h','1h','15m']){
    const row=tf==='1M'?candle(tf):[now-900001,'100','102','99','101','500',m.closeTime(now-900001,tf)];
    await m.request(m.candlesPath('BTCUSDT',tf),{now:()=>now,fetcher:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify([row]))}});
  }
  for(const {url,options} of calls){assert.equal(new URL(url).origin,'https://fapi.binance.com');assert.equal(new URL(url).pathname,'/fapi/v1/klines');assert.equal(options.method,'GET');assert.deepEqual(Object.keys(options.headers),['Accept'])}
  assert.equal(new URL(calls[0].url).searchParams.get('interval'),'1M');
  assert.equal(m.closeTime(Date.UTC(2024,1,1),'1M'),Date.UTC(2024,2,1)-1);
  assert.equal(m.streamsUrl(['btcusdt@kline_1M','ethusdt@ticker']),'wss://fstream.binance.com/market/stream?streams=btcusdt@kline_1M/ethusdt@ticker');
});

test('order/account/foreign routes and signature parameters are rejected without network I/O',async()=>{
  const m=fresh();let calls=0;const fetcher=async()=>{calls++;throw new Error('Unexpected network')};
  for(const p of ['/fapi/v1/order?symbol=BTCUSDT','/fapi/v2/account','/api/v3/klines?symbol=BTCUSDT','https://elsewhere.test/fapi/v1/klines?symbol=BTCUSDT','//elsewhere.test/fapi/v1/klines?symbol=BTCUSDT','/fapi/v1/ticker/24hr?symbol=BTCUSDT&signature=secret','/fapi/v1/ticker/24hr?symbol=BTCUSDT&symbol=ETHUSDT'])await assert.rejects(m.request(p,{fetcher}));
  assert.equal(calls,0);
  assert.throws(()=>m.streamsUrl(['btcusdt@kline_1m']));
  assert.throws(()=>m.streamsUrl(['btcusdt@depth']));
});

test('HTTP restrictions respect Retry-After and subsequent reads never hammer the exchange',async()=>{
  for(const status of [403,418,429,451]){
    const m=fresh();let calls=0;
    const fetcher=async()=>{calls++;return new Response('<html>blocked</html>',{status,headers:{'Retry-After':'120'}})};
    let error;try{await m.request(m.quotePath('BTCUSDT'),{fetcher,now:()=>now})}catch(e){error=e}
    assert.ok(error.retryAt>=now+120000);assert.ok(error.message.includes(String(status)));
    await assert.rejects(m.request(m.candlesPath('ETHUSDT','1M'),{fetcher,now:()=>now+1000}),/chờ đến/);
    assert.equal(calls,1);
  }
});

test('invalid OHLC, empty data and wrong ticker symbols cannot become valid market data',async()=>{
  for(const rows of [[],[candle().map((x,i)=>i===2?'98':x)],[candle().map((x,i)=>i===6?x+1:x)]]){
    const m=fresh();await assert.rejects(m.request(m.candlesPath('BTCUSDT','15m'),{fetcher:async()=>new Response(JSON.stringify(rows))}));
  }
  const m=fresh();await assert.rejects(m.request(m.quotePath('BTCUSDT'),{fetcher:async()=>new Response(JSON.stringify({symbol:'ETHUSDT',lastPrice:'100',priceChangePercent:'1'}))}),/sai mã/);
});

test('combined and raw streams normalize correctly; COIN-M and unrelated events are ignored',()=>{
  const m=fresh(),r=candle(),d={e:'kline',s:'BTCUSDT',k:{s:'BTCUSDT',i:'15m',t:r[0],o:r[1],h:r[2],l:r[3],c:r[4],v:r[5],T:r[6],x:false}};
  assert.equal(m.klineMessage({stream:'btcusdt@kline_15m',data:d})[0].k.i,'15m');
  assert.equal(m.klineMessage(d)[0].s,'BTCUSDT');
  assert.deepEqual(m.klineMessage({...d,st:2}),[]);
  assert.throws(()=>m.klineMessage({...d,k:{...d.k,s:'ETHUSDT'}}));
  const ticker={e:'24hrTicker',s:'ETHUSDT',c:'3100',P:'-2.7',E:now};
  assert.equal(m.tickerMessages({data:ticker})[0].P,'-2.7');
  assert.deepEqual(m.tickerMessages({e:'bookTicker'}),[]);
  assert.throws(()=>m.tickerMessages({...ticker,c:'NaN'}));
});

test('service worker upgrades cache and unsubscribes old push without touching unrelated caches',async()=>{
  const handlers={},deleted=[],added=[];let activation,unsubscribed=0,claimed=0;
  const self={registration:{pushManager:{getSubscription:async()=>({unsubscribe:async()=>{unsubscribed++;return true}})}},clients:{claim:async()=>{claimed++}},skipWaiting:async()=>{},addEventListener:(event,fn)=>{handlers[event]=fn}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8'),{self,URL,location:{origin:'https://test.invalid'},Promise,caches:{keys:async()=>['binance-signal-v3-8-0-hybrid','binance-signal-v3-9-0-futures','unrelated'],delete:async key=>{deleted.push(key)},open:async()=>({addAll:async assets=>added.push(...assets)})}});
  handlers.activate({waitUntil:p=>activation=p});await activation;
  assert.deepEqual(deleted,['binance-signal-v3-8-0-hybrid']);assert.equal(unsubscribed,1);assert.equal(claimed,1);
  let install;handlers.install({waitUntil:p=>install=p});await install;
  assert.ok(added.includes('./futures-market.js?v=390'));
  assert.ok(!added.some(x=>/paper|remote|market-data|binance-market/.test(x)));
  for(const asset of added.filter(x=>x!=='./'))assert.ok(fs.existsSync(path.join(__dirname,'..',asset.split('?')[0])),asset);
});

test('retirement Worker cancels existing alarms without deleting history or fetching market data',async()=>{
  const module=await import('../dung-bot-cu/worker.mjs');let cancelled=0;
  const obj=new module.PaperAccount({storage:{deleteAlarm:async()=>{cancelled++}}});
  await obj.alarm();const reply=await obj.fetch();assert.equal((await reply.json()).stopped,true);
  const env={PAPER:{idFromName:name=>{assert.equal(name,'paper-account-v1');return 'same'},get:()=>({fetch:()=>obj.fetch()})}};
  assert.equal((await (await module.default.fetch({},env)).json()).stopped,true);
  await module.default.scheduled({},env);assert.equal(cancelled,4);
  const config=JSON.parse(fs.readFileSync(path.join(__dirname,'../dung-bot-cu/wrangler.jsonc'),'utf8'));
  assert.equal(config.name,'binance-signal-paper');assert.deepEqual(config.triggers.crons,[]);assert.equal(config.migrations[0].new_sqlite_classes[0],'PaperAccount');
});
