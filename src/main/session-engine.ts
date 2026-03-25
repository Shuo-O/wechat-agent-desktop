import { getProviderLabel, isCloudProviderKind } from "./provider-catalog";
import type { ChannelAdapter } from "./channel-adapter";
import type { RuntimeAdapter } from "./runtime-adapter";
import type { JsonStore } from "./store";
import type { AppSettings, InboundMessage } from "./types";

const HISTORY_LIMIT = 16;

export class SessionEngine {
  private readonly store: JsonStore;
  private readonly channelAdapter: ChannelAdapter;
  private readonly runtimeAdapter: RuntimeAdapter;
  private readonly onChanged: () => void;
  private readonly log: (level: "info" | "warn" | "error", message: string) => void;
  private readonly queues = new Map<string, InboundMessage[]>();
  private readonly processing = new Set<string>();

  constructor(params: {
    store: JsonStore;
    channelAdapter: ChannelAdapter;
    runtimeAdapter: RuntimeAdapter;
    onChanged: () => void;
    log: (level: "info" | "warn" | "error", message: string) => void;
  }) {
    this.store = params.store;
    this.channelAdapter = params.channelAdapter;
    this.runtimeAdapter = params.runtimeAdapter;
    this.onChanged = params.onChanged;
    this.log = params.log;
  }

  async handleInbound(message: InboundMessage): Promise<void> {
    const enabledByDefault = this.store.getData().settings.allowUnknownContacts;
    const contact = this.store.upsertContact(message.contactId, enabledByDefault);

    this.store.update((draft) => {
      const draftContact = draft.contacts[message.contactId];
      draftContact.lastContextToken = message.contextToken;
      draftContact.lastInboundAt = new Date().toISOString();
      draftContact.lastMessagePreview = message.text;
      draftContact.lastError = null;
      if (!draftContact.enabled) {
        draftContact.status = "muted";
      }
      draftContact.history.push({
        role: "user",
        text: message.text,
        createdAt: new Date().toISOString()
      });
      draftContact.history = draftContact.history.slice(-HISTORY_LIMIT);
    });
    this.onChanged();

    if (!contact.enabled) {
      this.log("warn", `联系人 ${message.contactId} 已静音，消息不会自动回复`);
      return;
    }

    const queue = this.queues.get(message.contactId) ?? [];
    queue.push(message);
    this.queues.set(message.contactId, queue);
    await this.processQueue(message.contactId);
  }

  private async processQueue(contactId: string): Promise<void> {
    if (this.processing.has(contactId)) {
      return;
    }

    this.processing.add(contactId);

    try {
      const queue = this.queues.get(contactId);
      while (queue && queue.length > 0) {
        const current = queue.shift()!;
        const settings = this.store.getData().settings;

        this.store.update((draft) => {
          const contact = draft.contacts[contactId];
          contact.status = "processing";
          contact.lastError = null;
        });
        this.onChanged();

        try {
          await this.channelAdapter.sendTyping(contactId, current.contextToken).catch(() => undefined);

          const reply = await this.runtimeAdapter.generateReply({
            settings,
            contact: this.store.getData().contacts[contactId],
            incomingText: current.text
          });

          await this.channelAdapter.sendText(contactId, current.contextToken, reply);

          this.store.update((draft) => {
            const contact = draft.contacts[contactId];
            contact.status = "idle";
            contact.lastReplyAt = new Date().toISOString();
            contact.lastReplyPreview = reply;
            contact.lastError = null;
            contact.history.push({
              role: "assistant",
              text: reply,
              createdAt: new Date().toISOString()
            });
            contact.history = contact.history.slice(-HISTORY_LIMIT);
          });
          this.onChanged();

          this.log("info", `已向联系人 ${contactId} 发送回复`);
        } catch (error) {
          const message = normalizeError(error, settings);
          this.store.update((draft) => {
            const contact = draft.contacts[contactId];
            contact.status = "error";
            contact.lastError = message;
          });
          this.onChanged();
          this.log("error", `联系人 ${contactId} 回复失败：${message}`);

          try {
            await this.channelAdapter.sendText(
              contactId,
              current.contextToken,
              `抱歉，我现在暂时无法回复。\n\n原因：${message}`
            );
          } catch {
            // 这里不再抛出，避免队列终止
          }
        }
      }
    } finally {
      this.processing.delete(contactId);
    }
  }
}

function normalizeError(error: unknown, settings: AppSettings): string {
  if (error instanceof Error) {
    if (
      settings.assistantRuntime.kind === "local-provider"
      && settings.provider.kind === "codex"
    ) {
      const normalized = error.message.toLowerCase();
      if (error.message.includes("工作目录")) {
        return "Codex 模式尚未选择工作目录";
      }
      if (normalized.includes("codex mcp login")) {
        return error.message;
      }
      if (
        normalized.includes("codex cli 尚未登录")
        || (normalized.includes("codex login") && !normalized.includes("codex mcp login"))
      ) {
        return "Codex CLI 尚未登录，请先在终端执行 codex login";
      }
    }
    if (
      settings.assistantRuntime.kind === "local-provider"
      && isCloudProviderKind(settings.provider.kind)
      && error.message.includes("API Key")
    ) {
      return `尚未填写 ${getProviderLabel(settings.provider.kind)} API Key`;
    }
    if (
      (settings.assistantRuntime.kind === "openclaw-cli" || settings.assistantRuntime.kind === "openclaw-acp")
      && error.message.includes("OpenClaw")
    ) {
      return error.message;
    }
    return error.message;
  }

  return String(error);
}
