const CACHE='pokemon-watchlist-v1';
const SHELL=['./','./index.html','./styles.css','./app.js','./config.js','./manifest.webmanifest'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL))));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(u.origin===location.origin && !u.pathname.endsWith('/data.json')){
    e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
  }
});
