import { Renderer } from "./renderer.js"
import { MediaManager, detectMediaType } from "./media.js"
import { generatePuzzle, calculateGrid } from "./puzzle.js"
import { ChunkManager } from "./piece.js"
import { InputManager } from "./input.js"
import { StateManager } from "./state.js"
import { UIManager } from "./ui.js"
import { mat3 } from "./math-utils.js"

class App {
    constructor() {
        this.canvas = document.getElementById("puzzle-canvas")
        this.renderer = new Renderer(this.canvas)
        this.media = new MediaManager(this.renderer)
        this.cm = new ChunkManager()
        this.state = new StateManager()
        this.ui = new UIManager(this)
        this.input = null // created after puzzle loads

        this.puzzleData = null
        this.puzzleConfig = null
        this.completed = false
        this.showSolution = false
        this.dialogOpen = false
        this._needsRender = true
        this._animFrame = null

        // State auto-save
        this.state.setSaveCallback(() => this._buildSaveData())

        // Resize handler
        window.addEventListener("resize", () => {
            this.renderer.resize()
            this._needsRender = true
        })

        // Handle WebGL context loss
        this.canvas.addEventListener("webglcontextlost", (e) => {
            e.preventDefault()
            console.warn("WebGL context lost")
        })
        this.canvas.addEventListener("webglcontextrestored", () => {
            console.log("WebGL context restored")
            this._rebuildGL()
        })

        this._init()
    }

    async _init() {
        // Try to restore saved state
        const saved = this.state.load()
        if (saved) {
            try {
                await this._restorePuzzle(saved)
                return
            } catch (e) {
                console.warn("Failed to restore saved state:", e)
                this.state.clear()
            }
        }

        // No saved state — show puzzle selection
        this.ui.showPuzzleSelect()
        this._startRenderLoop()
    }

    // ── Puzzle lifecycle ──────────────────────────────

    async startNewPuzzle(opts) {
        const { url, type, name, pieceCount, rotationEnabled } = opts

        this.ui.hideCelebration()
        this.completed = false
        this.showSolution = false

        try {
            // Load media
            const mediaType = type || detectMediaType(url)
            const { aspectRatio } = await this.media.load(url, mediaType)

            // Calculate grid
            const { cols, rows } = calculateGrid(pieceCount, aspectRatio)

            // Generate seed
            const seed = Math.floor(Math.random() * 2147483647)

            // Store config
            this.puzzleConfig = {
                name: name || "Puzzle",
                url,
                type: mediaType,
                seed,
                cols,
                rows,
                rotationEnabled
            }

            // Generate puzzle geometry
            this.puzzleData = generatePuzzle(cols, rows, seed, this.renderer)
            this.cm.init(this.puzzleData, this.puzzleData.pieces)

            // Shuffle
            this.cm.shuffle(rotationEnabled)

            // Setup input
            if (!this.input) {
                this.input = new InputManager(this.canvas, this.renderer, this.cm, this)
            } else {
                this.input.cm = this.cm
                this.input.state = "IDLE"
                this.input.heldChunkId = null
            }

            // Center camera
            this.renderer.camera.x = 0
            this.renderer.camera.y = 0
            this.renderer.camera.zoom = Math.min(
                this.canvas.width / (this.puzzleData.puzzleWidth * 3),
                this.canvas.height / (this.puzzleData.puzzleHeight * 3)
            )

            // Show audio controls for video
            if (mediaType === "video") {
                this.ui.showAudioControls()
                if (this.media.needsAutoplay) {
                    this.ui.showVideoPlayOverlay()
                }
            } else {
                this.ui.hideAudioControls()
            }

            this._needsRender = true
            this.state.markDirty()
            this._startRenderLoop()
        } catch (e) {
            console.error("Failed to start puzzle:", e)
            alert("Failed to load puzzle: " + e.message)
            this.ui.showPuzzleSelect()
        }
    }

    async _restorePuzzle(saved) {
        const p = saved.puzzle

        // Load media
        await this.media.load(p.url, p.type)

        this.puzzleConfig = {
            name: p.name,
            url: p.url,
            type: p.type,
            seed: p.seed,
            cols: p.cols,
            rows: p.rows,
            rotationEnabled: p.rotationEnabled
        }

        // Regenerate puzzle geometry from seed
        this.puzzleData = generatePuzzle(p.cols, p.rows, p.seed, this.renderer)
        this.cm.init(this.puzzleData, this.puzzleData.pieces)

        // Restore chunks
        this.cm.restoreChunks(saved.chunks)

        // Restore camera
        this.renderer.camera.x = saved.camera.x
        this.renderer.camera.y = saved.camera.y
        this.renderer.camera.zoom = saved.camera.zoom

        // Restore completion state
        this.completed = saved.completed || false
        if (this.completed) {
            this.ui.showCelebration()
        }

        // Setup input
        if (!this.input) {
            this.input = new InputManager(this.canvas, this.renderer, this.cm, this)
        } else {
            this.input.cm = this.cm
        }

        // Audio
        if (p.type === "video") {
            this.ui.showAudioControls()
            this.media.setVolume(saved.volume || 0.5)
            this.media.setMuted(saved.muted !== undefined ? saved.muted : true)
            this.ui.updateVolume(saved.volume || 0.5)
            this.ui.updateMuteButton(saved.muted !== undefined ? saved.muted : true)
            if (this.media.needsAutoplay) {
                this.ui.showVideoPlayOverlay()
            }
        } else {
            this.ui.hideAudioControls()
        }

        this._needsRender = true
        this._startRenderLoop()
    }

