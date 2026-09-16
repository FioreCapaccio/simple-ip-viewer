// Electron main process.
//
// The toolbar UI (address bar, history, credentials, source view — the React
// app in src/) is still served by the Nitro/Node server built by
// `bun run build:desktop`, spawned here as a child process. But the actual
// device page is no longer fetched-and-rewritten server-side: it's loaded
// natively in a WebContentsView layered under the toolbar, exactly like a
// real browser tab. That's what lets device dashboards that populate
// themselves via JavaScript (fetch/AJAX/WebSocket) actually work instead of
// getting stuck on their own static "LOADING" placeholder, which a
// script-stripped/sandboxed rendering could never satisfy.
//
// Trade-off, by design and confirmed with the user: this content view runs
// with webSecurity disabled and accepts self-signed/invalid TLS certs, so
// device pages are not sandboxed the way a normal browser tab would be. That
// matches the app's whole purpose (reach LAN tools "like a browser but
// without the usual browser blocks") — only point it at devices you trust on
// your own network.
const {
  app,
  BrowserWindow,
  WebContentsView,
  Menu,
  shell,
  ipcMain,
  session,
  dialog,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
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
let contentView = null;
let currentCreds = { user: "", pass: "" };

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

function sendToToolbar(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function sendState() {
  if (!contentView) return;
  const wc = contentView.webContents;
  sendToToolbar("viewer:state", {
    url: wc.getURL(),
    title: wc.getTitle(),
    loading: wc.isLoading(),
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward(),
  });
}

function createContentView() {
  // A dedicated, persistent session (separate from the toolbar window's own
  // session) so relaxing TLS/security only affects the embedded device page.
  const deviceSession = session.fromPartition("persist:lan-viewer-content");
  deviceSession.setCertificateVerifyProc((_request, callback) => {
    // LAN devices routinely use self-signed or hostname-mismatched certs;
    // this is the desktop equivalent of a browser's "advanced -> proceed
    // anyway" click, applied automatically so the app behaves like a
    // dedicated tool rather than a general-purpose browser.
    callback(0);
  });

  // HTTP Basic Auth challenges from the device, answered with whatever
  // credentials the toolbar last supplied.
  deviceSession.on("login", (event, _details, authInfo, callback) => {
    if (authInfo.scheme && currentCreds.user) {
      event.preventDefault();
      callback(currentCreds.user, currentCreds.pass);
    }
    // Otherwise fall through: Electron shows its own native auth prompt.
  });

  // Downloads triggered by the device page itself (a link, a form, a
  // download-attribute anchor) — handled natively instead of through our own
  // proxy route, complete with a real save dialog.
  deviceSession.on("will-download", (_event, item) => {
    const result = dialog.showSaveDialogSync(mainWindow, { defaultPath: item.getFilename() });
    if (result) {
      item.setSavePath(result);
    } else {
      item.cancel();
    }
  });

  contentView = new WebContentsView({
    webPreferences: {
      session: deviceSession,
      sandbox: false,
      contextIsolation: true,
      webSecurity: false,
      allowRunningInsecureContent: true,
    },
  });

  contentView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  mainWindow.contentView.addChildView(contentView);

  const wc = contentView.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    // Keep single-pane browsing (matches the toolbar's own back/forward
    // model) instead of spawning extra windows for target="_blank" links.
    wc.loadURL(url);
    return { action: "deny" };
  });

  [
    "did-navigate",
    "did-navigate-in-page",
    "did-start-loading",
    "did-stop-loading",
    "page-title-updated",
  ].forEach((evt) => wc.on(evt, sendState));

  wc.on("did-fail-load", (_e, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3) return; // ERR_ABORTED — usually just a superseded navigation, not a real failure.
    sendToToolbar("viewer:error", { errorCode, errorDescription, validatedURL });
  });
}

function registerIpc() {
  ipcMain.handle("viewer:navigate", (_e, { url, user, pass }) => {
    currentCreds = { user: user || "", pass: pass || "" };
    contentView.webContents.loadURL(url).catch((err) => {
      sendToToolbar("viewer:error", {
        errorCode: 0,
        errorDescription: String(err),
        validatedURL: url,
      });
    });
  });

  ipcMain.handle("viewer:back", () => {
    const nav = contentView.webContents.navigationHistory;
    if (nav.canGoBack()) nav.goBack();
  });

  ipcMain.handle("viewer:forward", () => {
    const nav = contentView.webContents.navigationHistory;
    if (nav.canGoForward()) nav.goForward();
  });

  ipcMain.handle("viewer:reload", () => {
    contentView.webContents.reload();
  });

  ipcMain.handle("viewer:get-source", async () => {
    try {
      return await contentView.webContents.executeJavaScript("document.documentElement.outerHTML");
    } catch {
      return "";
    }
  });

  ipcMain.handle("viewer:save-page", async () => {
    const wc = contentView.webContents;
    const currentUrl = wc.getURL();
    if (!currentUrl) return { ok: false, error: "Nessuna pagina da salvare." };

    let html;
    try {
      html = await wc.executeJavaScript("document.documentElement.outerHTML");
    } catch (err) {
      return { ok: false, error: String(err) };
    }

    let suggestedName = "pagina.html";
    try {
      const u = new URL(currentUrl);
      const last = u.pathname.split("/").filter(Boolean).pop();
      suggestedName = `${(last ? last.replace(/\.[^.]+$/, "") : u.hostname).replace(/[^\w.-]+/g, "_")}.html`;
    } catch {
      /* nome di riserva */
    }

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: suggestedName,
      filters: [{ name: "Pagina HTML", extensions: ["html"] }],
    });
    if (canceled || !filePath) return { ok: false };

    const withBase = /<head[^>]*>/i.test(html)
      ? html.replace(/<head([^>]*)>/i, `<head$1><base href="${currentUrl}">`)
      : html;
    await fs.writeFile(filePath, withBase, "utf8");
    return { ok: true, filePath };
  });

  ipcMain.handle("viewer:download-url", (_e, url) => {
    contentView.webContents.downloadURL(url);
  });

  ipcMain.on("viewer:set-bounds", (_e, rect) => {
    if (!contentView) return;
    contentView.setBounds({
      x: Math.max(0, Math.round(rect.x)),
      y: Math.max(0, Math.round(rect.y)),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height)),
    });
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
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  Menu.setApplicationMenu(null);

  // The toolbar window itself never navigates to LAN content (that's the
  // content view's job), so any window-open request from it can safely go to
  // the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}/`);

  createContentView();

  mainWindow.on("resize", () => {
    // The renderer is the source of truth for bounds (it measures its own
    // content-area div), but re-asking it to report keeps things correct
    // even if a resize event fires before its own ResizeObserver does.
    sendToToolbar("viewer:request-bounds", null);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    contentView = null;
  });
}

app.whenReady().then(async () => {
  startServer();
  try {
    await waitForServer(`http://127.0.0.1:${PORT}/`);
  } catch (err) {
    console.error(err);
  }
  registerIpc();
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
