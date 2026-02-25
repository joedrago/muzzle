// -- Gamepad support -----------------------------------
// Provides full gamepad navigation for puzzles and dialogs.
//
// Standard Gamepad mapping:
//   A (0)       = Pick up / place piece; activate UI element
//   B (1)       = Cancel (drop without placing, close dialog, quit if idle)
//   X (2)       = Rotate held piece
//   Y (3)       = Toggle solution overlay
//   LB (4)      = Zoom out
//   RB (5)      = Zoom in
//   LT (6)      = (unused)
//   RT (7)      = (unused)
//   Select (8)  = Toggle help
//   Start (9)   = Open/close puzzle select dialog
//   L3 (10)     = (unused)
//   R3 (11)     = (unused)
//   D-pad Up (12), Down (13), Left (14), Right (15)
//
// Axes: leftStick [0,1], rightStick [2,3]

const DEAD_ZONE = 0.05
const NAV_REPEAT_DELAY = 400 // ms before first repeat
const NAV_REPEAT_RATE = 120 // ms between repeats
const DPAD_ACCEL = 400 // world units/sec^2 for d-pad movement
const DPAD_MAX_SPEED = 600 // world units/sec max d-pad speed
const ANALOG_MAX_SPEED = 700 // world units/sec at full tilt
const CAMERA_PAN_SPEED = 800 // world units/sec for right stick camera pan
const ZOOM_SPEED = 2.0 // zoom multiplier per second
const QUIT_HOLD_MS = 500 // hold Start+Select for this long to quit
// Button indices (standard gamepad)
const BTN_A = 0
const BTN_B = 1
const BTN_X = 2
const BTN_Y = 3
const BTN_LB = 4
const BTN_RB = 5
const BTN_SELECT = 8
const BTN_START = 9
const BTN_DPAD_UP = 12
const BTN_DPAD_DOWN = 13
const BTN_DPAD_LEFT = 14
const BTN_DPAD_RIGHT = 15

export class GamepadManager {
    constructor(app) {
        this.app = app
        this.active = false // true when a gamepad is actively being used

        // Highlighted chunk in navigation mode
        this.highlightedChunkId = null

        // Pre-pickup position for cancel
        this._prePickupPos = null
        this._prePickupRot = null

        // Button state: pressed[i] = true if currently pressed
        this._prevButtons = new Array(17).fill(false)
        this._currButtons = new Array(17).fill(false)

        // Axes
        this._axes = [0, 0, 0, 0]

        // D-pad navigation repeat timing
        this._navRepeatDir = null // [dx, dy] or null
        this._navRepeatTime = 0 // next repeat timestamp
        this._navFirstRepeat = true

        // D-pad movement velocity (when holding a piece)
        this._dpadVelocity = [0, 0]

        // Quit combo tracking
        this._quitHoldStart = 0

        // Connected gamepad index
        this._gamepadIndex = null

        // Listen for gamepad connections
        window.addEventListener("gamepadconnected", (e) => {
            this._gamepadIndex = e.gamepad.index
            console.log(`Gamepad connected: ${e.gamepad.id}`)
        })
        window.addEventListener("gamepaddisconnected", (e) => {
            if (this._gamepadIndex === e.gamepad.index) {
                this._gamepadIndex = null
                this.active = false
                this.highlightedChunkId = null
            }
            console.log(`Gamepad disconnected: ${e.gamepad.id}`)
        })
    }

    // Called once per frame from the render loop
    poll(dt) {
        if (this._gamepadIndex === null) return false

        const gamepads = navigator.getGamepads()
        const gp = gamepads[this._gamepadIndex]
        if (!gp || !gp.connected) return false

        // Read button state
        for (let i = 0; i < 17 && i < gp.buttons.length; i++) {
            this._prevButtons[i] = this._currButtons[i]
            this._currButtons[i] = gp.buttons[i].pressed
        }

        // Read axes with dead zone
        for (let i = 0; i < 4 && i < gp.axes.length; i++) {
            const raw = gp.axes[i]
            this._axes[i] = Math.abs(raw) > DEAD_ZONE ? raw : 0
        }

        // Check if any input is active
        const anyInput = this._currButtons.some((b) => b) || this._axes.some((a) => a !== 0)
        if (anyInput) this.active = true
        if (!this.active) {
            this.updateLegend()
            return false
        }

        // Process quit combo (Start + Select held together)
        this._processQuitCombo()

        // Route input based on app state
        if (this.app.dialogOpen) {
            this._processDialogInput(dt)
        } else if (this._isHolding()) {
            this._processHoldingInput(dt)
        } else {
            this._processNavigationInput(dt)
        }

        // Always process camera (right stick + bumper zoom) unless dialog is open
        if (!this.app.dialogOpen) {
            this._processCamera(dt)
        }

        // Update the on-screen button legend
        this.updateLegend()

        return anyInput
    }

