import { generateReply } from "../agent-provider";
import { AgentCommandResolver } from "../agent-command-resolver";
import type {
  RuntimeAdapter,
  RuntimeReplyInput
} from "../runtime-adapter";
import type { AgentRunRecorder } from "../types";

export class LocalProviderRuntimeAdapter implements RuntimeAdapter {
  private readonly agentCommandResolver: AgentCommandResolver;
  private readonly agentRunRecorder: AgentRunRecorder;

  constructor(params: {
    agentCommandResolver: AgentCommandResolver;
    agentRunRecorder: AgentRunRecorder;
  }) {
    this.agentCommandResolver = params.agentCommandResolver;
    this.agentRunRecorder = params.agentRunRecorder;
  }

  async prepare(_settings: RuntimeReplyInput["settings"]): Promise<void> {
    // Local provider mode has no extra bootstrap work.
  }

  async generateReply(input: RuntimeReplyInput): Promise<string> {
    return generateReply({
      settings: input.settings.provider,
      contact: input.contact,
      incomingText: input.incomingText
    }, {
      agentCommandResolver: this.agentCommandResolver,
      agentRunRecorder: this.agentRunRecorder,
      runtimeKind: input.settings.assistantRuntime.kind,
      source: input.contact.id === "__ui_console__" ? "ui-manual" : "wechat-auto"
    });
  }

  shutdown(): void {
    // Local provider mode has no background process to clean up.
  }
}
