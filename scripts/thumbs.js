import { readdirSync, mkdirSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { basename, extname, join } from "node:path"

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff"])
const VIDEO_EXTS = new Set([".mp4", ".webm", ".ogg", ".mov", ".avi", ".mkv"])

const THUMB_WIDTH = 200
const THUMB_HEIGHT = 150

mkdirSync("thumbs", { recursive: true })

const sources = []

if (existsSync("images")) {
    for (const f of readdirSync("images")) {
        if (IMAGE_EXTS.has(extname(f).toLowerCase())) {
            sources.push({ path: join("images", f), type: "image" })
        }
    }
}

if (existsSync("videos")) {
    for (const f of readdirSync("videos")) {
        if (VIDEO_EXTS.has(extname(f).toLowerCase())) {
            sources.push({ path: join("videos", f), type: "video" })
        }
    }
}

if (sources.length === 0) {
    console.log("No images or videos found in images/ or videos/")
    process.exit(0)
}

const scale = `scale=${THUMB_WIDTH}:${THUMB_HEIGHT}:force_original_aspect_ratio=decrease`

function getVideoDuration(path) {
    const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], {
        stdio: "pipe"
    })
    return parseFloat(out.toString().trim())
}

for (const { path, type } of sources) {
    const out = join("thumbs", basename(path, extname(path)) + ".png")

    if (existsSync(out)) {
        console.log(`  skipping ${path} (thumb exists)`)
        continue
    }

    try {
        let args
        if (type === "video") {
            const duration = getVideoDuration(path)
            const seekTo = (duration * 0.2).toFixed(2)
            args = ["-ss", seekTo, "-i", path, "-vf", scale, "-frames:v", "1", "-y", out]
        } else {
            args = ["-i", path, "-vf", scale, "-y", out]
        }
        execFileSync("ffmpeg", args, { stdio: "pipe" })
        console.log(`  ${path} -> ${out}`)
    } catch (e) {
        console.error(`  FAILED: ${path} — ${e.stderr?.toString().trim().split("\n").pop()}`)
    }
}

console.log("Done.")
