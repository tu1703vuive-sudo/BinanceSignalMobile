const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Engine}=require('../engine.cjs'),{createService}=require('../server.cjs');
function fixture(file=':memory:'){
 let clock=Date.UTC(2026,10,16,8,0,1),price=105.2,bad=false;
 const market=async route=>{const u=new URL(route,'https://fixture.invalid');if(u.pathname.includes('ticker'))return {price:String(price),time:clock};
  const tf=u.searchParams.get('interval');if(bad&&tf==='1M')throw new Error('Fixture market unavailable');
  const step={'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000,'1m':60000}[tf];
  const d=new Date(clock),start=tf==='1M'?Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1):Math.floor(clock/step)*step;
  const month=(ms,n)=>{const t=new Date(ms);return Date.UTC(t.getUTCFullYear(),t.getUTCMonth()+n,1)};
  if(tf==='1m'){const from=Number(u.searchParams.get('startTime')),end=Number(u.searchParams.get('endTime')),rows=[];for(let t=from;t<end&&rows.length<1000;t+=60000)rows.push([t,'105.2','105.3','105.1','105.2','1000',t+59999]);return rows}
  return Array.from({length:260},(_,i)=>{const t=tf==='1M'?month(start,i-259):start+(i-259)*step,end=tf==='1M'?month(t,1)-1:t+step-1,c=tf==='15m'?(i<257?100+i%2:i===257?100:i===258?105:105.2):(i<258?100+i%2:i===258?102:102.2);return [t,''+(c-.05),''+(c+.2),''+(c-.2),''+c,'1000',end]});
 };
 const e=new Engine({file,market,now:()=>clock});return {e,market,clock:()=>clock,advance:n=>clock+=n,setPrice:p=>price=p,setBad:x=>bad=x};
}
const sub={endpoint:'https://fcm.googleapis.com/fcm/send/fixture',keys:{auth:Buffer.alloc(16).toString('base64url'),p256dh:Buffer.alloc(65).toString('base64url')}};
test('server trades without a browser, deduplicates, persists auto and history across restart',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'signal-server-')),file=path.join(dir,'paper.sqlite'),f=fixture(file),e=f.e;
 e.db.prepare('INSERT INTO subscriptions VALUES(?,?)').run('fixture',JSON.stringify(sub));
 assert.equal(e.snapshot().autoEnabled,true);await e.tick();assert.equal(e.read().ledger.open,null);
 f.advance(900000);await e.tick();assert.equal(e.health.state,'live');assert.equal(e.read().ledger.open.side,'LONG');assert.equal(e.read().ledger.open.ruleSet,'v41');assert.equal(e.read().ledger.open.strategy,'MOMENTUM');assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM deliveries').get().n,1);
 await e.tick();assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM deliveries').get().n,1);
 f.setPrice(110);f.advance(3000);await e.tick();assert.equal(e.read().ledger.trades.length,1);assert.equal(e.read().ledger.trades[0].reason,'TP');assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM deliveries').get().n,2);
 e.setAuto(false);e.close();const reopened=new Engine({file,market:f.market,now:f.clock});assert.equal(reopened.read().autoEnabled,false);assert.equal(reopened.read().ledger.trades.length,1);reopened.close();fs.rmSync(dir,{recursive:true,force:true});
});
test('bad higher-frame data blocks entry without fabricating a signal',async()=>{const f=fixture();await f.e.tick();f.advance(900000);f.setBad(true);await f.e.tick();assert.equal(f.e.health.state,'error');assert.equal(f.e.read().ledger.open,null);f.e.close()});
test('Node migration pins an old target to BTC without resetting ledger or auto',()=>{
 const f=fixture(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'signal-btc-')),file=path.join(dir,'paper.sqlite');let e=new Engine({file,market:f.market,now:f.clock});
 try{const s=e.read();s.symbol='ETHUSDT';s.autoEnabled=false;s.ledger.cash=9999;e.write(s);e.close();e=new Engine({file,market:f.market,now:f.clock});const after=e.read();assert.equal(after.symbol,'BTCUSDT');assert.equal(after.autoEnabled,false);assert.equal(after.ledger.cash,9999);assert.throws(()=>e.setSymbol('SOLUSDT'),/chỉ chạy BTCUSDT/)}finally{e.close();f.e.close();fs.rmSync(dir,{recursive:true,force:true})}
});
test('HTTP auth, CORS, push validation, persistent outbox and incremental history',async()=>{
 const f=fixture(),e=f.e,calls=[],token='test-only-authentication-token-123456789',pusher={setVapidDetails(){},async sendNotification(s,p){calls.push(JSON.parse(p));return {statusCode:201}}};
 const svc=createService({engine:e,token,origins:['https://app.example'],vapid:{subject:'mailto:test@example.com',publicKey:'test',privateKey:'test'},pusher});
 await new Promise(r=>svc.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+svc.server.address().port;
 const req=async(p,data)=>fetch(base+p,{method:data?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Origin:'https://app.example'},...(data?{body:JSON.stringify(data)}:{})});
 try{
  assert.equal((await fetch(base+'/api/state')).status,401);assert.equal((await fetch(base+'/api/state',{headers:{Origin:'https://evil.example',Authorization:'Bearer '+token}})).status,403);
  const initial=await (await req('/api/state')).json();assert.equal(initial.autoEnabled,true);assert.equal(initial.pushReady,true);
  assert.equal((await req('/api/monitor',{symbol:'ETHUSDT'})).status,400);assert.equal(e.read().symbol,'BTCUSDT');assert.equal((await req('/api/monitor',{symbol:'BTCUSDT'})).status,200);
  assert.equal((await req('/api/push/subscribe',{subscription:{...sub,endpoint:'https://127.0.0.1/private'}})).status,400);
  assert.equal((await req('/api/push/subscribe',{subscription:sub})).status,200);
  await e.tick();f.advance(900000);await e.tick();await svc.dispatch();assert.equal(calls.length,1);await svc.dispatch();assert.equal(calls.length,1);
  f.setPrice(110);f.advance(3000);await e.tick();await svc.dispatch();assert.equal(calls.length,2);assert.equal(calls[1].type,'CLOSE');
  const delta=await (await req('/api/state?tradesSince=1')).json();assert.equal(delta.tradesOffset,1);assert.equal(delta.ledger.trades.length,0);assert.equal(delta.stats.closed,1);
  assert.equal((await req('/api/push/test',{subscription:sub})).status,200);assert.equal(calls.length,3);
  const off=await (await req('/api/auto',{enabled:false})).json();assert.equal(off.autoEnabled,false);
  assert.equal((await req('/api/import',{ledger:initial.ledger})).status,400,'cannot overwrite traded server account');
 }finally{await new Promise(r=>svc.server.close(r));e.close()}
});
test('failed push is retried, expired subscription is removed',async()=>{
 const f=fixture(),e=f.e;e.db.prepare('INSERT INTO subscriptions VALUES(?,?)').run('fixture',JSON.stringify(sub));await e.tick();f.advance(900000);await e.tick();
 let status=503;const pusher={setVapidDetails(){},async sendNotification(){const err=new Error('mock');err.statusCode=status;throw err}};
 const svc=createService({engine:e,token:'test-only-token-more-than-24-characters',vapid:{subject:'mailto:a@example.com',publicKey:'test',privateKey:'test'},pusher});
 await svc.dispatch();let row=e.db.prepare('SELECT * FROM deliveries').get();assert.equal(row.status,'pending');assert.equal(row.attempt,1);
 e.db.prepare('UPDATE deliveries SET next_at=0').run();status=410;await svc.dispatch();assert.equal(e.db.prepare('SELECT COUNT(*) AS n FROM subscriptions').get().n,0);assert.equal(e.db.prepare('SELECT status FROM deliveries').get().status,'failed');e.close();
});
