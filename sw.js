const CACHE='binance-signal-v3-2-7-auto-paper';
const ASSETS=['./','./index.html','./styles.css?v=327','./rsi-mtf.js?v=327','./paper-trading.js?v=327','./paper-ui.js?v=327','./app.js?v=327','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];

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
