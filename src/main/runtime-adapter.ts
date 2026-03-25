import type {
  AppSettings,
  ContactEntry
} from "./types";

export interface RuntimeReplyInput {
  settings: AppSettings;
  contact: ContactEntry;
  incomingText: string;
}

export interface RuntimeAdapter {
  prepare(settings: AppSettings): Promise<void>;
  generateReply(input: RuntimeReplyInput): Promise<string>;
  shutdown?(): Promise<void> | void;
}
