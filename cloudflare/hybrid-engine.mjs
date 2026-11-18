import {CloudEngine,notification} from './engine.mjs';
import core from '../paper-trading.js';
import {PROTOCOL,VERSION,MAX_BYTES,makeJob,validateResult} from '../hybrid-protocol.mjs';

export function executorUrl(value){
  let u;try{u=new URL(value)}catch{throw new Error('URL Production Vercel không hợp lệ')}
  if(u.protocol!=='https:'||!u.hostname.endsWith('.vercel.app')||u.username||u.password||u.port||u.search||u.hash||!['/','/api/run'].includes(u.pathname))throw new Error('Dùng URL Production HTTPS *.vercel.app, không kèm query hoặc thông tin đăng nhập');
  u.pathname='/api/run';return u.href;
}
async function jsonLimited(response){
  const reader=response.body?.getReader();if(!reader)throw new Error('Vercel không trả nội dung');
  const parts=[];let bytes=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>MAX_BYTES)throw new Error('Phản hồi Vercel quá lớn');parts.push(value)}}finally{await reader.cancel().catch(()=>{})}
  const body=new Uint8Array(bytes);let at=0;for(const part of parts){body.set(part,at);at+=part.length}
  try{return JSON.parse(new TextDecoder().decode(body))}catch{throw new Error('Vercel chưa trả API JSON; kiểm tra URL Production và Deployment Protection')}
}
export class ExecutorClient{
  constructor({url,token,fetcher=fetch,bypass}={}){
    this.url=executorUrl(url);if(typeof token!=='string'||token.length<32)throw new Error('Thiếu EXECUTOR_TOKEN khớp với Vercel');
    this.token=token;this.fetcher=(url,options)=>fetcher(url,options);this.bypass=bypass;
  }
  async run(job){
    const body=JSON.stringify(job);if(new TextEncoder().encode(body).length>MAX_BYTES)throw new Error('Tác vụ quá lớn để chuyển sang Vercel');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),55000);
    try{
      const response=await this.fetcher(this.url,{method:'POST',headers:{Authorization:'Bearer '+this.token,'Content-Type':'application/json',...(this.bypass?{'x-vercel-protection-bypass':this.bypass}:{})},body,redirect:'manual',signal:controller.signal});
      if(!response.ok){
        if(response.body)await response.body.cancel().catch(()=>{});
        const e=new Error(response.status===401||response.status===403?'Vercel từ chối xác thực; kiểm tra EXECUTOR_TOKEN và Deployment Protection':`Vercel HTTP ${response.status}; bot giữ sổ và không chuyển sang xử lý cục bộ`);
        const header=response.headers.get('Retry-After'),retry=header?(/^\d+(?:\.\d+)?$/.test(header)?Number(header)*1000:Date.parse(header)-Date.now()):0;e.retryAfter=Math.max(60000,Number.isFinite(retry)?retry:0);throw e;
      }
      return await jsonLimited(response);
    }finally{clearTimeout(timer)}
  }
}
export class HybridEngine extends CloudEngine{
  constructor(store,{url,token,bypass,client,now=Date.now,fetcher=fetch}={}){
    super(store,{now});this.client=null;this.configError='';
    try{this.client=client||new ExecutorClient({url,token,bypass,fetcher})}catch(e){this.configError=e.message}
    const rt=this.runtime;
    if(!this.client){rt.health={...rt.health,state:'error',detail:'Chưa kết nối Vercel: '+this.configError};rt.executor={configured:false,connected:false,lastSuccessAt:0};this.saveRuntime()}
    else if(rt.executorEndpoint!==this.client.url){
      rt.executorEndpoint=this.client.url;rt.frames=null;rt.bucket=null;rt.executor={configured:true,connected:false,lastSuccessAt:0};
      this.store.put('marketDiagnostic',null);
      if(!(rt.retryAt>now()))rt.health={...rt.health,state:'starting',detail:'Đang chờ Vercel kiểm tra dữ liệu OKX'};
      this.saveRuntime();
    }
  }
  snapshot(){return {...super.snapshot(),executionMode:'hybrid',executor:{configured:!!this.client,connected:this.runtime.executor?.connected===true,version:this.runtime.executor?.version||null,lastSuccessAt:this.runtime.executor?.lastSuccessAt||0,lastError:this.runtime.executor?.lastError||null}}}
  async fetchMarket(){throw new Error('Chế độ kết hợp chỉ lấy dữ liệu thị trường qua Vercel')}
  nextDue(){return this.client?super.nextDue():null}
  async perform(action,tradeId){
    if(!this.client){if(action==='close')throw new Error(this.runtime.health.detail);return null}
    const job=makeJob(this.read(),this.runtime,action,{id:crypto.randomUUID(),now:this.now(),pacing:this.store.get('marketPacing'),tradeId});
    try{
      this.store.count('executorRequests');const result=await this.client.run(job);
      const accepted=validateResult(job,result,this.read(),this.now()),rt={...accepted.runtime,executorEndpoint:this.client.url,executor:{configured:true,connected:true,version:result.executorVersion,lastSuccessAt:this.now(),lastError:null}};
      if(rt.health.state==='live')rt.health={...rt.health,detail:'Vercel xử lý · Cloudflare giữ sổ · OKX Spot · SL/TP nến đóng 1 phút'};
      this.store.atomic(()=>{
        if(result.journal.length)this.store.put('account',accepted.account);
        this.store.put('runtime',rt);if(accepted.pacing)this.store.put('marketPacing',accepted.pacing);
        for(const event of accepted.events)this.store.enqueue(notification(event,this.now()));
      });
      this.runtime=rt;this.store.count('marketRequests',accepted.marketRequests);return accepted;
    }catch(e){
      e.retryAfter=Math.max(60000,e.retryAfter||0);e.upstream={priceSource:core.PRICE_SOURCE,category:'EXECUTOR_ERROR',message:String(e.message).slice(0,300),checkedAt:this.now()};
      this.recordFailure(e);this.runtime.executor={configured:true,connected:false,version:VERSION,lastSuccessAt:this.runtime.executor?.lastSuccessAt||0,lastError:String(e.message).slice(0,240)};this.saveRuntime();return null;
    }
  }
  async tick(){const s=this.read();if(!s.autoEnabled&&!s.ledger.open||this.now()<this.runtime.retryAt)return;await this.perform('tick')}
  async manualClose(id){
    if(this.read().ledger.open?.id!==id)throw new Error('Không có lệnh mở tương ứng');
    if(this.runtime.retryAt>this.now())throw this.cooldownError();
    const result=await this.perform('close',id);if(!result||this.runtime.health.state==='error')throw new Error(this.runtime.health.detail);
  }
  async diagnoseRemote(){
    if(!this.client)return {ok:false,priceSource:core.PRICE_SOURCE,source:'Vercel executor',at:this.now(),requestSent:false,detail:this.runtime.health.detail,check:{category:'EXECUTOR_CONFIGURATION',message:this.configError},nextAllowedAt:this.now()+60000};
    const accepted=await this.perform('diagnose');if(accepted)return accepted.diagnostic;
    return {ok:false,priceSource:core.PRICE_SOURCE,source:'Vercel executor',at:this.now(),detail:this.runtime.health.detail,check:this.runtime.health.upstream,nextAllowedAt:this.runtime.retryAt||this.now()+60000};
  }
}
