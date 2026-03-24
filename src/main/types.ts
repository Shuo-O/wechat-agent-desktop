export type LogLevel = "info" | "warn" | "error";
export type ProviderKind = "mock" | "deepseek" | "openai" | "codex";
export type AssistantPresetId = "general" | "writer" | "work" | "support";
export type WechatLoginStatus =
  | "logged_out"
  | "pending"
  | "logged_in"
  | "expired"
  | "error";
export type CodexSandboxMode = "read-only" | "workspace-write";

export interface WechatCredentials {
  token: string;
  baseUrl: string;
  accountId: string;
  userId: string;
  savedAt: string;
}

export interface ProviderSettings {
  kind: ProviderKind;
  assistantPreset: AssistantPresetId;
  deepseekApiKey: string;
  deepseekModel: string;
  openaiBaseUrl: string;
  openaiApiKey: string;
  openaiModel: string;
  codexWorkdir: string;
  codexModel: string;
  codexSandbox: CodexSandboxMode;
}

export interface AppSettings {
  allowUnknownContacts: boolean;
  advancedModeEnabled: boolean;
  provider: ProviderSettings;
}

export interface LogEntry {
  id: string;
  level: LogLevel;
  message: string;
  createdAt: string;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  text: string;
  createdAt: string;
}

export interface ContactEntry {
  id: string;
  enabled: boolean;
  lastContextToken: string;
  status: "idle" | "processing" | "error" | "muted";
  lastInboundAt: string | null;
  lastReplyAt: string | null;
  lastMessagePreview: string;
  lastReplyPreview: string;
  lastError: string | null;
  history: ConversationTurn[];
}

export interface WechatState {
  status: WechatLoginStatus;
  credentials: WechatCredentials | null;
  qrUrl: string | null;
  statusMessage: string;
  syncCursor: string;
  lastError: string | null;
}

export interface RuntimeState {
  isRunning: boolean;
  lastStartedAt: string | null;
  lastStoppedAt: string | null;
}

export interface AppData {
  settings: AppSettings;
  logs: LogEntry[];
  contacts: Record<string, ContactEntry>;
  wechat: WechatState;
  runtime: RuntimeState;
}

export interface Snapshot {
  dataDir: string;
  settings: {
    allowUnknownContacts: boolean;
    advancedModeEnabled: boolean;
    providerKind: ProviderKind;
    assistantPreset: AssistantPresetId;
    deepseekModel: string;
    deepseekApiKeyMasked: string;
    openaiBaseUrl: string;
    openaiModel: string;
    openaiApiKeyMasked: string;
    codexWorkdir: string;
    codexModel: string;
    codexSandbox: CodexSandboxMode;
  };
  runtime: RuntimeState;
  wechat: {
    status: WechatLoginStatus;
    qrUrl: string | null;
    statusMessage: string;
    accountId: string | null;
    userId: string | null;
    lastError: string | null;
  };
  contacts: Array<{
    id: string;
    enabled: boolean;
    status: ContactEntry["status"];
    lastInboundAt: string | null;
    lastReplyAt: string | null;
    lastMessagePreview: string;
    lastReplyPreview: string;
    lastError: string | null;
  }>;
  logs: LogEntry[];
}

export interface SaveSettingsInput {
  allowUnknownContacts: boolean;
  advancedModeEnabled: boolean;
  providerKind: ProviderKind;
  previousProviderKind?: ProviderKind;
  assistantPreset: AssistantPresetId;
  deepseekModel: string;
  deepseekApiKey?: string;
  openaiBaseUrl: string;
  openaiModel: string;
  openaiApiKey?: string;
  codexWorkdir: string;
  codexModel: string;
  codexSandbox: CodexSandboxMode;
  resetHistories?: boolean;
}

export interface InboundMessage {
  contactId: string;
  contextToken: string;
  text: string;
}

export interface OpenClawMessageItem {
  type?: number;
  text_item?: { text?: string };
  image_item?: { url?: string };
  voice_item?: { text?: string };
  file_item?: { file_name?: string };
}

export interface OpenClawMessage {
  from_user_id?: string;
  to_user_id?: string;
  group_id?: string;
  message_type?: number;
  context_token?: string;
  item_list?: OpenClawMessageItem[];
}