    // -- Button edge detection ---

    _justPressed(btn) {
        return this._currButtons[btn] && !this._prevButtons[btn]
    }

    _isPressed(btn) {
        return this._currButtons[btn]
    }

    _isHolding() {
        const input = this.app.input
        return input && (input.heldChunkId !== null || input.heldChunkIds !== null)
    }

    // -- D-pad as directional vector ---

    _getDpadDirection() {
        let dx = 0,
            dy = 0
        if (this._isPressed(BTN_DPAD_UP)) dy = -1
        if (this._isPressed(BTN_DPAD_DOWN)) dy = 1
        if (this._isPressed(BTN_DPAD_LEFT)) dx = -1
        if (this._isPressed(BTN_DPAD_RIGHT)) dx = 1
        return [dx, dy]
    }

    // Combined left stick + d-pad direction (d-pad takes priority for navigation)
    _getLeftDir() {
        const [dpx, dpy] = this._getDpadDirection()
        if (dpx !== 0 || dpy !== 0) return [dpx, dpy]
        const lx = this._axes[0]
        const ly = this._axes[1]
        if (Math.abs(lx) > 0 || Math.abs(ly) > 0) return [lx, ly]
        return [0, 0]
    }

    // -- Quit combo ---

    _processQuitCombo() {
        if (this._isPressed(BTN_START) && this._isPressed(BTN_SELECT)) {
            if (this._quitHoldStart === 0) {
                this._quitHoldStart = Date.now()
            } else if (Date.now() - this._quitHoldStart >= QUIT_HOLD_MS) {
                window.close()
            }
        } else {
            this._quitHoldStart = 0
        }
    }

    // -- Navigation mode (no piece held) ---

    _processNavigationInput(_dt) {
        const cm = this.app.cm
        if (!cm || cm.chunks.size === 0) return

        // Validate current highlight still exists
        if (this.highlightedChunkId !== null && !cm.chunks.has(this.highlightedChunkId)) {
            this.highlightedChunkId = null
        }

        // D-pad / left stick navigation with repeat
        const [dx, dy] = this._getLeftDir()
        const hasDir = dx !== 0 || dy !== 0
        const dirKey = hasDir ? `${Math.sign(dx)},${Math.sign(dy)}` : null

        if (hasDir) {
            const now = Date.now()
            if (this._navRepeatDir !== dirKey) {
                // New direction - navigate immediately
                this._navRepeatDir = dirKey
                this._navFirstRepeat = true
                this._navRepeatTime = now + NAV_REPEAT_DELAY
                this._navigateToNearest(dx, dy)
            } else if (now >= this._navRepeatTime) {
                // Repeat
                this._navRepeatTime = now + NAV_REPEAT_RATE
                this._navigateToNearest(dx, dy)
            }
        } else {
            this._navRepeatDir = null
        }

        // A button: pick up highlighted chunk
        if (this._justPressed(BTN_A) && this.highlightedChunkId !== null) {
            this._pickupHighlighted()
        }

        // B button: close app (nothing to cancel)
        if (this._justPressed(BTN_B)) {
            window.close()
        }

        // X button: rotate highlighted chunk in place
        if (this._justPressed(BTN_X) && this.highlightedChunkId !== null) {
            cm.rotateChunkAroundCenter(this.highlightedChunkId)
            this.app.markDirty()
        }

        // Y button: toggle solution
        if (this._justPressed(BTN_Y)) {
            this.app.toggleSolution()
        }

        // Start: open puzzle select
        if (this._justPressed(BTN_START)) {
            this.app.ui.showPuzzleSelect()
        }

        // Select: cleanup (no confirmation)
        if (this._justPressed(BTN_SELECT)) {
            this.app.cleanup(true)
        }
    }

