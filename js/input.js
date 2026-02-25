import { vec2, degToRad } from "./math-utils.js"

// Input states
const IDLE = "IDLE"
const HOLDING_CLICK = "HOLDING_CLICK"
const HOLDING_DRAG = "HOLDING_DRAG"
const SELECTING = "SELECTING"
const PANNING = "PANNING"
const PENDING_PICK = "PENDING_PICK"
const PINCHING = "PINCHING"

const DRAG_THRESHOLD = 5 // pixels before pointerdown becomes a drag
const TAP_THRESHOLD = 5 // max movement for a tap
const TAP_TIMEOUT = 300 // ms — max duration for a tap
const LONG_PRESS_MS = 500 // ms — hold duration before long-press triggers selection
const TOUCH_LIFT_PX = 80 // screen pixels to lift piece above finger on touch
const TOUCH_LIFT_MAX_WORLD = 150 // max world units (1.5x piece height) — cap at low zoom
const TOUCH_LIFT_MS = 200 // ms to animate the lift

export class InputManager {
    constructor(canvas, renderer, chunkManager, app) {
        this.canvas = canvas
        this.renderer = renderer
        this.cm = chunkManager
        this.app = app

        this.state = IDLE

        // Double-tap/click detection
        this._lastPickupTime = 0
        this._lastTapTime = 0
        this._lastTapChunkId = null

        // Held chunk
        this.heldChunkId = null
        this.holdOffset = [0, 0]

        // Multi-selection
        this.heldChunkIds = null
        this.heldOffsets = null

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

        // Pointer tracking
        this._pointers = new Map() // pointerId → { sx, sy }
        this._primaryPointerId = null
        this._lastPointerType = "mouse"

        // Tap detection
        this._pointerDownTime = 0
        this._pointerDownPos = null

        // Long-press
        this._longPressTimer = null

        // Pinch state
        this._pinchStartDist = 0
        this._pinchStartZoom = 1
        this._pinchStartMid = [0, 0]
        this._pinchStartCam = [0, 0]

        // Touch lift animation — raises piece above finger
        this._touchLiftY = 0 // current world-space Y offset (negative = up)
        this._touchLiftTarget = 0
        this._touchLiftStartTime = 0
        this._touchLiftAnim = null // requestAnimationFrame id

        // Prevent canvas touch-action via JS
        this.canvas.style.touchAction = "none"

        this._bind()
    }

    _bind() {
        this.canvas.addEventListener("pointerdown", (e) => this._onPointerDown(e))
        this.canvas.addEventListener("pointermove", (e) => this._onPointerMove(e))
        this.canvas.addEventListener("pointerup", (e) => this._onPointerUp(e))
        this.canvas.addEventListener("pointercancel", (e) => this._onPointerUp(e))
        this.canvas.addEventListener("contextmenu", (e) => e.preventDefault())
        this.canvas.addEventListener("wheel", (e) => this._onWheel(e), { passive: false })
        window.addEventListener("keydown", (e) => this._onKeyDown(e))

        // mousedown catches right-click while left button is held (pointerdown doesn't fire for
        // additional buttons when one is already pressed)
        this.canvas.addEventListener("mousedown", (e) => {
            if (e.button === 2 && this.state === HOLDING_DRAG) {
                this._rotateHeld()
            }
        })
    }

    _getPos(e) {
        const rect = this.canvas.getBoundingClientRect()
        return [e.clientX - rect.left, e.clientY - rect.top]
    }

    _isTouch() {
        return this._lastPointerType === "touch"
    }

    // -- Pointer down ------------------------------------

