const CACHE_NAME = "muzzle-v3"

const STATIC_ASSETS = [
    "./",
    "./index.html",
    "./style.css",
    "./js/main.js",
    "./js/math-utils.js",
    "./js/puzzle.js",
    "./js/piece.js",
    "./js/renderer.js",
    "./js/input.js",
    "./js/media.js",
    "./js/state.js",
    "./js/ui.js",
    "./lib/earcut.js",
    "./manifest.json"
]

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches
            .open(CACHE_NAME)
            .then((cache) => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    )
})

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    )
})

self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url)

    // Network-only for external resources (puzzle images/videos)
    if (url.origin !== self.location.origin) return

    // Network-first: try network, fall back to cache (for offline)
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                const clone = response.clone()
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
                return response
            })
            .catch(() => caches.match(event.request))
    )
})