    _navigateToNearest(dx, dy) {
        const cm = this.app.cm
        const renderer = this.app.renderer

        // If nothing highlighted, pick the chunk nearest to screen center
        if (this.highlightedChunkId === null) {
            const [wcx, wcy] = renderer.screenToWorld(this.app.canvas.clientWidth / 2, this.app.canvas.clientHeight / 2)
            let bestId = null
            let bestDist = Infinity
            for (const chunk of cm.chunks.values()) {
                const center = cm.getChunkWorldCenter(chunk.id)
                const d = (center[0] - wcx) ** 2 + (center[1] - wcy) ** 2
                if (d < bestDist) {
                    bestDist = d
                    bestId = chunk.id
                }
            }
            this.highlightedChunkId = bestId
            this.app.markDirty()
            return
        }

        // Find nearest chunk in the given direction using a cone test
        const fromCenter = cm.getChunkWorldCenter(this.highlightedChunkId)
        const dirLen = Math.sqrt(dx * dx + dy * dy)
        if (dirLen === 0) return
        const ndx = dx / dirLen
        const ndy = dy / dirLen

        let bestId = null
        let bestScore = Infinity

        for (const chunk of cm.chunks.values()) {
            if (chunk.id === this.highlightedChunkId) continue
            const center = cm.getChunkWorldCenter(chunk.id)
            const tox = center[0] - fromCenter[0]
            const toy = center[1] - fromCenter[1]
            const dist = Math.sqrt(tox * tox + toy * toy)
            if (dist < 0.01) continue

            // Dot product for direction alignment
            const dot = (tox / dist) * ndx + (toy / dist) * ndy
            // Must be at least somewhat in the right direction (within ~90 degree cone)
            if (dot < 0.3) continue

            // Score: prefer close + aligned. Lower is better.
            const score = dist / (dot * dot)
            if (score < bestScore) {
                bestScore = score
                bestId = chunk.id
            }
        }

        if (bestId !== null) {
            this.highlightedChunkId = bestId
            this._ensureHighlightVisible()
            this.app.markDirty()
        }
    }

    _ensureHighlightVisible() {
        // Gently scroll camera if highlighted chunk is off-screen
        if (this.highlightedChunkId === null) return
        const cm = this.app.cm
        const renderer = this.app.renderer
        const center = cm.getChunkWorldCenter(this.highlightedChunkId)
        const [sx, sy] = renderer.worldToScreen(center[0], center[1])
        const cw = this.app.canvas.clientWidth
        const ch = this.app.canvas.clientHeight
        const margin = 80

        let panX = 0,
            panY = 0
        if (sx < margin) panX = sx - margin
        else if (sx > cw - margin) panX = sx - (cw - margin)
        if (sy < margin + 44)
            panY = sy - (margin + 44) // account for toolbar
        else if (sy > ch - margin) panY = sy - (ch - margin)

        if (panX !== 0 || panY !== 0) {
            const dpr = window.devicePixelRatio || 1
            renderer.camera.x += (panX * dpr) / renderer.camera.zoom
            renderer.camera.y += (panY * dpr) / renderer.camera.zoom
        }
    }

    _pickupHighlighted() {
        const cm = this.app.cm
        const input = this.app.input
        if (!input || this.highlightedChunkId === null) return

        const chunk = cm.chunks.get(this.highlightedChunkId)
        if (!chunk) return

        // Store pre-pickup position for cancel
        this._prePickupPos = [chunk.x, chunk.y]
        this._prePickupRot = chunk.rotation

        // Pick up with offset [0,0] (piece moves from its current position)
        cm.bringToFront(this.highlightedChunkId)
        input.heldChunkId = this.highlightedChunkId
        input.holdOffset = [0, 0]
        input.heldChunkIds = null
        input.state = "HOLDING_CLICK"

        // Reset d-pad velocity
        this._dpadVelocity = [0, 0]

        this.app.markDirty()
    }

    // -- Holding mode (piece held) ---

