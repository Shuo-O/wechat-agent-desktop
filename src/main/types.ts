export type LogLevel = "info" | "warn" | "error";
export type ProviderKind =
  | "mock"
  | "deepseek"
  | "qwen"
  | "zhipu"
  | "doubao"
  | "kimi"
  | "siliconflow"
  | "openai"
  | "anthropic"
  | "gemini"
  | "xai"
  | "openrouter"
  | "custom"
  | "codex";
export type CloudProviderKind = Exclude<ProviderKind, "mock" | "codex">;
export type ChannelBackendKind = "openclaw-official" | "openclaw-compatible";
export type AssistantRuntimeKind = "local-provider" | "openclaw-cli" | "openclaw-acp";
export type AssistantPresetId = "general" | "writer" | "work" | "support";
export type WechatLoginStatus =
  | "logged_out"
  | "pending"
  | "logged_in"
  | "expired"
  | "error";
export type CodexSandboxMode = "read-only" | "workspace-write";
export type ProviderApiStyle = "openai" | "anthropic" | "gemini";
export type ProviderOptionGroup = "builtin" | "domestic" | "global" | "advanced";

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
  apiKey: string;
  baseUrl: string;
  model: string;
  apiStyle: ProviderApiStyle;
  codexWorkdir: string;
  codexModel: string;
  codexSandbox: CodexSandboxMode;
}

export interface ChannelBackendSettings {
  kind: ChannelBackendKind;
  baseUrl: string;
  requestHeaders: Record<string, string>;
}

export interface AssistantRuntimeSettings {
  kind: AssistantRuntimeKind;
  openclawCommand: string;
  openclawAgentId: string;
  openclawAcpHarnessId: string;
  openclawTimeoutSeconds: number;
  openclawWorkingDir: string;
}

export interface AppSettings {
  allowUnknownContacts: boolean;
  advancedModeEnabled: boolean;
  channel: ChannelBackendSettings;
  assistantRuntime: AssistantRuntimeSettings;
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
  runtimeSessionNonce: number;
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
    channelBackendKind: ChannelBackendKind;
    channelBaseUrl: string;
    channelHeadersJson: string;
    assistantRuntimeKind: AssistantRuntimeKind;
    openclawCommand: string;
    openclawAgentId: string;
    openclawAcpHarnessId: string;
    openclawTimeoutSeconds: number;
    openclawWorkingDir: string;
    providerKind: ProviderKind;
    assistantPreset: AssistantPresetId;
    providerBaseUrl: string;
    providerModel: string;
    providerApiStyle: ProviderApiStyle;
    providerApiKeyMasked: string;
    codexWorkdir: string;
    codexModel: string;
    codexSandbox: CodexSandboxMode;
  };
  channelOptions: ChannelBackendOptionSnapshot[];
  runtimeOptions: AssistantRuntimeOptionSnapshot[];
  providerOptions: ProviderOptionSnapshot[];
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

export interface ProviderOptionSnapshot {
  kind: ProviderKind;
  label: string;
  group: ProviderOptionGroup;
  description: string;
  apiStyle: ProviderApiStyle | null;
  defaultBaseUrl: string;
  defaultModel: string;
  modelPlaceholder: string;
}

export interface ChannelBackendOptionSnapshot {
  kind: ChannelBackendKind;
  label: string;
  description: string;
  defaultBaseUrl: string;
}

export interface AssistantRuntimeOptionSnapshot {
  kind: AssistantRuntimeKind;
  label: string;
  description: string;
}

export interface SaveSettingsInput {
  allowUnknownContacts: boolean;
  advancedModeEnabled: boolean;
  channelBackendKind: ChannelBackendKind;
  channelBaseUrl: string;
  channelHeadersJson: string;
  assistantRuntimeKind: AssistantRuntimeKind;
  openclawCommand: string;
  openclawAgentId: string;
  openclawAcpHarnessId: string;
  openclawTimeoutSeconds: number;
  openclawWorkingDir: string;
  providerKind: ProviderKind;
  previousProviderKind?: ProviderKind;
  assistantPreset: AssistantPresetId;
  providerBaseUrl: string;
  providerModel: string;
  providerApiStyle: ProviderApiStyle;
  providerApiKey?: string;
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
