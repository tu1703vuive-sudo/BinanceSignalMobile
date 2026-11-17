// Optional JSDOM UI test; Cloudflare API shape over a local fixture server.
const assert=require('node:assert/strict');
const {harness,shared,until}=require('./paper-app.integration.cjs');
const {Engine}=require('../server/engine.cjs'),{createService}=require('../server/server.cjs'),core=require('../paper-trading.js');
(async()=>{
 const clock=Date.now(),engine=new Engine({now:()=>clock,market:async()=>({price:'100',time:clock})}),token='cloudflare-client-test-token-at-least-24-chars';
 const s=engine.read(),entryAt=clock-120000;
 s.ledger=core.acceptSignal(s.ledger,{symbol:'BTCUSDT',side:'LONG',price:100,score:100,signalAt:entryAt},{now:entryAt,armedAt:entryAt-1}).book;engine.write(s);engine.health={state:'live',lastTick:clock};engine.recoverId=s.ledger.open.id;
 const original=engine.snapshot.bind(engine);engine.snapshot=()=>({...original(),platform:'cloudflare',execution:'closed-1m',usage:{alarms:1440,apiRequests:10,marketRequests:100}});
 const service=createService({engine,token,origins:[]});await new Promise(r=>service.server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+service.server.address().port;
 const store=shared();store.storage.setItem('bsm_remote_paper_v1',JSON.stringify({url,token}));const h=harness({store,start:clock,remoteEndpoint:url});let reads=0;service.server.on('request',req=>{if(req.url.startsWith('/api/state'))reads++});
 const delays=[],native=h.w.setTimeout.bind(h.w);h.w.setTimeout=(fn,ms,...args)=>{delays.push(ms);return native(fn,ms,...args)};
 try{
  await until(()=>h.el('remoteStatusText').textContent.includes('Cloudflare 24/7'));
  assert.ok(h.el('remoteSettingsStatus').textContent.includes('1440 lượt bot'));assert.ok(delays.includes(10000));
  assert.equal(h.el('paperClose').disabled,false,'server fetches a fresh manual-close price even when last candle is older than 10 seconds');
  Object.defineProperty(h.w.document,'visibilityState',{value:'hidden',configurable:true});h.w.document.dispatchEvent(new h.w.Event('visibilitychange'));
  const before=reads;Object.defineProperty(h.w.document,'visibilityState',{value:'visible',configurable:true});h.w.document.dispatchEvent(new h.w.Event('visibilitychange'));await until(()=>reads>before);
  await h.el('paperClose').onclick();await until(()=>engine.read().ledger.trades.length===1);assert.equal(engine.read().ledger.trades[0].reason,'MANUAL');assert.equal(h.ledger(),null);assert.deepEqual(h.errors,[]);
  console.log('PASS: Cloudflare status/usage, 10s polling, visibility refresh, manual close with stale minute quote, no local ledger');
 }finally{h.close();await new Promise(r=>service.server.close(r));engine.close()}
})().catch(e=>{console.error(e);process.exit(1)});
