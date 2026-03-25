import { EventEmitter } from "node:events";
import { shell } from "electron";

import { AgentCommandResolver } from "./agent-command-resolver";
import {
  getChannelBackendDefinition,
  listChannelBackendOptions
} from "./channel-backend-catalog";
import {
  getAssistantRuntimeDefinition,
  listAssistantRuntimeOptions
} from "./runtime-backend-catalog";
import {
  getProviderDefinition,
  listProviderOptions,
  resolveProviderApiStyle
} from "./provider-catalog";
import type { ChannelAdapter } from "./channel-adapter";
import { createChannelAdapter } from "./channel-adapter-factory";
import type { RuntimeAdapter } from "./runtime-adapter";
import { createRuntimeAdapter } from "./runtime-adapter-factory";
import { JsonStore } from "./store";
import type {
  AgentRunRecorder,
  AppSettings,
  ContactEntry,
  ManualInstructionResult,
  SaveSettingsInput,
  Snapshot
} from "./types";
import { SessionEngine } from "./session-engine";

function maskApiKey(value: string): string {
  if (!value) {
    return "";
  }
  if (value.length <= 8) {
    return "已保存";
  }
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

export class AppService extends EventEmitter {
  private readonly store: JsonStore;
  private readonly channelAdapter: ChannelAdapter;
  private readonly runtimeAdapter: RuntimeAdapter;
  private readonly sessionEngine: SessionEngine;
  private readonly agentCommandResolver = new AgentCommandResolver();
  private readonly channelOptions = listChannelBackendOptions();
  private readonly runtimeOptions = listAssistantRuntimeOptions();
  private readonly providerOptions = listProviderOptions();
  private agentCatalog = this.agentCommandResolver.getCachedCatalog();

  constructor(dataDir: string) {
    super();
    this.store = new JsonStore(dataDir);
    this.channelAdapter = createChannelAdapter(this.store, () => this.publish());
    const agentRunRecorder: AgentRunRecorder = {
      start: (input) => this.startAgentRun(input),
      finish: (runId, patch) => this.finishAgentRun(runId, patch)
    };
    this.runtimeAdapter = createRuntimeAdapter({
      dataDir: this.store.getDataDir(),
      log: (level, message) => this.log(level, message),
      agentCommandResolver: this.agentCommandResolver,
      agentRunRecorder
    });
    this.sessionEngine = new SessionEngine({
      store: this.store,
      channelAdapter: this.channelAdapter,
      runtimeAdapter: this.runtimeAdapter,
      onChanged: () => this.publish(),
      log: (level, message) => this.log(level, message)
    });
  }

  async initialize(): Promise<void> {
    this.resetRuntimeStateOnLaunch();
    await this.refreshAgentCatalog(false);

    if (!this.store.getData().wechat.credentials) {
      return;
    }

    await this.channelAdapter.beginLogin(false);
    this.log("info", "已恢复本地微信登录态");
    try {
      await this.startRuntime();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.store.update((draft) => {
        draft.runtime.isRunning = false;
        draft.runtime.lastStoppedAt = new Date().toISOString();
        draft.wechat.lastError = reason;
        if (draft.wechat.status === "logged_in") {
          draft.wechat.statusMessage = "已恢复登录，但自动启动失败";
        }
      });
      this.publish();
      this.log("error", `已恢复本地微信登录态，但自动启动失败：${reason}`);
    }
  }

  getSnapshot(): Snapshot {
    const data = this.store.getData();

    return {
      dataDir: this.store.getDataDir(),
      settings: {
        allowUnknownContacts: data.settings.allowUnknownContacts,
        advancedModeEnabled: data.settings.advancedModeEnabled,
        channelBackendKind: data.settings.channel.kind,
        channelBaseUrl: data.settings.channel.baseUrl,
        channelHeadersJson: serializeHeaders(data.settings.channel.requestHeaders),
        assistantRuntimeKind: data.settings.assistantRuntime.kind,
        openclawCommand: data.settings.assistantRuntime.openclawCommand,
        openclawAgentId: data.settings.assistantRuntime.openclawAgentId,
        openclawAcpHarnessId: data.settings.assistantRuntime.openclawAcpHarnessId,
        openclawTimeoutSeconds: data.settings.assistantRuntime.openclawTimeoutSeconds,
        openclawWorkingDir: data.settings.assistantRuntime.openclawWorkingDir,
        providerKind: data.settings.provider.kind,
        assistantPreset: data.settings.provider.assistantPreset,
        providerBaseUrl: data.settings.provider.baseUrl,
        providerModel: data.settings.provider.model,
        providerApiStyle: data.settings.provider.apiStyle,
        providerApiKeyMasked: maskApiKey(data.settings.provider.apiKey),
        codexWorkdir: data.settings.provider.codexWorkdir,
        codexModel: data.settings.provider.codexModel,
        codexSandbox: data.settings.provider.codexSandbox
      },
      channelOptions: this.channelOptions,
      runtimeOptions: this.runtimeOptions,
      providerOptions: this.providerOptions,
      runtime: data.runtime,
      agentCatalog: this.agentCatalog,
      agentRuns: data.agentRuns.slice(0, 24),
      wechat: {
        status: data.wechat.status,
        qrUrl: data.wechat.qrUrl,
        statusMessage: data.wechat.statusMessage,
        accountId: data.wechat.credentials?.accountId ?? null,
        userId: data.wechat.credentials?.userId ?? null,
        lastError: data.wechat.lastError
      },
      contacts: Object.values(data.contacts)
        .sort((left, right) => {
          const a = left.lastInboundAt ?? left.lastReplyAt ?? "";
          const b = right.lastInboundAt ?? right.lastReplyAt ?? "";
          return b.localeCompare(a);
        })
        .map((contact) => ({
          id: contact.id,
          enabled: contact.enabled,
          status: contact.status,
          lastInboundAt: contact.lastInboundAt,
          lastReplyAt: contact.lastReplyAt,
          lastMessagePreview: contact.lastMessagePreview,
          lastReplyPreview: contact.lastReplyPreview,
          lastError: contact.lastError
        })),
      logs: data.logs.slice(0, 60)
    };
  }

  async refreshAgents(): Promise<void> {
    await this.refreshAgentCatalog(true);
  }

  async startWechatLogin(force = false): Promise<void> {
    if (force && this.store.getData().runtime.isRunning) {
      this.stopRuntime();
    }
    await this.channelAdapter.beginLogin(force);
    this.log("info", "微信登录流程完成");
    await this.startRuntime();
  }

  logoutWechat(): void {
    this.stopRuntime();
    this.channelAdapter.clearSession();
    this.log("info", "已退出微信登录");
  }

  async startRuntime(): Promise<void> {
    const data = this.store.getData();
    if (!data.wechat.credentials) {
      throw new Error("请先完成微信扫码登录");
    }

    if (data.runtime.isRunning) {
      return;
    }

    await this.runtimeAdapter.prepare(data.settings);

    this.store.update((draft) => {
      draft.runtime.isRunning = true;
      draft.runtime.lastStartedAt = new Date().toISOString();
      draft.runtime.lastStoppedAt = null;
      draft.wechat.statusMessage = "正在接收微信消息";
      draft.wechat.lastError = null;
    });
    this.publish();

    void this.channelAdapter.startMonitoring(
      async (message) => {
        await this.sessionEngine.handleInbound(message);
      },
      () => {
        this.store.update((draft) => {
          draft.runtime.isRunning = false;
          draft.runtime.lastStoppedAt = new Date().toISOString();
        });
        this.publish();
        this.log("warn", "微信登录态失效，已停止接收消息");
      }
    );

    this.log("info", "已开始接收微信消息");
  }

  stopRuntime(): void {
    this.channelAdapter.stopMonitoring();
    this.store.update((draft) => {
      if (draft.runtime.isRunning) {
        draft.runtime.isRunning = false;
        draft.runtime.lastStoppedAt = new Date().toISOString();
        if (draft.wechat.status === "logged_in") {
          draft.wechat.statusMessage = "已暂停接收消息";
        }
      }
    });
    this.publish();
    this.log("info", "已暂停接收微信消息");
  }

  shutdown(): void {
    this.channelAdapter.stopMonitoring();
    this.runtimeAdapter.shutdown?.();
    this.store.update((draft) => {
      if (draft.runtime.isRunning) {
        draft.runtime.isRunning = false;
        draft.runtime.lastStoppedAt = new Date().toISOString();
      }
    });
  }

  async saveSettings(input: SaveSettingsInput): Promise<void> {
    const currentData = this.store.getData();
    const parsedHeaders = parseHeadersJson(input.channelHeadersJson);
    const channelDefinition = getChannelBackendDefinition(input.channelBackendKind);
    const runtimeDefinition = getAssistantRuntimeDefinition(input.assistantRuntimeKind);
    const nextChannelBaseUrl = input.channelBaseUrl.trim() || channelDefinition.defaultBaseUrl;
    const nextOpenClawCommand = input.openclawCommand.trim() || "openclaw";
    const nextOpenClawAgentId = input.openclawAgentId.trim();
    const nextOpenClawAcpHarnessId = input.openclawAcpHarnessId.trim() || "codex";
    const nextOpenClawTimeoutSeconds = parseOpenClawTimeout(input.openclawTimeoutSeconds);
    const nextOpenClawWorkingDir = input.openclawWorkingDir.trim();
    const channelChanged =
      currentData.settings.channel.kind !== input.channelBackendKind
      || currentData.settings.channel.baseUrl !== nextChannelBaseUrl
      || !areHeadersEqual(currentData.settings.channel.requestHeaders, parsedHeaders);
    const assistantRuntimeChanged =
      currentData.settings.assistantRuntime.kind !== input.assistantRuntimeKind
      || currentData.settings.assistantRuntime.openclawCommand !== nextOpenClawCommand
      || currentData.settings.assistantRuntime.openclawAgentId !== nextOpenClawAgentId
      || currentData.settings.assistantRuntime.openclawAcpHarnessId !== nextOpenClawAcpHarnessId
      || currentData.settings.assistantRuntime.openclawTimeoutSeconds !== nextOpenClawTimeoutSeconds
      || currentData.settings.assistantRuntime.openclawWorkingDir !== nextOpenClawWorkingDir;
    const runtimeWasRunning = currentData.runtime.isRunning;
    const shouldAutoRestartOpenClaw =
      !channelChanged
      && assistantRuntimeChanged
      && (input.assistantRuntimeKind === "openclaw-cli" || input.assistantRuntimeKind === "openclaw-acp")
      && currentData.wechat.status === "logged_in"
      && Boolean(currentData.wechat.credentials);

    if ((channelChanged || assistantRuntimeChanged) && runtimeWasRunning) {
      this.stopRuntime();
    }

    this.store.update((draft) => {
      const providerChanged =
        Boolean(input.previousProviderKind) &&
        input.previousProviderKind !== input.providerKind;
      const providerDefinition = getProviderDefinition(input.providerKind);

      draft.settings.allowUnknownContacts = input.allowUnknownContacts;
      draft.settings.advancedModeEnabled = input.advancedModeEnabled;
      draft.settings.channel.kind = input.channelBackendKind;
      draft.settings.channel.baseUrl = nextChannelBaseUrl;
      draft.settings.channel.requestHeaders = parsedHeaders;
      draft.settings.assistantRuntime.kind = input.assistantRuntimeKind;
      draft.settings.assistantRuntime.openclawCommand = nextOpenClawCommand;
      draft.settings.assistantRuntime.openclawAgentId = nextOpenClawAgentId;
      draft.settings.assistantRuntime.openclawAcpHarnessId = nextOpenClawAcpHarnessId;
      draft.settings.assistantRuntime.openclawTimeoutSeconds = nextOpenClawTimeoutSeconds;
      draft.settings.assistantRuntime.openclawWorkingDir = nextOpenClawWorkingDir;
      draft.settings.provider.kind = input.providerKind;
      draft.settings.provider.assistantPreset = input.assistantPreset;
      draft.settings.provider.apiStyle = resolveProviderApiStyle(
        input.providerKind,
        input.providerApiStyle
      );

      const submittedBaseUrl = input.providerBaseUrl.trim();
      draft.settings.provider.baseUrl = submittedBaseUrl
        || (providerChanged ? providerDefinition.defaultBaseUrl : draft.settings.provider.baseUrl);

      const submittedModel = input.providerModel.trim();
      draft.settings.provider.model = submittedModel
        || (providerChanged ? providerDefinition.defaultModel : draft.settings.provider.model);

      if (input.providerApiKey && input.providerApiKey.trim()) {
        draft.settings.provider.apiKey = input.providerApiKey.trim();
      }
      draft.settings.provider.codexWorkdir = input.codexWorkdir.trim();
      draft.settings.provider.codexModel = input.codexModel.trim();
      draft.settings.provider.codexSandbox = input.codexSandbox;

      if (input.resetHistories || providerChanged || assistantRuntimeChanged) {
        for (const contact of Object.values(draft.contacts)) {
          contact.runtimeSessionNonce += 1;
          contact.history = [];
          contact.lastMessagePreview = "";
          contact.lastReplyPreview = "";
          contact.lastError = null;
          contact.status = contact.enabled ? "idle" : "muted";
        }
      }
    });

    if (channelChanged) {
      this.channelAdapter.clearSession();
    }

    await this.refreshAgentCatalog(false);
    this.publish();

    const message = [
      "设置已保存",
      input.resetHistories || assistantRuntimeChanged ? "并清空了历史上下文" : "",
      assistantRuntimeChanged ? `${runtimeDefinition.label} 已更新` : "",
      shouldAutoRestartOpenClaw ? "正在自动恢复接收消息" : "",
      channelChanged ? "微信后端已更新，请重新扫码登录" : ""
    ]
      .filter(Boolean)
      .join("，");
    this.log(channelChanged || assistantRuntimeChanged ? "warn" : "info", message);

    if (!shouldAutoRestartOpenClaw) {
      return;
    }

    try {
      await this.startRuntime();
      this.log("info", "已自动切换到 OpenClaw 并恢复接收消息");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.log("error", `设置已保存，但自动启动 OpenClaw 失败：${reason}`);
      throw new Error(`设置已保存，但自动启动 OpenClaw 失败：${reason}`);
    }
  }

  setContactEnabled(contactId: string, enabled: boolean): void {
    this.store.update((draft) => {
      const contact = draft.contacts[contactId];
      if (!contact) {
        return;
      }
      contact.enabled = enabled;
      contact.status = enabled ? "idle" : "muted";
      contact.lastError = null;
    });
    this.publish();
    this.log("info", `${contactId} 已${enabled ? "启用" : "静音"}`);
  }

  clearContactHistory(contactId: string): void {
    this.store.update((draft) => {
      const contact = draft.contacts[contactId];
      if (!contact) {
        return;
      }
      contact.runtimeSessionNonce += 1;
      contact.history = [];
      contact.lastMessagePreview = "";
      contact.lastReplyPreview = "";
      contact.lastError = null;
      contact.status = contact.enabled ? "idle" : "muted";
    });
    this.publish();
    this.log("info", `已清空联系人 ${contactId} 的上下文`);
  }

  async openDataDirectory(): Promise<void> {
    await shell.openPath(this.store.getDataDir());
  }

  async runManualInstruction(prompt: string): Promise<ManualInstructionResult> {
    const trimmed = prompt.trim();
    if (!trimmed) {
      throw new Error("请输入要发送给 agent 的指令");
    }

    const data = this.store.getData();
    const startedAt = new Date().toISOString();
    const agentId = resolveCurrentAgentId(data.settings);
    this.log("info", `开始执行 UI 手动指令：${summarizePrompt(trimmed)}`);
    await this.runtimeAdapter.prepare(data.settings);

    const reply = await this.runtimeAdapter.generateReply({
      settings: data.settings,
      contact: createManualConsoleContact(),
      incomingText: trimmed
    });

    const finishedAt = new Date().toISOString();
    this.log("info", `UI 手动指令执行完成：${summarizePrompt(trimmed)}`);

    return {
      reply,
      runtimeKind: data.settings.assistantRuntime.kind,
      agentId,
      startedAt,
      finishedAt
    };
  }

  private log(level: "info" | "warn" | "error", message: string): void {
    this.store.addLog(level, message);
    this.publish();
  }

  private publish(): void {
    this.emit("snapshot", this.getSnapshot());
  }

  private resetRuntimeStateOnLaunch(): void {
    const data = this.store.getData();
    if (!data.runtime.isRunning) {
      return;
    }

    this.store.update((draft) => {
      draft.runtime.isRunning = false;
      draft.runtime.lastStoppedAt = new Date().toISOString();
      if (draft.wechat.credentials && draft.wechat.status === "logged_in") {
        draft.wechat.statusMessage = "已恢复本地微信登录态";
      }
    });
  }

  private async refreshAgentCatalog(shouldLog: boolean): Promise<void> {
    const extraAgentIds = collectTrackedAgentIds(this.store.getData().settings);
    try {
      this.agentCatalog = await this.agentCommandResolver.refreshCatalog(extraAgentIds);
      this.publish();

      if (shouldLog) {
        const detectedCount = this.agentCatalog.filter((item) => item.detected).length;
        this.log("info", `已刷新 Agent 检测，当前识别到 ${detectedCount} 个命令`);
      }
    } catch (error) {
      this.agentCatalog = this.agentCommandResolver.getCachedCatalog(extraAgentIds);
      this.publish();
      if (shouldLog) {
        const message = error instanceof Error ? error.message : String(error);
        this.log("warn", `刷新 Agent 检测失败：${message}`);
      }
    }
  }

  private startAgentRun(input: Parameters<AgentRunRecorder["start"]>[0]): string {
    const runId = this.store.addAgentRun({
      ...input,
      stdout: "",
      stderr: "",
      finalOutput: "",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      exitCode: null,
      status: "running",
      errorMessage: null
    });
    this.publish();
    return runId;
  }

  private finishAgentRun(
    runId: string,
    patch: Parameters<AgentRunRecorder["finish"]>[1]
  ): void {
    this.store.updateAgentRun(runId, patch);
    this.publish();
  }
}

function serializeHeaders(headers: Record<string, string>): string {
  if (!Object.keys(headers).length) {
    return "{}";
  }
  return JSON.stringify(headers, null, 2);
}

function parseHeadersJson(input: string): Record<string, string> {
  const trimmed = input.trim();
  if (!trimmed) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("附加请求头必须是合法 JSON 对象");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("附加请求头必须是 JSON 对象，例如 {\"X-Test\":\"1\"}");
  }

  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => {
      if (!key.trim()) {
        throw new Error("附加请求头的键不能为空");
      }
      if (typeof value !== "string") {
        throw new Error(`附加请求头 ${key} 的值必须是字符串`);
      }
      return [key, value];
    })
  );
}

