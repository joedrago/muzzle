#!/usr/bin/env node

import { createServer } from "node:http"
import { createReadStream, readdirSync, statSync, writeFileSync } from "node:fs"
import { basename, extname, join, resolve } from "node:path"

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff"])
const VIDEO_EXTS = new Set([".mp4", ".webm", ".ogg", ".mov", ".avi", ".mkv"])
const MEDIA_EXTS = new Set([...IMAGE_EXTS, ...VIDEO_EXTS])

const MIME_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".tiff": "image/tiff",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".ogg": "video/ogg",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".mkv": "video/x-matroska"
}

// Parse args: filter out flags, collect file paths
const rawArgs = process.argv.slice(2)
const writeMode = rawArgs.includes("-w")
const fileArgs = rawArgs.filter((a) => a !== "-w")

let files

if (fileArgs.length > 0) {
    files = fileArgs.map((f) => resolve(f))
} else {
    const cwd = process.cwd()
    files = readdirSync(cwd)
        .filter((f) => MEDIA_EXTS.has(extname(f).toLowerCase()))
        .sort()
        .map((f) => join(cwd, f))
}

if (files.length === 0) {
    console.error("No media files found. Pass files as arguments or run from a directory with images/videos.")
    process.exit(1)
}

// Build challenge JSON with bare filenames as relative URLs
const presets = files.map((f) => ({
    url: basename(f)
}))

// -w flag: write challenge.json to cwd and exit
if (writeMode) {
    const outPath = join(process.cwd(), "challenge.json")
    writeFileSync(outPath, JSON.stringify(presets, null, 2) + "\n")
    console.log(`Wrote ${outPath} (${presets.length} puzzle${presets.length !== 1 ? "s" : ""})`)
    process.exit(0)
}

// Build filename -> absolute path map for serving
const fileMap = new Map()
for (const f of files) {
    fileMap.set(basename(f), f)
}

const PORT = parseInt(process.env.PORT) || 8080

const server = createServer((req, res) => {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type")

    if (req.method === "OPTIONS") {
        res.writeHead(204)
        res.end()
        return
    }

    const url = new URL(req.url, `http://localhost:${PORT}`)

    if (url.pathname === "/challenge.json") {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify(presets, null, 2))
        return
    }

    // Serve files at root path (so relative URLs in challenge.json resolve)
    const filename = decodeURIComponent(url.pathname.slice(1))
    const filepath = fileMap.get(filename)
    if (filepath) {
        const ext = extname(filename).toLowerCase()
        const mime = MIME_TYPES[ext] || "application/octet-stream"
        const stat = statSync(filepath)

        res.writeHead(200, {
            "Content-Type": mime,
            "Content-Length": stat.size
        })
        createReadStream(filepath).pipe(res)
        return
    }

    res.writeHead(404)
    res.end("Not found")
})

server.listen(PORT, () => {
    console.log(`Challenge server running on http://localhost:${PORT}`)
    console.log(`Serving ${files.length} file(s):`)
    for (const f of files) {
        console.log(`  - ${basename(f)}`)
    }
    const base = `?c=http://localhost:${PORT}/challenge.json`
    console.log()
    console.log(`Add this to a Muzzle URL to play:`)
    console.log(`  ${base}`)
    console.log()
    console.log(`Examples with options:`)
    console.log(`  ${base}&r=0        (no rotation)`)
    console.log(`  ${base}&ps=4       (large pieces)`)
    console.log(`  ${base}&ps=18&r=0  (tiny pieces, no rotation)`)
})
