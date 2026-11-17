'use strict';
const http=require('node:http'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),{Engine}=require('./engine.cjs');
function createService({engine,token,origins=[],vapid=null,pusher=null}={}){
 if(!token||token.length<24||token.includes('REPLACE_WITH'))throw new Error('BOT_TOKEN cần ít nhất 24 ký tự. Chạy npm run setup.');
 const allowed=new Set(origins),webpush=pusher||require('web-push');if(vapid)webpush.setVapidDetails(vapid.subject,vapid.publicKey,vapid.privateKey);
 const rate=new Map();let dispatching=false;
 const equal=(a,b)=>{const x=crypto.createHash('sha256').update(a).digest(),y=crypto.createHash('sha256').update(b).digest();return crypto.timingSafeEqual(x,y)};
 async function body(req){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>5e6)throw new Error('Dữ liệu quá lớn')}return text?JSON.parse(text):{}}
 function subscription(input){const u=new URL(input?.endpoint);const hosts=['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'];if(u.protocol!=='https:'||u.port&&u.port!=='443'||u.username||u.password||!(hosts.includes(u.hostname)||u.hostname.endsWith('.push.apple.com')||u.hostname.endsWith('.notify.windows.com')))throw new Error('Endpoint push không được hỗ trợ');if(Buffer.from(input.keys?.auth||'','base64url').length!==16||Buffer.from(input.keys?.p256dh||'','base64url').length!==65)throw new Error('Khóa push không hợp lệ');return {endpoint:u.href,keys:{auth:input.keys.auth,p256dh:input.keys.p256dh}}}
 const server=http.createServer(async(req,res)=>{
  const origin=req.headers.origin;if(origin&&!allowed.has(origin)){res.writeHead(403);res.end('Origin không được phép');return}
  if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin')}res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'});res.end();return}
  const url=new URL(req.url,'http://localhost');if(url.pathname==='/health'){res.end(JSON.stringify({ok:true,version:'3.3.0'}));return}
  const publicNames=new Set(['index.html','styles.css','app.js','sw.js','manifest.webmanifest','rsi-mtf.js','paper-trading.js','remote-paper.js','mobile-ui.js','paper-ui.js','icons/icon-192.png','icons/icon-512.png']);
  const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
  if(req.method==='GET'&&publicNames.has(file)){
   const mime=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':file.endsWith('.webmanifest')?'application/manifest+json':'text/html';
   try{const bytes=fs.readFileSync(path.join(__dirname,'..',file));res.setHeader('Content-Type',mime);res.end(bytes)}catch{res.writeHead(404);res.end('Not found')}return;
  }
  if(!equal(req.headers.authorization||'','Bearer '+token)){res.writeHead(401);res.end(JSON.stringify({error:'Mã kết nối không đúng'}));return}
  const key=req.socket.remoteAddress,now=Date.now(),bucket=rate.get(key)||{at:now,n:0};if(now-bucket.at>60000){bucket.at=now;bucket.n=0}bucket.n++;rate.set(key,bucket);if(bucket.n>180){res.writeHead(429);res.end(JSON.stringify({error:'Quá nhiều yêu cầu'}));return}
  if(rate.size>1000)for(const [k,v] of rate)if(now-v.at>60000)rate.delete(k);
  const snapshot=()=>{const snap={...engine.snapshot(),vapidPublicKey:vapid?.publicKey||null,pushReady:!!vapid};const after=url.searchParams.get('tradesSince');if(after!==null){const n=Number(after);if(Number.isSafeInteger(n)&&n>=0&&n<=snap.ledger.trades.length){snap.tradesOffset=n;snap.ledger.trades=snap.ledger.trades.slice(n)}}return snap};
  try{
   let result;if(req.method==='GET'&&url.pathname==='/api/state')result=snapshot();
   else if(req.method==='POST'){
    const data=await body(req);
    switch(url.pathname){
     case '/api/auto':engine.setAuto(data.enabled);result=snapshot();break;
     case '/api/monitor':engine.setSymbol(data.symbol);result=snapshot();break;
     case '/api/config':engine.configure(data.config);result=snapshot();break;
     case '/api/close':await engine.manualClose(data.id);result=snapshot();break;
     case '/api/import':engine.importBook(data.ledger);result=snapshot();break;
     case '/api/push/subscribe':{if(!vapid)throw new Error('Máy chủ chưa có cấu hình VAPID');const sub=subscription(data.subscription),id=crypto.createHash('sha256').update(sub.endpoint).digest('hex');engine.db.prepare('INSERT OR REPLACE INTO subscriptions VALUES(?,?)').run(id,JSON.stringify(sub));result={ok:true};break}
     case '/api/push/test':{const sub=subscription(data.subscription),payload={id:'test-'+Date.now(),title:'Signal · Thông báo 24/7',body:'Máy chủ đã gửi thông báo thử tới thiết bị này.',at:Date.now()};if(!vapid)throw new Error('Máy chủ chưa bật push');await webpush.sendNotification(sub,JSON.stringify(payload),{TTL:60});result={ok:true,detail:'Dịch vụ push đã nhận yêu cầu'};break}
     default:res.writeHead(404);res.end(JSON.stringify({error:'Không có API này'}));return;
    }
   }else{res.writeHead(404);res.end(JSON.stringify({error:'Không có API này'}));return}
   res.end(JSON.stringify(result));
  }catch(e){res.writeHead(400);res.end(JSON.stringify({error:String(e.message).slice(0,300)}))}
 });
 async function dispatch(){if(dispatching||!vapid)return;dispatching=true;try{
  const rows=engine.db.prepare("SELECT * FROM deliveries WHERE status='pending' AND next_at<=? LIMIT 20").all(Date.now());
  for(const row of rows){const stored=engine.db.prepare('SELECT json FROM subscriptions WHERE id=?').get(row.subscription_id);if(!stored){engine.db.prepare("UPDATE deliveries SET status='gone' WHERE id=?").run(row.id);continue}
   try{await webpush.sendNotification(JSON.parse(stored.json),row.payload,{TTL:3600,timeout:10000});engine.db.prepare("UPDATE deliveries SET status='sent' WHERE id=?").run(row.id)}
   catch(e){const status=e.statusCode;if(status===404||status===410)engine.db.prepare('DELETE FROM subscriptions WHERE id=?').run(row.subscription_id);const attempt=row.attempt+1;engine.db.prepare('UPDATE deliveries SET attempt=?,status=?,next_at=? WHERE id=?').run(attempt,attempt>=6||status===404||status===410?'failed':'pending',Date.now()+Math.min(3600000,15000*2**attempt),row.id)}
  }
 }finally{dispatching=false}}
 return {server,dispatch};
}
if(require.main===module){
 const dir=process.env.DATA_DIR||path.join(__dirname,'data');fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const stored=path.join(dir,'vapid.json');let vapid=fs.existsSync(stored)?JSON.parse(fs.readFileSync(stored,'utf8')):null;
 if(vapid)vapid.subject=process.env.VAPID_SUBJECT||'mailto:admin@example.com';
 const engine=new Engine({file:path.join(dir,'paper.sqlite')}),service=createService({engine,token:process.env.BOT_TOKEN,origins:(process.env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean),vapid});
 const timer=setInterval(()=>void engine.tick(),3000),pushTimer=setInterval(()=>void service.dispatch(),5000);void engine.tick();
 service.server.listen(Number(process.env.PORT||8787),process.env.HOST||'127.0.0.1',()=>console.log('Signal Paper server · listening on '+(process.env.PORT||8787)));
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{clearInterval(timer);clearInterval(pushTimer);service.server.close(()=>{engine.close();process.exit(0)})});
}
module.exports={createService};
