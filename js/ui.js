import { detectMediaType } from "./media.js"

// ── Preset puzzles ────────────────────────────────────

const DEFAULT_PRESETS = [
    {
        name: "Sunset Mountains",
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1e/Sunrise_over_the_sea.jpg/1280px-Sunrise_over_the_sea.jpg",
        thumbnail:
            "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1e/Sunrise_over_the_sea.jpg/200px-Sunrise_over_the_sea.jpg"
    },
    {
        name: "Starry Night",
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg/1280px-Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg",
        thumbnail:
            "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg/200px-Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg"
    },
    {
        name: "Coral Reef",
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/Coral_reef_at_palmyra.jpg/1280px-Coral_reef_at_palmyra.jpg",
        thumbnail:
            "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/Coral_reef_at_palmyra.jpg/200px-Coral_reef_at_palmyra.jpg"
    },
    {
        name: "Earth from Space",
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/97/The_Earth_seen_from_Apollo_17.jpg/1024px-The_Earth_seen_from_Apollo_17.jpg",
        thumbnail:
            "https://upload.wikimedia.org/wikipedia/commons/thumb/9/97/The_Earth_seen_from_Apollo_17.jpg/200px-The_Earth_seen_from_Apollo_17.jpg"
    },
    {
        name: "Japanese Garden",
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fd/Japanese_garden_%28Cowden%29.jpg/1280px-Japanese_garden_%28Cowden%29.jpg",
        thumbnail:
            "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fd/Japanese_garden_%28Cowden%29.jpg/200px-Japanese_garden_%28Cowden%29.jpg"
    }
]

export let PRESETS = DEFAULT_PRESETS

export async function loadLocalPresets() {
    try {
        console.log("[presets] Attempting to load presets.local.js...")
        const mod = await import("../presets.local.js")
        console.log("[presets] Loaded module:", mod)
        if (Array.isArray(mod.default) && mod.default.length > 0) {
            PRESETS = mod.default
            console.log(`[presets] Applied ${PRESETS.length} local preset(s)`)
            return true
        } else {
            console.warn("[presets] presets.local.js has no valid default export, using defaults")
        }
    } catch (e) {
        console.log("[presets] No presets.local.js found, using defaults:", e.message)
    }
}

// ── UI Manager ────────────────────────────────────────

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
        this.celebrationOverlay = document.getElementById("celebration-overlay")
        this.videoPlayOverlay = document.getElementById("video-play-overlay")

        this._confirmResolve = null

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

        document.getElementById("btn-play-video").addEventListener("click", () => {
            this.app.startVideo()
            this.hideVideoPlayOverlay()
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
                ? `<img class="preset-thumb" src="${preset.thumbnail}" alt="${preset.name}" loading="lazy"
                    onerror="this.outerHTML='<div class=\\'preset-thumb-placeholder\\'>?</div>'">`
                : `<div class="preset-thumb-placeholder">?</div>`
            const label = preset.name + (detectMediaType(preset.url) === "video" ? " (video)" : "")
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

    // ── Dialog management ─────────────────────────────

    _showDialog(dialog) {
        this.backdrop.classList.remove("hidden")
        dialog.classList.remove("hidden")
        this.app.dialogOpen = true
    }

    _hideDialog(dialog) {
        dialog.classList.add("hidden")
        if (
            this.puzzleDialog.classList.contains("hidden") &&
            this.confirmDialog.classList.contains("hidden") &&
            this.helpDialog.classList.contains("hidden")
        ) {
            this.backdrop.classList.add("hidden")
            this.app.dialogOpen = false
        }
    }

    showPuzzleSelect() {
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
    }

    // ── Actions ───────────────────────────────────────

    _onStartPuzzle() {
        const selected = document.querySelector('input[name="puzzle-source"]:checked')
        if (!selected) return

        let url, name

        if (selected.value === "custom") {
            url = document.getElementById("custom-url-input").value.trim()
            if (!url) return
            name = "Custom Puzzle"
        } else {
            const idx = parseInt(selected.value.replace("preset-", ""))
            const preset = PRESETS[idx]
            url = preset.url
            name = preset.name
        }

        const pieceSize = parseInt(document.getElementById("piece-size-select").value)
        const rotationEnabled = document.getElementById("rotation-checkbox").checked

        this.closePuzzleSelect()
        this.app.startNewPuzzle({ url, name, pieceSize, rotationEnabled })
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

    // ── Puzzle dimensions ─────────────────────────────

    updatePuzzleDims(cols, rows) {
        const el = document.getElementById("puzzle-dims")
        if (cols && rows) {
            el.textContent = `${cols}\u00d7${rows} (${cols * rows} pieces)`
            el.style.display = ""
        } else {
            el.style.display = "none"
        }
    }

    // ── Audio controls ────────────────────────────────

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

    // ── Video play overlay ────────────────────────────

    showVideoPlayOverlay() {
        this.videoPlayOverlay.classList.remove("hidden")
    }

    hideVideoPlayOverlay() {
        this.videoPlayOverlay.classList.add("hidden")
    }

    // ── Celebration ───────────────────────────────────

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
    }
}
