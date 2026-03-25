import type { AgentRunRecorder } from "./types";
import { AgentCommandResolver } from "./agent-command-resolver";
import type { RuntimeAdapter } from "./runtime-adapter";
import { LocalProviderRuntimeAdapter } from "./runtime-adapters/local-provider-runtime-adapter";
import { OpenClawAcpRuntimeAdapter } from "./runtime-adapters/openclaw-acp-runtime-adapter";
import { OpenClawCliRuntimeAdapter } from "./runtime-adapters/openclaw-cli-runtime-adapter";

class CompositeRuntimeAdapter implements RuntimeAdapter {
  private readonly localProviderAdapter: LocalProviderRuntimeAdapter;
  private readonly openclawAcpAdapter: OpenClawAcpRuntimeAdapter;
  private readonly openclawCliAdapter: OpenClawCliRuntimeAdapter;

  constructor(params: {
    dataDir: string;
    log?: (level: "info" | "warn" | "error", message: string) => void;
    agentCommandResolver: AgentCommandResolver;
    agentRunRecorder: AgentRunRecorder;
  }) {
    this.localProviderAdapter = new LocalProviderRuntimeAdapter(params);
    this.openclawAcpAdapter = new OpenClawAcpRuntimeAdapter(params);
    this.openclawCliAdapter = new OpenClawCliRuntimeAdapter(params);
  }

  async prepare(settings: Parameters<RuntimeAdapter["prepare"]>[0]): Promise<void> {
    switch (settings.assistantRuntime.kind) {
      case "openclaw-acp":
        return this.openclawAcpAdapter.prepare(settings);
      case "openclaw-cli":
        return this.openclawCliAdapter.prepare(settings);
      case "local-provider":
      default:
        return this.localProviderAdapter.prepare(settings);
    }
  }

  async generateReply(input: Parameters<RuntimeAdapter["generateReply"]>[0]): Promise<string> {
    switch (input.settings.assistantRuntime.kind) {
      case "openclaw-acp":
        return this.openclawAcpAdapter.generateReply(input);
      case "openclaw-cli":
        return this.openclawCliAdapter.generateReply(input);
      case "local-provider":
      default:
        return this.localProviderAdapter.generateReply(input);
    }
  }

  shutdown(): void {
    this.localProviderAdapter.shutdown?.();
    this.openclawAcpAdapter.shutdown?.();
    this.openclawCliAdapter.shutdown?.();
  }
}

export function createRuntimeAdapter(params: {
  dataDir: string;
  log?: (level: "info" | "warn" | "error", message: string) => void;
  agentCommandResolver: AgentCommandResolver;
  agentRunRecorder: AgentRunRecorder;
}): RuntimeAdapter {
  return new CompositeRuntimeAdapter(params);
}
