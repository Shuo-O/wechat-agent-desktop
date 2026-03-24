import { dialog, ipcMain } from "electron";

import type { AppService } from "./app-service";
import type { SaveSettingsInput } from "./types";

export function registerIpc(service: AppService): void {
  ipcMain.handle("app:getSnapshot", () => service.getSnapshot());
  ipcMain.handle("app:startWechatLogin", async (_event, force?: boolean) => {
    await service.startWechatLogin(Boolean(force));
  });
  ipcMain.handle("app:logoutWechat", () => service.logoutWechat());
  ipcMain.handle("app:startRuntime", async () => {
    await service.startRuntime();
  });
  ipcMain.handle("app:stopRuntime", () => service.stopRuntime());
  ipcMain.handle("app:saveSettings", (_event, input: SaveSettingsInput) => {
    service.saveSettings(input);
  });
  ipcMain.handle("app:setContactEnabled", (_event, contactId: string, enabled: boolean) => {
    service.setContactEnabled(contactId, enabled);
  });
  ipcMain.handle("app:clearContactHistory", (_event, contactId: string) => {
    service.clearContactHistory(contactId);
  });
  ipcMain.handle("app:openDataDirectory", async () => {
    await service.openDataDirectory();
  });
  ipcMain.handle("app:pickDirectory", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0] ?? null;
  });
}
