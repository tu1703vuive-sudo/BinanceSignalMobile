// Public Spot data by default. Legacy Futures positions retain their original data source.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BinanceMarket=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const SOURCE='binance-spot-public',LEGACY_SOURCE='binance-futures',BASE='https://data-api.binance.vision';
  function endpoint(name,source=SOURCE){
    if(![SOURCE,LEGACY_SOURCE].includes(source)||!['klines','quote'].includes(name))throw new Error('Nguồn hoặc endpoint không được hỗ trợ');
    return source===SOURCE?(name==='klines'?'/api/v3/klines':'/api/v3/ticker/24hr'):(name==='klines'?'/fapi/v1/klines':'/fapi/v1/ticker/price');
  }
  function quote(data,source=SOURCE,now=Date.now()){
    const price=+(source===SOURCE?data.lastPrice:data.price),time=+(source===SOURCE?data.closeTime:data.time);
    if(!Number.isFinite(price)||price<=0||!Number.isFinite(time)||now-time>10000||time-now>5000)throw new Error('Giá không hợp lệ hoặc đã cũ');
    return {price,time};
  }
  async function boundedText(response){
    if(!response.body)return '';
    const reader=response.body.getReader(),parts=[];let size=0;
    try{while(size<8192){const {value,done}=await reader.read();if(done)break;const part=value.slice(0,8192-size);parts.push(part);size+=part.length}}finally{await reader.cancel().catch(()=>{})}
    const out=new Uint8Array(size);let at=0;for(const p of parts){out.set(p,at);at+=p.length}return new TextDecoder().decode(out);
  }
  function classify(status,message){
    if(status===451||/restricted location|restricted jurisdiction|eligibility|country.{0,25}not supported/i.test(message))return {category:'ACCESS_RESTRICTED',label:'Binance từ chối theo điều kiện truy cập; chưa thể lấy dữ liệu',minimum:3600000};
    if(status===403)return {category:'WAF_BLOCK',label:'Binance WAF từ chối kết nối dữ liệu',minimum:900000};
    if(status===418)return {category:'IP_BANNED',label:'Binance đang tạm khóa IP truy cập API',minimum:900000};
    if(status===429)return {category:'RATE_LIMIT',label:'Binance yêu cầu giảm tần suất gọi API',minimum:60000};
    return {category:'UPSTREAM_HTTP',label:'Binance chưa trả dữ liệu hợp lệ',minimum:10000};
  }
  async function request(path,{fetcher=fetch,now=Date.now,onRequest=()=>{},source=SOURCE}={}){
    const allowed=source===SOURCE?/^\/api\/v3\/(?:klines|ticker\/24hr|time)(?:\?|$)/:source===LEGACY_SOURCE?/^\/fapi\/v1\/(?:klines|ticker\/price|time)(?:\?|$)/:null;
    if(!allowed?.test(path))throw new Error('Chỉ cho phép endpoint dữ liệu công khai đúng nguồn đã xác định');
    onRequest();
    const base=source===SOURCE?BASE:'https://fapi.binance.com';
    const response=await fetcher(base+path,{headers:{Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(8000)});
    if(!response.ok){
      const raw=await boundedText(response);let message=raw;
      try{const data=JSON.parse(raw);message=typeof data.msg==='string'?data.msg:typeof data.message==='string'?data.message:raw}catch{}
      message=message.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,500);
      const type=classify(response.status,message),header=response.headers.get('retry-after');
      const retry=header?(/^\d+(?:\.\d+)?$/.test(header)?Number(header)*1000:Math.max(0,Date.parse(header)-now())):0;
      const e=new Error(`Binance HTTP ${response.status} · ${type.label}`);
      e.retryAfter=Math.max(type.minimum,Number.isFinite(retry)?retry:0);
      e.upstream={status:response.status,priceSource:source,category:type.category,message:message||'Không có thông điệp chi tiết',route:path.split('?')[0],checkedAt:now()};
      throw e;
    }
    return response.json();
  }
  return Object.freeze({BASE,SOURCE,LEGACY_SOURCE,endpoint,quote,classify,request});
});