    _processHoldingInput(dt) {
        const input = this.app.input
        const cm = this.app.cm
        if (!input || !cm) return

        const chunkId = input.heldChunkId
        if (chunkId === null) return
        const chunk = cm.chunks.get(chunkId)
        if (!chunk) return

        // Compute movement from d-pad (acceleration) and analog stick (proportional)
        const [dpx, dpy] = this._getDpadDirection()
        const lx = this._axes[0]
        const ly = this._axes[1]

        // D-pad acceleration
        if (dpx !== 0 || dpy !== 0) {
            // Accelerate
            this._dpadVelocity[0] += dpx * DPAD_ACCEL * dt
            this._dpadVelocity[1] += dpy * DPAD_ACCEL * dt
            // Clamp to max speed
            const speed = Math.sqrt(this._dpadVelocity[0] ** 2 + this._dpadVelocity[1] ** 2)
            if (speed > DPAD_MAX_SPEED) {
                this._dpadVelocity[0] = (this._dpadVelocity[0] / speed) * DPAD_MAX_SPEED
                this._dpadVelocity[1] = (this._dpadVelocity[1] / speed) * DPAD_MAX_SPEED
            }
        } else {
            // Instant stop
            this._dpadVelocity = [0, 0]
        }

        // Analog stick: proportional velocity with quadratic response curve
        // This makes small inputs slow for precision, full tilt = full speed
        const analogMag = Math.sqrt(lx * lx + ly * ly)
        const analogScale = analogMag * analogMag // quadratic: mag^2
        const analogVelX = analogMag > 0 ? (lx / analogMag) * analogScale * ANALOG_MAX_SPEED : 0
        const analogVelY = analogMag > 0 ? (ly / analogMag) * analogScale * ANALOG_MAX_SPEED : 0

        // Combine: use whichever has greater magnitude
        let moveX, moveY
        const dpadSpeed = Math.sqrt(this._dpadVelocity[0] ** 2 + this._dpadVelocity[1] ** 2)
        const analogSpeed = Math.sqrt(analogVelX ** 2 + analogVelY ** 2)

        if (dpadSpeed >= analogSpeed) {
            moveX = this._dpadVelocity[0] * dt
            moveY = this._dpadVelocity[1] * dt
        } else {
            moveX = analogVelX * dt
            moveY = analogVelY * dt
        }

        // Apply movement (adjust for zoom so speed feels consistent)
        if (moveX !== 0 || moveY !== 0) {
            const zoomAdjust = 1 / this.app.renderer.camera.zoom
            chunk.setPosition(chunk.x + moveX * zoomAdjust, chunk.y + moveY * zoomAdjust)
            this.app.markDirty()
        }

        // A button: drop/place
        if (this._justPressed(BTN_A)) {
            this._dropHeld()
        }

        // B button: cancel (return to pre-pickup position)
        if (this._justPressed(BTN_B)) {
            this._cancelHeld()
        }

        // X button: rotate
        if (this._justPressed(BTN_X)) {
            cm.rotateChunkAroundCenter(chunkId)
            this.app.markDirty()
        }
    }

    _dropHeld() {
        const input = this.app.input
        if (!input) return

        const chunkId = input.heldChunkId
        input.heldChunkId = null
        input.heldChunkIds = null
        input.state = "IDLE"

        if (chunkId !== null) {
            const snapped = this.app.cm.trySnap(chunkId)
            this.app.markDirty()
            if (snapped || this.app.cm.isComplete()) {
                this.app.onPieceSnapped()
            }
        }

        this._prePickupPos = null
        this._prePickupRot = null
        this._dpadVelocity = [0, 0]
    }

    _cancelHeld() {
        const input = this.app.input
        const cm = this.app.cm
        if (!input) return

        const chunkId = input.heldChunkId
        if (chunkId !== null && this._prePickupPos) {
            const chunk = cm.chunks.get(chunkId)
            if (chunk) {
                chunk.setPosition(this._prePickupPos[0], this._prePickupPos[1])
                chunk.setRotation(this._prePickupRot)
            }
        }

        input.heldChunkId = null
        input.heldChunkIds = null
        input.state = "IDLE"
        this._prePickupPos = null
        this._prePickupRot = null
        this._dpadVelocity = [0, 0]
        this.app.markDirty()
    }