    _rebuildGL() {
        // Re-create GL resources after context restore
        if (this.puzzleConfig) {
            this.puzzleData = generatePuzzle(
                this.puzzleConfig.cols,
                this.puzzleConfig.rows,
                this.puzzleConfig.seed,
                this.renderer
            )
            this.cm.init(this.puzzleData, this.puzzleData.pieces)
            // Re-restore chunks from save
            const saved = this.state.load()
            if (saved) this.cm.restoreChunks(saved.chunks)
        }
        this._needsRender = true
    }

    // ── Render loop ───────────────────────────────────

    _startRenderLoop() {
        if (this._animFrame) return
        const loop = () => {
            this._animFrame = requestAnimationFrame(loop)
            this._render()
        }
        loop()
    }

    _render() {
        // Always update video texture if playing
        const isVideo = this.media.type === "video" && this.media.videoPlaying
        if (isVideo) {
            this.media.updateFrame()
            this._needsRender = true // video always needs re-render
        }

        if (!this._needsRender) return
        this._needsRender = false

        const r = this.renderer
        r.clear()

        if (!this.puzzleData || !this.media.texture) return

        const texture = this.media.texture
        const pw = this.puzzleData.pieceW
        const ph = this.puzzleData.pieceH

        // Draw all chunks
        const heldId = this.input ? this.input.heldChunkId : null
        const heldIds = this.input ? this.input.heldChunkIds : null

        const isHeld = (id) => {
            if (id === heldId) return true
            if (heldIds && heldIds.includes(id)) return true
            return false
        }

        // Draw non-held chunks first, then held chunks on top
        for (const chunk of this.cm.chunks.values()) {
            if (isHeld(chunk.id)) continue
            this._drawChunk(chunk, texture, pw, ph, 1.0, 0.0)
        }

        // Draw held chunks on top with slight transparency
        // Multi-selected chunks get a blue highlight tint
        const multiHighlight = heldIds && heldIds.length > 0 ? 0.2 : 0.0
        for (const chunk of this.cm.chunks.values()) {
            if (!isHeld(chunk.id)) continue
            this._drawChunk(chunk, texture, pw, ph, 0.85, multiHighlight)
        }

        // Selection rectangle
        if (this.input && this.input.isSelecting) {
            const sel = this.input.selectionRect
            if (sel) {
                r.drawRect(sel.x, sel.y, sel.w, sel.h, [0.4, 0.5, 1.0, 0.25])
            }
        }

        // Solution overlay
        if (this.showSolution) {
            const puzzleW = this.puzzleData.puzzleWidth
            const puzzleH = this.puzzleData.puzzleHeight
            // Position at origin (0,0 is where the solved puzzle would be)
            r.drawSolutionOverlay(texture, 0, 0, puzzleW, puzzleH, 0.5)
        }
    }

    _drawChunk(chunk, texture, pw, ph, alpha, highlight) {
        const worldMatrix = chunk.worldMatrix

        for (const pieceId of chunk.pieces) {
            const piece = this.puzzleData.pieces[pieceId]

            // Piece local offset within chunk
            const pieceOffsetX = piece.col * pw
            const pieceOffsetY = piece.row * ph

            // Build model matrix: chunk transform * piece offset
            const pieceTranslate = mat3.translate(pieceOffsetX, pieceOffsetY)
            const modelMatrix = mat3.multiply(worldMatrix, pieceTranslate)

            this.renderer.drawPiece(piece.vbo, piece.ibo, piece.triCount, modelMatrix, texture, alpha, highlight)
            this.renderer.drawPieceOutline(piece.outlineVBO, piece.outlineVertCount, modelMatrix, [0.9, 0.9, 0.9, 0.5])
        }
    }

    // ── App actions (called by input/UI) ──────────────

    markDirty() {
        this._needsRender = true
        this.state.markDirty()
    }

    onPieceSnapped() {
        if (this.cm.isComplete() && !this.completed) {
            this.completed = true
            this.ui.showCelebration()
            this.state.markDirty()
        }
    }

    toggleSolution() {
        this.showSolution = !this.showSolution
        this._needsRender = true
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {})
        } else {
            document.exitFullscreen().catch(() => {})
        }
    }

    toggleMute() {
        if (!this.media || this.media.type !== "video") return
        const muted = !this.media.getMuted()
        this.media.setMuted(muted)
        this.ui.updateMuteButton(muted)
        this.state.markDirty()
    }

    setVolume(v) {
        this.media.setVolume(v)
        this.state.markDirty()
    }

    toggleHelp() {
        const helpEl = document.getElementById("dialog-help")
        if (helpEl && !helpEl.classList.contains("hidden")) {
            this.ui.closeHelp()
        } else {
            this.ui.showHelp()
        }
    }

    closeAllDialogs() {
        this.ui.closeAllDialogs()
    }

    startVideo() {
        this.media.startVideo()
        this.ui.hideVideoPlayOverlay()
        this._needsRender = true
    }

    cleanup() {
        const cam = this.renderer.camera
        const viewW = this.canvas.width / cam.zoom
        const viewH = this.canvas.height / cam.zoom
        this.cm.cleanup(viewW, viewH, cam.x, cam.y)
        this._needsRender = true
        this.state.markDirty()
    }

    // ── Save data builder ─────────────────────────────

    _buildSaveData() {
        if (!this.puzzleConfig) return null
        return this.state.buildSaveData(
            this.puzzleConfig,
            this.cm,
            this.renderer.camera,
            this.completed,
            this.media.getVolume(),
            this.media.getMuted()
        )
    }
}

// ── Bootstrap ─────────────────────────────────────────

const _app = new App()
