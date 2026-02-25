import { detectMediaType } from "./media.js"

// -- Preset puzzles ------------------------------------

const DEFAULT_PRESETS = [
    {
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1e/Sunrise_over_the_sea.jpg/1280px-Sunrise_over_the_sea.jpg",
        thumbnail:
            "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1e/Sunrise_over_the_sea.jpg/200px-Sunrise_over_the_sea.jpg"
    },
    {
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg/1280px-Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg",
        thumbnail:
            "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg/200px-Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg"
    },
    {
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/Coral_reef_at_palmyra.jpg/1280px-Coral_reef_at_palmyra.jpg",
        thumbnail:
            "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/Coral_reef_at_palmyra.jpg/200px-Coral_reef_at_palmyra.jpg"
    },
    {
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/97/The_Earth_seen_from_Apollo_17.jpg/1024px-The_Earth_seen_from_Apollo_17.jpg",
        thumbnail:
            "https://upload.wikimedia.org/wikipedia/commons/thumb/9/97/The_Earth_seen_from_Apollo_17.jpg/200px-The_Earth_seen_from_Apollo_17.jpg"
    },
    {
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fd/Japanese_garden_%28Cowden%29.jpg/1280px-Japanese_garden_%28Cowden%29.jpg",
        thumbnail:
            "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fd/Japanese_garden_%28Cowden%29.jpg/200px-Japanese_garden_%28Cowden%29.jpg"
    }
]

export let PRESETS = DEFAULT_PRESETS

export function setPresets(p) {
    PRESETS = p
}

export function resolveUrl(url, baseUrl) {
    if (!url) return url
    try {
        new URL(url)
        return url
    } catch {
        return new URL(url, baseUrl).href
    }
}

export function labelFromUrl(url) {
    try {
        const path = new URL(url, "https://x").pathname
        const filename = decodeURIComponent(path.split("/").pop() || "")
        const stem = filename.replace(/\.[^.]+$/, "")
        return stem.replace(/[-_]+/g, " ")
    } catch {
        return url
    }
}

export async function loadLocalPresets() {
    try {
        console.log("[presets] Attempting to load presets.local.js...")
        const mod = await import("../presets.local.js")
        console.log("[presets] Loaded module:", mod)
        if (Array.isArray(mod.default) && mod.default.length > 0) {
            const baseUrl = new URL("../presets.local.js", window.location.href).href
            PRESETS = mod.default.map((p) => ({
                ...p,
                url: resolveUrl(p.url, baseUrl),
                thumbnail: p.thumbnail ? resolveUrl(p.thumbnail, baseUrl) : p.thumbnail
            }))
            console.log(`[presets] Applied ${PRESETS.length} local preset(s)`)
            return true
        } else {
            console.warn("[presets] presets.local.js has no valid default export, using defaults")
        }
    } catch (e) {
        console.log("[presets] No presets.local.js found, using defaults:", e.message)
    }
}

// -- UI Manager ----------------------------------------

export class UIManager {
    constructor(app) {
        this.app = app

        // Elements
        this.toolbar = document.getElementById("toolbar")
        this.btnNew = document.getElementById("btn-new")
        this.btnSolution = document.getElementById("btn-solution")
        this.btnCleanup = document.getElementById("btn-cleanup")
        this.btnShare = document.getElementById("btn-share")
        this.btnHelp = document.getElementById("btn-help")
        this.btnFullscreen = document.getElementById("btn-fullscreen")
        this.btnMute = document.getElementById("btn-mute")
        this.volumeSlider = document.getElementById("volume-slider")
        this.audioControls = document.getElementById("audio-controls")
        this.badgeComplete = document.getElementById("badge-complete")
        this.backdrop = document.getElementById("dialog-backdrop")

        // Dialogs
        this.puzzleDialog = document.getElementById("dialog-puzzle-select")
        this.confirmDialog = document.getElementById("dialog-confirm")
        this.helpDialog = document.getElementById("dialog-help")
        this.challengeDialog = document.getElementById("dialog-challenge-start")
        this.celebrationOverlay = document.getElementById("celebration-overlay")
        this.videoPlayOverlay = document.getElementById("video-play-overlay")

        // Challenge UI
        this.challengeIndicator = document.getElementById("challenge-indicator")
        this.btnChallengeNext = document.getElementById("btn-challenge-next")

        this._confirmResolve = null
        this._challengeResolve = null

        this._tooltip = document.createElement("div")
        this._tooltip.className = "preset-tooltip"
        document.body.appendChild(this._tooltip)

        this._bind()
        this._buildPresetList()
    }

