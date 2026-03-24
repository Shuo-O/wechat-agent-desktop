import type {
  CloudProviderKind,
  ProviderApiStyle,
  ProviderKind,
  ProviderOptionGroup,
  ProviderOptionSnapshot
} from "./types";

export interface ProviderDefinition {
  kind: ProviderKind;
  label: string;
  group: ProviderOptionGroup;
  description: string;
  apiStyle: ProviderApiStyle | null;
  defaultBaseUrl: string;
  defaultModel: string;
  modelPlaceholder: string;
  endpointPath?: string;
}

const PROVIDER_DEFINITIONS: Record<ProviderKind, ProviderDefinition> = {
  mock: {
    kind: "mock",
    label: "演示助手",
    group: "builtin",
    description: "不调用真实模型，用于验证消息闭环。",
    apiStyle: null,
    defaultBaseUrl: "",
    defaultModel: "",
    modelPlaceholder: ""
  },
  deepseek: {
    kind: "deepseek",
    label: "DeepSeek",
    group: "domestic",
    description: "官方接口，适合作为默认聊天供应商。",
    apiStyle: "openai",
    defaultBaseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
    modelPlaceholder: "例如 deepseek-chat",
    endpointPath: "/chat/completions"
  },
  qwen: {
    kind: "qwen",
    label: "通义千问（DashScope）",
    group: "domestic",
    description: "阿里云 DashScope OpenAI 兼容模式。",
    apiStyle: "openai",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    modelPlaceholder: "例如 qwen-plus",
    endpointPath: "/chat/completions"
  },
  zhipu: {
    kind: "zhipu",
    label: "智谱 GLM",
    group: "domestic",
    description: "智谱开放平台兼容聊天接口。",
    apiStyle: "openai",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-plus",
    modelPlaceholder: "例如 glm-4-plus",
    endpointPath: "/chat/completions"
  },
  doubao: {
    kind: "doubao",
    label: "豆包（火山方舟）",
    group: "domestic",
    description: "火山引擎 ARK 兼容接口，通常需要填写推理接入点 ID。",
    apiStyle: "openai",
    defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: "",
    modelPlaceholder: "填写火山方舟接入点 ID",
    endpointPath: "/chat/completions"
  },
  kimi: {
    kind: "kimi",
    label: "Kimi（Moonshot）",
    group: "domestic",
    description: "Moonshot 官方 OpenAI 兼容接口。",
    apiStyle: "openai",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-8k",
    modelPlaceholder: "例如 moonshot-v1-8k",
    endpointPath: "/chat/completions"
  },
  siliconflow: {
    kind: "siliconflow",
    label: "SiliconFlow",
    group: "domestic",
    description: "聚合型国内模型平台，适合快速接多模型。",
    apiStyle: "openai",
    defaultBaseUrl: "https://api.siliconflow.cn/v1",
    defaultModel: "Qwen/Qwen2.5-72B-Instruct",
    modelPlaceholder: "例如 Qwen/Qwen2.5-72B-Instruct",
    endpointPath: "/chat/completions"
  },
  openai: {
    kind: "openai",
    label: "OpenAI",
    group: "global",
    description: "官方 Chat Completions 接口。",
    apiStyle: "openai",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    modelPlaceholder: "例如 gpt-4o-mini",
    endpointPath: "/chat/completions"
  },
  anthropic: {
    kind: "anthropic",
    label: "Anthropic Claude",
    group: "global",
    description: "官方 Messages API。",
    apiStyle: "anthropic",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-3-5-sonnet-latest",
    modelPlaceholder: "例如 claude-3-5-sonnet-latest",
    endpointPath: "/messages"
  },
  gemini: {
    kind: "gemini",
    label: "Google Gemini",
    group: "global",
    description: "官方 Gemini GenerateContent API。",
    apiStyle: "gemini",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.0-flash",
    modelPlaceholder: "例如 gemini-2.0-flash"
  },
  xai: {
    kind: "xai",
    label: "xAI Grok",
    group: "global",
    description: "xAI 官方 OpenAI 兼容接口。",
    apiStyle: "openai",
    defaultBaseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-2-latest",
    modelPlaceholder: "例如 grok-2-latest",
    endpointPath: "/chat/completions"
  },
  openrouter: {
    kind: "openrouter",
    label: "OpenRouter",
    group: "global",
    description: "聚合型国际模型平台，可统一接多个国外模型。",
    apiStyle: "openai",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4o-mini",
    modelPlaceholder: "例如 openai/gpt-4o-mini",
    endpointPath: "/chat/completions"
  },
  custom: {
    kind: "custom",
    label: "自定义接口",
    group: "advanced",
    description: "手动填写 Base URL、模型名和协议，兼容更多平台。",
    apiStyle: "openai",
    defaultBaseUrl: "",
    defaultModel: "",
    modelPlaceholder: "填写你自己的模型名"
  },
  codex: {
    kind: "codex",
    label: "Codex（高级）",
    group: "advanced",
    description: "本地 CLI Agent，适合代码仓库问答和修改。",
    apiStyle: null,
    defaultBaseUrl: "",
    defaultModel: "",
    modelPlaceholder: ""
  }
};

export function listProviderOptions(): ProviderOptionSnapshot[] {
  return Object.values(PROVIDER_DEFINITIONS).map((item) => ({
    kind: item.kind,
    label: item.label,
    group: item.group,
    description: item.description,
    apiStyle: item.apiStyle,
    defaultBaseUrl: item.defaultBaseUrl,
    defaultModel: item.defaultModel,
    modelPlaceholder: item.modelPlaceholder
  }));
}

export function getProviderDefinition(kind: ProviderKind): ProviderDefinition {
  return PROVIDER_DEFINITIONS[kind] ?? PROVIDER_DEFINITIONS.deepseek;
}

export function getProviderLabel(kind: ProviderKind): string {
  return getProviderDefinition(kind).label;
}

export function isCloudProviderKind(kind: ProviderKind): kind is CloudProviderKind {
  return kind !== "mock" && kind !== "codex";
}

export function isProviderKind(value: unknown): value is ProviderKind {
  return typeof value === "string" && Object.hasOwn(PROVIDER_DEFINITIONS, value);
}

export function resolveProviderApiStyle(
  kind: ProviderKind,
  customStyle?: ProviderApiStyle
): ProviderApiStyle {
  return getProviderDefinition(kind).apiStyle ?? customStyle ?? "openai";
}
