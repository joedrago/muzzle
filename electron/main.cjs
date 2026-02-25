const { app, BrowserWindow, session } = require("electron")
const path = require("path")
const fs = require("fs")

// Ensure hardware acceleration for WebGL
app.commandLine.appendSwitch("enable-gpu-rasterization")
app.commandLine.appendSwitch("enable-webgl")
app.commandLine.appendSwitch("ignore-gpu-blocklist")

function loadConfig() {
    const configPath = path.join(__dirname, "config.json")
    const configData = fs.readFileSync(configPath, "utf-8")
    return JSON.parse(configData)
}

function createWindow() {
    const config = loadConfig()

    const win = new BrowserWindow({
        fullscreen: true,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    })

    // Clear cache on startup to ensure fresh code is loaded
    session.defaultSession.clearCache().then(() => {
        win.loadURL(config.endpoint)
    })

    // Hide menu bar completely
    win.setMenuBarVisibility(false)

    // Open devtools in development (set MUZZLE_DEV=1 to enable)
    if (process.env.MUZZLE_DEV) {
        win.webContents.openDevTools({ mode: "detach" })
    }

    win.on("page-title-updated", (e) => e.preventDefault())
}

app.whenReady().then(createWindow)

app.on("window-all-closed", () => {
    app.quit()
})