    _bind() {
        // Blur toolbar buttons after click so keyboard shortcuts (e.g. Space) aren't captured
        this.toolbar.addEventListener("click", (e) => {
            if (e.target.tagName === "BUTTON") e.target.blur()
        })

        this.btnNew.addEventListener("click", () => this.showPuzzleSelect())
        this.btnSolution.addEventListener("click", () => this.app.toggleSolution())
        this.btnCleanup.addEventListener("click", () => this._onCleanup())
        this.btnShare.addEventListener("click", () => this._onShare())
        this.btnHelp.addEventListener("click", () => this.app.toggleHelp())
        this.btnFullscreen.addEventListener("click", () => this.app.toggleFullscreen())
        this.btnMute.addEventListener("click", () => this.app.toggleMute())
        this.volumeSlider.addEventListener("input", (e) => {
            this.app.setVolume(parseInt(e.target.value) / 100)
        })

        document.getElementById("btn-start-puzzle").addEventListener("click", () => this._onStartPuzzle())
        document.getElementById("btn-cancel-puzzle").addEventListener("click", () => this.closePuzzleSelect())

        document.getElementById("btn-confirm-yes").addEventListener("click", () => {
            if (this._confirmResolve) this._confirmResolve(true)
            this.closeConfirm()
        })
        document.getElementById("btn-confirm-no").addEventListener("click", () => {
            if (this._confirmResolve) this._confirmResolve(false)
            this.closeConfirm()
        })

        document.getElementById("btn-close-help").addEventListener("click", () => this.closeHelp())

        document.getElementById("btn-challenge-begin").addEventListener("click", () => {
            if (this._challengeResolve) {
                const pieceSize = parseInt(document.getElementById("challenge-piecesize-select").value)
                const rotationEnabled = document.getElementById("challenge-rotation-checkbox").checked
                this._challengeResolve({ pieceSize, rotationEnabled })
                this._challengeResolve = null
            }
            this._hideDialog(this.challengeDialog)
        })
        document.getElementById("btn-challenge-cancel").addEventListener("click", () => {
            if (this._challengeResolve) {
                this._challengeResolve(null)
                this._challengeResolve = null
            }
            this._hideDialog(this.challengeDialog)
        })
        this.btnChallengeNext.addEventListener("click", () => this.app.advanceChallenge())

        document.getElementById("btn-play-video").addEventListener("click", () => {
            this.app.startVideo()
            this.hideVideoPlayOverlay()
        })

        // Rotate FAB for touch devices
        document.getElementById("fab-rotate").addEventListener("pointerdown", (e) => {
            e.preventDefault()
            e.stopPropagation()
            if (this.app.input) this.app.input._rotateHeld()
        })

        // Custom URL radio toggle
        const customRadio = document.querySelector('input[name="puzzle-source"][value="custom"]')
        customRadio.addEventListener("change", () => {
            if (customRadio.checked) {
                document.getElementById("custom-url-input").disabled = false
                document
                    .getElementById("preset-list")
                    .querySelectorAll(".preset-item")
                    .forEach((el) => el.classList.remove("selected"))
            }
        })
    }

    _buildPresetList() {
        const list = document.getElementById("preset-list")
        list.innerHTML = ""

        PRESETS.forEach((preset, idx) => {
            const div = document.createElement("div")
            div.className = "preset-item" + (idx === 0 ? " selected" : "")
            const thumbHtml = preset.thumbnail
                ? `<img class="preset-thumb" src="${preset.thumbnail}" loading="lazy"
                    onerror="this.outerHTML='<div class=\\'preset-thumb-placeholder\\'>?</div>'">`
                : `<div class="preset-thumb-placeholder">?</div>`
            const label = labelFromUrl(preset.url) + (detectMediaType(preset.url) === "video" ? " (video)" : "")
            div.innerHTML = `
                <input type="radio" name="puzzle-source" value="preset-${idx}" id="preset-${idx}"
                  ${idx === 0 ? "checked" : ""}>
                ${thumbHtml}
            `
            div.addEventListener("click", () => {
                list.querySelectorAll(".preset-item").forEach((el) => el.classList.remove("selected"))
                div.classList.add("selected")
                document.getElementById(`preset-${idx}`).checked = true
                document.getElementById("custom-url-input").disabled = true
            })
            div.addEventListener("mouseenter", (e) => {
                const rect = e.currentTarget.getBoundingClientRect()
                this._tooltip.textContent = label
                this._tooltip.style.left = rect.left + rect.width / 2 + "px"
                this._tooltip.style.top = rect.top + "px"
                this._tooltip.classList.add("visible")
            })
            div.addEventListener("mouseleave", () => {
                this._tooltip.classList.remove("visible")
            })
            list.appendChild(div)
        })
    }

