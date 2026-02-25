#!/usr/bin/env node

import { createServer } from "node:http"
import { createReadStream, readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { basename, extname, join, resolve } from "node:path"

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff"])
const VIDEO_EXTS = new Set([".mp4", ".webm", ".ogg", ".mov", ".avi", ".mkv"])
const GIF_EXT = ".gif"
const MEDIA_EXTS = new Set([...IMAGE_EXTS, ...VIDEO_EXTS, GIF_EXT])

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

const THUMB_DIR = "muzzlethumbs"
const THUMB_WIDTH = 200
const THUMB_HEIGHT = 150

// Parse args: filter out flags, collect file paths
const rawArgs = process.argv.slice(2)
const writeMode = rawArgs.includes("-w")
const thumbMode = rawArgs.includes("-t")
const fileArgs = rawArgs.filter((a) => a !== "-w" && a !== "-t")

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

// Convert GIFs to silent looping MP4s in muzzlevideos/
const VIDEO_DIR = "muzzlevideos"
const hasGifs = files.some((f) => extname(f).toLowerCase() === GIF_EXT)
if (hasGifs) {
    const videoDir = join(process.cwd(), VIDEO_DIR)
    mkdirSync(videoDir, { recursive: true })

    files = files.map((f) => {
        if (extname(f).toLowerCase() !== GIF_EXT) return f
        const stem = basename(f, extname(f))
        const out = join(videoDir, stem + ".mp4")

        if (existsSync(out)) {
            console.log(`  skipping ${basename(f)} (mp4 exists)`)
            return out
        }

        try {
            execFileSync(
                "ffmpeg",
                [
                    "-i",
                    f,
                    "-movflags",
                    "faststart",
                    "-pix_fmt",
                    "yuv420p",
                    "-vf",
                    "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                    "-an",
                    "-y",
                    out
                ],
                { stdio: "pipe" }
            )
            console.log(`  ${basename(f)} -> ${VIDEO_DIR}/${stem}.mp4`)
        } catch (e) {
            console.error(`  FAILED: ${basename(f)} — ${e.stderr?.toString().trim().split("\n").pop()}`)
            return f
        }
        return out
    })
}

// -t flag: generate thumbnails
if (thumbMode) {
    const thumbDir = join(process.cwd(), THUMB_DIR)
    mkdirSync(thumbDir, { recursive: true })

    const scale = `scale=${THUMB_WIDTH}:${THUMB_HEIGHT}:force_original_aspect_ratio=decrease`

    for (const f of files) {
        const stem = basename(f, extname(f))
        const out = join(thumbDir, stem + ".png")

        if (existsSync(out)) {
            console.log(`  skipping ${basename(f)} (thumb exists)`)
            continue
        }

        const ext = extname(f).toLowerCase()
        const isVideo = VIDEO_EXTS.has(ext)

        try {
            let args
            if (isVideo) {
                const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], {
                    stdio: "pipe"
                })
                const duration = parseFloat(probe.toString().trim())
                const seekTo = (duration * 0.2).toFixed(2)
                args = ["-ss", seekTo, "-i", f, "-vf", scale, "-frames:v", "1", "-y", out]
            } else {
                args = ["-i", f, "-vf", scale, "-y", out]
            }
            execFileSync("ffmpeg", args, { stdio: "pipe" })
            console.log(`  ${basename(f)} -> ${THUMB_DIR}/${stem}.png`)
        } catch (e) {
            console.error(`  FAILED: ${basename(f)} — ${e.stderr?.toString().trim().split("\n").pop()}`)
        }
    }
}

// Build challenge JSON with relative URLs
const cwd = process.cwd()
const presets = files.map((f) => {
    // Files in subdirs (muzzlevideos/) get a relative path, others just the filename
    const rel = f.startsWith(cwd) ? f.slice(cwd.length + 1) : basename(f)
    const entry = { url: rel }
    if (thumbMode) {
        const stem = basename(f, extname(f))
        const thumbPath = join(cwd, THUMB_DIR, stem + ".png")
        if (existsSync(thumbPath)) {
            entry.thumbnail = `${THUMB_DIR}/${stem}.png`
        }
    }
    return entry
})

// -w flag: write challenge.json to cwd and exit
if (writeMode) {
    const outPath = join(process.cwd(), "challenge.json")
    writeFileSync(outPath, JSON.stringify(presets, null, 2) + "\n")
    console.log(`Wrote ${outPath} (${presets.length} puzzle${presets.length !== 1 ? "s" : ""})`)
    process.exit(0)
}

// Build relative-path -> absolute-path map for serving (includes thumbs and converted videos)
const fileMap = new Map()
for (const f of files) {
    const rel = f.startsWith(cwd) ? f.slice(cwd.length + 1) : basename(f)
    fileMap.set(rel, f)
}
for (const dir of [THUMB_DIR, VIDEO_DIR]) {
    const absDir = join(cwd, dir)
    if (existsSync(absDir)) {
        for (const f of readdirSync(absDir)) {
            fileMap.set(`${dir}/${f}`, join(absDir, f))
        }
    }
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
        const ext = extname(filepath).toLowerCase()
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
    console.log()
    console.log(`Or use as a preset gallery instead of a challenge:`)
    console.log(`  ?p=http://localhost:${PORT}/challenge.json`)
})
