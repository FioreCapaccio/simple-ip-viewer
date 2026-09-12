// Electron main process.
//
// This app's UI needs a running Nitro/Node server (it proxies HTTP requests
// to the LAN machine and rewrites the returned HTML — see
// src/lib/proxy.functions.ts), so we can't just load static files. Instead we
// spawn the server that `bun run build:desktop` produces at
// `.output/server/index.mjs` as a child process on a local loopback port, and
// point a BrowserWindow at it once it responds.
const { app, BrowserWindow, Menu, shell } = require("electron");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");

const isDev = !app.isPackaged;
const PORT = process.env.LAN_VIEWER_PORT || "4790";
// In dev this reads the repo's own .output/ (produced by `bun run build:desktop`).
// In a packaged app, electron-builder copies .output/ verbatim into the
// resources dir as "output" (see build.extraResources in package.json), and
// server/index.mjs still expects its sibling public/ dir next to it.
const SERVER_ENTRY = isDev
  ? path.join(__dirname, "..", ".output", "server", "index.mjs")
  : path.join(process.resourcesPath, "output", "server", "index.mjs");

let serverProcess = null;
let mainWindow = null;

function waitForServer(url, timeoutMs = 20000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error("Il server locale non ha risposto in tempo."));
          return;
        }
        setTimeout(tryOnce, 200);
      });
    };
    tryOnce();
  });
}

function startServer() {
  serverProcess = spawn(process.execPath, [SERVER_ENTRY], {
    env: {
      ...process.env,
      PORT,
      HOST: "127.0.0.1",
      NITRO_PORT: PORT,
      NITRO_HOST: "127.0.0.1",
      // Running the built Node server under Electron's own node binary needs
      // ELECTRON_RUN_AS_NODE, otherwise `process.execPath` boots Electron's
      // GUI shell instead of executing the script.
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: "pipe",
  });

  serverProcess.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
  serverProcess.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));
  serverProcess.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`Il server locale è terminato con codice ${code}`);
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    title: "Visore di rete locale",
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  });

  Menu.setApplicationMenu(null);

  // The app itself proxies LAN URLs; only external links opened via
  // shell.openExternal (none today) should leave the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}/`);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  startServer();
  try {
    await waitForServer(`http://127.0.0.1:${PORT}/`);
  } catch (err) {
    console.error(err);
  }
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
});
