import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHandler} from '../handler.mjs';
import {runJob} from '../runner.mjs';
import {CloudEngine} from '../../cloudflare/engine.mjs';
import {ExecutorClient} from '../../cloudflare/hybrid-engine.mjs';
import {makeJob,validateResult,MAX_BYTES} from '../../hybrid-protocol.mjs';
import {testStore,marketFixture} from '../../tests/hybrid-fixture.mjs';

test('authenticated real HTTP executor round-trip, protected body and paper-only action contract',async()=>{
  const h=testStore(),token='executor-test-token-'.repeat(4),requests=[];
  const runner=job=>runJob(job,{now:h.now,wait:h.wait,fetcher:marketFixture({now:h.now,requests})});
  const server=http.createServer(createHandler({token,runner}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
  try{
    const engine=new CloudEngine(h.store,{now:h.now}),job=makeJob(engine.read(),engine.runtime,'diagnose',{now:h.now(),id:'fixture-job-12345678'});
    assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(job)})).status,401);assert.equal(requests.length,0);
    assert.equal((await fetch(url)).status,405);
    const invalid={...job,action:'place-real-order'};assert.equal((await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(invalid)})).status,400);assert.equal(requests.length,0);
    const client=new ExecutorClient({url:'https://paper-fixture.vercel.app',token,fetcher:(_url,options)=>fetch(url,options)});const result=await client.run(job),accepted=validateResult(job,result,engine.read(),h.now());
    assert.equal(accepted.diagnostic.ok,true);assert.equal(accepted.account.ledger.cash,engine.read().ledger.cash);assert.equal(result.journal.length,0);assert.equal(requests.length,1);assert.ok(!JSON.stringify(result).includes(token));
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));h.db.close()}
});
test('history is not sent to Vercel and oversized input is rejected before execution',async()=>{
  const h=testStore();try{
    const e=new CloudEngine(h.store,{now:h.now}),state=e.read();state.ledger.trades=Array.from({length:3000},()=>({privateHistory:'x'.repeat(10000)}));state.privateAccountSecret='must-stay-in-cloudflare';
    const job=makeJob(state,e.runtime,'tick',{id:'fixture-job-12345678',now:h.now()});assert.equal(job.tradesOffset,3000);assert.equal(job.account.ledger.trades.length,0);assert.ok(JSON.stringify(job).length<10000);assert.ok(!JSON.stringify(job).includes('must-stay-in-cloudflare'));
    let called=false,code=0,body;const handler=createHandler({token:'x'.repeat(64),runner:async()=>{called=true}});
    const req={method:'POST',headers:{authorization:'Bearer '+'x'.repeat(64),'content-type':'application/json'},body:' '.repeat(MAX_BYTES+1)};
    await handler(req,{setHeader(){},set statusCode(v){code=v},end(v){body=v}});assert.equal(code,413);assert.equal(called,false);assert.ok(body.includes('quá lớn'));
  }finally{h.db.close()}
});