    // -- Dialog management -----------------------------

    _showDialog(dialog) {
        this.backdrop.classList.remove("hidden")
        dialog.classList.remove("hidden")
        this.app.dialogOpen = true
    }

    _hideDialog(dialog) {
        // Clear gamepad focus within this dialog
        const focused = dialog.querySelector(".gamepad-focus")
        if (focused) focused.classList.remove("gamepad-focus")

        dialog.classList.add("hidden")
        if (
            this.puzzleDialog.classList.contains("hidden") &&
            this.confirmDialog.classList.contains("hidden") &&
            this.helpDialog.classList.contains("hidden") &&
            this.challengeDialog.classList.contains("hidden")
        ) {
            this.backdrop.classList.add("hidden")
            this.app.dialogOpen = false
        }
    }

    showPuzzleSelect() {
        this.app.exitChallenge()
        this._populateFromCurrent()
        this._showDialog(this.puzzleDialog)
    }

    _populateFromCurrent() {
        const config = this.app.puzzleConfig
        if (!config) return

        // Match URL to a preset, or fall back to custom
        const presetIdx = PRESETS.findIndex((p) => p.url === config.url)
        const customInput = document.getElementById("custom-url-input")

        const list = document.getElementById("preset-list")
        list.querySelectorAll(".preset-item").forEach((el) => el.classList.remove("selected"))

        if (presetIdx >= 0) {
            document.getElementById(`preset-${presetIdx}`).checked = true
            const selectedItem = list.children[presetIdx]
            selectedItem?.classList.add("selected")
            selectedItem?.scrollIntoView({ block: "nearest" })
            customInput.disabled = true
            customInput.value = ""
        } else {
            document.querySelector('input[name="puzzle-source"][value="custom"]').checked = true
            customInput.disabled = false
            customInput.value = config.url
        }

        // Piece size — map short side of current grid to closest option
        const shortSide = Math.min(config.cols, config.rows)
        const select = document.getElementById("piece-size-select")
        const options = Array.from(select.options).map((o) => parseInt(o.value))
        const closest = options.reduce((a, b) => (Math.abs(b - shortSide) < Math.abs(a - shortSide) ? b : a))
        select.value = String(closest)

        // Rotation
        document.getElementById("rotation-checkbox").checked = config.rotationEnabled
    }

    closePuzzleSelect() {
        this._hideDialog(this.puzzleDialog)
    }

    showHelp() {
        // Show relevant control sections based on device capabilities
        const hasTouch = navigator.maxTouchPoints > 0
        const lastType = this.app.input ? this.app.input._lastPointerType : "mouse"
        const hasGamepad = this.app.gamepad && this.app.gamepad.active
        const mouseSection = document.getElementById("help-mouse-controls")
        const touchSection = document.getElementById("help-touch-controls")
        const kbSection = document.getElementById("help-keyboard-controls")
        const gamepadSection = document.getElementById("help-gamepad-controls")

        if (hasTouch && lastType === "touch") {
            // Touch-primary device
            mouseSection.style.display = "none"
            touchSection.style.display = ""
            kbSection.style.display = "none"
        } else if (hasTouch) {
            // Hybrid device — show all
            mouseSection.style.display = ""
            touchSection.style.display = ""
            kbSection.style.display = ""
        } else {
            // Mouse-only
            mouseSection.style.display = ""
            touchSection.style.display = "none"
            kbSection.style.display = ""
        }

        // Show gamepad section if a gamepad has been used
        if (gamepadSection) {
            gamepadSection.style.display = hasGamepad ? "" : "none"
        }

        this._showDialog(this.helpDialog)
    }

    closeHelp() {
        this._hideDialog(this.helpDialog)
    }

