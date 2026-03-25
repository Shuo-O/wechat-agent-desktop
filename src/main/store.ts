import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import {
  getChannelBackendDefinition,
  isChannelBackendKind
} from "./channel-backend-catalog";
import {
  getAssistantRuntimeDefinition,
  isAssistantRuntimeKind
} from "./runtime-backend-catalog";
import {
  getProviderDefinition,
  isProviderKind,
  resolveProviderApiStyle
} from "./provider-catalog";
import type {
  AssistantRuntimeKind,
  AssistantRuntimeSettings,
  AppData,
  AppSettings,
  AssistantPresetId,
  ChannelBackendKind,
  ChannelBackendSettings,
  CodexSandboxMode,
  ContactEntry,
  LogEntry,
  LogLevel,
  ProviderApiStyle,
  ProviderKind,
  ProviderSettings
} from "./types";

const MAX_LOGS = 200;
const MAX_HISTORY = 16;

function defaultChannelSettings(): ChannelBackendSettings {
  const backend = getChannelBackendDefinition("openclaw-official");

  return {
    kind: backend.kind,
    baseUrl: backend.defaultBaseUrl,
    requestHeaders: {}
  };
}

function defaultProviderSettings(): ProviderSettings {
  const deepseek = getProviderDefinition("deepseek");

  return {
    kind: deepseek.kind,
    assistantPreset: "general",
    apiKey: process.env.DEEPSEEK_API_KEY ?? "",
    baseUrl: deepseek.defaultBaseUrl,
    model: deepseek.defaultModel,
    apiStyle: resolveProviderApiStyle(deepseek.kind),
    codexWorkdir: "",
    codexModel: "",
    codexSandbox: "read-only"
  };
}

function defaultAssistantRuntimeSettings(): AssistantRuntimeSettings {
  const runtime = getAssistantRuntimeDefinition("local-provider");

  return {
    kind: runtime.kind,
    openclawCommand: "openclaw",
    openclawAgentId: "",
    openclawAcpHarnessId: "codex",
    openclawTimeoutSeconds: 600,
    openclawWorkingDir: ""
  };
}

function defaultSettings(): AppSettings {
  return {
    allowUnknownContacts: true,
    advancedModeEnabled: false,
    channel: defaultChannelSettings(),
    assistantRuntime: defaultAssistantRuntimeSettings(),
    provider: defaultProviderSettings()
  };
}

export function createEmptyData(): AppData {
  return {
    settings: defaultSettings(),
    logs: [],
    contacts: {},
    wechat: {
      status: "logged_out",
      credentials: null,
      qrUrl: null,
      statusMessage: "尚未登录微信",
      syncCursor: "",
      lastError: null
    },
    runtime: {
      isRunning: false,
      lastStartedAt: null,
      lastStoppedAt: null
    }
  };
}

