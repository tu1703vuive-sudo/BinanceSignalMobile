const assert=require('node:assert/strict');
const {harness,shared,until}=require('./paper-app.integration.cjs'),{Engine}=require('../server/engine.cjs'),{createService}=require('../server/server.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 let clock=Date.UTC(2026,10,16,8,0,1);const engine=new Engine({now:()=>clock,market:async()=>{throw new Error('No market call expected in this UI test')}});
 const token='private-test-token-longer-than-24-characters',sent=[],pusher={setVapidDetails(){},async sendNotification(sub,payload){sent.push(JSON.parse(payload));return {statusCode:201}}};
 const service=createService({engine,token,origins:[],vapid:{subject:'mailto:test@example.com',publicKey:Buffer.alloc(65,4).toString('base64url'),privateKey:'mock'},pusher});
 await new Promise(r=>service.server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+service.server.address().port,store=shared();
 store.storage.setItem('bsm_remote_paper_v1',JSON.stringify({url,token}));
 const h=harness({store,start:clock,remoteEndpoint:url});
 try{
  await until(()=>h.el('remoteStatusText').textContent.includes('Máy chủ 24/7'));
  assert.equal(h.el('paperAuto').checked,true);assert.equal(h.ledger(),null);
  h.newSignal();await sleep(30);assert.equal(h.ledger(),null,'configured cloud mode never opens a second local order');
  // User changes a setting while polling: draft must not be overwritten.
  h.el('paper-notional').value='150';h.el('paper-notional').dispatchEvent(new h.w.Event('input'));
  await sleep(3100);assert.equal(h.el('paper-notional').value,'150');
  await h.el('paperSave').onclick();assert.equal(engine.read().ledger.config.notional,150);
  // Register this browser with the push server, using mock OS/push providers.
  h.w.PushManager=class{};let existing=null;const subscription={toJSON:()=>({endpoint:'https://fcm.googleapis.com/fcm/send/ui-fixture',keys:{auth:Buffer.alloc(16).toString('base64url'),p256dh:Buffer.alloc(65,4).toString('base64url')}})};
  h.w.navigator.serviceWorker.ready=Promise.resolve({pushManager:{getSubscription:async()=>existing,subscribe:async()=>{existing=subscription;return existing}}});
  await h.el('paperNotify').onclick();assert.equal(engine.snapshot().subscriptionCount,1);assert.equal(sent.length,1);
  h.el('paperAuto').checked=false;await h.el('paperAuto').onchange({target:h.el('paperAuto')});assert.equal(engine.read().autoEnabled,false);
  assert.equal(h.ledger(),null);assert.deepEqual(h.errors,[]);h.close();
  const reloaded=harness({store,start:clock,remoteEndpoint:url});await until(()=>reloaded.el('remoteStatusText').textContent.includes('Máy chủ 24/7'));
  assert.equal(reloaded.el('paperAuto').checked,false,'server pause survives phone/browser reopen');
  reloaded.close();await new Promise(r=>service.server.close(r));
  const lost=harness({store,start:clock,remoteEndpoint:url});await until(()=>lost.el('remoteStatusText').textContent.includes('mất kết nối'));
  lost.newSignal();await sleep(30);assert.equal(lost.ledger(),null,'network failure never falls back to local auto');assert.equal(lost.el('paperAuto').disabled,true);assert.deepEqual(lost.errors,[]);lost.close();
  console.log('PASS: cloud state, no local duplicate, config draft, push subscription/test, persistent pause, disconnected guard');
 }finally{h.close();service.server.close();engine.close()}
})().catch(e=>{console.error(e);process.exit(1)});
