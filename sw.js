const CACHE='binance-signal-v3-5-0-v41-btc';
const ASSETS=['./','./index.html','./styles.css?v=350','./rsi-mtf.js?v=350','./paper-trading.js?v=350','./remote-paper.js?v=350','./paper-ui.js?v=350','./mobile-ui.js?v=350','./app.js?v=350','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];

self.addEventListener('install',e=>e.waitUntil(
  caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())
));

self.addEventListener('activate',e=>e.waitUntil(
  caches.keys()
    .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim())
));

self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const u=new URL(e.request.url);
  if(u.origin!==location.origin)return;

  if(e.request.mode==='navigate'){
    e.respondWith(
      fetch(e.request)
        .then(r=>{
          if(r.ok){
            const c=r.clone();
            caches.open(CACHE).then(x=>x.put('./index.html',c));
          }
          return r;
        })
        .catch(()=>caches.match('./index.html'))
    );
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then(r=>{
        if(r.ok){
          const c=r.clone();
          caches.open(CACHE).then(x=>x.put(e.request,c));
        }
        return r;
      })
      .catch(()=>caches.match(e.request))
  );
});

self.addEventListener('notificationclick',e=>{
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows=>{
    const url=new URL('./',self.registration.scope).href;
    const client=windows.find(c=>c.url.startsWith(self.registration.scope));
    if(client)return client.focus();
    return self.clients.openWindow(url);
  }));
});

self.addEventListener('push',e=>{
  let data={};try{data=e.data?.json()||{}}catch{}
  const title=typeof data.title==='string'?data.title.slice(0,150):'Signal · Paper Trading';
  const body=typeof data.body==='string'?data.body.slice(0,600):'Có cập nhật mới từ bot giả lập.';
  e.waitUntil(self.registration.showNotification(title,{body,tag:typeof data.id==='string'?data.id:'signal-paper',icon:'./icons/icon-192.png',badge:'./icons/icon-192.png',data:{at:data.at||Date.now()}}));
});
