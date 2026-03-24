import type {
  ChannelBackendKind,
  ChannelBackendOptionSnapshot
} from "./types";

export interface ChannelBackendDefinition {
  kind: ChannelBackendKind;
  label: string;
  description: string;
  defaultBaseUrl: string;
}

const CHANNEL_BACKEND_DEFINITIONS: Record<ChannelBackendKind, ChannelBackendDefinition> = {
  "openclaw-official": {
    kind: "openclaw-official",
    label: "OpenClaw 官方",
    description: "使用默认 OpenClaw / iLink HTTP 接口，适合直接对接官方兼容环境。",
    defaultBaseUrl: "https://ilinkai.weixin.qq.com"
  },
  "openclaw-compatible": {
    kind: "openclaw-compatible",
    label: "兼容 OpenClaw HTTP",
    description: "对接自建或定制的 OpenClaw 兼容 HTTP 服务，可自定义 Base URL 和附加请求头。",
    defaultBaseUrl: "http://127.0.0.1:8080"
  }
};

export function listChannelBackendOptions(): ChannelBackendOptionSnapshot[] {
  return Object.values(CHANNEL_BACKEND_DEFINITIONS).map((item) => ({
    kind: item.kind,
    label: item.label,
    description: item.description,
    defaultBaseUrl: item.defaultBaseUrl
  }));
}

export function getChannelBackendDefinition(kind: ChannelBackendKind): ChannelBackendDefinition {
  return CHANNEL_BACKEND_DEFINITIONS[kind] ?? CHANNEL_BACKEND_DEFINITIONS["openclaw-official"];
}

export function isChannelBackendKind(value: unknown): value is ChannelBackendKind {
  return typeof value === "string" && Object.hasOwn(CHANNEL_BACKEND_DEFINITIONS, value);
}
