const BOOK_CACHE='csharp-book-fb128987f7344617';
const appBase=new URL('./',self.location.href);
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const list=await fetch(new URL('offline.json',appBase),{cache:'no-store'});
  if(!list.ok) throw Error('Учебник не загрузился полностью');
  const cache=await caches.open(BOOK_CACHE);
  const files=await list.json();
  await cache.addAll(files.map(file=>new Request(new URL(file,appBase),{cache:'reload'})));
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys()) if(key.startsWith('csharp-book-') && key!==BOOK_CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==appBase.origin || !url.pathname.startsWith(appBase.pathname))return;
  const relative=url.pathname.slice(appBase.pathname.length);
  if(relative.startsWith('api/') || relative.startsWith('_'))return;
  event.respondWith((async()=>{
    const cache=await caches.open(BOOK_CACHE);
    const isShell=event.request.mode==='navigate' && (relative==='' || relative==='index.html');
    const cached=await cache.match(isShell?new URL('index.html',appBase):event.request);
    return cached || fetch(event.request);
  })());
});
