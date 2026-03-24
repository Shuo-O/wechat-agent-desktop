import type { JsonStore } from "./store";
import type { ChannelAdapter } from "./channel-adapter";
import { OpenClawHttpAdapter } from "./channel-adapters/openclaw-http-adapter";

export function createChannelAdapter(
  store: JsonStore,
  onChanged: () => void
): ChannelAdapter {
  switch (store.getData().settings.channel.kind) {
    case "openclaw-compatible":
    case "openclaw-official":
    default:
      return new OpenClawHttpAdapter(store, onChanged);
  }
}
