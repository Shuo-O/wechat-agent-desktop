import type { InboundMessage } from "./types";

export interface ChannelAdapter {
  beginLogin(force?: boolean): Promise<void>;
  clearSession(): void;
  startMonitoring(
    onInboundMessage: (message: InboundMessage) => Promise<void>,
    onSessionExpired: () => void
  ): Promise<void>;
  stopMonitoring(): void;
  sendText(contactId: string, contextToken: string, text: string): Promise<void>;
  sendTyping(contactId: string, contextToken: string): Promise<void>;
}