    _onPointerDown(e) {
        if (this.app.dialogOpen) return

        // Prevent browser default touch actions (iOS fullscreen exit, text selection, etc.)
        if (e.pointerType === "touch") e.preventDefault()

        this._lastPointerType = e.pointerType
        const [sx, sy] = this._getPos(e)
        this._pointers.set(e.pointerId, { sx, sy })

        // Capture pointer for reliable tracking
        try {
            this.canvas.setPointerCapture(e.pointerId)
        } catch (_err) {
            // ignore
        }

        // Right-click while holding — rotate (mouse only)
        // Check before pointer counting so right-click doesn't trigger pinch
        if (e.button === 2 && (this.state === HOLDING_CLICK || this.state === HOLDING_DRAG)) {
            this._pointers.delete(e.pointerId) // don't track right-click as a pointer
            this._rotateHeld()
            return
        }

        // Second finger arrives → pinch (touch only)
        if (this._isTouch() && this._pointers.size === 2) {
            this._clearLongPress()

            // Cancel any in-progress drag/hold
            if (this.state === HOLDING_DRAG || this.state === HOLDING_CLICK) {
                this._stopTouchLift()
                this.heldChunkId = null
                this.heldChunkIds = null
                this._updateFAB()
            }
            if (this.state === SELECTING) {
                this.selStart = null
                this.selEnd = null
            }

            this._startPinch()
            return
        }

        // Third+ finger — ignore
        if (this._pointers.size > 2) return

        // First pointer
        this._primaryPointerId = e.pointerId
        this.mouseScreen = [sx, sy]
        this._pointerDownTime = Date.now()
        this._pointerDownPos = [sx, sy]

        if (this.state === HOLDING_CLICK) {
            // Mouse only — touch never enters HOLDING_CLICK
            if (e.button === 0 && this.heldChunkId !== null && Date.now() - this._lastPickupTime < 400) {
                // Double-click: rotate in place and drop
                this.cm.rotateChunkAroundCenter(this.heldChunkId)
                this.heldChunkId = null
                this.heldChunkIds = null
                this.state = IDLE
                this.app.markDirty()
            } else if (e.button === 0) {
                // Second click drops the held piece
                this._dropHeld()
            }
            return
        }

        const [wx, wy] = this.renderer.screenToWorld(sx, sy)

        if (e.button === 2) {
            // Right button on background — start panning (mouse only)
            this.state = PANNING
            this.panStart = [sx, sy]
            this.panCamStart = [this.renderer.camera.x, this.renderer.camera.y]
            return
        }

        if (e.button === 0 || this._isTouch()) {
            const hit = this.cm.hitTest(wx, wy)

            if (hit) {
                this.state = PENDING_PICK
                this.pendingScreenPos = [sx, sy]
                this.pendingWorldPos = [wx, wy]
                this.pendingHit = hit
                this._clearLongPress()
            } else {
                // Touch: start panning on background (single finger)
                // Mouse: start selection rectangle
                if (this._isTouch()) {
                    this.state = PANNING
                    this.panStart = [sx, sy]
                    this.panCamStart = [this.renderer.camera.x, this.renderer.camera.y]

                    // Long-press on background starts selection
                    this._longPressTimer = setTimeout(() => {
                        this._longPressTimer = null
                        if (this.state === PANNING) {
                            // Convert to selection mode
                            const [lwx, lwy] = this.renderer.screenToWorld(sx, sy)
                            this.state = SELECTING
                            this.selStart = [lwx, lwy]
                            this.selEnd = [lwx, lwy]
                            // Vibrate feedback
                            if (navigator.vibrate) navigator.vibrate(50)
                            this.app._needsRender = true
                        }
                    }, LONG_PRESS_MS)
                } else {
                    this.state = SELECTING
                    this.selStart = [wx, wy]
                    this.selEnd = [wx, wy]
                }
            }
        }
    }

    // -- Pointer move ------------------------------------

