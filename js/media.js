// -- Media type detection ------------------------------

const VIDEO_EXTENSIONS = [".mp4", ".webm", ".ogg", ".mov"]

export function detectMediaType(url) {
    const lower = url.toLowerCase().split("?")[0]
    for (const ext of VIDEO_EXTENSIONS) {
        if (lower.endsWith(ext)) return "video"
    }
    return "image"
}

// -- Image loading -------------------------------------

export function loadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image()
        img.crossOrigin = "anonymous"
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error(`Failed to load image: ${url}`))
        img.src = url
    })
}

// -- Video loading -------------------------------------

export function loadVideo(url) {
    return new Promise((resolve, reject) => {
        const video = document.getElementById("puzzle-video")
        video.crossOrigin = "anonymous"
        video.muted = true
        video.loop = true
        video.playsInline = true
        video.preload = "auto"

        const onMeta = () => {
            video.removeEventListener("loadedmetadata", onMeta)
            video.removeEventListener("error", onErr)
            resolve(video)
        }
        const onErr = () => {
            video.removeEventListener("loadedmetadata", onMeta)
            video.removeEventListener("error", onErr)
            reject(new Error(`Failed to load video: ${url}`))
        }

        video.addEventListener("loadedmetadata", onMeta)
        video.addEventListener("error", onErr)

        video.src = url
        video.load()
    })
}

// -- Media manager -------------------------------------

export class MediaManager {
    constructor(renderer) {
        this.renderer = renderer
        this.texture = null
        this.source = null // HTMLImageElement or HTMLVideoElement
        this.type = null // 'image' or 'video'
        this.width = 0
        this.height = 0
        this.aspectRatio = 1
        this.videoPlaying = false
        this.needsAutoplay = false
    }

    async load(url, type) {
        this.type = type || detectMediaType(url)

        if (this.type === "video") {
            const video = await loadVideo(url)
            this.source = video
            this.width = video.videoWidth
            this.height = video.videoHeight
            this.aspectRatio = this.width / this.height
            this.texture = this.renderer.createTexture(null)

            // Try to autoplay
            try {
                await video.play()
                this.videoPlaying = true
                this.needsAutoplay = false
                // Update texture with first frame
                this.renderer.updateTexture(this.texture, video)
            } catch {
                // Autoplay blocked, need user interaction
                this.needsAutoplay = true
                this.videoPlaying = false
            }
        } else {
            const img = await loadImage(url)
            this.source = img
            this.width = img.naturalWidth
            this.height = img.naturalHeight
            this.aspectRatio = this.width / this.height
            this.texture = this.renderer.createTexture(img)
        }

        return { width: this.width, height: this.height, aspectRatio: this.aspectRatio }
    }

    startVideo() {
        if (this.type !== "video" || !this.source) return
        this.source
            .play()
            .then(() => {
                this.videoPlaying = true
                this.needsAutoplay = false
            })
            .catch(() => {})
    }

    // Call each frame to update video texture
    updateFrame() {
        if (this.type === "video" && this.source && this.videoPlaying) {
            if (this.source.readyState >= this.source.HAVE_CURRENT_DATA) {
                this.renderer.updateTexture(this.texture, this.source)
            }
        }
    }

    setVolume(v) {
        if (this.type === "video" && this.source) {
            this.source.volume = Math.max(0, Math.min(1, v))
        }
    }

    setMuted(m) {
        if (this.type === "video" && this.source) {
            this.source.muted = m
        }
    }

    getMuted() {
        if (this.type === "video" && this.source) {
            return this.source.muted
        }
        return true
    }

    getVolume() {
        if (this.type === "video" && this.source) {
            return this.source.volume
        }
        return 0
    }

    destroy() {
        if (this.type === "video" && this.source) {
            this.source.pause()
            this.source.src = ""
        }
        if (this.texture) {
            this.renderer.gl.deleteTexture(this.texture)
            this.texture = null
        }
    }
}
