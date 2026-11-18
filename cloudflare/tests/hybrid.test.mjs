import test from 'node:test';
import assert from 'node:assert/strict';
import {HybridEngine,ExecutorClient,executorUrl} from '../hybrid-engine.mjs';
import {CloudEngine} from '../engine.mjs';
import core from '../../paper-trading.js';
import {runJob} from '../../vercel/runner.mjs';
import {clone,makeJob} from '../../hybrid-protocol.mjs';
import {testStore,ready,marketFixture} from '../../tests/hybrid-fixture.mjs';

test('Vercel calculates entry/exit; Cloudflare commits one ledger/outbox and preserves history across restart',async()=>{
  const h=testStore(),jobs=[];try{
    const client={url:'https://paper-fixture.vercel.app/api/run',run:async job=>{jobs.push(clone(job));return runJob(job,{now:h.now,wait:h.wait,fetcher:marketFixture({now:h.now})})}};
    let engine=new HybridEngine(h.store,{client,now:h.now});ready(engine,h.now());h.store.subscribe('phone',{endpoint:'fixture'});
    await engine.tick();assert.equal(engine.runtime.health.state,'live',engine.runtime.health.detail);assert.equal(engine.read().ledger.open?.side,'LONG');assert.equal(h.store.pending().length,1);
    assert.equal(jobs[0].account.ledger.trades.length,0);assert.equal(jobs[0].protocol,'paper-hybrid-v1');assert.equal(jobs[0].account.ledger.open,null);
    const id=engine.read().ledger.open.id;await engine.tick();assert.equal(engine.read().ledger.open.id,id);assert.equal(h.store.pending().length,1);
    engine.auto(false);h.advance(180000);await engine.tick();assert.equal(engine.runtime.health.state,'live',engine.runtime.health.detail);assert.equal(engine.read().ledger.open,null);assert.equal(engine.read().ledger.trades[0].reason,'SL');assert.equal(h.store.pending().length,2);
    const cash=engine.read().ledger.cash;engine=new HybridEngine(h.store,{client,now:h.now});assert.equal(engine.read().autoEnabled,false);assert.equal(engine.read().ledger.cash,cash);assert.equal(engine.read().ledger.trades.length,1);assert.equal(engine.snapshot().executor.connected,true);
    const calls=jobs.length;await engine.tick();assert.equal(h.store.pending().length,2);assert.equal(jobs.length,calls,'paused and flat accounts never invoke Vercel');assert.equal(jobs.at(-1).account.ledger.trades.length,0);
  }finally{h.db.close()}
});
test('manual close uses Vercel; mutated money, stale replies and wrong jobs never change the ledger',async()=>{
  const h=testStore();try{
    const good={url:'https://paper-fixture.vercel.app/api/run',run:job=>runJob(job,{now:h.now,wait:h.wait,fetcher:marketFixture({now:h.now})})};
    const engine=new HybridEngine(h.store,{client:good,now:h.now});ready(engine,h.now());await engine.tick();assert.ok(engine.read().ledger.open);
    const before=engine.read();engine.client={...good,run:async job=>{const result=await good.run(job);result.account.ledger.cash+=9999;return result}};
    await assert.rejects(engine.manualClose(before.ledger.open.id));assert.deepEqual(engine.read(),before);assert.equal(engine.runtime.health.state,'error');
    h.setNow(engine.runtime.retryAt+1);engine.client={...good,run:async job=>{const result=await good.run(job);result.jobId='old-job-id-00000';return result}};await engine.tick();assert.deepEqual(engine.read(),before);
    h.setNow(engine.runtime.retryAt+1);engine.client=good;await engine.manualClose(before.ledger.open.id);assert.equal(engine.read().ledger.open,null);assert.equal(engine.read().ledger.trades[0].reason,'SL');
  }finally{h.db.close()}
});
test('executor outage has no Cloudflare market fallback and keeps account/auto/push state intact',async()=>{
  const h=testStore();try{
    const engine=new HybridEngine(h.store,{now:h.now,client:{url:'https://paper-fixture.vercel.app/api/run',run:async()=>{throw new Error('executor unavailable')}}});const before=engine.read();h.store.subscribe('phone',{endpoint:'fixture'});
    await engine.tick();assert.deepEqual(engine.read(),before);assert.equal(h.store.subscriptionCount(),1);assert.equal(h.store.pending().length,0);assert.equal(engine.runtime.health.state,'error');assert.equal(engine.runtime.retryAt-h.now(),60000);assert.equal(h.store.usage.marketRequests,0);
    await assert.rejects(engine.fetchMarket('/api/v5/market/ticker'),/chỉ lấy dữ liệu/);const calls=h.store.usage.executorRequests;await engine.tick();assert.equal(h.store.usage.executorRequests,calls);
  }finally{h.db.close()}
});
test('wrong executor URL, redirect, missing token and malformed JSON fail closed',async()=>{
  for(const url of ['http://paper.vercel.app','https://example.com','https://paper.vercel.app/api/evil','https://paper.vercel.app?token=x','https://user:pass@paper.vercel.app'])assert.throws(()=>executorUrl(url));
  assert.equal(executorUrl('https://paper.vercel.app/'),'https://paper.vercel.app/api/run');
  assert.throws(()=>new ExecutorClient({url:'https://paper.vercel.app',token:'short'}));
  let calls=0;const redirect=new ExecutorClient({url:'https://paper.vercel.app',token:'x'.repeat(64),fetcher:async(_url,options)=>{calls++;assert.equal(options.redirect,'manual');return new Response('',{status:307,headers:{Location:'https://elsewhere.invalid'}})}});await assert.rejects(redirect.run({}),/307/);assert.equal(calls,1);
  const bad=new ExecutorClient({url:'https://paper.vercel.app',token:'x'.repeat(64),fetcher:async()=>new Response('<html>login</html>')});await assert.rejects(bad.run({}),/JSON/);
});
test('failed outbox transaction rolls back the proposed account too',async()=>{
  const h=testStore();try{
    const engine=new HybridEngine(h.store,{now:h.now,client:{url:'https://paper-fixture.vercel.app/api/run',run:job=>runJob(job,{now:h.now,wait:h.wait,fetcher:marketFixture({now:h.now})})}});ready(engine,h.now());const before=engine.read();h.store.enqueue=()=>{throw new Error('outbox failure')};
    await engine.tick();assert.deepEqual(engine.read(),before);assert.equal(engine.runtime.health.state,'error');
  }finally{h.db.close()}
});
test('late entry proposal is rejected, and forged journal balances cannot pass financial validation',async()=>{
  for(const kind of ['late','money']){
    const h=testStore();try{
      const engine=new HybridEngine(h.store,{now:h.now,client:{url:'https://paper-fixture.vercel.app/api/run',run:async job=>{const result=await runJob(job,{now:h.now,wait:h.wait,fetcher:marketFixture({now:h.now})});if(kind==='late')h.advance(31000);else{for(const state of result.journal)state.ledger.cash+=100;result.account.ledger.cash+=100}return result}}});
      ready(engine,h.now());const before=engine.read();await engine.tick();assert.deepEqual(engine.read(),before);assert.equal(h.store.pending().length,0);assert.equal(engine.runtime.health.state,'error');
    }finally{h.db.close()}
  }
});
test('429 cooldown and history cache survive Vercel calls and Cloudflare restart',async()=>{
  const h=testStore();try{
    let status=429,calls=0;const requests=[],client={url:'https://paper-fixture.vercel.app/api/run',run:job=>{calls++;return runJob(job,{now:h.now,wait:h.wait,fetcher:marketFixture({now:h.now,status:()=>status,requests})})}};
    let engine=new HybridEngine(h.store,{client,now:h.now});const before=engine.read();await engine.tick();assert.deepEqual(engine.read(),before);assert.equal(engine.runtime.health.upstream.category,'RATE_LIMIT');assert.equal(engine.runtime.retryAt-h.now(),60000);assert.equal(engine.snapshot().executor.connected,true);
    engine=new HybridEngine(h.store,{client,now:h.now});await engine.tick();assert.equal(calls,1);assert.equal(requests.length,1);
    status=200;h.setNow(engine.runtime.retryAt+1);await engine.tick();assert.equal(engine.runtime.health.state,'live',engine.runtime.health.detail);assert.ok(engine.runtime.candleRows['15m'].length>=100);assert.equal(engine.runtime.rateLimitStreak,0);
    const saved=engine.runtime.candleRows;engine=new HybridEngine(h.store,{client,now:h.now});assert.deepEqual(engine.runtime.candleRows,saved);
  }finally{h.db.close()}
});
test('LONG and SHORT proposals preserve exact ledger math over different quote sizes',async()=>{
  for(const side of ['LONG','SHORT'])for(const price of [100,65000.123456,0.001987]){
    const h=testStore();try{
      const fetcher=async()=>Response.json({code:'0',data:[{instId:'BTC-USDT',last:String(price),open24h:String(price),ts:String(h.now())}]});
      const engine=new HybridEngine(h.store,{now:h.now,client:{url:'https://paper-fixture.vercel.app/api/run',run:job=>runJob(job,{now:h.now,wait:h.wait,fetcher})}});ready(engine,h.now());
      if(side==='SHORT'){for(const [tf,f] of Object.entries(engine.runtime.frames)){f.confirmed=tf==='15m'?45:40;f.previous=tf==='15m'?51:41}engine.saveRuntime()}
      await engine.tick();assert.equal(engine.runtime.health.state,'live',engine.runtime.health.detail);assert.equal(engine.read().ledger.open?.side,side);assert.equal(engine.read().ledger.open.priceSource,'okx-spot');
    }finally{h.db.close()}
  }
});
test('migration from the direct Cloudflare runner keeps capital, history, auto, subscriptions and cooldown',()=>{
  const h=testStore();try{
    const old=new CloudEngine(h.store,{now:h.now}),state=old.read(),t=h.now()-60000;
    state.ledger=core.close(core.acceptSignal(core.create({initialCapital:5000}),{symbol:'BTCUSDT',side:'LONG',price:100,score:60,signalAt:t},{now:t,armedAt:t-1}).book,101,t+1).book;state.autoEnabled=false;old.write(state);
    old.runtime.retryAt=h.now()+120000;old.runtime.health={state:'error',detail:'OKX HTTP 429',upstream:{priceSource:'okx-spot',category:'RATE_LIMIT',checkedAt:h.now()},retryAt:old.runtime.retryAt};old.saveRuntime();h.store.subscribe('phone',{endpoint:'fixture'});
    const before=old.read(),hybrid=new HybridEngine(h.store,{now:h.now,client:{url:'https://paper-fixture.vercel.app/api/run',run:async()=>{throw Error('not expected')}}});
    assert.deepEqual(hybrid.read(),before);assert.equal(hybrid.runtime.retryAt,old.runtime.retryAt);assert.equal(h.store.subscriptionCount(),1);assert.equal(hybrid.nextDue(),null);
  }finally{h.db.close()}
});
