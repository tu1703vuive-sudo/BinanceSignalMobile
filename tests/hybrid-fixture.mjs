import {DatabaseSync} from 'node:sqlite';
import {Store} from '../cloudflare/store.mjs';
import market from '../market-data.js';
export function testStore(){
  const db=new DatabaseSync(':memory:');
  const storage={sql:{exec(q,...args){const rows=db.prepare(q).all(...args);return {toArray:()=>rows,rowsRead:rows.length,rowsWritten:0}}},transactionSync(fn){db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}}};
  let clock=Date.UTC(2026,10,18,8,0,2);const now=()=>clock,advance=ms=>clock+=ms;
  return {db,store:new Store(storage,now),now,advance,wait:async ms=>advance(ms),setNow:t=>clock=t};
}
export function ready(engine,now){
  const state=engine.read();state.armedAt=now-900000;engine.write(state);
  const closedAt=Math.floor(now/900000)*900000-1;
  engine.runtime.frames=Object.fromEntries(['1M','1d','4h','1h','15m'].map(tf=>[tf,{ready:true,healthy:true,confirmed:60,previous:tf==='15m'?49:59,closedAt}]));
  engine.runtime.frameSymbol='BTCUSDT';engine.runtime.bucket=Math.floor(now/900000);engine.runtime.health={state:'live',lastTick:now,lastSignalCheck:now};engine.saveRuntime();
}
export function marketFixture({now=Date.now,status=()=>200,requests=[],bothHit=true}={}){
  return async(url)=>{
    requests.push(url);if(status()!==200)return new Response('Too Many Requests',{status:status(),headers:{'Retry-After':'60'}});
    const u=new URL(url),time=now();
    if(u.pathname.endsWith('ticker'))return Response.json({code:'0',data:[{instId:u.searchParams.get('instId'),last:'100',open24h:'100',ts:String(time)}]});
    const tf=market.timeframe(u.searchParams.get('bar')),steps={'1m':60000,'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000},d=new Date(time);
    const current=tf==='1M'?Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1):Math.floor(time/steps[tf])*steps[tf];
    const month=(t,n)=>{const d=new Date(t);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+n,1)};
    let rows;
    if(tf==='1m'){
      const start=+u.searchParams.get('before')+1,end=+u.searchParams.get('after');rows=[];
      for(let t=start;t<end;t+=60000)rows.push([String(t),'100',bothHit?'110':'100.2',bothHit?'90':'99.8','100','1000','1000','1000',market.closeTime(t,tf)<time?'1':'0']);
    }else rows=Array.from({length:450},(_,i)=>{const t=tf==='1M'?month(current,i-449):current+(i-449)*steps[tf];return [String(t),'100','100.2','99.8','100','1000','1000','1000',market.closeTime(t,tf)<time?'1':'0']});
    rows=rows.filter(r=>(!u.searchParams.has('before')||+r[0]>+u.searchParams.get('before'))&&(!u.searchParams.has('after')||+r[0]<+u.searchParams.get('after'))).reverse().slice(0,+u.searchParams.get('limit'));
    return Response.json({code:'0',data:rows});
  };
}
