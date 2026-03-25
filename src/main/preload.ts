import { contextBridge, ipcRenderer } from "electron";

const api = {
  getSnapshot: () => ipcRenderer.invoke("app:getSnapshot"),
  startWechatLogin: (force = false) => ipcRenderer.invoke("app:startWechatLogin", force),
  logoutWechat: () => ipcRenderer.invoke("app:logoutWechat"),
  startRuntime: () => ipcRenderer.invoke("app:startRuntime"),
  stopRuntime: () => ipcRenderer.invoke("app:stopRuntime"),
  saveSettings: (input: unknown) => ipcRenderer.invoke("app:saveSettings", input),
  setContactEnabled: (contactId: string, enabled: boolean) =>
    ipcRenderer.invoke("app:setContactEnabled", contactId, enabled),
  clearContactHistory: (contactId: string) =>
    ipcRenderer.invoke("app:clearContactHistory", contactId),
  openDataDirectory: () => ipcRenderer.invoke("app:openDataDirectory"),
  refreshAgents: () => ipcRenderer.invoke("app:refreshAgents"),
  runManualInstruction: (prompt: string) => ipcRenderer.invoke("app:runManualInstruction", prompt),
  pickDirectory: () => ipcRenderer.invoke("app:pickDirectory"),
  onSnapshot: (listener: (snapshot: unknown) => void) => {
    const wrapped = (_event: unknown, snapshot: unknown) => listener(snapshot);
    ipcRenderer.on("snapshot:changed", wrapped);
    return () => ipcRenderer.removeListener("snapshot:changed", wrapped);
  }
};

contextBridge.exposeInMainWorld("wechatAgent", api);
