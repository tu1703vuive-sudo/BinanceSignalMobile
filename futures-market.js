// Public Binance USDⓈ-M Futures market data. No account keys or order endpoints.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MarketData=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const SOURCE='binance-futures',BASE='https://fapi.binance.com',WS_BASE='wss://fstream.binance.com/market/stream';
  const FRAMES=Object.freeze(['15m','1h','4h','12h','1d','1w','1M']);
  const STEPS={'15m':900000,'1h':3600000,'4h':14400000,'12h':43200000,'1d':86400000,'1w':604800000};
  let blockedUntil=0,blockedError=null;
  function symbol(value){if(typeof value!=='string'||!/^([A-Z0-9]{1,30})USDT$/.test(value))throw new Error('Chỉ hỗ trợ mã Binance Futures USDT');return value}
  function closeTime(t,tf){if(tf==='1M'){const d=new Date(t);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)-1}if(!STEPS[tf])throw new Error('Khung nến không được hỗ trợ');return t+STEPS[tf]-1}
  function candlesPath(s,tf,{limit=450}={}){
    symbol(s);if(!FRAMES.includes(tf)||!Number.isInteger(limit)||limit<1||limit>1500)throw new Error('Khung hoặc số nến không hợp lệ');
    return '/fapi/v1/klines?'+new URLSearchParams({symbol:s,interval:tf,limit:String(limit)});
  }
  function quotePath(s){return '/fapi/v1/ticker/24hr?symbol='+symbol(s)}
  function streamsUrl(streams){
    if(!Array.isArray(streams)||!streams.length||streams.length>200)throw new Error('Danh sách stream không hợp lệ');
    for(const stream of streams){
      const [s,channel,...extra]=String(stream).split('@');symbol(s.toUpperCase());
      if(s!==s.toLowerCase()||extra.length||!(channel==='ticker'||channel?.startsWith('kline_')&&FRAMES.includes(channel.slice(6))))throw new Error('Chỉ hỗ trợ stream ticker/nến Futures');
    }
    return WS_BASE+'?streams='+[...new Set(streams)].join('/');
  }
  function validateCandle(row,tf){
    if(!Array.isArray(row)||row.length<7)throw new Error('Binance trả nến không hợp lệ');
    const [t,o,h,l,c,v,end]=row.slice(0,7).map(Number);
    if(![t,o,h,l,c,v,end].every(Number.isFinite)||t<=0||Math.min(o,h,l,c)<=0||v<0||h<Math.max(o,c,l)||l>Math.min(o,c,h)||end!==closeTime(t,tf))throw new Error('OHLCV Binance Futures không hợp lệ');
    return row;
  }
  function ticker(item,s){
    if(!item||item.symbol!==s||!Number.isFinite(+item.lastPrice)||+item.lastPrice<=0||!Number.isFinite(+item.priceChangePercent))throw new Error('Ticker Binance Futures sai mã hoặc không hợp lệ');
    return item;
  }
  async function textLimited(response){
    if(!response.body)return '';
    const reader=response.body.getReader(),parts=[];let size=0;
    try{while(size<4096){const {done,value}=await reader.read();if(done)break;const part=value.slice(0,4096-size);parts.push(part);size+=part.length}}finally{await reader.cancel().catch(()=>{})}
    const out=new Uint8Array(size);let at=0;for(const part of parts){out.set(part,at);at+=part.length}return new TextDecoder().decode(out);
  }
  function failure(status,message,now,retry=0){
    const category=status===451?'ACCESS_RESTRICTED':status===403?'WAF_BLOCK':status===418?'IP_BANNED':status===429?'RATE_LIMIT':'UPSTREAM_ERROR';
    const minimum=status===451?3600000:[403,418].includes(status)?900000:status===429?60000:10000;
    const label={ACCESS_RESTRICTED:'Binance từ chối theo điều kiện truy cập',WAF_BLOCK:'Binance WAF từ chối kết nối',IP_BANNED:'Binance tạm khóa IP API',RATE_LIMIT:'Binance yêu cầu giảm tần suất gọi API',UPSTREAM_ERROR:'Binance chưa trả dữ liệu hợp lệ'}[category];
    const e=new Error(`Binance Futures HTTP ${status} · ${label}`);e.retryAt=now+Math.max(minimum,retry);e.category=category;e.detail=String(message||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,300);return e;
  }
  async function request(path,{fetcher=fetch,now=Date.now}={}){
    const url=new URL(path,BASE);
    if(!path.startsWith('/fapi/v1/')||url.origin!==BASE||!['/fapi/v1/klines','/fapi/v1/ticker/24hr'].includes(url.pathname)||url.username||url.password||url.hash)throw new Error('Chỉ cho phép API dữ liệu Binance Futures công khai');
    const s=symbol(url.searchParams.get('symbol'));
    const isCandle=url.pathname.endsWith('/klines'),tf=url.searchParams.get('interval');
    const keys=isCandle?['symbol','interval','limit']:['symbol'];
    for(const key of url.searchParams.keys())if(!keys.includes(key)||url.searchParams.getAll(key).length!==1)throw new Error('Tham số API không hợp lệ');
    if(isCandle)candlesPath(s,tf,{limit:Number(url.searchParams.get('limit'))});
    if(now()<blockedUntil){const e=new Error(blockedError.message+' · chờ đến '+new Date(blockedUntil).toLocaleTimeString('vi-VN'));e.retryAt=blockedUntil;e.category=blockedError.category;throw e}
    const response=await fetcher(url.href,{method:'GET',headers:{Accept:'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});
    if(!response.ok){
      const raw=await textLimited(response),h=response.headers.get('Retry-After');
      const retry=h?(/^\d+(?:\.\d+)?$/.test(h)?Number(h)*1000:Math.max(0,Date.parse(h)-now())):0;
      const e=failure(response.status,raw,now(),Number.isFinite(retry)?retry:0);
      blockedUntil=e.retryAt;blockedError=e;throw e;
    }
    const data=await response.json();
    if(isCandle){if(!Array.isArray(data)||!data.length)throw new Error('Binance chưa có dữ liệu nến');return data.map(row=>validateCandle(row,tf))}
    return ticker(data,s);
  }
  function payload(value){return value?.data??value}
  function klineMessage(value){
    const d=payload(value);if(d?.e!=='kline'||d.st===2||!d.k)return [];
    symbol(d.s);const k=d.k;if(k.s!==d.s||!FRAMES.includes(k.i)||typeof k.x!=='boolean')throw new Error('Stream nến sai mã hoặc khung');
    validateCandle([k.t,k.o,k.h,k.l,k.c,k.v,k.T],k.i);return [d];
  }
  function tickerMessages(value){
    const raw=payload(value),items=Array.isArray(raw)?raw:[raw];
    return items.filter(d=>d?.e==='24hrTicker'&&d.st!==2).map(d=>{symbol(d.s);if(![+d.c,+d.P,+d.E].every(Number.isFinite)||+d.c<=0||+d.E<=0)throw new Error('Stream ticker không hợp lệ');return d});
  }
  return Object.freeze({SOURCE,BASE,WS_BASE,FRAMES,symbol,closeTime,candlesPath,quotePath,streamsUrl,request,klineMessage,tickerMessages});
});
