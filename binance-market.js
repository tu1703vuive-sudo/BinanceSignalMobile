// Public Futures transport only. Never changes provider, market or access region.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BinanceMarket=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const BASE='https://fapi.binance.com';
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
  async function request(path,{fetcher=fetch,now=Date.now,onRequest=()=>{}}={}){
    if(!/^\/fapi\/v[12]\/(?:klines|ticker\/price|time)(?:\?|$)/.test(path))throw new Error('Chỉ cho phép endpoint dữ liệu công khai đã xác định');
    onRequest();
    const response=await fetcher(BASE+path,{headers:{Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(8000)});
    if(!response.ok){
      const raw=await boundedText(response);let message=raw;
      try{const data=JSON.parse(raw);message=typeof data.msg==='string'?data.msg:typeof data.message==='string'?data.message:raw}catch{}
      message=message.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,500);
      const type=classify(response.status,message),header=response.headers.get('retry-after');
      const retry=header?(/^\d+(?:\.\d+)?$/.test(header)?Number(header)*1000:Math.max(0,Date.parse(header)-now())):0;
      const e=new Error(`Binance HTTP ${response.status} · ${type.label}`);
      e.retryAfter=Math.max(type.minimum,Number.isFinite(retry)?retry:0);
      e.upstream={status:response.status,category:type.category,message:message||'Không có thông điệp chi tiết',route:path.split('?')[0],checkedAt:now()};
      throw e;
    }
    return response.json();
  }
  return Object.freeze({BASE,classify,request});
});
