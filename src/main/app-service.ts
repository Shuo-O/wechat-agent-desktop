import { EventEmitter } from "node:events";
import { shell } from "electron";

import { JsonStore } from "./store";
import type { SaveSettingsInput, Snapshot } from "./types";
import { SessionEngine } from "./session-engine";
import { WechatGateway } from "./wechat-gateway";

function maskApiKey(value: string): string {
  if (!value) {
    return "";
  }
  if (value.length <= 8) {
    return "已保存";
  }
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

export class AppService extends EventEmitter {
  private readonly store: JsonStore;
  private readonly gateway: WechatGateway;
  private readonly sessionEngine: SessionEngine;

  constructor(dataDir: string) {
    super();
    this.store = new JsonStore(dataDir);
    this.gateway = new WechatGateway(this.store, () => this.publish());
    this.sessionEngine = new SessionEngine({
      store: this.store,
      gateway: this.gateway,
      onChanged: () => this.publish(),
      log: (level, message) => this.log(level, message)
    });
  }

  async initialize(): Promise<void> {
    this.resetRuntimeStateOnLaunch();

    if (!this.store.getData().wechat.credentials) {
      return;
    }

    await this.gateway.beginLogin(false);
    this.log("info", "已恢复本地微信登录态");
    await this.startRuntime();
  }

  getSnapshot(): Snapshot {
    const data = this.store.getData();

    return {
      dataDir: this.store.getDataDir(),
      settings: {
        allowUnknownContacts: data.settings.allowUnknownContacts,
        advancedModeEnabled: data.settings.advancedModeEnabled,
        providerKind: data.settings.provider.kind,
        assistantPreset: data.settings.provider.assistantPreset,
        deepseekModel: data.settings.provider.deepseekModel,
        deepseekApiKeyMasked: maskApiKey(data.settings.provider.deepseekApiKey),
        openaiBaseUrl: data.settings.provider.openaiBaseUrl,
        openaiModel: data.settings.provider.openaiModel,
        openaiApiKeyMasked: maskApiKey(data.settings.provider.openaiApiKey),
        codexWorkdir: data.settings.provider.codexWorkdir,
        codexModel: data.settings.provider.codexModel,
        codexSandbox: data.settings.provider.codexSandbox
      },
      runtime: data.runtime,
      wechat: {
        status: data.wechat.status,
        qrUrl: data.wechat.qrUrl,
        statusMessage: data.wechat.statusMessage,
        accountId: data.wechat.credentials?.accountId ?? null,
        userId: data.wechat.credentials?.userId ?? null,
        lastError: data.wechat.lastError
      },
      contacts: Object.values(data.contacts)
        .sort((left, right) => {
          const a = left.lastInboundAt ?? left.lastReplyAt ?? "";
          const b = right.lastInboundAt ?? right.lastReplyAt ?? "";
          return b.localeCompare(a);
        })
        .map((contact) => ({
          id: contact.id,
          enabled: contact.enabled,
          status: contact.status,
          lastInboundAt: contact.lastInboundAt,
          lastReplyAt: contact.lastReplyAt,
          lastMessagePreview: contact.lastMessagePreview,
          lastReplyPreview: contact.lastReplyPreview,
          lastError: contact.lastError
        })),
      logs: data.logs.slice(0, 60)
    };
  }

  async startWechatLogin(force = false): Promise<void> {
    if (force && this.store.getData().runtime.isRunning) {
      this.stopRuntime();
    }
    await this.gateway.beginLogin(force);
    this.log("info", "微信登录流程完成");
    await this.startRuntime();
  }

  logoutWechat(): void {
    this.stopRuntime();
    this.gateway.clearLogin();
    this.log("info", "已退出微信登录");
  }

  async startRuntime(): Promise<void> {
    const data = this.store.getData();
    if (!data.wechat.credentials) {
      throw new Error("请先完成微信扫码登录");
    }

    if (data.runtime.isRunning) {
      return;
    }

    this.store.update((draft) => {
      draft.runtime.isRunning = true;
      draft.runtime.lastStartedAt = new Date().toISOString();
      draft.runtime.lastStoppedAt = null;
      draft.wechat.statusMessage = "正在接收微信消息";
      draft.wechat.lastError = null;
    });
    this.publish();

    void this.gateway.startMonitoring(
      async (message) => {
        await this.sessionEngine.handleInbound(message);
      },
      () => {
        this.store.update((draft) => {
          draft.runtime.isRunning = false;
          draft.runtime.lastStoppedAt = new Date().toISOString();
        });
        this.publish();
        this.log("warn", "微信登录态失效，已停止接收消息");
      }
    );

    this.log("info", "已开始接收微信消息");
  }

  stopRuntime(): void {
    this.gateway.stopMonitoring();
    this.store.update((draft) => {
      if (draft.runtime.isRunning) {
        draft.runtime.isRunning = false;
        draft.runtime.lastStoppedAt = new Date().toISOString();
        if (draft.wechat.status === "logged_in") {
          draft.wechat.statusMessage = "已暂停接收消息";
        }
      }
    });
    this.publish();
    this.log("info", "已暂停接收微信消息");
  }

  shutdown(): void {
    this.gateway.stopMonitoring();
    this.store.update((draft) => {
      if (draft.runtime.isRunning) {
        draft.runtime.isRunning = false;
        draft.runtime.lastStoppedAt = new Date().toISOString();
      }
    });
  }

  saveSettings(input: SaveSettingsInput): void {
    this.store.update((draft) => {
      const providerChanged =
        Boolean(input.previousProviderKind) &&
        input.previousProviderKind !== input.providerKind;

      draft.settings.allowUnknownContacts = input.allowUnknownContacts;
      draft.settings.advancedModeEnabled = input.advancedModeEnabled;
      draft.settings.provider.kind = input.providerKind;
      draft.settings.provider.assistantPreset = input.assistantPreset;
      draft.settings.provider.deepseekModel = input.deepseekModel.trim() || draft.settings.provider.deepseekModel;
      if (input.deepseekApiKey && input.deepseekApiKey.trim()) {
        draft.settings.provider.deepseekApiKey = input.deepseekApiKey.trim();
      }
      draft.settings.provider.openaiBaseUrl = input.openaiBaseUrl.trim() || draft.settings.provider.openaiBaseUrl;
      draft.settings.provider.openaiModel = input.openaiModel.trim() || draft.settings.provider.openaiModel;
      if (input.openaiApiKey && input.openaiApiKey.trim()) {
        draft.settings.provider.openaiApiKey = input.openaiApiKey.trim();
      }
      draft.settings.provider.codexWorkdir = input.codexWorkdir.trim();
      draft.settings.provider.codexModel = input.codexModel.trim();
      draft.settings.provider.codexSandbox = input.codexSandbox;

      if (input.resetHistories || providerChanged) {
        for (const contact of Object.values(draft.contacts)) {
          contact.history = [];
          contact.lastMessagePreview = "";
          contact.lastReplyPreview = "";
          contact.lastError = null;
          contact.status = contact.enabled ? "idle" : "muted";
        }
      }
    });
    this.publish();
    this.log("info", input.resetHistories ? "助手设置已保存，并清空了历史上下文" : "助手设置已保存");
  }

  setContactEnabled(contactId: string, enabled: boolean): void {
    this.store.update((draft) => {
      const contact = draft.contacts[contactId];
      if (!contact) {
        return;
      }
      contact.enabled = enabled;
      contact.status = enabled ? "idle" : "muted";
      contact.lastError = null;
    });
    this.publish();
    this.log("info", `${contactId} 已${enabled ? "启用" : "静音"}`);
  }

  clearContactHistory(contactId: string): void {
    this.store.update((draft) => {
      const contact = draft.contacts[contactId];
      if (!contact) {
        return;
      }
      contact.history = [];
      contact.lastMessagePreview = "";
      contact.lastReplyPreview = "";
      contact.lastError = null;
      contact.status = contact.enabled ? "idle" : "muted";
    });
    this.publish();
    this.log("info", `已清空联系人 ${contactId} 的上下文`);
  }

  async openDataDirectory(): Promise<void> {
    await shell.openPath(this.store.getDataDir());
  }

  private log(level: "info" | "warn" | "error", message: string): void {
    this.store.addLog(level, message);
    this.publish();
  }

  private publish(): void {
    this.emit("snapshot", this.getSnapshot());
  }

  private resetRuntimeStateOnLaunch(): void {
    const data = this.store.getData();
    if (!data.runtime.isRunning) {
      return;
    }

    this.store.update((draft) => {
      draft.runtime.isRunning = false;
      draft.runtime.lastStoppedAt = new Date().toISOString();
      if (draft.wechat.credentials && draft.wechat.status === "logged_in") {
        draft.wechat.statusMessage = "已恢复本地微信登录态";
      }
    });
  }
}
