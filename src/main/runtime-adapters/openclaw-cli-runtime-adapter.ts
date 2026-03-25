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

interface GatewayChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{
        type?: string;
        text?: string;
      }>;
    };
  }>;
  error?: {
    message?: string;
  };
}

export class OpenClawCliRuntimeAdapter implements RuntimeAdapter {
  private readonly managedInstaller: ManagedOpenClawInstaller;
  private runChain: Promise<void> = Promise.resolve();

  constructor(params: {
    dataDir: string;
    log?: (level: "info" | "warn" | "error", message: string) => void;
  }) {
    this.managedInstaller = new ManagedOpenClawInstaller(params.dataDir, params.log);
  }

  async prepare(inputSettings: RuntimeReplyInput["settings"]): Promise<void> {
    if (inputSettings.assistantRuntime.kind !== "openclaw-cli") {
      return;
    }
    const command = await this.resolveCommandPath(inputSettings);
    if (usesManagedOpenClaw(inputSettings)) {
      await this.managedInstaller.syncProviderConfig(inputSettings);
      await this.ensureDefaultModel(command, inputSettings);
      await this.managedInstaller.ensureGatewayReady(inputSettings);
    }
  }

  async generateReply(input: RuntimeReplyInput): Promise<string> {
    return this.runExclusive(async () => {
      const runtime = input.settings.assistantRuntime;
      const command = await this.resolveCommandPath(input.settings);
      if (usesManagedOpenClaw(input.settings)) {
        await this.managedInstaller.syncProviderConfig(input.settings);
        await this.ensureDefaultModel(command, input.settings);
        await this.managedInstaller.ensureGatewayReady(input.settings);
        return this.invokeManagedGateway(input);
      }
      const args = buildOpenClawArgs(input);
      const cwd = runtime.openclawWorkingDir.trim() || process.cwd();
      const env = this.buildEnv(input.settings, command);

      const timeoutMs = Math.max(10_000, runtime.openclawTimeoutSeconds * 1000 + 30_000);
      const reply = await this.invokeOpenClaw(command, args, cwd, env, timeoutMs);

      if (!reply) {
        throw new Error("OpenClaw 未返回可发送的文本内容");
      }

      return reply;
    });
  }

  private async resolveCommandPath(inputSettings: RuntimeReplyInput["settings"]): Promise<string> {
    const configured = inputSettings.assistantRuntime.openclawCommand.trim();
    if (configured && configured !== "openclaw") {
      return configured;
    }
    return this.managedInstaller.ensureReady();
  }

  private async ensureDefaultModel(
    commandPath: string,
    inputSettings: RuntimeReplyInput["settings"]
  ): Promise<void> {
    const provider = inputSettings.provider;
    if (provider.kind === "mock" || provider.kind === "codex") {
      return;
    }

    const modelId = provider.model.trim();
    if (!modelId) {
      return;
    }

    await execFileAsync(
      commandPath,
      ["models", "set", `wechat-agent/${modelId}`],
      {
        cwd: inputSettings.assistantRuntime.openclawWorkingDir.trim() || process.cwd(),
        env: this.buildEnv(inputSettings, commandPath),
        timeout: 30_000,
        maxBuffer: MAX_STDIO_BUFFER
      }
    );
  }

  private buildEnv(
    inputSettings: RuntimeReplyInput["settings"],
    commandPath: string
  ): NodeJS.ProcessEnv {
    if (inputSettings.assistantRuntime.openclawCommand.trim() && commandPath === inputSettings.assistantRuntime.openclawCommand.trim()) {
      return process.env;
    }
    return this.managedInstaller.buildEnv(inputSettings);
  }

  shutdown(): void {
    this.managedInstaller.shutdown();
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
      throw new Error(`OpenClaw CLI 执行失败：${message}`);
    }

    const payload = parseOpenClawJson(stdout, stderr);
    const reply = formatOpenClawReply(payload);
    if (!reply) {
      throw new Error(payload.summary?.trim() || "OpenClaw 未返回可发送的文本内容");
    }
    return reply;
  }

  private async invokeManagedGateway(input: RuntimeReplyInput): Promise<string> {
    const runtime = input.settings.assistantRuntime;
    const agentId = runtime.openclawAgentId.trim() || "main";
    const gateway = await this.managedInstaller.resolveGatewayHttpClientConfig();
    const controller = new AbortController();
    const timeoutMs = Math.max(10_000, runtime.openclawTimeoutSeconds * 1000 + 30_000);
    const timeout = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(`${gateway.origin}/v1/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${gateway.token}`,
          "Content-Type": "application/json",
          "x-openclaw-agent-id": agentId,
          "x-openclaw-session-key": buildOpenClawSessionKey(agentId, input.contact)
        },
        body: JSON.stringify({
          model: `openclaw:${agentId}`,
          stream: false,
          user: buildOpenClawSenderKey(input.contact),
          messages: [
            {
              role: "user",
              content: input.incomingText
            }
          ]
        }),
        signal: controller.signal
      });

      const raw = await response.text();
      const payload = tryParseGatewayChatCompletion(raw);
      if (!response.ok) {
        const errorMessage = payload?.error?.message?.trim()
          || raw.trim()
          || `Gateway HTTP ${response.status}`;
        throw new Error(`OpenClaw Gateway 调用失败：${errorMessage}`);
      }

      const reply = extractGatewayReplyText(payload);
      if (!reply) {
        throw new Error("OpenClaw Gateway 未返回可发送的文本内容");
      }
      return reply;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("OpenClaw Gateway 请求超时");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function buildOpenClawArgs(input: RuntimeReplyInput, message?: string): string[] {
  const runtime = input.settings.assistantRuntime;
  const timeoutSeconds = Math.max(0, Math.floor(runtime.openclawTimeoutSeconds));
  const args = [
    "agent",
    "--local",
    "--json",
    "--message",
    message ?? input.incomingText,
    "--to",
    buildOpenClawSenderKey(input.contact),
    "--timeout",
    String(timeoutSeconds)
  ];

  if (runtime.openclawAgentId.trim()) {
    args.push("--agent", runtime.openclawAgentId.trim());
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

function buildOpenClawSessionKey(
  agentId: string,
  contact: RuntimeReplyInput["contact"]
): string {
  const peerKey = Buffer.from(buildOpenClawSenderKey(contact), "utf8").toString("base64url");
  return `agent:${agentId}:wechat:direct:${peerKey}`;
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
    throw new Error("OpenClaw CLI 没有输出 JSON 结果");
  }

  throw new Error(`OpenClaw CLI 输出不是合法 JSON：${candidates[0]!.slice(0, 200)}`);
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

function tryParseGatewayChatCompletion(candidate: string): GatewayChatCompletionResponse | null {
  try {
    return JSON.parse(candidate) as GatewayChatCompletionResponse;
  } catch {
    return null;
  }
}

function extractGatewayReplyText(payload: GatewayChatCompletionResponse | null): string {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => item?.text?.trim() || "")
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }
  return "";
}
