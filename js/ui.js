// ── Preset puzzles ────────────────────────────────────

export const PRESETS = [
    {
        name: "Sunset Mountains",
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1e/Sunrise_over_the_sea.jpg/1280px-Sunrise_over_the_sea.jpg",
        type: "image"
    },
    {
        name: "Starry Night",
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg/1280px-Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg",
        type: "image"
    },
    {
        name: "Coral Reef",
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/Coral_reef_at_palmyra.jpg/1280px-Coral_reef_at_palmyra.jpg",
        type: "image"
    },
    {
        name: "Earth from Space",
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/97/The_Earth_seen_from_Apollo_17.jpg/1024px-The_Earth_seen_from_Apollo_17.jpg",
        type: "image"
    },
    {
        name: "Japanese Garden",
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fd/Japanese_garden_%28Cowden%29.jpg/1280px-Japanese_garden_%28Cowden%29.jpg",
        type: "image"
    }
]

// ── UI Manager ────────────────────────────────────────

export class UIManager {
    constructor(app) {
        this.app = app

        // Elements
        this.toolbar = document.getElementById("toolbar")
        this.btnNew = document.getElementById("btn-new")
        this.btnSolution = document.getElementById("btn-solution")
        this.btnCleanup = document.getElementById("btn-cleanup")
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

        this._bind()
        this._buildPresetList()
    }

    _bind() {
        this.btnNew.addEventListener("click", () => this.showPuzzleSelect())
        this.btnSolution.addEventListener("click", () => this.app.toggleSolution())
        this.btnCleanup.addEventListener("click", () => this._onCleanup())
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
        const radios = document.querySelectorAll('input[name="puzzle-source"]')
        radios.forEach((radio) => {
            radio.addEventListener("change", () => {
                document.getElementById("custom-url-input").disabled =
                    document.querySelector('input[name="puzzle-source"]:checked')?.value !== "custom"
            })
        })
    }

    _buildPresetList() {
        const list = document.getElementById("preset-list")
        list.innerHTML = ""

        PRESETS.forEach((preset, idx) => {
            const div = document.createElement("div")
            div.className = "preset-item"
            div.innerHTML = `
        <input type="radio" name="puzzle-source" value="preset-${idx}" id="preset-${idx}"
          ${idx === 0 ? "checked" : ""}>
        <label for="preset-${idx}">${preset.name}</label>
        <span class="preset-type ${preset.type}">${preset.type}</span>
      `
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
        this._showDialog(this.puzzleDialog)
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

        let url, type, name

        if (selected.value === "custom") {
            url = document.getElementById("custom-url-input").value.trim()
            if (!url) return
            name = "Custom Puzzle"
            type = null // auto-detect
        } else {
            const idx = parseInt(selected.value.replace("preset-", ""))
            const preset = PRESETS[idx]
            url = preset.url
            type = preset.type
            name = preset.name
        }

        const pieceCount = parseInt(document.getElementById("piece-count-select").value)
        const rotationEnabled = document.getElementById("rotation-checkbox").checked

        this.closePuzzleSelect()
        this.app.startNewPuzzle({ url, type, name, pieceCount, rotationEnabled })
    }

    async _onCleanup() {
        const yes = await this.confirm("This will reorganize all pieces into a grid. Continue?")
        if (yes) {
            this.app.cleanup()
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
