const CACHE_NAME = 'snapmail-v2';
const ASSETS = ['/', '/index.html', '/manifest.json', '/sw.js'];
const GAS_URL = "https://script.google.com/macros/s/AKfycbxgqzjDRquoBW442aNbXuMvaFyKq7mqSqYDzSYzn2LE-MtzJQk25B_MrX73VEN_D4Tr/exec";

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(caches.keys().then(keys =>
        Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ));
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    e.respondWith(
        caches.match(e.request).then(cached => {
            if (cached) return cached;
            return fetch(e.request).catch(() => new Response('Offline', { status: 503 }));
        })
    );
});

self.addEventListener('sync', (e) => {
    if (e.tag === 'send-photos') e.waitUntil(processSendQueue());
});

async function openDB() {
    return new Promise((resolve, reject) => {
        const r = indexedDB.open("snapmail_db", 2);
        r.onsuccess = () => resolve(r.result);
        r.onerror   = () => reject(r.error);
        r.onupgradeneeded = (e) => {
            const d = e.target.result;
            if (!d.objectStoreNames.contains("send_queue"))
                d.createObjectStore("send_queue", { keyPath: "id" });
        };
    });
}

async function processSendQueue() {
    const db = await openDB();
    const items = await new Promise((res, rej) => {
        const req = db.transaction("send_queue","readonly").objectStore("send_queue").getAll();
        req.onsuccess = () => res(req.result);
        req.onerror   = () => rej(req.error);
    });
    for (const item of items) {
        try {
            await fetch(GAS_URL, { method: 'POST', mode: 'no-cors', body: item.payload });
            await new Promise((res, rej) => {
                const req = db.transaction("send_queue","readwrite").objectStore("send_queue").delete(item.id);
                req.onsuccess = res; req.onerror = rej;
            });
        } catch {
            await notify('SEND_ERROR'); return;
        }
    }
    await notify('SEND_COMPLETE');
}

async function notify(type) {
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    clients.forEach(c => c.postMessage({ type }));
}
