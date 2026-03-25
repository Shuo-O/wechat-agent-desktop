import { generateReply } from "../agent-provider";
import type {
  RuntimeAdapter,
  RuntimeReplyInput
} from "../runtime-adapter";

export class LocalProviderRuntimeAdapter implements RuntimeAdapter {
  async prepare(_settings: RuntimeReplyInput["settings"]): Promise<void> {
    // Local provider mode has no extra bootstrap work.
  }

  async generateReply(input: RuntimeReplyInput): Promise<string> {
    return generateReply({
      settings: input.settings.provider,
      contact: input.contact,
      incomingText: input.incomingText
    });
  }

  shutdown(): void {
    // Local provider mode has no background process to clean up.
  }
}
