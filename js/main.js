import { Renderer } from "./renderer.js"
import { MediaManager, detectMediaType } from "./media.js"
import { generatePuzzle, calculateGrid } from "./puzzle.js"
import { ChunkManager } from "./piece.js"
import { InputManager } from "./input.js"
import { StateManager } from "./state.js"
import { UIManager, loadLocalPresets, resolveUrl } from "./ui.js?v=2"
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
        this.challenge = null // { presets, index, pieceSize, rotationEnabled }
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

    _parseChallengeParams() {
        const params = new URLSearchParams(window.location.search)
        const challengeUrl = params.get("c")
        if (!challengeUrl) return null
        const ps = params.get("ps")
        const r = params.get("r")
        return {
            challengeUrl,
            pieceSize: ps ? parseInt(ps) : null,
            rotationEnabled: r != null ? r !== "0" : null
        }
    }

    async _init() {
        const presetsChanged = await loadLocalPresets()
        if (presetsChanged) this.ui._buildPresetList()

        // Check for challenge mode query params
        const challengeParams = this._parseChallengeParams()
        if (challengeParams) {
            window.history.replaceState({}, "", window.location.pathname)

            const saved = this.state.load()
            if (saved) {
                this._startRenderLoop()
                try {
                    await this._restorePuzzle(saved)
                } catch (_e) {
                    this.state.clear()
                }
            }

            let presets
            try {
                const resp = await fetch(challengeParams.challengeUrl)
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
                presets = await resp.json()
                if (!Array.isArray(presets) || presets.length === 0) {
                    throw new Error("Challenge JSON must be a non-empty array")
                }
                // Resolve relative URLs against the challenge JSON location
                const baseUrl = challengeParams.challengeUrl
                presets = presets.map((p) => ({
                    ...p,
                    url: resolveUrl(p.url, baseUrl),
                    thumbnail: p.thumbnail ? resolveUrl(p.thumbnail, baseUrl) : p.thumbnail
                }))
            } catch (e) {
                alert("Failed to load challenge: " + e.message)
                if (!saved) this.ui.showPuzzleSelect()
                this._startRenderLoop()
                return
            }

            const result = await this.ui.showChallengeStart(
                presets.length,
                challengeParams.pieceSize,
                challengeParams.rotationEnabled,
                !!saved
            )
            if (!result) {
                // Cancelled — keep current state
                this._startRenderLoop()
                return
            }

            this.challenge = {
                url: challengeParams.challengeUrl,
                presets,
                index: 0,
                pieceSize: result.pieceSize,
                rotationEnabled: result.rotationEnabled
            }
            this._startChallengeAt(0)
            this._startRenderLoop()
            return
        }

        // Check for share link query params
        const shareParams = this._parseShareParams()
        if (shareParams) {
            // Strip query string from URL immediately
            window.history.replaceState({}, "", window.location.pathname)

            const saved = this.state.load()
            if (saved) {
                this._startRenderLoop()
                try {
                    await this._restorePuzzle(saved)
                } catch (_e) {
                    this.state.clear()
                }
                const yes = await this.ui.confirm("Open a shared puzzle? This will replace your current one.")
                if (!yes) return
            }
            this.startNewPuzzle(shareParams)
            this._startRenderLoop()
            return
        }

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

    _parseShareParams() {
        const params = new URLSearchParams(window.location.search)
        const url = params.get("u")
        if (!url) return null
        return {
            url,
            cols: parseInt(params.get("cols")) || null,
            rows: parseInt(params.get("rows")) || null,
            rotationEnabled: params.get("r") !== "0",
            seed: parseInt(params.get("s")) || null
        }
    }

    getShareUrl() {
        if (this.challenge) {
            const params = new URLSearchParams()
            params.set("c", this.challenge.url)
            params.set("ps", this.challenge.pieceSize)
            params.set("r", this.challenge.rotationEnabled ? "1" : "0")
            return window.location.origin + window.location.pathname + "?" + params.toString()
        }
        if (!this.puzzleConfig) return null
        const params = new URLSearchParams()
        params.set("u", this.puzzleConfig.url)
        params.set("cols", this.puzzleConfig.cols)
        params.set("rows", this.puzzleConfig.rows)
        params.set("r", this.puzzleConfig.rotationEnabled ? "1" : "0")
        params.set("s", this.puzzleConfig.seed)
        return window.location.origin + window.location.pathname + "?" + params.toString()
    }

    // -- Challenge lifecycle --------------------------

    _startChallengeAt(index) {
        this.challenge.index = index
        const preset = this.challenge.presets[index]
        this.ui.hideChallengeNextButton()
        this.ui.updateChallengeIndicator(index + 1, this.challenge.presets.length)
        this.startNewPuzzle({
            url: preset.url,
            pieceSize: this.challenge.pieceSize,
            rotationEnabled: this.challenge.rotationEnabled
        })
    }

    advanceChallenge() {
        if (!this.challenge || !this.completed) return
        this._startChallengeAt(this.challenge.index + 1)
    }

    exitChallenge() {
        if (!this.challenge) return
        this.challenge = null
        this.ui.hideChallengeUI()
    }

    // -- Puzzle lifecycle ------------------------------

    async startNewPuzzle(opts) {
        const { url, pieceSize, rotationEnabled } = opts

        this.ui.hideCelebration()
        this.completed = false
        this.showSolution = false

        try {
            // Tear down previous media (stops any playing video/audio)
            this.media.destroy()

            // Load media
            const mediaType = detectMediaType(url)
            const { aspectRatio } = await this.media.load(url, mediaType)

            // Use explicit cols/rows (shared puzzles) or calculate from piece size
            const { cols, rows } = opts.cols && opts.rows ? opts : calculateGrid(pieceSize || 7, aspectRatio)

            // Use provided seed or generate a new one
            const seed = opts.seed || Math.floor(Math.random() * 2147483647)

            // Store config
            this.puzzleConfig = {
                url,
                type: mediaType,
                seed,
                cols,
                rows,
                rotationEnabled
            }
            this.ui.updatePuzzleDims(cols, rows)

            // Generate puzzle geometry
            this.puzzleData = generatePuzzle(cols, rows, seed, this.renderer)
            this.cm.init(this.puzzleData, this.puzzleData.pieces)

            // Shuffle then organize around the solution area
            this.cm.shuffle(rotationEnabled)

            // Setup input
            if (!this.input) {
                this.input = new InputManager(this.canvas, this.renderer, this.cm, this)
            } else {
                this.input.cm = this.cm
                this.input.state = "IDLE"
                this.input.heldChunkId = null
            }

            // Organize pieces around the overlay and zoom to fit
            this.cleanup()

            // Show audio controls for video
            if (mediaType === "video") {
                this.ui.showAudioControls()
                this.ui.updateMuteButton(this.media.getMuted())
                this.ui.updateVolume(this.media.getVolume())
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
            url: p.url,
            type: p.type,
            seed: p.seed,
            cols: p.cols,
            rows: p.rows,
            rotationEnabled: p.rotationEnabled
        }
        this.ui.updatePuzzleDims(p.cols, p.rows)

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

        // Audio — always start muted so autoplay isn't blocked by the browser
        if (p.type === "video") {
            this.ui.showAudioControls()
            this.media.setVolume(saved.volume || 0.5)
            this.media.setMuted(true)
            this.ui.updateVolume(saved.volume || 0.5)
            this.ui.updateMuteButton(true)
            if (this.media.needsAutoplay) {
                this.ui.showVideoPlayOverlay()
            }
        } else {
            this.ui.hideAudioControls()
        }

        // Restore challenge state
        if (saved.challenge) {
            this.challenge = saved.challenge
            this.ui.updateChallengeIndicator(this.challenge.index + 1, this.challenge.presets.length)
            if (this.completed) {
                const isLast = this.challenge.index >= this.challenge.presets.length - 1
                if (!isLast) this.ui.showChallengeNextButton()
            }
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

    // -- Render loop -----------------------------------

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

        // Solution area border outline
        if (!this.completed) {
            const puzzleW = this.puzzleData.puzzleWidth
            const puzzleH = this.puzzleData.puzzleHeight
            const bx = -puzzleW / 2
            const by = -puzzleH / 2
            const t = 2 / (this.renderer.camera.zoom || 1) // 2px screen-space thickness
            const borderColor = [1.0, 1.0, 1.0, 0.15]
            r.drawRect(bx, by, puzzleW, t, borderColor) // top
            r.drawRect(bx, by + puzzleH - t, puzzleW, t, borderColor) // bottom
            r.drawRect(bx, by, t, puzzleH, borderColor) // left
            r.drawRect(bx + puzzleW - t, by, t, puzzleH, borderColor) // right
        }

        // Solution overlay
        if (this.showSolution) {
            const puzzleW = this.puzzleData.puzzleWidth
            const puzzleH = this.puzzleData.puzzleHeight
            // Center the overlay at the origin so it's visible after cleanup or at start
            r.drawSolutionOverlay(texture, -puzzleW / 2, -puzzleH / 2, puzzleW, puzzleH, 0.25)
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
            const outlineAlpha = this.completed ? 0.125 : 0.5
            this.renderer.drawPieceOutline(piece.outlineVBO, piece.outlineVertCount, modelMatrix, [0.9, 0.9, 0.9, outlineAlpha])
        }
    }

    // -- App actions (called by input/UI) --------------

    markDirty() {
        this._needsRender = true
        this.state.markDirty()
    }

    onPieceSnapped() {
        if (this.cm.isComplete() && !this.completed) {
            this.completed = true
            this.showSolution = false
            this.state.markDirty()

            if (this.challenge) {
                const isLast = this.challenge.index >= this.challenge.presets.length - 1
                if (isLast) {
                    this.ui.showChallengeFinalCelebration()
                } else {
                    this.ui.showCelebration()
                    this.ui.showChallengeNextButton()
                }
            } else {
                this.ui.showCelebration()
            }
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

    cleanup(skipInside = false) {
        const cam = this.renderer.camera
        const dpr = window.devicePixelRatio || 1
        const toolbarPx = 44 * dpr
        const usableW = this.canvas.width
        const usableH = this.canvas.height - toolbarPx
        const aspect = usableW / usableH
        const bounds = this.cm.cleanup(aspect, skipInside)
        if (bounds) {
            // Zoom to fit, then center on bounding box offset for toolbar
            const pad = 0.9 // 10% padding
            cam.zoom = Math.min((usableW * pad) / bounds.totalW, (usableH * pad) / bounds.totalH)
            cam.x = bounds.centerX
            cam.y = bounds.centerY - toolbarPx / (2 * cam.zoom)
        }
        this._needsRender = true
        this.state.markDirty()
    }

    // -- Save data builder -----------------------------

    _buildSaveData() {
        if (!this.puzzleConfig) return null
        const data = this.state.buildSaveData(
            this.puzzleConfig,
            this.cm,
            this.renderer.camera,
            this.completed,
            this.media.getVolume(),
            this.media.getMuted()
        )
        if (this.challenge) {
            data.challenge = {
                url: this.challenge.url,
                presets: this.challenge.presets,
                index: this.challenge.index,
                pieceSize: this.challenge.pieceSize,
                rotationEnabled: this.challenge.rotationEnabled
            }
        }
        return data
    }
}

// -- Bootstrap -----------------------------------------

const _app = new App()
