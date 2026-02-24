const STORAGE_KEY = "muzzle_puzzle_state"
const DEBOUNCE_MS = 1500

export class StateManager {
    constructor() {
        this._dirty = false
        this._timer = null
        this._saveCallback = null

        window.addEventListener("beforeunload", () => {
            if (this._dirty) this._flushSave()
        })
    }

    setSaveCallback(fn) {
        this._saveCallback = fn
    }

    markDirty() {
        this._dirty = true
        if (this._timer) clearTimeout(this._timer)
        this._timer = setTimeout(() => this._flushSave(), DEBOUNCE_MS)
    }

    _flushSave() {
        if (!this._dirty || !this._saveCallback) return
        try {
            const data = this._saveCallback()
            if (data) {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
            }
        } catch (e) {
            console.warn("Failed to save state:", e)
        }
        this._dirty = false
        this._timer = null
    }

    load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY)
            if (!raw) return null
            const data = JSON.parse(raw)
            if (data && data.version === 1) return data
        } catch (e) {
            console.warn("Failed to load state:", e)
        }
        return null
    }

    clear() {
        localStorage.removeItem(STORAGE_KEY)
        this._dirty = false
        if (this._timer) {
            clearTimeout(this._timer)
            this._timer = null
        }
    }

    buildSaveData(puzzleConfig, chunkManager, camera, completed, volume, muted) {
        return {
            version: 1,
            puzzle: {
                url: puzzleConfig.url,
                type: puzzleConfig.type,
                seed: puzzleConfig.seed,
                cols: puzzleConfig.cols,
                rows: puzzleConfig.rows,
                rotationEnabled: puzzleConfig.rotationEnabled
            },
            chunks: chunkManager.serialize(),
            camera: { x: camera.x, y: camera.y, zoom: camera.zoom },
            completed,
            volume,
            muted
        }
    }
}
