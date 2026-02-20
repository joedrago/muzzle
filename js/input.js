import { vec2, degToRad } from "./math-utils.js"

// Input states
const IDLE = "IDLE"
const HOLDING_CLICK = "HOLDING_CLICK"
const HOLDING_DRAG = "HOLDING_DRAG"
const SELECTING = "SELECTING"
const PANNING = "PANNING"
const PENDING_PICK = "PENDING_PICK" // brief state between mousedown and determining click vs drag

const DRAG_THRESHOLD = 5 // pixels before mousedown becomes a drag

export class InputManager {
    constructor(canvas, renderer, chunkManager, app) {
        this.canvas = canvas
        this.renderer = renderer
        this.cm = chunkManager
        this.app = app

        this.state = IDLE

        // Held chunk
        this.heldChunkId = null
        this.holdOffset = [0, 0] // offset from chunk origin to pick point

        // Multi-selection
        this.heldChunkIds = null // array of chunk IDs for multi-select
        this.heldOffsets = null // corresponding offsets

        // Selection rectangle
        this.selStart = null
        this.selEnd = null

        // Pending pick
        this.pendingScreenPos = null
        this.pendingWorldPos = null
        this.pendingHit = null

        // Pan
        this.panStart = null
        this.panCamStart = null

        // Mouse position (screen)
        this.mouseScreen = [0, 0]

        this._bind()
    }

    _bind() {
        this.canvas.addEventListener("mousedown", (e) => this._onMouseDown(e))
        this.canvas.addEventListener("mousemove", (e) => this._onMouseMove(e))
        this.canvas.addEventListener("mouseup", (e) => this._onMouseUp(e))
        this.canvas.addEventListener("click", (e) => this._onClick(e))
        this.canvas.addEventListener("contextmenu", (e) => e.preventDefault())
        this.canvas.addEventListener("wheel", (e) => this._onWheel(e), { passive: false })
        window.addEventListener("keydown", (e) => this._onKeyDown(e))
    }

    _getMousePos(e) {
        const rect = this.canvas.getBoundingClientRect()
        return [e.clientX - rect.left, e.clientY - rect.top]
    }

    // ── Mouse down ────────────────────────────────────

    _onMouseDown(e) {
        if (this.app.dialogOpen) return
        const [sx, sy] = this._getMousePos(e)
        this.mouseScreen = [sx, sy]

        if (e.button === 2 && (this.state === HOLDING_CLICK || this.state === HOLDING_DRAG)) {
            // Right-click while holding — rotate
            this._rotateHeld()
            return
        }

        if (this.state === HOLDING_CLICK) {
            // Already holding via click mode — don't start a new action
            return
        }

        const [wx, wy] = this.renderer.screenToWorld(sx, sy)

        if (e.button === 2) {
            // Right button on background — start panning
            this.state = PANNING
            this.panStart = [sx, sy]
            this.panCamStart = [this.renderer.camera.x, this.renderer.camera.y]
            return
        }

        if (e.button === 0) {
            // Left button
            const hit = this.cm.hitTest(wx, wy)

            if (hit) {
                // Clicked on a piece — start pending pick
                this.state = PENDING_PICK
                this.pendingScreenPos = [sx, sy]
                this.pendingWorldPos = [wx, wy]
                this.pendingHit = hit
            } else {
                // Clicked on background — start selection rectangle
                this.state = SELECTING
                this.selStart = [wx, wy]
                this.selEnd = [wx, wy]
            }
        }
    }

    // ── Mouse move ────────────────────────────────────

    _onMouseMove(e) {
        const [sx, sy] = this._getMousePos(e)
        this.mouseScreen = [sx, sy]
        const [wx, wy] = this.renderer.screenToWorld(sx, sy)

        switch (this.state) {
            case PENDING_PICK: {
                const dist = vec2.distance([sx, sy], this.pendingScreenPos)
                if (dist > DRAG_THRESHOLD) {
                    // Transition to drag
                    this._pickupChunk(this.pendingHit, this.pendingWorldPos)
                    this.state = HOLDING_DRAG
                    this._moveHeld(wx, wy)
                }
                break
            }

            case HOLDING_CLICK:
            case HOLDING_DRAG:
                this._moveHeld(wx, wy)
                break

            case SELECTING:
                this.selEnd = [wx, wy]
                this.app._needsRender = true
                break

            case PANNING: {
                const dx = (sx - this.panStart[0]) / this.renderer.camera.zoom
                const dy = (sy - this.panStart[1]) / this.renderer.camera.zoom
                const dpr = window.devicePixelRatio || 1
                this.renderer.camera.x = this.panCamStart[0] - dx * dpr
                this.renderer.camera.y = this.panCamStart[1] - dy * dpr
                this.app.markDirty()
                break
            }
        }
    }

