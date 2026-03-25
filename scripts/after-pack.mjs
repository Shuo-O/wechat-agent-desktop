import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { vendorOpenClaw } from "./vendor-openclaw.mjs";

const execFileAsync = promisify(execFile);

async function findAppBundle(appOutDir) {
  const entries = await fs.readdir(appOutDir, { withFileTypes: true });
  const appEntry = entries.find((entry) => entry.isDirectory() && entry.name.endsWith(".app"));
  if (!appEntry) {
    throw new Error(`未在输出目录找到 .app：${appOutDir}`);
  }
  return path.join(appOutDir, appEntry.name);
}

export default async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const appBundlePath = await findAppBundle(context.appOutDir);
  const resourcesPath = path.join(appBundlePath, "Contents", "Resources");
  const openclawPrefix = path.join(resourcesPath, "openclaw-managed");

  console.log(`[afterPack] 内置 OpenClaw 到应用包：${openclawPrefix}`);
  await vendorOpenClaw(openclawPrefix);

  console.log(`[afterPack] 对未签名 macOS 应用执行 deep ad-hoc 签名：${appBundlePath}`);

  await execFileAsync("codesign", [
    "--force",
    "--deep",
    "--sign",
    "-",
    appBundlePath
  ]);
}
