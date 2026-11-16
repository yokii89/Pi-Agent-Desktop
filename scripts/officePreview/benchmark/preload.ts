import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("officeBenchmark", {
  read: (name: string) => ipcRenderer.invoke("benchmark:read", name),
  metrics: () => ipcRenderer.invoke("benchmark:metrics"),
  close: () => ipcRenderer.invoke("benchmark:close"),
});
