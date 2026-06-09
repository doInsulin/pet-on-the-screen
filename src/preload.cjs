const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("petApi", {
  listAssets: () => ipcRenderer.invoke("assets:list"),
  importAssets: () => ipcRenderer.invoke("assets:import"),
  setAlwaysOnTop: (value) => ipcRenderer.invoke("window:setAlwaysOnTop", value),
  setSize: (scale) => ipcRenderer.invoke("window:setSize", scale),
  nudgeWindow: (dx, dy) => ipcRenderer.invoke("window:nudge", dx, dy),
  homeWindow: () => ipcRenderer.invoke("window:home"),
  quit: () => ipcRenderer.invoke("app:quit"),
  onPetAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on("pet-action", listener);
    return () => ipcRenderer.removeListener("pet-action", listener);
  },
  onAssetsUpdated: (callback) => {
    const listener = (_event, assets) => callback(assets);
    ipcRenderer.on("assets-updated", listener);
    return () => ipcRenderer.removeListener("assets-updated", listener);
  }
});
