// Preload for the toolbar window. Exposes a small, explicit API so the React
// UI can drive the native content view (see electron/main.cjs) without
// getting direct Node/Electron access itself (contextIsolation stays on).
const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("electronViewer", {
  isElectron: true,
  navigate: (url, creds) =>
    ipcRenderer.invoke("viewer:navigate", { url, user: creds?.user, pass: creds?.pass }),
  back: () => ipcRenderer.invoke("viewer:back"),
  forward: () => ipcRenderer.invoke("viewer:forward"),
  reload: () => ipcRenderer.invoke("viewer:reload"),
  getSource: () => ipcRenderer.invoke("viewer:get-source"),
  savePage: () => ipcRenderer.invoke("viewer:save-page"),
  downloadUrl: (url) => ipcRenderer.invoke("viewer:download-url", url),
  setContentBounds: (rect) => ipcRenderer.send("viewer:set-bounds", rect),
  onState: (callback) => subscribe("viewer:state", callback),
  onError: (callback) => subscribe("viewer:error", callback),
  onRequestBounds: (callback) => subscribe("viewer:request-bounds", callback),
});
