import test from 'node:test';import assert from 'node:assert/strict';import {verifyMarket} from '../verify.mjs';
test('deployment preflight distinguishes API reachability from actual market readiness',async()=>{
 for(const blocked of [true,false]){
  let reads=0,waits=0;
  const result=await verifyMarket('https://fixture.workers.dev','test-token',{wait:async()=>waits++,fetcher:async(url)=>{
   if(url.endsWith('/api/diagnostics/market'))return Response.json(blocked?{ok:false,detail:'Spot 403',check:{message:'blocked'}}:{ok:true});
   reads++;return Response.json({platform:'cloudflare',priceSource:'okx-spot',executionMode:'hybrid',executor:{configured:true,connected:true},frames:Object.fromEntries(['1M','1d','4h','1h','15m'].map(tf=>[tf,{ready:true,healthy:true}])),health:{state:reads>2?'live':'starting'}});
  }});
  assert.equal(result.apiReady,true);assert.equal(result.marketReady,!blocked);if(blocked)assert.equal(waits,0);else assert.ok(waits>0);
 }
});
test('successful probe without all five healthy frames never claims the bot is ready',async()=>{
 const result=await verifyMarket('https://fixture.workers.dev','test-token',{attempts:1,fetcher:async url=>Response.json(url.endsWith('/api/diagnostics/market')?{ok:true}:{platform:'cloudflare',priceSource:'okx-spot',executionMode:'hybrid',executor:{configured:true,connected:true},autoEnabled:true,health:{state:'live'},frames:{'15m':{ready:true,healthy:true}}})});
 assert.equal(result.marketReady,false);assert.equal(result.checking,true);
});
test('a ready current bot needs no new market probe during deploy; stale frames still need checking',async()=>{
 const now=Date.UTC(2026,10,17,8,0,2),frames=Object.fromEntries(['1M','1d','4h','1h','15m'].map(tf=>[tf,{ready:true,healthy:true,closedAt:Math.floor(now/900000)*900000-1}]));let reads=0;
 const ready=await verifyMarket('https://fixture.workers.dev','token',{fetcher:async url=>{reads++;assert.ok(!url.endsWith('/api/diagnostics/market'));return Response.json({platform:'cloudflare',priceSource:'okx-spot',executionMode:'hybrid',executor:{configured:true,connected:true},serverTime:now,frames,autoEnabled:true,health:{state:'live'}})}});assert.equal(ready.marketReady,true);assert.equal(reads,1);
 let probes=0;const stale=await verifyMarket('https://fixture.workers.dev','token',{fetcher:async url=>{if(url.endsWith('/api/diagnostics/market')){probes++;return Response.json({ok:false,detail:'blocked'})}return Response.json({platform:'cloudflare',priceSource:'okx-spot',executionMode:'hybrid',executor:{configured:true,connected:true},serverTime:now+900000,frames,autoEnabled:true,health:{state:'live'}})}});assert.equal(stale.marketReady,false);assert.equal(probes,1);
});
