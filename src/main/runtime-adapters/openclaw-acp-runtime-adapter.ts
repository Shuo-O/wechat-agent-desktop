import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { ManagedOpenClawInstaller } from "../managed-openclaw";
import type {
  RuntimeAdapter,
  RuntimeReplyInput
} from "../runtime-adapter";

const execFileAsync = promisify(execFile);
const MAX_STDIO_BUFFER = 8 * 1024 * 1024;

interface OpenClawCliResponse {
  status?: string;
  summary?: string;
  payloads?: Array<{
    text?: string;
    mediaUrl?: string | null;
    mediaUrls?: string[];
  }>;
  result?: {
    payloads?: Array<{
      text?: string;
      mediaUrl?: string | null;
      mediaUrls?: string[];
    }>;
  };
}

export class OpenClawAcpRuntimeAdapter implements RuntimeAdapter {
  private readonly managedInstaller: ManagedOpenClawInstaller;
  private runChain: Promise<void> = Promise.resolve();

  constructor(params: {
    dataDir: string;
    log?: (level: "info" | "warn" | "error", message: string) => void;
  }) {
    this.managedInstaller = new ManagedOpenClawInstaller(params.dataDir, params.log);
  }

  async prepare(inputSettings: RuntimeReplyInput["settings"]): Promise<void> {
    if (inputSettings.assistantRuntime.kind !== "openclaw-acp") {
      return;
    }
    const command = await this.resolveCommandPath(inputSettings);
    if (usesManagedOpenClaw(inputSettings)) {
      await this.managedInstaller.syncAcpRuntimeConfig(inputSettings);
      await this.managedInstaller.ensureGatewayReady(inputSettings);
      await this.validateAcpHarness(command, inputSettings);
    }
  }

  async generateReply(input: RuntimeReplyInput): Promise<string> {
    return this.runExclusive(async () => {
      const runtime = input.settings.assistantRuntime;
      const command = await this.resolveCommandPath(input.settings);
      if (usesManagedOpenClaw(input.settings)) {
        await this.managedInstaller.syncAcpRuntimeConfig(input.settings);
        await this.managedInstaller.ensureGatewayReady(input.settings);
        await this.validateAcpHarness(command, input.settings);
      }

      const timeoutMs = Math.max(10_000, runtime.openclawTimeoutSeconds * 1000 + 30_000);
      const reply = await this.invokeOpenClaw(
        command,
        buildOpenClawGatewayArgs(input),
        runtime.openclawWorkingDir.trim() || process.cwd(),
        this.buildEnv(input.settings, command),
        timeoutMs
      );

      if (!reply) {
        throw new Error("OpenClaw ACP 未返回可发送的文本内容");
      }

      return reply;
    });
  }

  shutdown(): void {
    this.managedInstaller.shutdown();
  }

  private async resolveCommandPath(inputSettings: RuntimeReplyInput["settings"]): Promise<string> {
    const configured = inputSettings.assistantRuntime.openclawCommand.trim();
    if (configured && configured !== "openclaw") {
      return configured;
    }
    return this.managedInstaller.ensureReady();
  }

  private buildEnv(
    inputSettings: RuntimeReplyInput["settings"],
    commandPath: string
  ): NodeJS.ProcessEnv {
    if (
      inputSettings.assistantRuntime.openclawCommand.trim()
      && commandPath === inputSettings.assistantRuntime.openclawCommand.trim()
    ) {
      return process.env;
    }
    return this.managedInstaller.buildEnv(inputSettings);
  }

  private async validateAcpHarness(
    commandPath: string,
    inputSettings: RuntimeReplyInput["settings"]
  ): Promise<void> {
    const harnessId = inputSettings.assistantRuntime.openclawAcpHarnessId.trim() || "codex";
    try {
      await execFileAsync(
        commandPath,
        ["gateway", "call", "tools.catalog", "--json", "--params", JSON.stringify({ agentId: inputSettings.assistantRuntime.openclawAgentId.trim() || "main" })],
        {
          cwd: inputSettings.assistantRuntime.openclawWorkingDir.trim() || process.cwd(),
          env: this.buildEnv(inputSettings, commandPath),
          timeout: 30_000,
          maxBuffer: MAX_STDIO_BUFFER
        }
      );
    } catch {
      // Non-fatal: catalog access differs by OpenClaw version. We only use this to warm up the gateway path.
    }

    if (harnessId !== "codex") {
      return;
    }

    try {
      await execFileAsync(
        "which",
        ["codex"],
        {
          timeout: 5_000,
          maxBuffer: MAX_STDIO_BUFFER
        }
      );
    } catch {
      throw new Error("未检测到 ACP harness：codex。请确认运行环境中存在 `codex` 命令，或在设置里改成其他可用 harness。");
    }
  }

