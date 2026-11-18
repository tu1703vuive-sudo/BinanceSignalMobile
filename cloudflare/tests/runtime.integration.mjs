// Run after npm run build. Actual workerd/SQLite/alarms; OKX and OS push are fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {createECDH,randomBytes} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import core from '../../paper-trading.js';
import marketData from '../../market-data.js';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<200;i++){const value=await fn();if(value)return value;await sleep(100)}throw new Error('Timed out waiting for real alarm')}
test('workerd authenticates, runs alarm without phone polling, persists after eviction and encrypts push',async()=>{
  const key=createECDH('prime256v1');key.generateKeys();const client=createECDH('prime256v1');client.generateKeys();
  const token='runtime-test-token-64-characters-012345678901234567890123456789';
  const directory=await mkdtemp(join(tmpdir(),'bsm-cf-')),requests=[],pushes=[];let marketStatus=200;
  const outboundService=async request=>{
    const u=new URL(request.url);requests.push(u.href);
    if(u.hostname==='fcm.googleapis.com'){
      pushes.push({headers:Object.fromEntries(request.headers),bytes:new Uint8Array(await request.arrayBuffer())});return new Response('',{status:201});
    }
    if(u.pathname.endsWith('candles')){
      if(marketStatus!==200)return Response.json({msg:'Request blocked by WAF'},{status:marketStatus});
      const tf=marketData.timeframe(u.searchParams.get('bar')),now=Date.now(),steps={'1m':60000,'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000};
      const d=new Date(now),current=tf==='1M'?Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1):Math.floor(now/steps[tf])*steps[tf];
      const month=(t,n)=>{const d=new Date(t);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+n,1)};
      let rows;
      if(tf==='1m'){
        const start=+u.searchParams.get('before')+1,end=+u.searchParams.get('after')-1;rows=[];
        for(let t=start;t<=end;t+=60000)rows.push([t,'100','110','90','100','1000',t+59999]);
      }else rows=Array.from({length:450},(_,i)=>{const t=tf==='1M'?month(current,i-449):current+(i-449)*steps[tf],end=tf==='1M'?month(t,1)-1:t+steps[tf]-1;return [t,'100','100.2','99.8','100','1000',end]});
      rows=rows.filter(r=>(!u.searchParams.has('before')||r[0]>+u.searchParams.get('before'))&&(!u.searchParams.has('after')||r[0]<+u.searchParams.get('after'))).reverse().slice(0,+u.searchParams.get('limit')).map(r=>[...r.slice(0,6),'1000','1000',r[6]<now?'1':'0']);
      return Response.json({code:'0',data:rows});
    }
    return Response.json({code:'0',data:[{instId:u.searchParams.get('instId'),last:'100',open24h:'100',ts:String(Date.now())}]});
  };
  const mf=new Miniflare(convertV4MiniflareOptions({name:'bsm-test',modules:true,scriptPath:'dist/worker.js',compatibilityDate:'2026-11-17',durableObjects:{PAPER:{className:'PaperAccount',useSQLite:true}},durableObjectsPersist:directory,outboundService,bindings:{EXECUTION_MODE:'cloudflare',BOT_TOKEN:token,ALLOWED_ORIGINS:'https://tu1703vuive-sudo.github.io',VAPID_SUBJECT:'https://example.com/',VAPID_PUBLIC_KEY:key.getPublicKey().toString('base64url'),VAPID_PRIVATE_KEY:key.getPrivateKey().toString('base64url')}}));
  const api=async(path,body,auth=token,origin='https://tu1703vuive-sudo.github.io')=>{const r=await mf.dispatchFetch('https://worker.test'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+auth,Origin:origin,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),headers:r.headers}};
  try{
    assert.equal((await api('/api/state',null,'wrong')).status,401);assert.equal((await api('/api/state',null,token,'https://attacker.invalid')).status,403);
    const first=await api('/api/state');assert.equal(first.status,200);assert.equal(first.data.autoEnabled,true);assert.ok(first.data.nextAlarm);assert.equal(first.headers.get('Access-Control-Allow-Origin'),'https://tu1703vuive-sudo.github.io');
    assert.equal((await api('/api/monitor',{symbol:'ETHUSDT'})).status,400);assert.equal((await api('/api/monitor',{symbol:'BTCUSDT'})).data.symbol,'BTCUSDT');
    // No incoming app requests while waiting: alarm itself must fetch all five frames.
    await until(()=>requests.filter(u=>u.includes('/market/candles')).length===10);
    const live=await api('/api/state');assert.equal(live.data.health.state,'live');assert.ok(live.data.usage.alarms>=1);assert.equal(Object.keys(live.data.frames).length,5);
    assert.equal(live.data.priceSource,'okx-spot');assert.ok(requests.filter(u=>u.includes('/market/candles')).every(u=>u.startsWith('https://openapi.okx.com/api/v5/market/candles')),'new RSI frames must all use Spot');
    const countBefore=requests.length;const fromBot=await api('/api/diagnostics/market',{});assert.equal(fromBot.data.ok,true);assert.equal(fromBot.data.requestSent,false);assert.equal(requests.length,countBefore,'healthy bot diagnostics reuse data instead of restarting warmup');
    const sub={endpoint:'https://fcm.googleapis.com/fcm/send/runtime-fixture',keys:{auth:randomBytes(16).toString('base64url'),p256dh:client.getPublicKey().toString('base64url')}};
    const registered=await api('/api/push/subscribe',{subscription:sub});assert.equal(registered.status,200,JSON.stringify(registered.data));const delivered=await api('/api/push/test',{subscription:sub});assert.equal(delivered.status,200,JSON.stringify(delivered.data));assert.equal(pushes.length,1);assert.equal(pushes[0].headers['content-encoding'],'aes128gcm');assert.equal(pushes[0].bytes.length,4096);
    // Import an older position; alarm catches up and writes a durable CLOSE outbox.
    await api('/api/auto',{enabled:false});const entryAt=Math.floor(Date.now()/60000)*60000-180000+2000;
    const result=core.acceptSignal(core.create(),{symbol:'BTCUSDT',side:'LONG',price:100,signalAt:entryAt,score:100},{now:entryAt,armedAt:entryAt-1});
    assert.equal((await api('/api/import',{ledger:result.book})).status,200);
    await until(()=>pushes.length===2);
    const closed=await api('/api/state');assert.equal(closed.data.ledger.open,null);assert.equal(closed.data.ledger.trades.length,1);assert.equal(closed.data.ledger.trades[0].reason,'SL');assert.equal(closed.data.autoEnabled,false);assert.equal(closed.data.nextAlarm,null);
    await mf.unsafeEvictDurableObject('bsm-test','PaperAccount',{name:'paper-account-v1'});
    const reopened=await api('/api/state?tradesSince=1');assert.equal(reopened.status,200);assert.equal(reopened.data.autoEnabled,false);assert.equal(reopened.data.tradesOffset,1);assert.equal(reopened.data.ledger.trades.length,0);assert.equal(reopened.data.subscriptionCount,1);
    assert.equal((await api('/api/import',{ledger:core.create()})).status,400,'never overwrite an existing cloud history');
    const ns=await mf.getDurableObjectNamespace('PAPER'),waf=ns.get(ns.idFromName('waf-probe-isolated-test'));
    const wafApi=async(path,body)=>{const r=await waf.fetch('https://internal'+path,{method:body?'POST':'GET',...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()}};
    await wafApi('/api/auto',{enabled:false});
    marketStatus=403;const beforeCheck=await wafApi('/api/state'),beforeRequests=requests.length;
    const diagnosis=await wafApi('/api/diagnostics/market',{});assert.equal(diagnosis.status,200);assert.equal(diagnosis.data.ok,false);assert.equal(diagnosis.data.check.status,403);assert.equal(diagnosis.data.check.message,'Request blocked by WAF');
    const again=await wafApi('/api/diagnostics/market',{});assert.equal(again.data.cached,true);assert.equal(requests.length,beforeRequests+1,'diagnostic cannot hammer an upstream block');
    const blocked=await wafApi('/api/state');assert.equal(blocked.data.health.state,'error');assert.equal(blocked.data.marketDiagnostic.check.category,'ACCESS_DENIED');assert.deepEqual(blocked.data.ledger,beforeCheck.data.ledger);assert.equal(blocked.data.autoEnabled,false);
    marketStatus=429;const rateId='rate-limit-isolated-test';let limited=ns.get(ns.idFromName(rateId));const beforeRate=requests.length;
    const diagnose=async()=>{const r=await limited.fetch('https://internal/api/diagnostics/market',{method:'POST',body:'{}'});return r.json()};
    const rate=await diagnose();assert.equal(rate.check.status,429);assert.ok(rate.nextAllowedAt-rate.at>=60000);const savedAt=rate.at;
    await mf.unsafeEvictDurableObject('bsm-test','PaperAccount',{name:rateId});limited=ns.get(ns.idFromName(rateId));
    const reused=await diagnose();assert.equal(reused.at,savedAt);assert.equal(reused.requestSent,false);assert.equal(reused.cached,true);assert.equal(requests.length,beforeRate+1);
    marketStatus=200;const probe=ns.get(ns.idFromName('spot-preflight-isolated-test'));
    const response=await probe.fetch('https://internal/api/diagnostics/market',{method:'POST',body:'{}',headers:{'Content-Type':'application/json'}});const checked=await response.json();assert.equal(checked.ok,true);assert.equal(checked.priceSource,'okx-spot');assert.equal(checked.check.status,200);

  }finally{await mf.dispose();await rm(directory,{recursive:true,force:true})}
});
