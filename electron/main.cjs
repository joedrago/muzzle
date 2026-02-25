const { app, BrowserWindow } = require("electron")
const path = require("path")
const fs = require("fs")

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

    win.loadURL(config.endpoint)

    // Hide menu bar completely
    win.setMenuBarVisibility(false)

    // Close window when the web page calls window.close()
    // (triggered by Escape in idle state or gamepad quit combo)
    win.on("page-title-updated", (e) => e.preventDefault())
}

app.whenReady().then(createWindow)

app.on("window-all-closed", () => {
    app.quit()
})