    // -- Camera control ---

    _processCamera(dt) {
        const renderer = this.app.renderer
        const rx = this._axes[2]
        const ry = this._axes[3]

        // Right stick pans camera
        if (rx !== 0 || ry !== 0) {
            const zoomAdjust = 1 / renderer.camera.zoom
            renderer.camera.x += rx * CAMERA_PAN_SPEED * dt * zoomAdjust
            renderer.camera.y += ry * CAMERA_PAN_SPEED * dt * zoomAdjust
            this.app.markDirty()
        }

        // LB/RB zoom
        if (this._isPressed(BTN_LB)) {
            const factor = 1 / (1 + (ZOOM_SPEED - 1) * dt * 4)
            renderer.camera.zoom = Math.max(0.1, Math.min(10, renderer.camera.zoom * factor))
            this.app.markDirty()
        }
        if (this._isPressed(BTN_RB)) {
            const factor = 1 + (ZOOM_SPEED - 1) * dt * 4
            renderer.camera.zoom = Math.max(0.1, Math.min(10, renderer.camera.zoom * factor))
            this.app.markDirty()
        }
    }

    // -- Dialog mode ---

    _processDialogInput(_dt) {
        const ui = this.app.ui

        // D-pad / left stick for focus navigation
        const [dx, dy] = this._getLeftDir()
        const hasDir = dx !== 0 || dy !== 0
        const dirKey = hasDir ? `${Math.sign(dx)},${Math.sign(dy)}` : null

        if (hasDir) {
            const now = Date.now()
            if (this._navRepeatDir !== dirKey) {
                this._navRepeatDir = dirKey
                this._navFirstRepeat = true
                this._navRepeatTime = now + NAV_REPEAT_DELAY
                this._navigateDialog(dx, dy)
            } else if (now >= this._navRepeatTime) {
                this._navRepeatTime = now + NAV_REPEAT_RATE
                this._navigateDialog(dx, dy)
            }
        } else {
            this._navRepeatDir = null
        }

        // A button: activate focused element
        if (this._justPressed(BTN_A)) {
            ui.activateGamepadFocus()
        }

        // B button: close/cancel dialog
        if (this._justPressed(BTN_B)) {
            this.app.closeAllDialogs()
        }

        // LB/RB: quick-navigate presets
        if (this._justPressed(BTN_LB)) {
            ui.moveGamepadFocus(0, -1, true) // up/prev in list
        }
        if (this._justPressed(BTN_RB)) {
            ui.moveGamepadFocus(0, 1, true) // down/next in list
        }
    }

    _navigateDialog(dx, dy) {
        // Quantize to cardinal direction
        if (Math.abs(dx) > Math.abs(dy)) {
            this.app.ui.moveGamepadFocus(Math.sign(dx), 0)
        } else {
            this.app.ui.moveGamepadFocus(0, Math.sign(dy))
        }
    }

    // -- Button legend ---

    updateLegend() {
        const el = document.getElementById("gamepad-legend")
        if (!el) return

        if (!this.active) {
            el.classList.add("hidden")
            return
        }

        el.classList.remove("hidden")
        const b = (label) => `<span class="legend-btn">${label}</span>`

        let lines
        if (this.app.dialogOpen) {
            lines = [`${b("D-pad")} Navigate`, `${b("A")} Select`, `${b("B")} Cancel`, `${b("LB")} ${b("RB")} Prev / Next`]
        } else if (this._isHolding()) {
            lines = [
                `${b("D-pad")} ${b("L")} Move piece`,
                `${b("A")} Place`,
                `${b("B")} Cancel`,
                `${b("X")} Rotate`,
                `${b("R")} Pan camera`,
                `${b("LB")} ${b("RB")} Zoom`
            ]
        } else {
            lines = [
                `${b("D-pad")} ${b("L")} Select piece`,
                `${b("A")} Pick up`,
                `${b("X")} Rotate`,
                `${b("Y")} Solution`,
                `${b("R")} Pan camera`,
                `${b("LB")} ${b("RB")} Zoom`,
                `${b("Start")} New puzzle`,
                `${b("Sel")} Cleanup`
            ]
        }

        el.innerHTML = lines.join("<br>")
    }
}
