import { execFile } from "node:child_process";
import { constants as fsConstants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { AgentCatalogEntry } from "./types";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 8_000;
const LOGIN_SHELL = process.env.SHELL?.trim() || (process.platform === "win32" ? "" : "/bin/zsh");

const KNOWN_AGENT_DEFINITIONS = [
  { id: "codex", label: "Codex CLI", commands: ["codex"] },
  { id: "claude", label: "Claude Code", commands: ["claude"] },
  { id: "opencode", label: "OpenCode", commands: ["opencode"] },
  { id: "gemini", label: "Gemini CLI", commands: ["gemini"] },
  { id: "kimi", label: "Kimi CLI", commands: ["kimi"] },
  { id: "pi", label: "Pi CLI", commands: ["pi"] },
  { id: "openclaw", label: "OpenClaw", commands: ["openclaw"] }
] as const;

type KnownAgentDefinition = (typeof KNOWN_AGENT_DEFINITIONS)[number];

interface DetectionCandidate {
  executable: string;
  source: AgentCatalogEntry["source"];
  details: string | null;
}

export class AgentCommandResolver {
  private readonly cache = new Map<string, AgentCatalogEntry>();
  private loginShellPathEntries: string[] = [];

  async refreshCatalog(extraAgentIds: string[] = []): Promise<AgentCatalogEntry[]> {
    const ids = uniqueStrings([
      ...KNOWN_AGENT_DEFINITIONS.map((item) => item.id),
      ...extraAgentIds
    ]);

    const results: AgentCatalogEntry[] = [];
    for (const id of ids) {
      results.push(await this.resolveAgentCommand(id));
    }
    return results;
  }

  getCachedCatalog(extraAgentIds: string[] = []): AgentCatalogEntry[] {
    const ids = uniqueStrings([
      ...KNOWN_AGENT_DEFINITIONS.map((item) => item.id),
      ...extraAgentIds
    ]);
    return ids.map((id) => this.cache.get(id) ?? this.buildMissingEntry(id, id, "尚未检测"));
  }

  async resolveAgentCommand(
    agentId: string,
    preferredCommand?: string
  ): Promise<AgentCatalogEntry> {
    const command = preferredCommand?.trim() || this.getDefaultCommand(agentId);
    const checkedAt = new Date().toISOString();

    if (!command) {
      const missing = this.buildMissingEntry(agentId, agentId, "未提供命令名");
      missing.checkedAt = checkedAt;
      this.cache.set(agentId, missing);
      return missing;
    }

    const resolved = await this.tryResolveExecutable(command);
    const entry: AgentCatalogEntry = resolved
      ? {
        id: agentId,
        label: this.getLabel(agentId),
        command,
        resolvedPath: resolved.executable,
        detected: true,
        source: resolved.source,
        checkedAt,
        details: resolved.details
      }
      : {
        id: agentId,
        label: this.getLabel(agentId),
        command,
        resolvedPath: null,
        detected: false,
        source: "missing",
        checkedAt,
        details: "已检查当前 PATH、登录 shell PATH 与常见安装目录"
      };

    this.cache.set(agentId, entry);
    return entry;
  }

  augmentEnv(baseEnv: NodeJS.ProcessEnv, agentIds: string[]): NodeJS.ProcessEnv {
    const pathEntries = uniqueStrings([
      ...splitPathValue(baseEnv.PATH),
      ...this.loginShellPathEntries,
      ...agentIds
        .map((id) => this.cache.get(id)?.resolvedPath)
        .filter((value): value is string => Boolean(value))
        .map((value) => path.dirname(value))
    ]);

    return {
      ...baseEnv,
      PATH: pathEntries.join(path.delimiter)
    };
  }

  private async tryResolveExecutable(command: string): Promise<DetectionCandidate | null> {
    if (looksLikePath(command)) {
      const normalized = path.resolve(command);
      if (await isExecutable(normalized)) {
        return {
          executable: normalized,
          source: "configured",
          details: "使用显式命令路径"
        };
      }
      return null;
    }

    const processPathMatch = await this.findInDirectories(command, splitPathValue(process.env.PATH));
    if (processPathMatch) {
      return {
        executable: processPathMatch,
        source: "process-path",
        details: "在当前 Electron 进程 PATH 中找到"
      };
    }

    const loginShellMatch = await this.resolveFromLoginShell(command);
    if (loginShellMatch) {
      return loginShellMatch;
    }

    const commonDirMatch = await this.findInDirectories(command, await this.getCommonDirectories());
    if (commonDirMatch) {
      return {
        executable: commonDirMatch,
        source: "common-dir",
        details: "在常见用户安装目录中找到"
      };
    }

    return null;
  }

  private async resolveFromLoginShell(command: string): Promise<DetectionCandidate | null> {
    if (process.platform === "win32" || !LOGIN_SHELL) {
      return null;
    }

    try {
      const [pathResult, commandResult] = await Promise.all([
        execFileAsync(LOGIN_SHELL, ["-lic", "printf %s \"$PATH\""], {
          timeout: DEFAULT_TIMEOUT_MS,
          maxBuffer: 256 * 1024
        }),
        execFileAsync(LOGIN_SHELL, ["-lic", `command -v ${escapeShellWord(command)}`], {
          timeout: DEFAULT_TIMEOUT_MS,
          maxBuffer: 256 * 1024
        })
      ]);

      this.loginShellPathEntries = splitPathValue(pathResult.stdout);
      const resolved = commandResult.stdout.trim().split(/\r?\n/)[0]?.trim();
      if (resolved && await isExecutable(resolved)) {
        return {
          executable: resolved,
          source: "login-shell",
          details: `通过 ${path.basename(LOGIN_SHELL)} 登录 shell 解析`
        };
      }
    } catch {
      // Ignore shell lookup failures and continue with common directories.
    }

    return null;
  }

  private async findInDirectories(command: string, directories: string[]): Promise<string | null> {
    for (const directory of uniqueStrings(directories)) {
      for (const candidateName of buildExecutableCandidates(command)) {
        const candidatePath = path.join(directory, candidateName);
        if (await isExecutable(candidatePath)) {
          return candidatePath;
        }
      }
    }
    return null;
  }

  private async getCommonDirectories(): Promise<string[]> {
    const homeDir = os.homedir();
    const directories = uniqueStrings([
      path.join(homeDir, "bin"),
      path.join(homeDir, ".local", "bin"),
      path.join(homeDir, ".cargo", "bin"),
      path.join(homeDir, ".volta", "bin"),
      path.join(homeDir, ".asdf", "shims"),
      path.join(homeDir, ".mise", "shims"),
      "/opt/homebrew/bin",
      "/opt/homebrew/sbin",
      "/usr/local/bin",
      "/usr/local/sbin",
      "/opt/local/bin",
      "/usr/bin"
    ]);

    const nvmBins = await collectNestedBinDirectories(path.join(homeDir, ".nvm", "versions", "node"));
    return uniqueStrings([...directories, ...nvmBins]);
  }

  private getDefaultCommand(agentId: string): string {
    const match = KNOWN_AGENT_DEFINITIONS.find((item) => item.id === agentId);
    return match?.commands[0] ?? agentId;
  }

  private getLabel(agentId: string): string {
    const match: KnownAgentDefinition | undefined = KNOWN_AGENT_DEFINITIONS.find((item) => item.id === agentId);
    return match?.label ?? `${agentId} CLI`;
  }

  private buildMissingEntry(agentId: string, command: string, details: string): AgentCatalogEntry {
    return {
      id: agentId,
      label: this.getLabel(agentId),
      command,
      resolvedPath: null,
      detected: false,
      source: "missing",
      checkedAt: new Date().toISOString(),
      details
    };
  }
}

function splitPathValue(value: string | undefined): string[] {
  return (value ?? "")
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function looksLikePath(value: string): boolean {
  return value.includes(path.sep) || (path.sep === "\\" && value.includes("/"));
}

function buildExecutableCandidates(command: string): string[] {
  if (process.platform !== "win32") {
    return [command];
  }

  const extensions = (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
    .split(";")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const hasExtension = /\.[^./\\]+$/.test(command);
  if (hasExtension) {
    return [command];
  }
  return [command, ...extensions.map((ext) => `${command}${ext}`)];
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      return false;
    }
    await fs.access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function collectNestedBinDirectories(rootDir: string): Promise<string[]> {
  try {
    const versions = await fs.readdir(rootDir, { withFileTypes: true });
    const directories: string[] = [];
    for (const version of versions) {
      if (!version.isDirectory()) {
        continue;
      }
      const binDir = path.join(rootDir, version.name, "bin");
      if (await isDirectory(binDir)) {
        directories.push(binDir);
      }
    }
    return directories;
  } catch {
    return [];
  }
}

async function isDirectory(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

function escapeShellWord(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
