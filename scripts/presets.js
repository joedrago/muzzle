import { readdirSync, existsSync, writeFileSync } from "node:fs"
import { basename, extname, join } from "node:path"
import { pathToFileURL } from "node:url"

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff"])
const VIDEO_EXTS = new Set([".mp4", ".webm", ".ogg", ".mov", ".avi", ".mkv"])

// Load existing presets
let presets = []
const presetsFile = "presets.local.js"
try {
    const mod = await import(pathToFileURL(join(process.cwd(), presetsFile)))
    presets = mod.default
} catch {
    // file doesn't exist or has errors — start fresh
}

// Collect all URLs already cited
const citedUrls = new Set(presets.flatMap((p) => [p.url, p.thumbnail].filter(Boolean)))

// Determine base URL by matching existing preset URLs to local files
let baseUrl = null
for (const url of citedUrls) {
    for (const dir of ["images", "videos"]) {
        const marker = `/${dir}/`
        const idx = url.lastIndexOf(marker)
        if (idx !== -1) {
            const localPath = dir + "/" + url.slice(idx + marker.length)
            if (existsSync(localPath)) {
                baseUrl = url.slice(0, idx + 1)
                break
            }
        }
    }
    if (baseUrl) break
}

if (!baseUrl) {
    console.error(
        "Could not determine base URL. Ensure presets.local.js has at least one entry whose URL path matches a file in images/ or videos/."
    )
    process.exit(1)
}

console.log(`Base URL: ${baseUrl}`)

// Scan local media files
const localFiles = []
for (const dir of ["images", "videos"]) {
    if (!existsSync(dir)) continue
    const exts = dir === "images" ? IMAGE_EXTS : VIDEO_EXTS
    for (const f of readdirSync(dir).sort()) {
        if (exts.has(extname(f).toLowerCase())) {
            localFiles.push({ dir, file: f })
        }
    }
}

// Find uncited files and build new entries
const newEntries = []
for (const { dir, file } of localFiles) {
    const url = `${baseUrl}${dir}/${file}`
    if (citedUrls.has(url)) continue
    const stem = basename(file, extname(file))
    const thumbnail = `${baseUrl}thumbs/${stem}.png`
    newEntries.push({ url, thumbnail })
    console.log(`  + ${url}`)
}

if (newEntries.length === 0) {
    console.log("All local files are already cited in presets.local.js")
    process.exit(0)
}

// Serialize updated presets back to presets.local.js
const all = [...presets, ...newEntries]

function serializePreset(p) {
    const props = [`        url: ${JSON.stringify(p.url)}`]
    if (p.thumbnail) props.push(`        thumbnail: ${JSON.stringify(p.thumbnail)}`)
    return `    {\n${props.join(",\n")}\n    }`
}

const output = `export default [\n${all.map(serializePreset).join(",\n")}\n]\n`
writeFileSync(presetsFile, output)
console.log(`\nAdded ${newEntries.length} preset(s) to presets.local.js`)
