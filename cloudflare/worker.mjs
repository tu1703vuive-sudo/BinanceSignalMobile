import marketTransport from '../market-data.js';
import {CloudEngine} from './engine.mjs';
import {HybridEngine} from './hybrid-engine.mjs';
import {Store} from './store.mjs';
import {buildPushPayload} from '@block65/webcrypto-web-push';
const VERSION='3.8.0',MAX_BODY=2*1024*1024;
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
const hash=async s=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
async function equal(a,b){const [x,y]=await Promise.all([hash(a),hash(b)]);let diff=0;for(let i=0;i<x.length;i++)diff|=x.charCodeAt(i)^y.charCodeAt(i);return diff===0}
const singleton=env=>env.PAPER.get(env.PAPER.idFromName('paper-account-v1'));
export default {
  async fetch(request,env){
    const origin=request.headers.get('Origin'),allowed=(env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim());
    if(origin&&!allowed.includes(origin))return json({error:'Origin không được phép'},403);
    const cors=origin?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{};
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'86400'}});
    const path=new URL(request.url).pathname;
    if(request.method==='GET'&&path==='/health')return json({ok:true,version:VERSION,platform:'cloudflare',market:'spot',exchange:'okx',priceSource:marketTransport.SOURCE,executionMode:env.EXECUTION_MODE||'hybrid',executorConfigured:!!(env.EXECUTOR_URL&&env.EXECUTOR_TOKEN)},200,cors);
    if(!path.startsWith('/api/'))return json({error:'Signal Paper API · giao diện nằm trên GitHub Pages'},404,cors);
    if(!env.BOT_TOKEN||env.BOT_TOKEN.length<24)return json({error:'Chưa cài secrets; chạy npm run setup rồi npm run deploy'},503,cors);
    if(!await equal(request.headers.get('Authorization')||'','Bearer '+env.BOT_TOKEN))return json({error:'Mã kết nối không đúng'},401,cors);
    try{const r=await singleton(env).fetch(request);const headers=new Headers(r.headers);for(const [k,v] of Object.entries(cors))headers.set(k,v);return new Response(r.body,{status:r.status,headers})}catch{return json({error:'Cloudflare tạm không khả dụng hoặc đã chạm hạn mức; kiểm tra Dashboard'},503,cors)}
  },
  async scheduled(_event,env,ctx){if(env.BOT_TOKEN?.length>=24)ctx.waitUntil(singleton(env).fetch('https://internal/internal/watchdog',{method:'POST'}))}
};
export function subscription(input){
  const u=new URL(input?.endpoint),hosts=['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'];
  if(u.protocol!=='https:'||u.port&&u.port!=='443'||u.username||u.password||!(hosts.includes(u.hostname)||u.hostname.endsWith('.push.apple.com')||u.hostname.endsWith('.notify.windows.com')))throw new Error('Endpoint push không được hỗ trợ');
  const size=s=>{if(typeof s!=='string'||!/^[A-Za-z0-9_-]+={0,2}$/.test(s))return 0;return atob(s.replace(/-/g,'+').replace(/_/g,'/')).length};
  if(size(input.keys?.auth)!==16||size(input.keys?.p256dh)!==65)throw new Error('Khóa push không hợp lệ');
  return {endpoint:u.href,keys:{auth:input.keys.auth,p256dh:input.keys.p256dh}};
}
export class PaperAccount{
  constructor(ctx,env){this.ctx=ctx;this.env=env;this.store=new Store(ctx.storage);this.engine=env.EXECUTION_MODE==='cloudflare'?new CloudEngine(this.store):new HybridEngine(this.store,{url:env.EXECUTOR_URL,token:env.EXECUTOR_TOKEN,bypass:env.VERCEL_PROTECTION_BYPASS});this.queue=Promise.resolve();this.rate={minute:0,n:0}}
  exclusive(fn){const result=this.queue.then(fn);this.queue=result.catch(()=>{});return result}
  pushReady(){return !!(this.env.VAPID_PUBLIC_KEY&&this.env.VAPID_PRIVATE_KEY&&this.env.VAPID_SUBJECT)}
  async send(sub,payload,ttl=3600){
    if(!this.pushReady())throw new Error('Cloud chưa cài VAPID');
    this.store.count('pushAttempts');
    const details=await buildPushPayload({data:JSON.stringify(payload),options:{ttl} },sub,{subject:this.env.VAPID_SUBJECT,publicKey:this.env.VAPID_PUBLIC_KEY,privateKey:this.env.VAPID_PRIVATE_KEY});
    const r=await fetch(sub.endpoint,{...details,redirect:'manual',signal:AbortSignal.timeout(8000)});
    if(!r.ok){const e=new Error(`Push HTTP ${r.status}`);e.status=r.status;e.retryAfter=Math.max(0,Number(r.headers.get('Retry-After'))||0)*1000;throw e}
    if(r.body)await r.body.cancel();
  }
  async dispatch(){
    if(!this.pushReady())return;
    await Promise.all(this.store.pending().map(async row=>{
      const stored=this.store.query('SELECT json FROM subscriptions WHERE id=?',row.subscription_id)[0];
      if(!stored){this.store.query("UPDATE deliveries SET status='gone' WHERE id=?",row.id);return}
      try{await this.send(JSON.parse(stored.json),JSON.parse(row.payload));this.store.query("UPDATE deliveries SET status='sent' WHERE id=?",row.id)}
      catch(e){const expired=[404,410].includes(e.status);if(expired)this.store.query('DELETE FROM subscriptions WHERE id=?',row.subscription_id);const attempt=row.attempt+1;this.store.query('UPDATE deliveries SET attempt=?,status=?,next_at=? WHERE id=?',attempt,expired||attempt>=6?'failed':'pending',Date.now()+Math.max(e.retryAfter||0,Math.min(3600000,15000*2**attempt)),row.id)}
    }));
  }
  async schedule({force=false}={}){
    const now=Date.now(),a=this.engine.nextDue(),b=this.pushReady()?this.store.nextDelivery():null;
    const times=[a,b].filter(t=>t!==null),due=times.length?Math.max(now+1000,Math.min(...times)):null;
    const existing=await this.ctx.storage.getAlarm();
    if(due===null){if(existing!==null)await this.ctx.storage.deleteAlarm();return null}
    if(force||existing===null||due<existing||existing<now-120000)await this.ctx.storage.setAlarm(due);
    return await this.ctx.storage.getAlarm();
  }
  async snapshot(url){
    const snap={...this.engine.snapshot(),backendVersion:VERSION,marketDiagnostic:this.store.get('marketDiagnostic'),vapidPublicKey:this.env.VAPID_PUBLIC_KEY||null,pushReady:this.pushReady(),usage:{...this.store.usage,note:'Bộ đếm ứng dụng, không thay thế Cloudflare Billing'},nextAlarm:await this.ctx.storage.getAlarm()};
    const raw=url.searchParams.get('tradesSince');if(raw!==null){const n=Number(raw);if(Number.isSafeInteger(n)&&n>=0&&n<=snap.ledger.trades.length){snap.tradesOffset=n;snap.ledger.trades=snap.ledger.trades.slice(n)}}return snap;
  }
  async diagnoseMarket(){
    const now=Date.now(),last=this.store.get('marketDiagnostic'),rt=this.engine.runtime;
    if(this.engine instanceof HybridEngine&&!this.engine.client)return this.engine.diagnoseRemote();
    if(rt.health.upstream?.priceSource===marketTransport.SOURCE&&rt.retryAt>now){const report={ok:false,source:'OKX Spot · dữ liệu công khai',priceSource:marketTransport.SOURCE,at:rt.health.upstream.checkedAt||now,check:rt.health.upstream,detail:rt.health.detail,nextAllowedAt:rt.retryAt,cached:true,requestSent:false};this.store.put('marketDiagnostic',report);return report}
    if(this.engine.read().autoEnabled&&rt.health.state==='live'&&rt.bucket===Math.floor(now/900000)&&['1M','1d','4h','1h','15m'].every(tf=>rt.frames?.[tf]?.ready&&rt.frames[tf].healthy)){const report={ok:true,source:'OKX Spot · dữ liệu bot đã đồng bộ',priceSource:marketTransport.SOURCE,at:rt.health.lastSignalCheck,detail:'Bot đã lấy đủ 5 khung OKX trong chu kỳ hiện tại; không gửi thêm yêu cầu kiểm tra.',nextAllowedAt:now+60000,cached:true,requestSent:false};this.store.put('marketDiagnostic',report);return report}
    if(last&&now<last.nextAllowedAt)return {...last,cached:true,requestSent:false};
    if(this.engine instanceof HybridEngine){const report=await this.engine.diagnoseRemote();this.store.put('marketDiagnostic',report);return report}
    let report;
    try{
      const cs=await this.engine.fetchMarket(marketTransport.candlesPath('BTCUSDT','15m',{limit:2}));
      if(!Array.isArray(cs)||cs.length!==2||cs.some(c=>!Number.isFinite(+c[4])||+c[4]<=0))throw new Error('OKX trả nến không hợp lệ');
      report={ok:true,source:'OKX Spot · dữ liệu công khai',priceSource:marketTransport.SOURCE,at:now,requestSent:true,check:{status:200,route:'/api/v5/market/candles'},detail:'Cloudflare lấy được nến OKX BTC 15m. Bot vẫn phải kiểm tra đủ 5 khung và lệnh đang mở trước khi tiếp tục.',nextAllowedAt:now+60000};
      rt.frames=null;rt.bucket=null;if(!rt.health.upstream||rt.health.upstream.priceSource===marketTransport.SOURCE){rt.retryAt=0;rt.health={...rt.health,state:'starting',detail:'Đã lấy được nến Spot thử; đang chờ kiểm tra đủ dữ liệu bot',upstream:null,retryAt:0}}this.engine.saveRuntime();
    }catch(e){this.engine.recordFailure(e);report={ok:false,source:'OKX Spot · dữ liệu công khai',priceSource:marketTransport.SOURCE,at:e.upstream?.checkedAt||now,requestSent:true,check:e.upstream||{category:'CONNECTION_ERROR',message:String(e.message).slice(0,300)},detail:this.engine.runtime.health.detail,nextAllowedAt:this.engine.runtime.retryAt}}
    this.store.put('marketDiagnostic',report);return report;
  }
  fetch(request){return this.exclusive(async()=>{
    try{
      const url=new URL(request.url),path=url.pathname;
      if(path==='/internal/watchdog'){
        this.store.count('watchdogs');await this.schedule();this.store.cleanup();this.store.flushUsage();return json({ok:true});
      }
      const minute=Math.floor(Date.now()/60000);if(this.rate.minute!==minute)this.rate={minute,n:0};if(++this.rate.n>180)return json({error:'Quá nhiều yêu cầu; thử lại sau một phút'},429);
      this.store.count('apiRequests');
      if(request.method==='GET'&&path==='/api/state'){await this.schedule();this.store.flushUsage();return json(await this.snapshot(url))}
      if(request.method!=='POST')return json({error:'Không có API này'},404);
      const reader=request.body?.getReader();let total=0,parts=[];
      if(reader){while(true){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>MAX_BODY){await reader.cancel();throw new Error('Dữ liệu lớn hơn 2 MB')}parts.push(value)}}
      const bytes=new Uint8Array(total);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length}const data=total?JSON.parse(new TextDecoder().decode(bytes)):{};
      let result=null;
      switch(path){
        case '/api/auto':this.engine.auto(data.enabled);break;
        case '/api/monitor':this.engine.monitor(data.symbol);break;
        case '/api/config':this.engine.configure(data.config);break;
        case '/api/import':this.engine.importBook(data.ledger);break;
        case '/api/close':await this.engine.manualClose(data.id);break;
        case '/api/diagnostics/market':result=await this.diagnoseMarket();break;
        case '/api/push/subscribe':{if(!this.pushReady())throw new Error('Cloud chưa cài VAPID');const sub=subscription(data.subscription),id=await hash(sub.endpoint);this.store.subscribe(id,sub);result={ok:true};break}
        case '/api/push/test':{const sub=subscription(data.subscription);await this.send(sub,{id:'test-'+Date.now(),title:'Signal · Cloudflare 24/7',body:'Dịch vụ push đã nhận thông báo thử từ Cloudflare.',at:Date.now()},60);result={ok:true,detail:'Dịch vụ push đã nhận yêu cầu'};break}
        default:return json({error:'Không có API này'},404);
      }
      await this.schedule({force:true});this.store.flushUsage();return json(result||await this.snapshot(url));
    }catch(e){this.store.flushUsage();return json({error:String(e.message).slice(0,300)},400)}
  })}
  alarm(){return this.exclusive(async()=>{
    this.store.count('alarms');
    // Safety alarm survives a reset while downstream I/O is in flight.
    await this.ctx.storage.setAlarm(Date.now()+60000);
    try{await this.engine.tick();await this.dispatch()}
    finally{await this.schedule({force:true});this.store.flushUsage()}
  })}
}