export class JsonStore {
  private readonly filePath: string;
  private data: AppData;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "app-data.json");
    fs.mkdirSync(dataDir, { recursive: true });
    this.data = this.load();
  }

  getData(): AppData {
    return this.data;
  }

  getDataDir(): string {
    return path.dirname(this.filePath);
  }

  update(mutator: (draft: AppData) => void): AppData {
    mutator(this.data);
    this.normalize();
    this.persist();
    return this.data;
  }

  upsertContact(contactId: string, enabled: boolean): ContactEntry {
    const existing = this.data.contacts[contactId];
    if (existing) {
      return existing;
    }

    const created: ContactEntry = {
      id: contactId,
      enabled,
      lastContextToken: "",
      runtimeSessionNonce: 0,
      status: enabled ? "idle" : "muted",
      lastInboundAt: null,
      lastReplyAt: null,
      lastMessagePreview: "",
      lastReplyPreview: "",
      lastError: null,
      history: []
    };
    this.data.contacts[contactId] = created;
    this.persist();
    return created;
  }

  addLog(level: LogLevel, message: string): void {
    const entry: LogEntry = {
      id: crypto.randomUUID(),
      level,
      message,
      createdAt: new Date().toISOString()
    };
    this.data.logs.unshift(entry);
    this.data.logs = this.data.logs.slice(0, MAX_LOGS);
    this.persist();
  }

  private load(): AppData {
    if (!fs.existsSync(this.filePath)) {
      const initial = createEmptyData();
      fs.writeFileSync(this.filePath, JSON.stringify(initial, null, 2), "utf8");
      return initial;
    }

    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<AppData>;
      return {
        ...createEmptyData(),
        ...parsed,
        settings: {
          ...defaultSettings(),
          ...(parsed.settings ?? {}),
          channel: normalizeChannelSettings(parsed.settings?.channel, parsed.wechat?.credentials?.baseUrl),
          assistantRuntime: normalizeAssistantRuntimeSettings(parsed.settings?.assistantRuntime),
          provider: normalizeProviderSettings(parsed.settings?.provider)
        },
        wechat: {
          ...createEmptyData().wechat,
          ...(parsed.wechat ?? {})
        },
        runtime: {
          ...createEmptyData().runtime,
          ...(parsed.runtime ?? {})
        },
        contacts: parsed.contacts ?? {},
        logs: parsed.logs ?? []
      };
    } catch {
      return createEmptyData();
    }
  }

  private normalize(): void {
    for (const contact of Object.values(this.data.contacts)) {
      contact.history = contact.history.slice(-MAX_HISTORY);
      contact.runtimeSessionNonce = readNonNegativeInteger(contact.runtimeSessionNonce, 0);
      if (!contact.enabled && contact.status !== "processing") {
        contact.status = "muted";
      }
      if (contact.enabled && contact.status === "muted") {
        contact.status = "idle";
      }
    }
  }

  private persist(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf8");
  }
}

function normalizeChannelSettings(
  raw: unknown,
  fallbackCredentialBaseUrl?: string
): ChannelBackendSettings {
  const defaults = defaultChannelSettings();
  const candidate = (raw ?? {}) as Partial<ChannelBackendSettings> & Record<string, unknown>;
  const kind = readChannelBackendKind(candidate.kind, fallbackCredentialBaseUrl);
  const definition = getChannelBackendDefinition(kind);

  return {
    kind,
    baseUrl: readChannelBaseUrl(candidate.baseUrl, definition.defaultBaseUrl, fallbackCredentialBaseUrl),
    requestHeaders: readRequestHeaders(candidate.requestHeaders)
  };
}

function normalizeProviderSettings(raw: unknown): ProviderSettings {
  const defaults = defaultProviderSettings();
  const candidate = (raw ?? {}) as Partial<ProviderSettings> & Record<string, unknown>;
  const kind = readProviderKind(candidate.kind);
  const definition = getProviderDefinition(kind);

  return {
    ...defaults,
    kind,
    assistantPreset: readAssistantPreset(candidate.assistantPreset),
    apiKey: readApiKey(kind, candidate),
    baseUrl: readBaseUrl(kind, definition.defaultBaseUrl, candidate),
    model: readModel(kind, definition.defaultModel, candidate),
    apiStyle: readApiStyle(kind, candidate.apiStyle),
    codexWorkdir: readString(candidate.codexWorkdir),
    codexModel: readString(candidate.codexModel),
    codexSandbox: readCodexSandbox(candidate.codexSandbox)
  };
}

function normalizeAssistantRuntimeSettings(raw: unknown): AssistantRuntimeSettings {
  const defaults = defaultAssistantRuntimeSettings();
  const candidate = (raw ?? {}) as Partial<AssistantRuntimeSettings> & Record<string, unknown>;
  const kind = readAssistantRuntimeKind(candidate.kind);

  return {
    kind,
    openclawCommand: readString(candidate.openclawCommand) || defaults.openclawCommand,
    openclawAgentId: readString(candidate.openclawAgentId),
    openclawAcpHarnessId: readString(candidate.openclawAcpHarnessId) || defaults.openclawAcpHarnessId,
    openclawTimeoutSeconds: readNonNegativeInteger(
      candidate.openclawTimeoutSeconds,
      defaults.openclawTimeoutSeconds
    ),
    openclawWorkingDir: readString(candidate.openclawWorkingDir)
  };
}

