import fs from "node:fs";
import path from "node:path";

import { app, BrowserWindow, ipcMain } from "electron";

import { AppService } from "./app-service";
import { registerIpc } from "./ipc";
import type { Snapshot } from "./types";

let mainWindow: BrowserWindow | null = null;
let service: AppService | null = null;

const APP_NAME = "WeChat Agent Desktop";
const APP_DATA_FILE = "app-data.json";
const LEGACY_USER_DATA_DIR = "Electron";

function migrateLegacyData(): void {
  const appDataRoot = app.getPath("appData");
  const legacyFile = path.join(appDataRoot, LEGACY_USER_DATA_DIR, APP_DATA_FILE);
  const targetDir = app.getPath("userData");
  const targetFile = path.join(targetDir, APP_DATA_FILE);

  if (fs.existsSync(targetFile) || !fs.existsSync(legacyFile)) {
    return;
  }

  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(legacyFile, targetFile);
}

function configureAppPaths(): void {
  app.setName(APP_NAME);
  app.setPath("userData", path.join(app.getPath("appData"), APP_NAME));
  migrateLegacyData();
}

function createWindow(): void {
  const preloadPath = path.join(__dirname, "preload.js");
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 920,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: "#f3efe7",
    title: "微信智能助手桌面版",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function bootstrap(): Promise<void> {
  service = new AppService(app.getPath("userData"));
  registerIpc(service);

  service.on("snapshot", (snapshot: Snapshot) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("snapshot:changed", snapshot);
    }
  });

  await service.initialize();

  createWindow();
}

configureAppPaths();

app.whenReady().then(async () => {
  await bootstrap();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  service?.shutdown();
});

ipcMain.handle("app:ping", () => "pong");
