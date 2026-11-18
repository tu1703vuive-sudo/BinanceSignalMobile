// Normalized public market data. OKX Spot is primary; old trades keep their original source.
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./binance-market.js'):root.BinanceMarket);if(typeof module==='object'&&module.exports)module.exports=api;else root.MarketData=api})(typeof globalThis!=='undefined'?globalThis:this,function(binance){
  'use strict';
  const SOURCE='okx-spot',BASE='https://openapi.okx.com',WS_PUBLIC='wss://ws.okx.com/ws/v5/public',WS_BUSINESS='wss://ws.okx.com/ws/v5/business';
  const BARS=Object.freeze({'1m':'1m','15m':'15m','1h':'1H','4h':'4H','12h':'12Hutc','1d':'1Dutc','1w':'1Wutc','1M':'1Mutc'});
  const STEPS={'1m':60000,'15m':900000,'1h':3600000,'4h':14400000,'12h':43200000,'1d':86400000,'1w':604800000};
  function instrument(symbol){if(!/^[A-Z0-9]{1,30}USDT$/.test(symbol))throw new Error('Chỉ hỗ trợ cặp Spot USDT');return symbol.slice(0,-4)+'-USDT'}
  function symbol(instId){if(!/^[A-Z0-9]{1,30}-USDT$/.test(instId))throw new Error('Không phải cặp Spot USDT');return instId.replace('-','')}
  function timeframe(bar){const tf=Object.keys(BARS).find(tf=>BARS[tf]===bar);if(!tf)throw new Error('Khung OKX không được hỗ trợ');return tf}
  function closeTime(t,tf){if(tf==='1M'){const d=new Date(t);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)-1}if(!STEPS[tf])throw new Error('Khung nến không hợp lệ');return t+STEPS[tf]-1}
  function candle(row,tf,now=Date.now()){
    if(!Array.isArray(row)||row.length<9||!['0','1'].includes(row[8]))throw new Error('OKX trả nến không hợp lệ');
    const t=+row[0],end=closeTime(t,tf),numbers=row.slice(0,6).map(Number);
    if(!numbers.every(Number.isFinite)||t<=0||Math.min(...numbers.slice(1,5))<=0||numbers[5]<0||+row[2]<Math.max(+row[1],+row[4])||+row[3]>Math.min(+row[1],+row[4]))throw new Error('OHLCV OKX không hợp lệ');
    if(end<now&&row[8]!=='1')throw new Error('Nến OKX đã hết thời gian nhưng chưa được xác nhận');
    return [...row.slice(0,6),end,row[8]];
  }
  function candlesPath(symbol,tf,{limit=450,startTime,endTime}={},source=SOURCE){
    if(source!==SOURCE){const p=new URLSearchParams({symbol,interval:tf,limit:String(limit)});if(startTime!==undefined)p.set('startTime',startTime);if(endTime!==undefined)p.set('endTime',endTime);return binance.endpoint('klines',source)+'?'+p}
    if(!BARS[tf])throw new Error('Khung nến không được hỗ trợ');
    const p=new URLSearchParams({instId:instrument(symbol),bar:BARS[tf],limit:String(limit)});
    if(startTime!==undefined)p.set('before',String(startTime-1));if(endTime!==undefined)p.set('after',String(endTime+1));
    return '/api/v5/market/'+(startTime!==undefined||endTime!==undefined?'history-candles':'candles')+'?'+p;
  }
  function quotePath(symbol,source=SOURCE){return source===SOURCE?'/api/v5/market/ticker?instId='+instrument(symbol):binance.endpoint('quote',source)+'?symbol='+symbol}
  function quote(data,source=SOURCE,now=Date.now()){return binance.quote(data,source===SOURCE?binance.SOURCE:source,now)}
  function ticker(item){
    const s=symbol(item.instId),p=+item.last,o=+item.open24h,t=+item.ts;
    if(![p,o,t].every(Number.isFinite)||p<=0||o<=0||t<=0)throw new Error('Ticker OKX không hợp lệ');
    return {symbol:s,lastPrice:String(p),priceChangePercent:String((p-o)/o*100),closeTime:t};
  }
  async function bodyText(response){if(!response.body)return '';const reader=response.body.getReader(),parts=[];let n=0;try{while(n<8192){const {value,done}=await reader.read();if(done)break;const part=value.slice(0,8192-n);parts.push(part);n+=part.length}}finally{await reader.cancel().catch(()=>{})}const bytes=new Uint8Array(n);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length}return new TextDecoder().decode(bytes)}
  function failure(status,message,route,now,retry=0,code){
    message=String(message||'Không có thông điệp chi tiết').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,500);
    const category=status===451||/restricted (location|jurisdiction)|eligibility/i.test(message)?'ACCESS_RESTRICTED':status===403?'ACCESS_DENIED':status===429||['50011','50040'].includes(code)?'RATE_LIMIT':'UPSTREAM_ERROR';
    const minimum=category==='ACCESS_RESTRICTED'?3600000:category==='ACCESS_DENIED'?900000:category==='RATE_LIMIT'?60000:10000;
    const e=new Error(`OKX ${code?'API '+code:'HTTP '+status} · ${message}`);e.retryAfter=Math.max(minimum,retry);e.upstream={status,code,priceSource:SOURCE,category,message,route,checkedAt:now};return e;
  }
  async function request(path,{fetcher=fetch,now=Date.now,onRequest=()=>{},beforeRequest=async()=>{},source=SOURCE}={}){
    if(source!==SOURCE)return binance.request(path,{fetcher,now,onRequest,source});
    const url=new URL(path,BASE);
    if(url.origin!==BASE||!['/api/v5/market/candles','/api/v5/market/history-candles','/api/v5/market/ticker'].includes(url.pathname))throw new Error('Chỉ cho phép API dữ liệu Spot công khai');
    symbol(url.searchParams.get('instId'));
    async function get(u){
      await beforeRequest();onRequest();const r=await fetcher(u.href,{headers:{Accept:'application/json'},redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(8000)});
      if(!r.ok){let raw=await bodyText(r);try{raw=JSON.parse(raw).msg||raw}catch{}const h=r.headers.get('Retry-After'),retry=h?(/^\d+(?:\.\d+)?$/.test(h)?+h*1000:Math.max(0,Date.parse(h)-now())):0;throw failure(r.status,raw,u.pathname,now(),Number.isFinite(retry)?retry:0)}
      const data=await r.json();if(data.code!=='0'||!Array.isArray(data.data))throw failure(r.status,data.msg||'Phản hồi API không hợp lệ',u.pathname,now(),0,data.code||'INVALID_RESPONSE');return data.data;
    }
    if(url.pathname.endsWith('/ticker')){const data=await get(url);if(data.length!==1||data[0].instId!==url.searchParams.get('instId'))throw new Error('Ticker OKX sai cặp');return ticker(data[0])}
    const tf=timeframe(url.searchParams.get('bar')),wanted=+(url.searchParams.get('limit')||100);
    if(!Number.isSafeInteger(wanted)||wanted<1||wanted>1000)throw new Error('Số nến phải trong khoảng 1–1000');
    const lower=url.searchParams.has('before')?+url.searchParams.get('before'):-Infinity,upper=url.searchParams.has('after')?+url.searchParams.get('after'):Infinity,found=new Map();
    let cursor=upper;
    for(let page=0;page<5&&found.size<wanted;page++){
      const u=new URL(url),batch=Math.min(300,wanted-found.size);u.searchParams.set('limit',String(batch));if(Number.isFinite(cursor))u.searchParams.set('after',String(cursor));
      const rows=await get(u);if(!rows.length)break;
      let oldest=Infinity;
      for(const row of rows){const c=candle(row,tf,now()),t=+c[0];if(t>=cursor)throw new Error('Phân trang OKX không tiến về quá khứ');oldest=Math.min(oldest,t);if(t>lower&&t<upper)found.set(t,c)}
      if(oldest>=cursor)throw new Error('Phân trang OKX không tiến triển');cursor=oldest;
      if(rows.length<batch||oldest<=lower+1)break;
    }
    return [...found.values()].sort((a,b)=>+a[0]-+b[0]).slice(-wanted);
  }
  function klineMessage(payload,now=Date.now()){
    if(!payload.arg?.channel?.startsWith('candle')||!Array.isArray(payload.data))return [];
    const tf=timeframe(payload.arg.channel.slice(6)),s=symbol(payload.arg.instId);
    return payload.data.map(row=>{const c=candle(row,tf,now);return {s,k:{i:tf,t:+c[0],o:c[1],h:c[2],l:c[3],c:c[4],v:c[5],T:c[6],x:c[7]==='1'}}});
  }
  function tickerMessages(payload){if(payload.arg?.channel!=='tickers'||!Array.isArray(payload.data))return [];return payload.data.map(item=>{if(item.instId!==payload.arg.instId)throw new Error('Ticker sai subscription');const q=ticker(item);return {s:q.symbol,c:q.lastPrice,o:item.open24h,E:q.closeTime}})}
  return Object.freeze({SOURCE,BASE,WS_PUBLIC,WS_BUSINESS,BARS,instrument,symbol,timeframe,closeTime,candle,candlesPath,quotePath,quote,ticker,request,klineMessage,tickerMessages});
});
