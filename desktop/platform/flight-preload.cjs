const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld(
  "flight",
  Object.freeze({
    ready: () => ipcRenderer.send("flight-ready"),
    frames: (callback) =>
      ipcRenderer.on("flight-frame", (_event, value) => callback(value)),
  }),
);
