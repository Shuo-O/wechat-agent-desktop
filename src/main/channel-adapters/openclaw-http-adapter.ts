import { setTimeout as delay } from "node:timers/promises";
import QRCode from "qrcode";

import type { ChannelAdapter } from "../channel-adapter";
import {
  fetchQrCode,
  fetchQrStatus,
  getTypingTicket,
  getUpdates,
  OpenClawApiError,
  sendTextMessage,
  sendTyping
} from "../openclaw";
import type { JsonStore } from "../store";
import type { InboundMessage, OpenClawMessage } from "../types";

const SESSION_EXPIRED_CODE = -14;

function extractInboundMessage(message: OpenClawMessage): InboundMessage | null {
  if (message.message_type !== 1) {
    return null;
  }

  if (message.group_id) {
    return null;
  }

  const contactId = message.from_user_id;
  const contextToken = message.context_token;

  if (!contactId || !contextToken) {
    return null;
  }

  const text = (message.item_list ?? [])
    .map((item) => {
      if (item.type === 1) return item.text_item?.text ?? "";
      if (item.type === 2) return item.image_item?.url ?? "[图片]";
      if (item.type === 3) return item.voice_item?.text ?? "[语音]";
      if (item.type === 4) return item.file_item?.file_name ?? "[文件]";
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();

  return {
    contactId,
    contextToken,
    text: text || "[空消息]"
  };
}

export class OpenClawHttpAdapter implements ChannelAdapter {
  private readonly store: JsonStore;
  private readonly onChanged: () => void;
  private loginInFlight = false;
  private monitoringAbortController: AbortController | null = null;
  private readonly typingCache = new Map<string, { ticket: string; expiresAt: number }>();

  constructor(store: JsonStore, onChanged: () => void) {
    this.store = store;
    this.onChanged = onChanged;
  }

  async beginLogin(force = false): Promise<void> {
    if (this.loginInFlight) {
      return;
    }

    const data = this.store.getData();
    const baseUrl = this.getConfiguredBaseUrl();
    const requestOptions = this.getRequestOptions();

    if (!force && data.wechat.credentials) {
      this.store.update((draft) => {
        draft.wechat.status = "logged_in";
        draft.wechat.qrUrl = null;
        draft.wechat.statusMessage = "已加载本地微信登录态";
        draft.wechat.lastError = null;
      });
      this.onChanged();
      return;
    }

    this.loginInFlight = true;
    this.store.update((draft) => {
      draft.wechat.status = "pending";
      draft.wechat.qrUrl = null;
      draft.wechat.statusMessage = "正在获取二维码...";
      draft.wechat.lastError = null;
    });
    this.onChanged();

    try {
      while (true) {
        const qr = await fetchQrCode(baseUrl, "3", requestOptions);
        const qrImageDataUrl = await QRCode.toDataURL(qr.qrcode_img_content, {
          margin: 1,
          width: 320,
          color: {
            dark: "#111111",
            light: "#fffaf2"
          }
        });

        this.store.update((draft) => {
          draft.wechat.status = "pending";
          draft.wechat.qrUrl = qrImageDataUrl;
          draft.wechat.statusMessage = "请使用微信扫码";
        });
        this.onChanged();

        let lastStatus = "";
        while (true) {
          const status = await fetchQrStatus(baseUrl, qr.qrcode, requestOptions);
          if (status.status !== lastStatus) {
            lastStatus = status.status;
            this.store.update((draft) => {
              if (status.status === "scaned") {
                draft.wechat.statusMessage = "已扫码，请在手机上确认";
              } else if (status.status === "wait") {
                draft.wechat.statusMessage = "请使用微信扫码";
              } else if (status.status === "expired") {
                draft.wechat.statusMessage = "二维码已过期，正在刷新";
              }
            });
            this.onChanged();
          }

          if (status.status === "confirmed") {
            if (!status.bot_token || !status.ilink_bot_id || !status.ilink_user_id) {
              throw new Error("扫码成功，但返回凭证不完整");
            }

            const confirmedToken = status.bot_token;
            const confirmedAccountId = status.ilink_bot_id;
            const confirmedUserId = status.ilink_user_id;
            const confirmedBaseUrl = status.baseurl || baseUrl;

            this.store.update((draft) => {
              draft.wechat.status = "logged_in";
              draft.wechat.qrUrl = null;
              draft.wechat.statusMessage = "微信已登录";
              draft.wechat.lastError = null;
              draft.wechat.credentials = {
                token: confirmedToken,
                baseUrl: confirmedBaseUrl,
                accountId: confirmedAccountId,
                userId: confirmedUserId,
                savedAt: new Date().toISOString()
              };
            });
            this.onChanged();
            return;
          }

          if (status.status === "expired") {
            break;
          }

          await delay(1500);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.update((draft) => {
        draft.wechat.status = "error";
        draft.wechat.lastError = message;
        draft.wechat.statusMessage = "微信登录失败";
      });
      this.onChanged();
      throw error;
    } finally {
      this.loginInFlight = false;
    }
  }

  clearSession(): void {
    this.stopMonitoring();
    this.store.update((draft) => {
      draft.wechat.status = "logged_out";
      draft.wechat.qrUrl = null;
      draft.wechat.statusMessage = "已退出微信登录";
      draft.wechat.lastError = null;
      draft.wechat.credentials = null;
      draft.wechat.syncCursor = "";
    });
    this.onChanged();
  }

  async startMonitoring(
    onInboundMessage: (message: InboundMessage) => Promise<void>,
    onSessionExpired: () => void
  ): Promise<void> {
    if (this.monitoringAbortController) {
      return;
    }

    const credentials = this.store.getData().wechat.credentials;
    if (!credentials) {
      throw new Error("请先完成微信登录");
    }

    this.monitoringAbortController = new AbortController();
    const signal = this.monitoringAbortController.signal;

    while (!signal.aborted) {
      const latestCredentials = this.store.getData().wechat.credentials;
      if (!latestCredentials) {
        return;
      }

      try {
        const response = await getUpdates(
          latestCredentials.baseUrl,
          latestCredentials.token,
          this.store.getData().wechat.syncCursor,
          38_000,
          this.getRequestOptions()
        );

        if (response.errcode === SESSION_EXPIRED_CODE || response.ret === SESSION_EXPIRED_CODE) {
          this.handleSessionExpired(onSessionExpired);
          return;
        }

        if (response.get_updates_buf) {
          this.store.update((draft) => {
            draft.wechat.syncCursor = response.get_updates_buf ?? draft.wechat.syncCursor;
          });
          this.onChanged();
        }

        for (const raw of response.msgs ?? []) {
          const inbound = extractInboundMessage(raw as OpenClawMessage);
          if (!inbound) {
            continue;
          }

          void onInboundMessage(inbound).catch(() => undefined);
        }
      } catch (error) {
        if (signal.aborted) {
          return;
        }

        if (error instanceof OpenClawApiError && error.code === SESSION_EXPIRED_CODE) {
          this.handleSessionExpired(onSessionExpired);
          return;
        }

        await delay(2000);
      }
    }
  }

  stopMonitoring(): void {
    this.monitoringAbortController?.abort();
    this.monitoringAbortController = null;
  }

  async sendText(contactId: string, contextToken: string, text: string): Promise<void> {
    const credentials = this.store.getData().wechat.credentials;
    if (!credentials) {
      throw new Error("微信尚未登录");
    }

    for (const chunk of splitText(text, 1800)) {
      await sendTextMessage(
        credentials.baseUrl,
        credentials.token,
        contactId,
        contextToken,
        chunk,
        this.getRequestOptions()
      );
    }
  }

  async sendTyping(contactId: string, contextToken: string): Promise<void> {
    const credentials = this.store.getData().wechat.credentials;
    if (!credentials) {
      return;
    }

    const cached = this.typingCache.get(contactId);
    let ticket = cached?.expiresAt && cached.expiresAt > Date.now() ? cached.ticket : null;

    if (!ticket) {
      const response = await getTypingTicket(
        credentials.baseUrl,
        credentials.token,
        contactId,
        contextToken,
        this.getRequestOptions()
      );
      if (!response.typing_ticket) {
        return;
      }
      ticket = response.typing_ticket;
      this.typingCache.set(contactId, {
        ticket,
        expiresAt: Date.now() + 24 * 60 * 60_000
      });
    }

    await sendTyping(
      credentials.baseUrl,
      credentials.token,
      contactId,
      ticket,
      1,
      this.getRequestOptions()
    );
  }

  private handleSessionExpired(onSessionExpired: () => void): void {
    this.stopMonitoring();
    this.store.update((draft) => {
      draft.wechat.status = "expired";
      draft.wechat.lastError = "微信登录态已失效，请重新扫码登录";
      draft.wechat.statusMessage = "微信登录态已失效";
    });
    this.onChanged();
    onSessionExpired();
  }

  private getConfiguredBaseUrl(): string {
    return this.store.getData().settings.channel.baseUrl.trim();
  }

  private getRequestOptions(): { requestHeaders: Record<string, string> } {
    return {
      requestHeaders: this.store.getData().settings.channel.requestHeaders
    };
  }
}

function splitText(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let rest = text;

  while (rest.length > maxLength) {
    let breakAt = rest.lastIndexOf("\n", maxLength);
    if (breakAt <= 0) {
      breakAt = maxLength;
    }

    chunks.push(rest.slice(0, breakAt).trim());
    rest = rest.slice(breakAt).trim();
  }

  if (rest) {
    chunks.push(rest);
  }

  return chunks.filter(Boolean);
}
