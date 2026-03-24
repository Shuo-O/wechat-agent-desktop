import crypto from "node:crypto";

const DEFAULT_TIMEOUT_MS = 15_000;

export interface OpenClawRequestOptions {
  requestHeaders?: Record<string, string>;
}

export class OpenClawApiError extends Error {
  readonly code?: number;

  constructor(message: string, code?: number) {
    super(message);
    this.name = "OpenClawApiError";
    this.code = code;
  }
}

function buildHeaders(
  token?: string,
  requestHeaders: Record<string, string> = {}
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomWechatUin()
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return {
    ...headers,
    ...requestHeaders
  };
}

function randomWechatUin(): string {
  const value = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(value), "utf8").toString("base64");
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!response.ok) {
    throw new OpenClawApiError(
      String(payload.errmsg ?? `HTTP ${response.status}`),
      typeof payload.errcode === "number" ? payload.errcode : undefined
    );
  }

  if (
    typeof payload.ret === "number" &&
    payload.ret !== 0
  ) {
    throw new OpenClawApiError(
      String(payload.errmsg ?? "接口返回失败"),
      typeof payload.errcode === "number" ? payload.errcode : payload.ret
    );
  }

  if (
    typeof payload.errcode === "number" &&
    payload.errcode !== 0
  ) {
    throw new OpenClawApiError(
      String(payload.errmsg ?? "接口返回失败"),
      payload.errcode
    );
  }

  return payload as T;
}

async function get<T>(
  baseUrl: string,
  path: string,
  headers: Record<string, string> = {}
): Promise<T> {
  const url = new URL(path, `${normalizeBaseUrl(baseUrl)}/`);
  const response = await fetch(url, {
    method: "GET",
    headers
  });
  return parseResponse<T>(response);
}

async function post<T>(
  baseUrl: string,
  path: string,
  body: Record<string, unknown>,
  token?: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  requestHeaders: Record<string, string> = {}
): Promise<T> {
  const url = new URL(path, `${normalizeBaseUrl(baseUrl)}/`);
  const response = await fetch(url, {
    method: "POST",
    headers: buildHeaders(token, requestHeaders),
    body: JSON.stringify({
      ...body,
      base_info: {
        channel_version: "1.0.2"
      }
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });

  return parseResponse<T>(response);
}

export async function fetchQrCode(
  baseUrl: string,
  botType = "3",
  options: OpenClawRequestOptions = {}
) {
  return get<{ qrcode: string; qrcode_img_content: string }>(
    baseUrl,
    `/ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
    options.requestHeaders
  );
}

export async function fetchQrStatus(
  baseUrl: string,
  qrcode: string,
  options: OpenClawRequestOptions = {}
) {
  return get<{
    status: "wait" | "scaned" | "confirmed" | "expired";
    bot_token?: string;
    ilink_bot_id?: string;
    ilink_user_id?: string;
    baseurl?: string;
  }>(
    baseUrl,
    `/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
    {
      "iLink-App-ClientVersion": "1",
      ...(options.requestHeaders ?? {})
    }
  );
}

export async function getUpdates(
  baseUrl: string,
  token: string,
  cursor: string,
  timeoutMs = 38_000,
  options: OpenClawRequestOptions = {}
) {
  try {
    return await post<{
      ret?: number;
      errcode?: number;
      errmsg?: string;
      msgs?: Array<Record<string, unknown>>;
      get_updates_buf?: string;
      longpolling_timeout_ms?: number;
    }>(
      baseUrl,
      "/ilink/bot/getupdates",
      {
        get_updates_buf: cursor
      },
      token,
      timeoutMs,
      options.requestHeaders
    );
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return {
        ret: 0,
        msgs: [],
        get_updates_buf: cursor
      };
    }
    throw error;
  }
}

export async function getTypingTicket(
  baseUrl: string,
  token: string,
  contactId: string,
  contextToken: string,
  options: OpenClawRequestOptions = {}
) {
  return post<{
    typing_ticket?: string;
  }>(
    baseUrl,
    "/ilink/bot/getconfig",
    {
      ilink_user_id: contactId,
      context_token: contextToken
    },
    token,
    10_000,
    options.requestHeaders
  );
}

export async function sendTyping(
  baseUrl: string,
  token: string,
  contactId: string,
  typingTicket: string,
  status: 1 | 2,
  options: OpenClawRequestOptions = {}
) {
  return post<Record<string, unknown>>(
    baseUrl,
    "/ilink/bot/sendtyping",
    {
      ilink_user_id: contactId,
      typing_ticket: typingTicket,
      status
    },
    token,
    10_000,
    options.requestHeaders
  );
}

export async function sendTextMessage(
  baseUrl: string,
  token: string,
  contactId: string,
  contextToken: string,
  text: string,
  options: OpenClawRequestOptions = {}
) {
  return post<Record<string, unknown>>(
    baseUrl,
    "/ilink/bot/sendmessage",
    {
      msg: {
        from_user_id: "",
        to_user_id: contactId,
        client_id: `wechat-agent-${crypto.randomUUID()}`,
        message_type: 2,
        message_state: 2,
        context_token: contextToken,
        item_list: [
          {
            type: 1,
            text_item: {
              text
            }
          }
        ]
      }
    },
    token,
    DEFAULT_TIMEOUT_MS,
    options.requestHeaders
  );
}