    confirm(message) {
        document.getElementById("confirm-message").textContent = message
        this._showDialog(this.confirmDialog)
        return new Promise((resolve) => {
            this._confirmResolve = resolve
        })
    }

    closeConfirm() {
        this._hideDialog(this.confirmDialog)
        this._confirmResolve = null
    }

    closeAllDialogs() {
        this.closePuzzleSelect()
        this.closeHelp()
        if (this._confirmResolve) this._confirmResolve(false)
        this.closeConfirm()
        if (this._challengeResolve) {
            this._challengeResolve(null)
            this._challengeResolve = null
        }
        this._hideDialog(this.challengeDialog)
    }

    // -- Actions ---------------------------------------

    _onStartPuzzle() {
        const selected = document.querySelector('input[name="puzzle-source"]:checked')
        if (!selected) return

        let url

        if (selected.value === "custom") {
            url = document.getElementById("custom-url-input").value.trim()
            if (!url) return
        } else {
            const idx = parseInt(selected.value.replace("preset-", ""))
            url = PRESETS[idx].url
        }

        const pieceSize = parseInt(document.getElementById("piece-size-select").value)
        const rotationEnabled = document.getElementById("rotation-checkbox").checked

        this.closePuzzleSelect()
        this.app.startNewPuzzle({ url, pieceSize, rotationEnabled })
    }

    async _onShare() {
        const url = this.app.getShareUrl()
        if (!url) return
        try {
            await navigator.clipboard.writeText(url)
            this.btnShare.textContent = "Copied!"
            setTimeout(() => {
                this.btnShare.textContent = "Share"
            }, 2000)
        } catch (_e) {
            // Fallback: select a prompt with the URL
            window.prompt("Copy this link to share:", url)
        }
    }

    async _onCleanup() {
        const yes = await this.confirm("This will reorganize all pieces into a grid. Continue?")
        if (yes) {
            this.app.cleanup(true)
        }
    }

    // -- Puzzle dimensions -----------------------------

    updatePuzzleDims(cols, rows) {
        const el = document.getElementById("puzzle-dims")
        if (cols && rows) {
            el.textContent = `${cols}\u00d7${rows} (${cols * rows} pieces)`
            el.style.display = ""
        } else {
            el.style.display = "none"
        }
    }

    // -- Audio controls --------------------------------

    showAudioControls() {
        this.audioControls.style.display = ""
    }

    hideAudioControls() {
        this.audioControls.style.display = "none"
    }

    updateMuteButton(muted) {
        this.btnMute.textContent = muted ? "Unmute" : "Mute"
    }

    updateVolume(vol) {
        this.volumeSlider.value = Math.round(vol * 100)
    }

    // -- Video play overlay ----------------------------

    showVideoPlayOverlay() {
        this.videoPlayOverlay.classList.remove("hidden")
    }

    hideVideoPlayOverlay() {
        this.videoPlayOverlay.classList.add("hidden")
    }

    // -- Celebration -----------------------------------

