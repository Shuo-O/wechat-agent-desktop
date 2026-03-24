import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import type {
  AppData,
  AppSettings,
  ContactEntry,
  LogEntry,
  LogLevel,
  ProviderSettings
} from "./types";

const MAX_LOGS = 200;
const MAX_HISTORY = 16;

function defaultProviderSettings(): ProviderSettings {
  return {
    kind: "deepseek",
    assistantPreset: "general",
    deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? "",
    deepseekModel: "deepseek-chat",
    openaiBaseUrl: "https://api.openai.com/v1",
    openaiApiKey: "",
    openaiModel: "gpt-4o-mini",
    codexWorkdir: "",
    codexModel: "",
    codexSandbox: "read-only"
  };
}

function defaultSettings(): AppSettings {
  return {
    allowUnknownContacts: true,
    advancedModeEnabled: false,
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
          provider: {
            ...defaultProviderSettings(),
            ...(parsed.settings?.provider ?? {})
          }
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
