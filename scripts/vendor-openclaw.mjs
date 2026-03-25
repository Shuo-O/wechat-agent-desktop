import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const INSTALL_SCRIPT_URL = "https://openclaw.ai/install-cli.sh";
const MAX_STDIO_BUFFER = 8 * 1024 * 1024;
const BUNDLED_VERSION = process.env.OPENCLAW_BUNDLED_VERSION || "latest";
const MAX_VENDOR_ATTEMPTS = 3;

export async function vendorOpenClaw(prefix) {
  const commandPath = getCommandPath(prefix);
  if (await exists(commandPath)) {
    console.log(`[vendor-openclaw] 已存在，跳过安装：${commandPath}`);
    return commandPath;
  }

  if (process.platform === "win32") {
    throw new Error("当前脚本暂未实现 Windows 下的 OpenClaw 随包内置");
  }

  await fs.mkdir(prefix, { recursive: true });
  const scriptPath = await downloadInstallScript();

  try {
    for (let attempt = 1; attempt <= MAX_VENDOR_ATTEMPTS; attempt += 1) {
      console.log(`[vendor-openclaw] 开始安装 OpenClaw 到 ${prefix}（第 ${attempt}/${MAX_VENDOR_ATTEMPTS} 次）`);
      try {
        await execFileAsync(
          "bash",
          [
            scriptPath,
            "--json",
            "--prefix",
            prefix,
            "--version",
            BUNDLED_VERSION,
            "--no-onboard"
          ],
          {
            env: {
              ...process.env,
              OPENCLAW_NPM_LOGLEVEL: process.env.OPENCLAW_NPM_LOGLEVEL || "warn"
            },
            maxBuffer: MAX_STDIO_BUFFER,
            timeout: 20 * 60_000
          }
        );
        break;
      } catch (error) {
        if (attempt >= MAX_VENDOR_ATTEMPTS) {
          throw error;
        }
        console.warn(`[vendor-openclaw] 安装失败，准备重试：${extractErrorMessage(error)}`);
        await fs.rm(prefix, { recursive: true, force: true }).catch(() => undefined);
        await fs.mkdir(prefix, { recursive: true });
      }
    }

    if (!(await exists(commandPath))) {
      throw new Error(`OpenClaw 安装完成后未找到命令：${commandPath}`);
    }

    console.log(`[vendor-openclaw] OpenClaw 已随包内置：${commandPath}`);
    return commandPath;
  } finally {
    await fs.rm(scriptPath, { force: true }).catch(() => undefined);
  }
}

async function downloadInstallScript() {
  const response = await fetch(INSTALL_SCRIPT_URL);
  if (!response.ok) {
    throw new Error(`下载 OpenClaw 安装脚本失败 (${response.status})`);
  }

  const script = await response.text();
  const scriptPath = path.join(
    os.tmpdir(),
    `vendor-openclaw-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`
  );
  await fs.writeFile(scriptPath, script, { mode: 0o700 });
  return scriptPath;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getCommandPath(prefix) {
  if (process.platform === "win32") {
    return path.join(prefix, "bin", "openclaw.cmd");
  }
  return path.join(prefix, "bin", "openclaw");
}

function extractErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const prefix = process.argv[2];
  if (!prefix) {
    throw new Error("usage: node scripts/vendor-openclaw.mjs <prefix>");
  }
  await vendorOpenClaw(prefix);
}
