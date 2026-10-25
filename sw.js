const CACHE = 'lastcard-shell-v1';
const FILES = ['./','./index.html','./style.css','./app.js','./engine.js','./session.js','./config.js','./vendor/peerjs.min.js','./icon.svg','./manifest.webmanifest'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
// Wait for all existing game tabs to close before activating an update.
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('lastcard-shell-')&&k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin) return;
  // Do not cache other projects on the same GitHub Pages origin.
  const allowed = FILES.map(path=>new URL(path,self.registration.scope).href);
  if(!allowed.includes(url.href)) return;
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
});