function createManualConsoleContact(): ContactEntry {
  return {
    id: "__ui_console__",
    enabled: true,
    lastContextToken: "ui-console",
    runtimeSessionNonce: 0,
    status: "idle",
    lastInboundAt: null,
    lastReplyAt: null,
    lastMessagePreview: "",
    lastReplyPreview: "",
    lastError: null,
    history: []
  };
}

function collectTrackedAgentIds(settings: AppSettings): string[] {
  return [
    "codex",
    "openclaw",
    settings.assistantRuntime.openclawAcpHarnessId,
    settings.assistantRuntime.kind === "local-provider" && settings.provider.kind === "codex"
      ? "codex"
      : ""
  ];
}

function resolveCurrentAgentId(settings: Parameters<typeof collectTrackedAgentIds>[0]): string {
  if (settings.assistantRuntime.kind === "openclaw-acp") {
    return settings.assistantRuntime.openclawAcpHarnessId || "codex";
  }
  if (settings.assistantRuntime.kind === "openclaw-cli") {
    return settings.assistantRuntime.openclawAgentId || "main";
  }
  if (settings.provider.kind === "codex") {
    return "codex";
  }
  return settings.provider.kind;
}

function summarizePrompt(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  return normalized.length > 48 ? `${normalized.slice(0, 48)}...` : normalized;
}

function parseOpenClawTimeout(input: number): number {
  const numeric = Number(input);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error("OpenClaw 超时时间必须是大于等于 0 的整数秒");
  }
  return Math.floor(numeric);
}

function areHeadersEqual(
  left: Record<string, string>,
  right: Record<string, string>
): boolean {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));

  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  return leftEntries.every(([key, value], index) => {
    const [rightKey, rightValue] = rightEntries[index] ?? [];
    return key === rightKey && value === rightValue;
  });
}