function readChannelBackendKind(
  value: unknown,
  fallbackCredentialBaseUrl?: string
): ChannelBackendKind {
  if (isChannelBackendKind(value)) {
    return value;
  }

  if (
    typeof fallbackCredentialBaseUrl === "string"
    && fallbackCredentialBaseUrl.trim()
    && fallbackCredentialBaseUrl.trim() !== defaultChannelSettings().baseUrl
  ) {
    return "openclaw-compatible";
  }

  return defaultChannelSettings().kind;
}

function readChannelBaseUrl(
  value: unknown,
  fallback: string,
  fallbackCredentialBaseUrl?: string
): string {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (typeof fallbackCredentialBaseUrl === "string" && fallbackCredentialBaseUrl.trim()) {
    return fallbackCredentialBaseUrl;
  }
  return fallback;
}

function readAssistantRuntimeKind(value: unknown): AssistantRuntimeKind {
  if (value === "openclaw-acp") {
    return "openclaw-cli";
  }
  if (isAssistantRuntimeKind(value)) {
    return value;
  }
  return defaultAssistantRuntimeSettings().kind;
}

function readProviderKind(value: unknown): ProviderKind {
  if (isProviderKind(value)) {
    return value;
  }
  return defaultProviderSettings().kind;
}

function readAssistantPreset(value: unknown): AssistantPresetId {
  if (value === "general" || value === "writer" || value === "work" || value === "support") {
    return value;
  }
  return defaultProviderSettings().assistantPreset;
}

function readApiKey(
  kind: ProviderKind,
  candidate: Partial<ProviderSettings> & Record<string, unknown>
): string {
  if (typeof candidate.apiKey === "string") {
    return candidate.apiKey;
  }
  if (kind === "deepseek" && typeof candidate.deepseekApiKey === "string") {
    return candidate.deepseekApiKey;
  }
  if (kind === "openai" && typeof candidate.openaiApiKey === "string") {
    return candidate.openaiApiKey;
  }
  return kind === "deepseek" ? process.env.DEEPSEEK_API_KEY ?? "" : "";
}

function readBaseUrl(
  kind: ProviderKind,
  fallback: string,
  candidate: Partial<ProviderSettings> & Record<string, unknown>
): string {
  if (typeof candidate.baseUrl === "string") {
    return candidate.baseUrl;
  }
  if (kind === "openai" && typeof candidate.openaiBaseUrl === "string") {
    return candidate.openaiBaseUrl;
  }
  return fallback;
}

function readModel(
  kind: ProviderKind,
  fallback: string,
  candidate: Partial<ProviderSettings> & Record<string, unknown>
): string {
  if (typeof candidate.model === "string") {
    return candidate.model;
  }
  if (kind === "deepseek" && typeof candidate.deepseekModel === "string") {
    return candidate.deepseekModel;
  }
  if (kind === "openai" && typeof candidate.openaiModel === "string") {
    return candidate.openaiModel;
  }
  return fallback;
}

function readApiStyle(kind: ProviderKind, value: unknown): ProviderApiStyle {
  if (value === "openai" || value === "anthropic" || value === "gemini") {
    return resolveProviderApiStyle(kind, value);
  }
  return resolveProviderApiStyle(kind);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readNonNegativeInteger(value: unknown, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return fallback;
  }
  return Math.floor(numeric);
}

function readRequestHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, headerValue]) => {
      if (!key.trim() || typeof headerValue !== "string") {
        return [];
      }
      return [[key, headerValue]];
    })
  );
}

function readCodexSandbox(value: unknown): CodexSandboxMode {
  return value === "workspace-write" ? "workspace-write" : "read-only";
}