    // ── Mouse up ──────────────────────────────────────

    _onMouseUp(e) {
        switch (this.state) {
            case PENDING_PICK:
                // Was a click, not a drag — enter HOLDING_CLICK mode
                this._pickupChunk(this.pendingHit, this.pendingWorldPos)
                this.state = HOLDING_CLICK
                break

            case HOLDING_DRAG:
                // Only drop on left button release, not right (which is rotate)
                if (e.button === 0) this._dropHeld()
                break

            case SELECTING:
                this._finishSelection()
                break

            case PANNING:
                this.state = IDLE
                this.app.markDirty()
                break
        }
    }

    // ── Click (for HOLDING_CLICK drop) ────────────────

    _onClick(_e) {
        if (this.state === HOLDING_CLICK) {
            // Give a brief delay to distinguish from the pickup click
            // Actually, the pickup click happens on mouseup above.
            // A subsequent click event = user wants to drop.
            // But we need to ignore the initial click that picked it up.
            // The pickup happens on mouseup, and click fires right after.
            // So we skip this first click by checking a flag.
            if (this._skipNextClick) {
                this._skipNextClick = false
                return
            }
            this._dropHeld()
        }
    }

    // ── Pickup ────────────────────────────────────────

    _pickupChunk(hit, worldPos) {
        const chunk = this.cm.chunks.get(hit.chunkId)
        if (!chunk) return

        this.heldChunkId = hit.chunkId
        this.holdOffset = [chunk.x - worldPos[0], chunk.y - worldPos[1]]
        this.heldChunkIds = null

        this.cm.bringToFront(hit.chunkId)
        this._skipNextClick = true
        this.app.markDirty()
    }

    _moveHeld(wx, wy) {
        if (this.heldChunkIds) {
            // Multi-selection movement
            for (let i = 0; i < this.heldChunkIds.length; i++) {
                const chunk = this.cm.chunks.get(this.heldChunkIds[i])
                if (chunk) {
                    chunk.setPosition(wx + this.heldOffsets[i][0], wy + this.heldOffsets[i][1])
                }
            }
        } else if (this.heldChunkId !== null) {
            const chunk = this.cm.chunks.get(this.heldChunkId)
            if (chunk) {
                chunk.setPosition(wx + this.holdOffset[0], wy + this.holdOffset[1])
            }
        }
        this.app.markDirty()
    }

    _dropHeld() {
        if (this.heldChunkIds) {
            // Multi-selection drop — no snapping
            this.heldChunkIds = null
            this.heldOffsets = null
            this.state = IDLE
            this.app.markDirty()
            return
        }

        if (this.heldChunkId !== null) {
            const chunkId = this.heldChunkId
            this.heldChunkId = null
            this.state = IDLE

            // Try snapping
            const snapped = this.cm.trySnap(chunkId)
            this.app.markDirty()

            if (snapped || this.cm.isComplete()) {
                this.app.onPieceSnapped()
            }
        }
    }

    // ── Rotation ──────────────────────────────────────