    _onPointerMove(e) {
        if (e.pointerType === "touch") e.preventDefault()

        const [sx, sy] = this._getPos(e)
        this._pointers.set(e.pointerId, { sx, sy })
        this._lastPointerType = e.pointerType

        if (this.state === PINCHING) {
            this._updatePinch()
            return
        }

        // Only process primary pointer for single-finger operations
        // Allow mouse moves during HOLDING_CLICK (primaryPointerId is null after pointerup)
        if (e.pointerId !== this._primaryPointerId && this.state !== HOLDING_CLICK) return

        this.mouseScreen = [sx, sy]
        const [wx, wy] = this.renderer.screenToWorld(sx, sy)

        switch (this.state) {
            case PENDING_PICK: {
                const dist = vec2.distance([sx, sy], this.pendingScreenPos)
                if (dist > DRAG_THRESHOLD) {
                    this._clearLongPress()
                    this._pickupChunk(this.pendingHit, this.pendingWorldPos)
                    this.state = HOLDING_DRAG
                    if (this._isTouch()) this._startTouchLift()
                    this._moveHeld(wx, wy)
                    this._updateFAB()
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
                // Cancel long-press if finger moves significantly
                if (this._longPressTimer && this._pointerDownPos) {
                    const moveDist = vec2.distance([sx, sy], this._pointerDownPos)
                    if (moveDist > DRAG_THRESHOLD) {
                        this._clearLongPress()
                    }
                }
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

    // -- Pointer up --------------------------------------

    _onPointerUp(e) {
        this._pointers.delete(e.pointerId)
        this._lastPointerType = e.pointerType
        this._clearLongPress()

        // If we were pinching and one finger lifts, go to IDLE
        if (this.state === PINCHING) {
            if (this._pointers.size < 2) {
                this.state = IDLE
                this._primaryPointerId = null
                this.app.markDirty()
            }
            return
        }

        // Only process primary pointer
        if (e.pointerId !== this._primaryPointerId) return

        const wasTap = this._isTap(e)

        switch (this.state) {
            case PENDING_PICK:
                if (this._isTouch()) {
                    // Touch: double-tap rotates piece in place
                    if (
                        wasTap &&
                        this.pendingHit &&
                        this._lastTapChunkId === this.pendingHit.chunkId &&
                        Date.now() - this._lastTapTime < 400
                    ) {
                        this.cm.rotateChunkAroundCenter(this.pendingHit.chunkId)
                        this._lastTapChunkId = null
                        this._lastTapTime = 0
                        this.app.markDirty()
                    } else if (wasTap && this.pendingHit) {
                        this._lastTapTime = Date.now()
                        this._lastTapChunkId = this.pendingHit.chunkId
                    }
                    this.state = IDLE
                } else {
                    // Mouse: tap picks up into HOLDING_CLICK mode
                    this._pickupChunk(this.pendingHit, this.pendingWorldPos)
                    this.state = HOLDING_CLICK
                    this._updateFAB()
                }
                break

            case HOLDING_DRAG:
                if (this._isTouch() || e.button === 0) this._dropHeld()
                break

            case HOLDING_CLICK:
                // Mouse only — touch never enters HOLDING_CLICK
                // Don't clear primaryPointerId; piece keeps following cursor
                return

            case SELECTING:
                this._finishSelection()
                break

            case PANNING:
                // Touch: if it was a tap on background (no pan movement), just go idle
                this.state = IDLE
                this.app.markDirty()
                break
        }

        this._primaryPointerId = null
    }

    // -- Tap detection -----------------------------------

    _isTap(e) {
        if (!this._pointerDownPos) return false
        const [sx, sy] = this._getPos(e)
        const dist = vec2.distance([sx, sy], this._pointerDownPos)
        const elapsed = Date.now() - this._pointerDownTime
        return dist < TAP_THRESHOLD && elapsed < TAP_TIMEOUT
    }

    // -- Long press -----------------------------------

    _clearLongPress() {
        if (this._longPressTimer) {
            clearTimeout(this._longPressTimer)
            this._longPressTimer = null
        }
    }

    // -- Pinch zoom ------------------------------------

    _startPinch() {
        this.state = PINCHING
        const pts = Array.from(this._pointers.values())
        const [a, b] = pts
        this._pinchStartDist = Math.hypot(b.sx - a.sx, b.sy - a.sy)
        this._pinchStartZoom = this.renderer.camera.zoom
        this._pinchStartMid = [(a.sx + b.sx) / 2, (a.sy + b.sy) / 2]
        this._pinchStartCam = [this.renderer.camera.x, this.renderer.camera.y]
    }

    _updatePinch() {
        if (this._pointers.size < 2) return
        const pts = Array.from(this._pointers.values())
        const [a, b] = pts

        const dist = Math.hypot(b.sx - a.sx, b.sy - a.sy)
        const mid = [(a.sx + b.sx) / 2, (a.sy + b.sy) / 2]

        // Compute new zoom
        const scale = dist / this._pinchStartDist
        const newZoom = Math.max(0.1, Math.min(10, this._pinchStartZoom * scale))

        // Get world point under the starting midpoint
        const dpr = window.devicePixelRatio || 1
        const w = this.canvas.width
        const h = this.canvas.height
        const startWorldX = (this._pinchStartMid[0] * dpr - w / 2) / this._pinchStartZoom + this._pinchStartCam[0]
        const startWorldY = (this._pinchStartMid[1] * dpr - h / 2) / this._pinchStartZoom + this._pinchStartCam[1]

        // Apply zoom
        this.renderer.camera.zoom = newZoom

        // Pan so that the original world point stays under the current midpoint
        this.renderer.camera.x = startWorldX - (mid[0] * dpr - w / 2) / newZoom
        this.renderer.camera.y = startWorldY - (mid[1] * dpr - h / 2) / newZoom

        this.app.markDirty()
    }

    // -- Touch lift animation ----------------------------

    _startTouchLift() {
        const dpr = window.devicePixelRatio || 1
        const screenLift = (TOUCH_LIFT_PX * dpr) / this.renderer.camera.zoom
        this._touchLiftTarget = -Math.min(screenLift, TOUCH_LIFT_MAX_WORLD)
        this._touchLiftStartTime = Date.now()
        this._touchLiftY = 0

        if (this._touchLiftAnim) cancelAnimationFrame(this._touchLiftAnim)
        const animate = () => {
            const elapsed = Date.now() - this._touchLiftStartTime
            const t = Math.min(1, elapsed / TOUCH_LIFT_MS)
            // ease-out quad
            const eased = t * (2 - t)
            const prevLiftY = this._touchLiftY
            this._touchLiftY = this._touchLiftTarget * eased

            // Apply the delta to the current offset
            const delta = this._touchLiftY - prevLiftY
            if (this.heldChunkIds) {
                for (let i = 0; i < this.heldOffsets.length; i++) {
                    this.heldOffsets[i][1] += delta
                }
            } else {
                this.holdOffset[1] += delta
            }

            // Move piece to reflect new offset
            const [wx, wy] = this.renderer.screenToWorld(...this.mouseScreen)
            this._moveHeld(wx, wy)

            if (t < 1) {
                this._touchLiftAnim = requestAnimationFrame(animate)
            } else {
                this._touchLiftAnim = null
            }
        }
        this._touchLiftAnim = requestAnimationFrame(animate)
    }

    _stopTouchLift() {
        if (this._touchLiftAnim) {
            cancelAnimationFrame(this._touchLiftAnim)
            this._touchLiftAnim = null
        }
        this._touchLiftY = 0
        this._touchLiftTarget = 0
    }

    // -- Pickup ----------------------------------------

    _pickupChunk(hit, worldPos) {
        const chunk = this.cm.chunks.get(hit.chunkId)
        if (!chunk) return

        this.heldChunkId = hit.chunkId
        this.holdOffset = [chunk.x - worldPos[0], chunk.y - worldPos[1]]
        this.heldChunkIds = null
        this._lastPickupTime = Date.now()

        this.cm.bringToFront(hit.chunkId)
        this._skipNextTap = true
        this.app.markDirty()
    }

    _moveHeld(wx, wy) {
        if (this.heldChunkIds) {
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
        this._stopTouchLift()

        if (this.heldChunkIds) {
            this.heldChunkIds = null
            this.heldOffsets = null
            this.state = IDLE
            this.app.markDirty()
            this._updateFAB()
            return
        }

        if (this.heldChunkId !== null) {
            const chunkId = this.heldChunkId
            this.heldChunkId = null
            this.state = IDLE

            const snapped = this.cm.trySnap(chunkId)
            this.app.markDirty()

            if (snapped || this.cm.isComplete()) {
                this.app.onPieceSnapped()
            }
        }
        this._updateFAB()
    }

    // -- Rotation --------------------------------------

    _rotateHeld() {
        const [wx, wy] = this.renderer.screenToWorld(...this.mouseScreen)

        if (this.heldChunkIds) {
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

                this.cm.rotateChunkAroundCenter(cid)

                const dx = centers[i][0] - gcx
                const dy = centers[i][1] - gcy
                const rotated = vec2.rotate([dx, dy], rad)
                const newCenter = [gcx + rotated[0], gcy + rotated[1]]
                const currentCenter = this.cm.getChunkWorldCenter(cid)
                chunk.setPosition(chunk.x + newCenter[0] - currentCenter[0], chunk.y + newCenter[1] - currentCenter[1])
            }

            this.heldOffsets = this.heldChunkIds.map((cid) => {
                const chunk = this.cm.chunks.get(cid)
                return [chunk.x - wx, chunk.y - wy]
            })
        } else if (this.heldChunkId !== null) {
            this.cm.rotateChunkAroundCenter(this.heldChunkId)

            const chunk = this.cm.chunks.get(this.heldChunkId)
            if (chunk) {
                this.holdOffset = [chunk.x - wx, chunk.y - wy]
            }
        }
        this.app.markDirty()
    }

    // -- Selection rectangle ---------------------------

    _finishSelection() {
        const piecesInRect = this.cm.getPiecesInRect(this.selStart[0], this.selStart[1], this.selEnd[0], this.selEnd[1])

        if (piecesInRect.length > 0) {
            const chunkIdSet = new Set(piecesInRect.map((p) => p.chunkId))
            const chunkIds = Array.from(chunkIdSet)

            if (chunkIds.length === 1) {
                const hit = piecesInRect[0]
                const center = [(this.selStart[0] + this.selEnd[0]) / 2, (this.selStart[1] + this.selEnd[1]) / 2]
                this._pickupChunk(hit, center)
                this.state = HOLDING_CLICK
            } else {
                const center = [(this.selStart[0] + this.selEnd[0]) / 2, (this.selStart[1] + this.selEnd[1]) / 2]
                this.heldChunkIds = chunkIds
                this.heldOffsets = chunkIds.map((cid) => {
                    const chunk = this.cm.chunks.get(cid)
                    return [chunk.x - center[0], chunk.y - center[1]]
                })
                this.heldChunkId = null
                this.state = HOLDING_CLICK
                this._skipNextTap = true
            }
        } else {
            this.state = IDLE
        }

        this.selStart = null
        this.selEnd = null
        this.app.markDirty()
        this._updateFAB()
    }

    // -- FAB visibility --------------------------------

    _updateFAB() {
        const fab = document.getElementById("fab-rotate")
        if (!fab) return
        const show = this._isTouch() && this.isHolding
        if (show) {
            fab.classList.remove("hidden")
        } else {
            fab.classList.add("hidden")
        }
    }

    // -- Keyboard --------------------------------------

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
            case " ":
                this._rotateHeld()
                break
            case "o":
            case "s":
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
                    this._stopTouchLift()
                    this.heldChunkId = null
                    this.heldChunkIds = null
                    this.state = IDLE
                    this.app.markDirty()
                    this._updateFAB()
                }
                break
        }
    }

    // -- Wheel (zoom) ----------------------------------

    _onWheel(e) {
        e.preventDefault()
        const [sx, sy] = this._getPos(e)
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
        this.renderer.zoomAtScreen(sx, sy, factor)
        this.app.markDirty()
    }

    // -- Getters for rendering -------------------------

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
