(function(root){'use strict';const KEY='bsm_remote_paper_v1';root.RemotePaper={create(callback){
 let cfg=null,state=null,connected=false,error='',timer=null,busy=false,seq=0,lastTrade=null,lastOpen=null,pushRegistered=false,lastPushTry=0;try{cfg=JSON.parse(localStorage.getItem(KEY)||'null')}catch{}
 const configured=()=>!!(cfg?.url&&cfg?.token);
 function normalize(url){const u=new URL(url);if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))throw new Error('Máy chủ phải dùng HTTPS');if(u.username||u.password||u.search||u.hash)throw new Error('URL máy chủ không chứa tài khoản hoặc tham số');return u.href.replace(/\/$/,'')}
 async function request(path,body,target=cfg){if(!target)throw new Error('Chưa kết nối máy chủ');const r=await fetch(target.url+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+target.token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.timeout(10000)});let data;try{data=await r.json()}catch{throw new Error('Máy chủ trả dữ liệu không hợp lệ')}if(!r.ok)throw new Error(data.error||`HTTP ${r.status}`);return data}
 function apply(next){
  if(state&&next.ledger.revision<state.ledger.revision)return;
  if(next.tradesOffset!=null&&state){if(next.tradesOffset!==state.ledger.trades.length)throw new Error('Lịch sử máy chủ cần đồng bộ lại');next.ledger.trades=[...state.ledger.trades,...next.ledger.trades]}
  const previous=state;state=next;connected=true;error='';
  if(previous){const closed=next.ledger.trades.at(-1);if(closed&&closed.id!==lastTrade)callback.event?.({type:'CLOSE',trade:closed});const t=next.ledger.open;if(t&&t.id!==lastOpen)callback.event?.({type:'OPEN',trade:t})}
  lastOpen=next.ledger.open?.id||null;lastTrade=next.ledger.trades.at(-1)?.id||null;callback.update?.();
 }
 const pollDelay=()=>state?.platform==='cloudflare'?10000:3000;
 function scheduleRefresh(){clearTimeout(timer);if(configured()&&document.visibilityState!=='hidden')timer=setTimeout(()=>void refresh(),pollDelay())}
 async function refresh(){if(!configured()||busy)return;busy=true;const generation=seq;clearTimeout(timer);try{const n=await request('/api/state'+(state?'?tradesSince='+state.ledger.trades.length:''));if(generation===seq){apply(n);if(!pushRegistered)void autoPush()}}catch(e){if(generation===seq){connected=false;error=e.message;callback.update?.()}}finally{busy=false;if(generation===seq)scheduleRefresh()}}
 async function connect(url,token){const target={url:normalize(url),token:token.trim()};if(target.token.length<24)throw new Error('Mã kết nối quá ngắn');const next=await request('/api/state',null,target);if(!next.ledger||typeof next.autoEnabled!=='boolean')throw new Error('Đây không phải máy chủ Signal Paper');clearTimeout(timer);seq++;cfg=target;state=null;pushRegistered=false;lastPushTry=0;localStorage.setItem(KEY,JSON.stringify(cfg));apply(next);void autoPush();scheduleRefresh();return next}
 async function action(path,body){if(!connected)throw new Error('Máy chủ chưa kết nối; không thay đổi sổ lệnh');const next=await request(path,body);apply(next);return next}
 function bytes(s){const binary=atob(s.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(binary,c=>c.charCodeAt(0))}
 async function push({test=false,ask=true}={}){
  if(!configured()||!connected||!state?.pushReady)throw new Error('Kết nối máy chủ có hỗ trợ push trước');
  if(!('Notification'in root)||!navigator.serviceWorker||!('PushManager'in root))throw new Error('Thiết bị chưa hỗ trợ Web Push. iPhone: thêm website ra Màn hình chính rồi mở từ biểu tượng đó.');
  let permission=Notification.permission;if(permission!=='granted'&&ask)permission=await Notification.requestPermission();if(permission!=='granted')throw new Error('Cần cấp quyền nhận thông báo một lần');
  const reg=await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Service worker chưa sẵn sàng; tải lại app')),10000))]);
  let subscription=await reg.pushManager.getSubscription();if(!subscription)subscription=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes(state.vapidPublicKey)});
  await request('/api/push/subscribe',{subscription:subscription.toJSON()});
  if(test)await request('/api/push/test',{subscription:subscription.toJSON()});pushRegistered=true;callback.pushReady?.();return subscription;
 }
 async function autoPush(){if(Date.now()-lastPushTry<60000)return;if('Notification'in root&&Notification.permission==='granted'){lastPushTry=Date.now();try{await push({ask:false})}catch{}}}
 async function disconnect(){if(state?.ledger.open)throw new Error('Máy chủ đang có lệnh. Tắt tự mở mới hoặc đóng lệnh trước khi chuyển về trình duyệt.');await action('/api/auto',{enabled:false});clearTimeout(timer);seq++;cfg=null;state=null;connected=false;localStorage.removeItem(KEY);callback.update?.()}
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')clearTimeout(timer);else if(configured())void refresh()});
 if(configured())setTimeout(()=>{void refresh();void autoPush()},0);
 return {configured,view:()=>({state,connected,error,cfg}),connect,refresh,action,disconnect,push,diagnoseMarket:()=>request('/api/diagnostics/market',{})};
}}})(globalThis);
