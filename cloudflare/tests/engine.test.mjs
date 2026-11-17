import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {CloudEngine,validate} from '../engine.mjs';
import {Store} from '../store.mjs';
import core from '../../paper-trading.js';
const MIN=60000;
function setup(){
  let at=Date.UTC(2026,10,17,8,0,2),market=async()=>({price:'100',time:at});
  const db=new DatabaseSync(':memory:');
  const storage={sql:{exec(q,...args){const rows=db.prepare(q).all(...args);return {toArray:()=>rows,rowsRead:rows.length,rowsWritten:0}}},transactionSync(fn){db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}}};
  const store=new Store(storage,()=>at),engine=new CloudEngine(store,{now:()=>at,market:path=>market(path)});
  return {store,engine,db,setAt:t=>at=t,at:()=>at,setMarket:fn=>market=fn};
}
function ready(h){
  const s=h.engine.read();s.armedAt=h.at()-900000;h.engine.write(s);
  const closedAt=Math.floor(h.at()/900000)*900000-1;
  const frames=Object.fromEntries(['1M','1d','4h','1h','15m'].map(tf=>[tf,{ready:true,healthy:true,confirmed:60,previous:tf==='15m'?49:59,closedAt}]));
  Object.assign(h.engine.runtime,{frames,bucket:Math.floor(h.at()/900000),frameSymbol:'BTCUSDT'});
}
const row=(t,{open=100,high=100.2,low=99.8,close=100}={})=>[t,''+open,''+high,''+low,''+close,'1000',t+MIN-1];
test('BTC-only API and migration preserve legacy ledger, auto preference, and reject altcoin imports',()=>{
  const h=setup();try{
    const before=h.engine.read();assert.throws(()=>h.engine.monitor('ETHUSDT'),/chỉ chạy BTCUSDT/);h.engine.monitor('BTCUSDT');assert.deepEqual(h.engine.read(),before);
    const legacy=core.acceptSignal(core.create(),{symbol:'BTCUSDT',side:'LONG',price:100,signalAt:h.at()-10000,score:100},{now:h.at()-10000,armedAt:h.at()-20000}).book;
    legacy.open.symbol='ETHUSDT';legacy.open.id='old-eth-position';
    assert.throws(()=>h.engine.importBook(legacy),/Đóng lệnh coin khác/);assert.deepEqual(h.engine.read(),before);
    h.store.put('account',{...before,symbol:'ETHUSDT',autoEnabled:false,ledger:legacy,armedAt:h.at()-10000});
    h.store.put('runtime',{...h.engine.runtime,frameSymbol:'ETHUSDT',frames:{old:true}});
    const migrated=new CloudEngine(h.store,{now:h.at});const after=migrated.read();
    assert.equal(after.symbol,'BTCUSDT');assert.equal(after.autoEnabled,false);assert.equal(after.armedAt,h.at());assert.equal(after.ledger.cash,legacy.cash);assert.deepEqual(after.ledger.open,legacy.open);assert.equal(migrated.runtime.frames,null);
    const twice=new CloudEngine(h.store,{now:h.at});assert.deepEqual(twice.read(),after,'migration runs only once');
  }finally{h.db.close()}
});
test('fresh 5-frame signal, duplicate alarm, restart, pause and resume retain one ledger',async()=>{
  const h=setup();try{ready(h);h.store.subscribe('phone',{endpoint:'fixture'});await h.engine.tick();const first=h.engine.read();assert.equal(first.ledger.open.side,'LONG');assert.equal(h.store.pending().length,1);
    assert.equal(first.ledger.open.ruleSet,'v41');assert.equal(first.ledger.open.strategy,'MOMENTUM');assert.equal(first.ledger.open.checks.length,5);assert.ok(first.ledger.open.checks.every(c=>c.passed));
    await h.engine.tick();assert.equal(h.engine.read().ledger.open.id,first.ledger.open.id);assert.equal(h.store.pending().length,1);
    h.engine.auto(false);const restarted=new CloudEngine(h.store,{now:h.at,market:async()=>({price:'100'})});assert.equal(restarted.read().autoEnabled,false);assert.equal(restarted.read().ledger.open.id,first.ledger.open.id);
    h.setAt(h.at()+1000);restarted.auto(true);assert.equal(restarted.read().armedAt,h.at());
  }finally{h.db.close()}
});
test('upgrading old Momentum account rearms once, clears old frames and preserves open trade/config/auto',()=>{
 const h=setup();try{
  const before=h.engine.read(),ledger=core.acceptSignal(before.ledger,{symbol:'BTCUSDT',side:'SHORT',price:100,signalAt:h.at()-10000,score:-70},{now:h.at()-10000,armedAt:h.at()-20000}).book;
  delete before.strategyVersion;before.ledger=ledger;before.autoEnabled=false;before.armedAt=h.at()-20000;h.store.put('account',before);h.store.put('runtime',{...h.engine.runtime,frames:{oldMomentum:true},bucket:123});
  const upgraded=new CloudEngine(h.store,{now:h.at});const after=upgraded.read();assert.equal(after.strategyVersion,'RSI14-V41-1');assert.equal(after.armedAt,h.at());assert.equal(after.autoEnabled,false);assert.deepEqual(after.ledger.open,ledger.open);assert.deepEqual(after.ledger.config,ledger.config);assert.equal(after.ledger.cash,ledger.cash);assert.equal(upgraded.runtime.frames,null);
  h.setAt(h.at()+60000);const twice=new CloudEngine(h.store,{now:h.at});assert.equal(twice.read().armedAt,after.armedAt);assert.equal(twice.read().ledger.revision,after.ledger.revision);
 }finally{h.db.close()}
});
test('closed minute execution ignores pre-entry wicks, then uses SL when a full candle hits both',async()=>{
  const h=setup();try{ready(h);await h.engine.tick();h.engine.auto(false);let start=Math.floor(h.at()/MIN)*MIN;
    h.setAt(start+MIN+2000);h.setMarket(async()=>[row(start,{high:110,low:90})]);await h.engine.tick();assert.ok(h.engine.read().ledger.open,'entry minute extremes precede entry and cannot trigger');
    start+=MIN;h.setAt(start+MIN+2000);h.setMarket(async()=>[row(start,{high:110,low:90})]);await h.engine.tick();const s=h.engine.read();assert.equal(s.ledger.open,null);assert.equal(s.ledger.trades[0].reason,'SL');assert.equal(s.ledger.trades[0].ambiguous,true);assert.equal(h.engine.nextDue(),null);
  }finally{h.db.close()}
});
test('missing candles keep open position and schedule retry; no invented close',async()=>{
  const h=setup();try{ready(h);await h.engine.tick();h.engine.auto(false);const start=Math.floor(h.at()/MIN)*MIN;h.setAt(start+3*MIN+2000);h.setMarket(async()=>[row(start),row(start+2*MIN)]);await h.engine.tick();assert.ok(h.engine.read().ledger.open);assert.equal(h.engine.read().ledger.trades.length,0);assert.equal(h.engine.runtime.health.state,'error');assert.ok(h.engine.nextDue()>h.at());
  }finally{h.db.close()}
});
test('long outage recovers one bounded page and persists progress before restart',async()=>{
  const h=setup();try{ready(h);await h.engine.tick();h.engine.auto(false);const start=Math.floor(h.at()/MIN)*MIN;h.setAt(start+1002*MIN+2000);let calls=0;h.setMarket(async path=>{calls++;assert.ok(path.includes('limit=1000'));return Array.from({length:1000},(_,i)=>row(start+i*MIN))});await h.engine.tick();assert.equal(calls,1);assert.equal(h.engine.read().ledger.open.lastObservedAt,start+1000*MIN);assert.equal(h.engine.runtime.health.state,'recovering');assert.equal(h.engine.nextDue(),h.at()+5000);
  }finally{h.db.close()}
});
test('stale crossing is skipped; fresh default account never enters past signals',async()=>{
  const h=setup();try{ready(h);h.setAt(h.at()+31000);let calls=0;h.setMarket(async()=>{calls++;throw new Error('No current entry allowed')});await h.engine.tick();assert.equal(h.engine.read().ledger.open,null);assert.equal(calls,0);
  }finally{h.db.close()}
});
test('transaction rolls back ledger if enqueue fails',async()=>{
  const h=setup();try{const before=h.engine.read();h.store.enqueue=()=>{throw new Error('storage failure')};const next=core.acceptSignal(before.ledger,{symbol:'BTCUSDT',side:'LONG',price:100,signalAt:h.at(),score:100},{now:h.at(),armedAt:h.at()-1});assert.throws(()=>h.engine.write({...before,ledger:next.book},next.event),/storage failure/);assert.deepEqual(h.engine.read(),before);
  }finally{h.db.close()}
});
test('UTC usage resets; monthly candles handle February rather than fixed 30-day steps',()=>{
  const h=setup();try{h.store.count('alarms',10);h.setAt(Date.UTC(2026,10,18));h.store.count('alarms');assert.equal(h.store.usage.alarms,1);assert.equal(h.store.usage.day,'2026-11-18');
    const c=(a,b)=>({openTime:a,closeTime:b-1,open:100,high:101,low:99,close:100,volume:1});assert.equal(validate([c(Date.UTC(2026,0,1),Date.UTC(2026,1,1)),c(Date.UTC(2026,1,1),Date.UTC(2026,2,1))],'1M').length,2);
  }finally{h.db.close()}
});