  private async runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.runChain.then(task, task);
    this.runChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async invokeOpenClaw(
    command: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    timeoutMs: number
  ): Promise<string> {
    let stdout = "";
    let stderr = "";
    try {
      const result = await execFileAsync(command, args, {
        cwd,
        env,
        timeout: timeoutMs,
        maxBuffer: MAX_STDIO_BUFFER
      });
      stdout = result.stdout ?? "";
      stderr = result.stderr ?? "";
    } catch (error) {
      const message = extractProcessError(error);
      if (message.includes("ENOENT")) {
        throw new Error(`未检测到 OpenClaw 命令：${command}`);
      }
      throw new Error(`OpenClaw ACP 执行失败：${message}`);
    }

    const payload = parseOpenClawJson(stdout, stderr);
    const reply = formatOpenClawReply(payload);
    if (!reply) {
      throw new Error(payload.summary?.trim() || "OpenClaw ACP 未返回可发送的文本内容");
    }
    return reply;
  }
}

function buildOpenClawGatewayArgs(input: RuntimeReplyInput): string[] {
  const runtime = input.settings.assistantRuntime;
  const timeoutSeconds = Math.max(0, Math.floor(runtime.openclawTimeoutSeconds));
  const args = [
    "agent",
    "--json",
    "--message",
    input.incomingText,
    "--to",
    buildOpenClawSenderKey(input.contact),
    "--timeout",
    String(timeoutSeconds)
  ];

  const agentId = runtime.openclawAgentId.trim();
  if (agentId) {
    args.push("--agent", agentId);
  }

  return args;
}

function usesManagedOpenClaw(settings: RuntimeReplyInput["settings"]): boolean {
  const configured = settings.assistantRuntime.openclawCommand.trim();
  return !configured || configured === "openclaw";
}

function buildOpenClawSenderKey(contact: RuntimeReplyInput["contact"]): string {
  const nonce = Number.isFinite(contact.runtimeSessionNonce)
    ? Math.max(0, Math.floor(contact.runtimeSessionNonce))
    : 0;
  return nonce > 0 ? `${contact.id}::session-${nonce}` : contact.id;
}

function extractProcessError(error: unknown): string {
  if (error instanceof Error) {
    const details = (error as Error & { stderr?: string; stdout?: string }).stderr?.trim()
      || (error as Error & { stdout?: string }).stdout?.trim()
      || error.message;
    return details.trim();
  }
  return String(error);
}

function parseOpenClawJson(stdout: string, stderr: string): OpenClawCliResponse {
  const candidates = [stdout.trim(), stderr.trim()].filter(Boolean);
  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate);
    if (parsed) {
      return parsed;
    }
  }

  if (candidates.length === 0) {
    throw new Error("OpenClaw ACP 没有输出 JSON 结果");
  }

  throw new Error(`OpenClaw ACP 输出不是合法 JSON：${candidates[0]!.slice(0, 200)}`);
}

function formatOpenClawReply(payload: OpenClawCliResponse): string {
  const payloads = payload.result?.payloads ?? payload.payloads ?? [];
  const lines: string[] = [];

  for (const item of payloads) {
    const text = item.text?.trim();
    if (text) {
      lines.push(text);
    }

    const mediaUrls = [
      ...(typeof item.mediaUrl === "string" && item.mediaUrl.trim() ? [item.mediaUrl.trim()] : []),
      ...((item.mediaUrls ?? []).map((url) => url.trim()).filter(Boolean))
    ];
    for (const url of mediaUrls) {
      lines.push(url);
    }
  }

  return lines.join("\n\n").trim();
}

function tryParseJson(candidate: string): OpenClawCliResponse | null {
  try {
    return JSON.parse(candidate) as OpenClawCliResponse;
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }
    try {
      return JSON.parse(candidate.slice(start, end + 1)) as OpenClawCliResponse;
    } catch {
      return null;
    }
  }
}
