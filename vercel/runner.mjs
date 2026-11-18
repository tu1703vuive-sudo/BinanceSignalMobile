import {CloudEngine} from '../cloudflare/engine.mjs';
import market from '../market-data.js';
import {PROTOCOL,VERSION,clone,validateJob} from '../hybrid-protocol.mjs';

// A request-scoped scratch store. This service never owns an account or a push subscription.
class ScratchStore{
  constructor(job){this.values=new Map([['account',clone(job.account)],['runtime',clone(job.runtime)],['marketPacing',clone(job.pacing)]]);this.journal=[];this.requests=0}
  get(key){const value=this.values.get(key);return value===undefined?null:clone(value)}
  put(key,value){this.values.set(key,clone(value));if(key==='account')this.journal.push(clone(value))}
  atomic(fn){const previous=new Map([...this.values].map(([k,v])=>[k,clone(v)])),length=this.journal.length;try{return fn()}catch(e){this.values=previous;this.journal.length=length;throw e}}
  count(key){if(key==='marketRequests'&&++this.requests>50)throw new Error('Đã chạm giới hạn lượt dữ liệu của một tác vụ')}
  enqueue(){} // Cloudflare regenerates and commits notifications with its authoritative ledger.
  subscriptionCount(){return 0}
}
export async function runJob(job,{now=Date.now,fetcher=fetch,wait=ms=>new Promise(r=>setTimeout(r,ms))}={}){
  validateJob(job,now());
  const store=new ScratchStore(job);
  const boundedFetch=async(url,options)=>{
    const remaining=job.expiresAt-now();if(remaining<=0)throw new Error('Tác vụ Vercel đã hết hạn');
    return fetcher(url,{...options,signal:AbortSignal.any([options.signal,AbortSignal.timeout(Math.max(1,remaining))].filter(Boolean))});
  };
  const engine=new CloudEngine(store,{now,fetcher:boundedFetch,wait,executionLabel:'Vercel + Cloudflare'});let diagnostic=null;
  if(job.action==='tick')await engine.tick();
  else if(job.action==='close'){
    try{await engine.manualClose(job.tradeId);engine.runtime.errors=0;engine.runtime.retryAt=0;engine.runtime.health={...engine.runtime.health,state:engine.read().autoEnabled&&!engine.runtime.frames?'starting':'live',detail:'Đã kiểm tra và xử lý đóng lệnh giả',lastTick:now(),upstream:null}}
    catch(e){engine.recordFailure(e)}
  }else{
    try{
      const cs=await engine.fetchMarket(market.candlesPath('BTCUSDT','15m',{limit:2}));
      if(cs.length!==2)throw new Error('Chưa có đủ nến kiểm tra');
      diagnostic={ok:true,source:'OKX Spot qua Vercel',priceSource:market.SOURCE,at:now(),requestSent:store.requests>0,check:{status:200,route:'/api/v5/market/candles'},detail:'Vercel lấy được nến OKX BTC 15m. Bot còn phải kiểm tra đủ 5 khung và lệnh đang mở.',nextAllowedAt:now()+60000};
      const rt=engine.runtime;rt.frames=null;rt.bucket=null;
      if(!rt.health.upstream||rt.health.upstream.priceSource===market.SOURCE){rt.retryAt=0;rt.health={...rt.health,state:'starting',detail:'Vercel lấy được nến thử; đang chờ kiểm tra đủ dữ liệu',retryAt:0,upstream:null}}
    }catch(e){engine.recordFailure(e);diagnostic={ok:false,source:'OKX Spot qua Vercel',priceSource:market.SOURCE,at:e.upstream?.checkedAt||now(),requestSent:store.requests>0,check:e.upstream||{category:'CONNECTION_ERROR',message:String(e.message).slice(0,300)},detail:engine.runtime.health.detail,nextAllowedAt:engine.runtime.retryAt}}
  }
  engine.saveRuntime();
  return {protocol:PROTOCOL,executorVersion:VERSION,jobId:job.jobId,baseRevision:job.baseRevision,completedAt:now(),account:engine.read(),runtime:store.get('runtime'),pacing:store.get('marketPacing'),journal:store.journal,marketRequests:store.requests,diagnostic};
}