    _rotateHeld() {
        const [wx, wy] = this.renderer.screenToWorld(...this.mouseScreen)

        if (this.heldChunkIds) {
            // Multi-chunk: rotate all around their collective center
            const centers = this.heldChunkIds.map((cid) => this.cm.getChunkWorldCenter(cid))
            let gcx = 0,
                gcy = 0
            for (const c of centers) {
                gcx += c[0]
                gcy += c[1]
            }
            gcx /= centers.length
            gcy /= centers.length

            const rad = degToRad(90)
            for (let i = 0; i < this.heldChunkIds.length; i++) {
                const cid = this.heldChunkIds[i]
                const chunk = this.cm.chunks.get(cid)
                if (!chunk) continue

                // Rotate chunk around its own visual center
                this.cm.rotateChunkAroundCenter(cid)

                // Orbit the chunk's center around the group center
                const dx = centers[i][0] - gcx
                const dy = centers[i][1] - gcy
                const rotated = vec2.rotate([dx, dy], rad)
                const newCenter = [gcx + rotated[0], gcy + rotated[1]]
                const currentCenter = this.cm.getChunkWorldCenter(cid)
                chunk.setPosition(chunk.x + newCenter[0] - currentCenter[0], chunk.y + newCenter[1] - currentCenter[1])
            }

            // Update offsets to match new positions
            this.heldOffsets = this.heldChunkIds.map((cid) => {
                const chunk = this.cm.chunks.get(cid)
                return [chunk.x - wx, chunk.y - wy]
            })
        } else if (this.heldChunkId !== null) {
            this.cm.rotateChunkAroundCenter(this.heldChunkId)

            // Update offset to match new position
            const chunk = this.cm.chunks.get(this.heldChunkId)
            if (chunk) {
                this.holdOffset = [chunk.x - wx, chunk.y - wy]
            }
        }
        this.app.markDirty()
    }

    // ── Selection rectangle ───────────────────────────

    _finishSelection() {
        const piecesInRect = this.cm.getPiecesInRect(this.selStart[0], this.selStart[1], this.selEnd[0], this.selEnd[1])

        if (piecesInRect.length > 0) {
            // Gather unique chunk IDs
            const chunkIdSet = new Set(piecesInRect.map((p) => p.chunkId))
            const chunkIds = Array.from(chunkIdSet)

            if (chunkIds.length === 1) {
                // Single chunk selected — pick it up normally
                const hit = piecesInRect[0]
                const center = [(this.selStart[0] + this.selEnd[0]) / 2, (this.selStart[1] + this.selEnd[1]) / 2]
                this._pickupChunk(hit, center)
                this.state = HOLDING_CLICK
            } else {
                // Multi-chunk selection
                const center = [(this.selStart[0] + this.selEnd[0]) / 2, (this.selStart[1] + this.selEnd[1]) / 2]
                this.heldChunkIds = chunkIds
                this.heldOffsets = chunkIds.map((cid) => {
                    const chunk = this.cm.chunks.get(cid)
                    return [chunk.x - center[0], chunk.y - center[1]]
                })
                this.heldChunkId = null
                this.state = HOLDING_CLICK
                this._skipNextClick = true
            }
        } else {
            this.state = IDLE
        }

        this.selStart = null
        this.selEnd = null
        this.app.markDirty()
    }

    // ── Keyboard ──────────────────────────────────────

    _onKeyDown(e) {
        if (this.app.dialogOpen) {
            if (e.key === "Escape") {
                this.app.closeAllDialogs()
            }
            return
        }

        switch (e.key.toLowerCase()) {
            case "r":
                this._rotateHeld()
                break
            case "f":
                this.app.toggleFullscreen()
                break
            case "o":
            case "s":
            case " ":
                this.app.toggleSolution()
                break
            case "m":
                this.app.toggleMute()
                break
            case "c":
                this.app.cleanup(true)
                break
            case "h":
            case "?":
                this.app.toggleHelp()
                break
            case "escape":
                if (this.state === HOLDING_CLICK || this.state === HOLDING_DRAG) {
                    // Cancel pick up — just drop without snapping
                    this.heldChunkId = null
                    this.heldChunkIds = null
                    this.state = IDLE
                    this.app.markDirty()
                }
                break
        }
    }

    // ── Wheel (zoom) ──────────────────────────────────

    _onWheel(e) {
        e.preventDefault()
        const [sx, sy] = this._getMousePos(e)
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
        this.renderer.zoomAtScreen(sx, sy, factor)
        this.app.markDirty()
    }

    // ── Getters for rendering ─────────────────────────

    get isSelecting() {
        return this.state === SELECTING && this.selStart && this.selEnd
    }

    get isHolding() {
        return this.state === HOLDING_CLICK || this.state === HOLDING_DRAG
    }

    get selectionRect() {
        if (!this.isSelecting) return null
        return {
            x: Math.min(this.selStart[0], this.selEnd[0]),
            y: Math.min(this.selStart[1], this.selEnd[1]),
            w: Math.abs(this.selEnd[0] - this.selStart[0]),
            h: Math.abs(this.selEnd[1] - this.selStart[1])
        }
    }
}
