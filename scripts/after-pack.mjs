import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

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
  console.log(`[afterPack] 对未签名 macOS 应用执行 deep ad-hoc 签名：${appBundlePath}`);

  await execFileAsync("codesign", [
    "--force",
    "--deep",
    "--sign",
    "-",
    appBundlePath
  ]);
}
