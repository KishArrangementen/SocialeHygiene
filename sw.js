const CACHE_NAME = "rustig-leren-v3";
const CORE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./questions.js",
  "./extra-questions.js",
  "./manifest.webmanifest",
  "./LEES-MIJ.txt"
];
const QUESTION_AUDIO = Array.from({ length: 170 }, (_, index) => {
  const id = String(index + 1).padStart(3, "0");
  return [`./audio/${id}-q.mp3`, `./audio/${id}-a.mp3`];
}).flat();
const SUMMARY_NAMES = [
  "01-basis-en-beleid",
  "02-omgaan-met-gasten",
  "03-regels-en-handhaving",
  "04-risicogedrag",
  "05-gespreksmodellen",
  "06-alcohol",
  "07-drugs",
  "08-tabak-en-gokken",
  "09-veiligheid-en-brand",
  "10-examenmix"
];
const SUMMARY_ASSETS = SUMMARY_NAMES.flatMap((name) => [
  `./audio/samenvattingen/${name}.mp3`,
  `./audio/samenvattingen/${name}.txt`
]);

async function cacheInBatches(cache, assets, size = 20) {
  for (let index = 0; index < assets.length; index += size) {
    const batch = assets.slice(index, index + size);
    await Promise.allSettled(batch.map(async (asset) => {
      const response = await fetch(asset, { cache: "reload" });
      if (response.ok) await cache.put(asset, response);
    }));
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cacheInBatches(cache, [...CORE, ...QUESTION_AUDIO, ...SUMMARY_ASSETS]);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok && new URL(event.request.url).origin === location.origin) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, response.clone());
      }
      return response;
    } catch {
      if (event.request.mode === "navigate") return caches.match("./index.html");
      throw new Error("Offline en bestand niet in cache");
    }
  })());
});