    showCelebration() {
        this.badgeComplete.style.display = ""
        this.celebrationOverlay.classList.remove("hidden")

        // Generate confetti
        const colors = ["#ff6b6b", "#ffd93d", "#6bcb77", "#4d96ff", "#ff6fff", "#ffa07a"]
        for (let i = 0; i < 60; i++) {
            const el = document.createElement("div")
            el.className = "confetti"
            el.style.left = Math.random() * 100 + "%"
            el.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)]
            el.style.width = 6 + Math.random() * 8 + "px"
            el.style.height = 6 + Math.random() * 8 + "px"
            el.style.borderRadius = Math.random() > 0.5 ? "50%" : "0"
            el.style.animationDuration = 2 + Math.random() * 3 + "s"
            el.style.animationDelay = Math.random() * 2 + "s"
            this.celebrationOverlay.appendChild(el)
        }

        // Auto-dismiss confetti after 6 seconds
        setTimeout(() => {
            this.celebrationOverlay.innerHTML = ""
            this.celebrationOverlay.classList.add("hidden")
        }, 6000)
    }

    hideCelebration() {
        this.badgeComplete.style.display = "none"
        this.celebrationOverlay.innerHTML = ""
        this.celebrationOverlay.classList.add("hidden")
        // Remove any lingering challenge final message
        document.querySelectorAll(".challenge-final-msg").forEach((el) => el.remove())
    }

    // -- Challenge Mode UI ----------------------------

    showChallengeStart(count, lockedPieceSize, lockedRotation, hasSavedState) {
        const desc = document.getElementById("challenge-description")
        desc.textContent = `This challenge has ${count} puzzle${count !== 1 ? "s" : ""}. Can you complete them all?`

        const pieceSizeSelect = document.getElementById("challenge-piecesize-select")
        const rotationCheckbox = document.getElementById("challenge-rotation-checkbox")

        if (lockedPieceSize != null) {
            pieceSizeSelect.value = String(lockedPieceSize)
            pieceSizeSelect.disabled = true
        } else {
            pieceSizeSelect.disabled = false
        }

        if (lockedRotation != null) {
            rotationCheckbox.checked = lockedRotation
            rotationCheckbox.disabled = true
        } else {
            rotationCheckbox.disabled = false
        }

        const warning = document.getElementById("challenge-warning")
        if (hasSavedState) {
            warning.classList.remove("hidden")
        } else {
            warning.classList.add("hidden")
        }

        this._showDialog(this.challengeDialog)
        return new Promise((resolve) => {
            this._challengeResolve = resolve
        })
    }

    updateChallengeIndicator(current, total) {
        this.challengeIndicator.textContent = `Puzzle ${current} / ${total}`
        this.challengeIndicator.style.display = ""
    }

    showChallengeNextButton() {
        this.btnChallengeNext.style.display = ""
    }

    hideChallengeNextButton() {
        this.btnChallengeNext.style.display = "none"
    }

    hideChallengeUI() {
        this.challengeIndicator.style.display = "none"
        this.btnChallengeNext.style.display = "none"
    }

    // -- Gamepad dialog focus navigation ----------------

    _getVisibleDialog() {
        if (!this.puzzleDialog.classList.contains("hidden")) return this.puzzleDialog
        if (!this.confirmDialog.classList.contains("hidden")) return this.confirmDialog
        if (!this.helpDialog.classList.contains("hidden")) return this.helpDialog
        if (!this.challengeDialog.classList.contains("hidden")) return this.challengeDialog
        return null
    }

    _getFocusableElements(dialog) {
        if (!dialog) return []
        const selectors = [
            ".preset-item",
            'input[type="radio"]:not(.preset-item input)',
            'input[type="text"]:not(:disabled)',
            'input[type="checkbox"]:not(:disabled)',
            "select:not(:disabled)",
            "button:not(:disabled)",
            'input[type="range"]'
        ]
        // Get all focusable elements, filter to visible ones
        const all = Array.from(dialog.querySelectorAll(selectors.join(",")))
        return all.filter((el) => {
            // Skip radio inputs inside preset-items (the .preset-item itself is the focusable)
            if (el.tagName === "INPUT" && el.type === "radio" && el.closest(".preset-item")) return false
            // Skip hidden elements
            if (el.offsetParent === null && !el.closest(".preset-item")) return false
            return true
        })
    }

    _getGamepadFocused() {
        const dialog = this._getVisibleDialog()
        if (!dialog) return null
        return dialog.querySelector(".gamepad-focus")
    }

    moveGamepadFocus(dx, dy, presetOnly = false) {
        const dialog = this._getVisibleDialog()
        if (!dialog) return

        const focusable = this._getFocusableElements(dialog)
        if (focusable.length === 0) return

        const current = this._getGamepadFocused()

        if (presetOnly) {
            // LB/RB: navigate only preset items
            const presets = focusable.filter((el) => el.classList.contains("preset-item"))
            if (presets.length === 0) return
            const idx = current ? presets.indexOf(current) : -1
            const next = dy > 0 || dx > 0 ? idx + 1 : idx - 1
            const clamped = Math.max(0, Math.min(presets.length - 1, next))
            this._setGamepadFocus(presets[clamped])
            return
        }

        if (!current) {
            // Nothing focused yet -- focus the first element
            this._setGamepadFocus(focusable[0])
            return
        }

        const idx = focusable.indexOf(current)
        if (idx === -1) {
            this._setGamepadFocus(focusable[0])
            return
        }

        // For preset grid: handle 2D navigation
        if (current.classList.contains("preset-item") && (dx !== 0 || dy !== 0)) {
            const presets = focusable.filter((el) => el.classList.contains("preset-item"))
            const presetIdx = presets.indexOf(current)
            if (presetIdx !== -1) {
                // Estimate grid columns from layout
                const gridCols = this._getPresetGridCols(presets)

                if (dx !== 0) {
                    const nextPreset = presetIdx + dx
                    if (nextPreset >= 0 && nextPreset < presets.length) {
                        this._setGamepadFocus(presets[nextPreset])
                        return
                    }
                }
                if (dy !== 0) {
                    const nextPreset = presetIdx + dy * gridCols
                    if (nextPreset >= 0 && nextPreset < presets.length) {
                        this._setGamepadFocus(presets[nextPreset])
                        return
                    }
                }

                // If dy and we're at the edge of presets, fall through to move to next element type
                if (dy > 0) {
                    // Move to the next non-preset element
                    const nextNonPreset = focusable.find((el, i) => i > idx && !el.classList.contains("preset-item"))
                    if (nextNonPreset) {
                        this._setGamepadFocus(nextNonPreset)
                        return
                    }
                }
                if (dy < 0) {
                    // Already at top of presets, nowhere to go
                    return
                }
            }
        }

        // Linear navigation for non-preset elements
        let nextIdx
        if (dy > 0 || dx > 0) {
            nextIdx = Math.min(focusable.length - 1, idx + 1)
        } else {
            nextIdx = Math.max(0, idx - 1)
        }
        this._setGamepadFocus(focusable[nextIdx])
    }

    _getPresetGridCols(presets) {
        if (presets.length < 2) return 1
        // Detect columns by comparing Y positions
        const y0 = presets[0].getBoundingClientRect().top
        for (let i = 1; i < presets.length; i++) {
            if (presets[i].getBoundingClientRect().top > y0 + 5) return i
        }
        return presets.length // all on one row
    }

    _setGamepadFocus(el) {
        // Remove previous focus
        const prev = this._getGamepadFocused()
        if (prev) prev.classList.remove("gamepad-focus")

        if (el) {
            el.classList.add("gamepad-focus")
            el.scrollIntoView({ block: "nearest", behavior: "smooth" })
        }
    }

    activateGamepadFocus() {
        const focused = this._getGamepadFocused()
        if (!focused) return

        if (focused.classList.contains("preset-item")) {
            // Simulate clicking the preset item
            focused.click()
            return
        }

        if (focused.tagName === "BUTTON") {
            focused.click()
            return
        }

        if (focused.tagName === "INPUT") {
            if (focused.type === "checkbox") {
                focused.checked = !focused.checked
                focused.dispatchEvent(new Event("change", { bubbles: true }))
                return
            }
            if (focused.type === "radio") {
                focused.checked = true
                focused.dispatchEvent(new Event("change", { bubbles: true }))
                return
            }
        }

        if (focused.tagName === "SELECT") {
            // Cycle through options
            const select = focused
            select.selectedIndex = (select.selectedIndex + 1) % select.options.length
            select.dispatchEvent(new Event("change", { bubbles: true }))
            return
        }
    }

    showChallengeFinalCelebration() {
        this.badgeComplete.textContent = "Challenge Complete!"
        this.badgeComplete.style.display = ""
        this.celebrationOverlay.classList.remove("hidden")

        // Extra confetti (120 particles)
        const colors = ["#ff6b6b", "#ffd93d", "#6bcb77", "#4d96ff", "#ff6fff", "#ffa07a"]
        for (let i = 0; i < 120; i++) {
            const el = document.createElement("div")
            el.className = "confetti"
            el.style.left = Math.random() * 100 + "%"
            el.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)]
            el.style.width = 6 + Math.random() * 8 + "px"
            el.style.height = 6 + Math.random() * 8 + "px"
            el.style.borderRadius = Math.random() > 0.5 ? "50%" : "0"
            el.style.animationDuration = 2 + Math.random() * 3 + "s"
            el.style.animationDelay = Math.random() * 2 + "s"
            this.celebrationOverlay.appendChild(el)
        }

        // Centered overlay message
        const msg = document.createElement("div")
        msg.className = "challenge-final-msg"
        msg.textContent = "You beat the challenge!"
        document.body.appendChild(msg)

        // Auto-dismiss after 10 seconds
        setTimeout(() => {
            this.celebrationOverlay.innerHTML = ""
            this.celebrationOverlay.classList.add("hidden")
            msg.remove()
        }, 10000)
    }
}
