// Real workerd/SQLite + the real Vercel runner; only provider data and OS push are fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {createECDH,randomBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runJob} from '../../vercel/runner.mjs';
import {marketFixture} from '../../tests/hybrid-fixture.mjs';
import core from '../../paper-trading.js';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<200;i++){if(await fn())return;await sleep(100)}throw new Error('Hybrid runtime timed out')}
test('alarm calls only Vercel, commits close/push once, and preserves ledger on Vercel outage and eviction',async()=>{
  const vapid=createECDH('prime256v1');vapid.generateKeys();const phone=createECDH('prime256v1');phone.generateKeys();
  const token='app-runtime-token-'.repeat(4),executorToken='executor-runtime-token-'.repeat(4),directory=await mkdtemp(join(tmpdir(),'paper-hybrid-'));
  const jobs=[],marketRequests=[],pushes=[],failures=[];let unavailable=false,finished=0;
  const outboundService=async request=>{
    const u=new URL(request.url);
    if(u.hostname==='executor-fixture.vercel.app'){
      if(unavailable)return new Response('Unavailable',{status:503});
      assert.equal(request.headers.get('Authorization'),'Bearer '+executorToken);const job=await request.json();jobs.push(job);
      const text=JSON.stringify(job);assert.ok(!text.includes(token));assert.ok(!text.includes(vapid.getPrivateKey().toString('base64url')));assert.equal(job.account.ledger.trades.length,0);
      try{const result=await runJob(job,{fetcher:marketFixture({requests:marketRequests})});finished++;return Response.json(result)}catch(e){failures.push(e.message);return Response.json({error:e.message},{status:400})}
    }
    if(u.hostname==='fcm.googleapis.com'){pushes.push(new Uint8Array(await request.arrayBuffer()));return new Response('',{status:201})}
    throw new Error('Cloudflare must not call the exchange: '+u.hostname);
  };
  const mf=new Miniflare(convertV4MiniflareOptions({name:'hybrid-test',modules:true,scriptPath:'dist/worker.js',compatibilityDate:'2026-11-18',durableObjects:{PAPER:{className:'PaperAccount',useSQLite:true}},durableObjectsPersist:directory,outboundService,bindings:{EXECUTION_MODE:'hybrid',EXECUTOR_URL:'https://executor-fixture.vercel.app/api/run',EXECUTOR_TOKEN:executorToken,BOT_TOKEN:token,ALLOWED_ORIGINS:'https://tu1703vuive-sudo.github.io',VAPID_SUBJECT:'https://example.com/',VAPID_PUBLIC_KEY:vapid.getPublicKey().toString('base64url'),VAPID_PRIVATE_KEY:vapid.getPrivateKey().toString('base64url')}}));
  const api=async(path,body,auth=token)=>{const r=await mf.dispatchFetch('https://worker.test'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()}};
  try{
    assert.equal((await api('/api/state',null,'wrong')).status,401);assert.equal(jobs.length,0);
    const initial=await api('/api/state');assert.equal(initial.data.executionMode,'hybrid');assert.equal(initial.data.autoEnabled,true);assert.equal(initial.data.executor.connected,false);
    try{await until(()=>finished>=1)}catch(e){throw new Error(JSON.stringify({error:e.message,jobs:jobs.length,marketRequests:marketRequests.length,failures,health:(await api('/api/state')).data.health}))}const live=await api('/api/state');assert.equal(live.data.health.state,'live',live.data.health.detail);assert.equal(live.data.executor.connected,true);assert.equal(Object.keys(live.data.frames).length,5);assert.equal(live.data.executor.version,'3.8.0');assert.equal(live.data.usage.executorRequests,1);assert.ok(marketRequests.length>=5);
    assert.ok(!JSON.stringify(live.data).includes(executorToken));
    const sub={endpoint:'https://fcm.googleapis.com/fcm/send/hybrid-fixture',keys:{auth:randomBytes(16).toString('base64url'),p256dh:phone.getPublicKey().toString('base64url')}};
    assert.equal((await api('/api/push/subscribe',{subscription:sub})).status,200);assert.equal((await api('/api/push/test',{subscription:sub})).status,200);assert.equal(pushes.length,1);assert.equal(pushes[0].length,4096);
    await api('/api/auto',{enabled:false});const entryAt=Math.floor(Date.now()/60000)*60000-180000+2000;
    const book=core.acceptSignal(core.create(),{symbol:'BTCUSDT',side:'LONG',price:100,score:80,signalAt:entryAt},{now:entryAt,armedAt:entryAt-1}).book;
    assert.equal((await api('/api/import',{ledger:book})).status,200);await until(()=>pushes.length===2);
    const closed=await api('/api/state');assert.equal(closed.data.ledger.open,null);assert.equal(closed.data.ledger.trades.length,1);assert.equal(closed.data.ledger.trades[0].reason,'SL');assert.equal(closed.data.autoEnabled,false);
    await mf.unsafeEvictDurableObject('hybrid-test','PaperAccount',{name:'paper-account-v1'});const persisted=await api('/api/state');assert.deepEqual(persisted.data.ledger,closed.data.ledger);assert.equal(persisted.data.subscriptionCount,1);assert.equal(persisted.data.autoEnabled,false);
    unavailable=true;const failed=await api('/api/diagnostics/market',{});assert.equal(failed.data.ok,false);const blocked=await api('/api/state');assert.equal(blocked.data.health.state,'error');assert.equal(blocked.data.executor.connected,false);assert.deepEqual(blocked.data.ledger,closed.data.ledger);assert.equal(pushes.length,2);
    await mf.unsafeEvictDurableObject('hybrid-test','PaperAccount',{name:'paper-account-v1'});const after=await api('/api/state');assert.deepEqual(after.data.ledger,closed.data.ledger);assert.ok(after.data.health.retryAt>Date.now());assert.equal(after.data.subscriptionCount,1);
  }finally{await mf.dispose();await rm(directory,{recursive:true,force:true})}
});
