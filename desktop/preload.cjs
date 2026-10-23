const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld(
  "nspi",
  Object.freeze({
    call: (action, payload) => ipcRenderer.invoke("nspi", action, payload),
    onPointer: (callback) => {
      const listener = (_, point) => callback(point);
      ipcRenderer.on("pointer", listener);
      return () => ipcRenderer.removeListener("pointer", listener);
    },
    onState: (callback) => {
      const listener = (_, state) => callback(state);
      ipcRenderer.on("state", listener);
      return () => ipcRenderer.removeListener("state", listener);
    },
  }),
);
