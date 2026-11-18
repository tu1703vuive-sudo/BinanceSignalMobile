const CACHE='binance-signal-v3-10-0-futures';
const ASSETS=['./','./index.html','./styles.css?v=3100','./futures-market.js?v=3100','./workspace-view.js?v=3100','./rsi-mtf.js?v=3100','./mobile-ui.js?v=3100','./app.js?v=3100','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];

self.addEventListener('install',e=>e.waitUntil(
  caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())
));

self.addEventListener('activate',e=>e.waitUntil(Promise.all([
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('binance-signal-')&&k!==CACHE).map(k=>caches.delete(k)))),
  self.registration.pushManager?.getSubscription().then(sub=>sub?.unsubscribe()).catch(()=>{})
]).then(()=>self.clients.claim())));

self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const u=new URL(e.request.url);
  if(u.origin!==location.origin||u.pathname.includes('/api/'))return;

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

// Old push deliveries are ignored after this read-only version takes control.
self.addEventListener('push',e=>e.waitUntil(Promise.resolve()));
