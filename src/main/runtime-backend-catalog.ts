import type {
  AssistantRuntimeKind,
  AssistantRuntimeOptionSnapshot
} from "./types";

export interface AssistantRuntimeDefinition {
  kind: AssistantRuntimeKind;
  label: string;
  description: string;
}

const ASSISTANT_RUNTIME_DEFINITIONS: Record<AssistantRuntimeKind, AssistantRuntimeDefinition> = {
  "local-provider": {
    kind: "local-provider",
    label: "直连模型",
    description: "当前项目直接请求 DeepSeek、OpenAI 等模型接口；微信只负责收发消息，不经过 OpenClaw runtime。"
  },
  "openclaw-cli": {
    kind: "openclaw-cli",
    label: "统一走 OpenClaw",
    description: "所有消息统一交给 OpenClaw Gateway 原生控制面处理；底层模型、工具、agent 和联网能力都以 OpenClaw 内部配置为准。"
  },
  "openclaw-acp": {
    kind: "openclaw-acp",
    label: "统一走 OpenClaw ACP",
    description: "实验性模式。当前版本的 OpenClaw ACP 更适合 IDE / 线程绑定场景，不适合作为外部微信前端的主回复链路。"
  }
};

export function listAssistantRuntimeOptions(): AssistantRuntimeOptionSnapshot[] {
  return Object.values(ASSISTANT_RUNTIME_DEFINITIONS)
    .filter((item) => item.kind !== "openclaw-acp")
    .map((item) => ({
    kind: item.kind,
    label: item.label,
    description: item.description
    }));
}

export function getAssistantRuntimeDefinition(
  kind: AssistantRuntimeKind
): AssistantRuntimeDefinition {
  return ASSISTANT_RUNTIME_DEFINITIONS[kind] ?? ASSISTANT_RUNTIME_DEFINITIONS["local-provider"];
}

export function isAssistantRuntimeKind(value: unknown): value is AssistantRuntimeKind {
  return typeof value === "string" && Object.hasOwn(ASSISTANT_RUNTIME_DEFINITIONS, value);
}
