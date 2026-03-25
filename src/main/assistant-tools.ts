const TOOL_USER_AGENT = "wechat-agent-desktop/0.1";
const DEFAULT_SEARCH_RESULTS = 5;
const MAX_SEARCH_RESULTS = 8;
const DEFAULT_FETCH_CHARS = 8_000;
const MAX_FETCH_CHARS = 20_000;

interface SearchLocaleHint {
  market?: string;
  language?: string;
  acceptLanguage?: string;
}

export interface OpenAiToolCall {
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

export const OPENAI_COMPATIBLE_TOOLS = [
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "搜索互联网获取最新信息，适合天气、新闻、公告、产品更新、网页入口等实时问题。它主要用于定位候选来源，不应只根据搜索摘要直接下结论。",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "搜索关键词，尽量具体，例如“北京今天天气”或“某产品最新价格”。"
          },
          max_results: {
            type: "integer",
            description: "返回结果数量，默认 5，最大 8。"
          },
          market: {
            type: "string",
            description: "可选市场代码，例如 zh-CN、ja-JP、en-US。搜索地域相关信息时尽量填写。"
          },
          language: {
            type: "string",
            description: "可选语言代码，例如 zh-Hans、ja、en。"
          }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "fetch_url",
      description:
        "打开一个网页并提取正文，适合在搜索后进一步读取具体页面内容。若用户要求你直接查看、总结事实或给出现成答案，而搜索摘要不足，就应继续调用这个工具。",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "要读取的网页 URL，必须是 http 或 https。"
          },
          max_chars: {
            type: "integer",
            description: "返回正文最大字符数，默认 8000，最大 20000。"
          }
        },
        required: ["url"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_current_time",
      description: "获取当前时间和时区，适合处理今天、明天、本周等相对时间问题。",
      parameters: {
        type: "object",
        properties: {
          timezone: {
            type: "string",
            description: "可选 IANA 时区，例如 Asia/Shanghai。留空时使用本机时区。"
          }
        }
      }
    }
  }
] as const;

export async function executeOpenAiToolCall(toolCall: OpenAiToolCall): Promise<string> {
  const toolName = toolCall.function?.name ?? "";
  const args = parseToolArguments(toolCall.function?.arguments);

  try {
    switch (toolName) {
      case "web_search":
        return JSON.stringify(await webSearch(args), null, 2);
      case "fetch_url":
        return JSON.stringify(await fetchUrl(args), null, 2);
      case "get_current_time":
        return JSON.stringify(getCurrentTime(args), null, 2);
      default:
        return JSON.stringify(
          {
            ok: false,
            error: `未知工具：${toolName || "empty"}`
          },
          null,
          2
        );
    }
  } catch (error) {
    return JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      },
      null,
      2
    );
  }
}

function parseToolArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw || !raw.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore invalid arguments and let the tool validate.
  }

  return {};
}

async function webSearch(args: Record<string, unknown>) {
  const query = readRequiredString(args, "query");
  const maxResults = readInteger(args, "max_results", DEFAULT_SEARCH_RESULTS, 1, MAX_SEARCH_RESULTS);
  const requestedMarket = readOptionalString(args, "market");
  const requestedLanguage = readOptionalString(args, "language");
  const localeHint = resolveSearchLocale(query, requestedMarket, requestedLanguage);
  const url = new URL("https://www.bing.com/search");
  url.searchParams.set("format", "rss");
  url.searchParams.set("q", query);
  if (localeHint.market) {
    url.searchParams.set("mkt", localeHint.market);
  }
  if (localeHint.language) {
    url.searchParams.set("setlang", localeHint.language);
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": TOOL_USER_AGENT,
      Accept: "application/rss+xml, application/xml, text/xml",
      ...(localeHint.acceptLanguage
        ? {
            "Accept-Language": localeHint.acceptLanguage
          }
        : {})
    }
  });

  if (!response.ok) {
    throw new Error(`搜索请求失败 (${response.status})`);
  }

  const xml = await response.text();
  const results = extractXmlItems(xml)
    .slice(0, maxResults)
    .map((item) => ({
      title: decodeXmlEntities(extractXmlTag(item, "title")),
      url: decodeXmlEntities(extractXmlTag(item, "link")),
      snippet: decodeXmlEntities(extractXmlTag(item, "description")),
      published_at: decodeXmlEntities(extractXmlTag(item, "pubDate"))
    }))
    .filter((item) => item.title && item.url);

  return {
    ok: true,
    query,
    market: localeHint.market ?? null,
    language: localeHint.language ?? null,
    results
  };
}

async function fetchUrl(args: Record<string, unknown>) {
  const sourceUrl = readRequiredString(args, "url");
  const normalizedUrl = normalizeWebUrl(sourceUrl);
  const maxChars = readInteger(args, "max_chars", DEFAULT_FETCH_CHARS, 500, MAX_FETCH_CHARS);
  const readerUrl = `https://r.jina.ai/http://${normalizedUrl}`;

  const response = await fetch(readerUrl, {
    headers: {
      "User-Agent": TOOL_USER_AGENT
    }
  });

  if (!response.ok) {
    throw new Error(`网页抓取失败 (${response.status})`);
  }

  const content = (await response.text()).trim();

  return {
    ok: true,
    url: normalizedUrl,
    content: truncateText(content, maxChars),
    truncated: content.length > maxChars
  };
}

function getCurrentTime(args: Record<string, unknown>) {
  const requestedTimezone =
    typeof args.timezone === "string" && args.timezone.trim()
      ? args.timezone.trim()
      : Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = new Date();

  return {
    ok: true,
    timezone: requestedTimezone,
    iso: now.toISOString(),
    local: formatDateTime(now, requestedTimezone)
  };
}

function extractXmlItems(xml: string): string[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => match[1] ?? "");
}

function extractXmlTag(xml: string, tagName: string): string {
  const match = xml.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match?.[1]?.trim() ?? "";
}

function decodeXmlEntities(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'");
}

function normalizeWebUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("fetch_url 只支持 http 或 https 链接");
  }
  return url.toString();
}

function readRequiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} 必须是非空字符串`);
  }
  return value.trim();
}

function readOptionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  return value.trim();
}

function readInteger(
  args: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number
): number {
  const value = args[key];
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(numeric)));
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars).trim()}\n\n[内容已截断]`;
}

function resolveSearchLocale(
  query: string,
  requestedMarket?: string,
  requestedLanguage?: string
): SearchLocaleHint {
  if (requestedMarket || requestedLanguage) {
    return {
      market: requestedMarket,
      language: requestedLanguage,
      acceptLanguage: buildAcceptLanguage(requestedMarket, requestedLanguage)
    };
  }

  if (/[\u3040-\u30ff]/.test(query)) {
    return {
      market: "ja-JP",
      language: "ja",
      acceptLanguage: "ja-JP,ja;q=0.9"
    };
  }

  if (/[\uac00-\ud7af]/.test(query)) {
    return {
      market: "ko-KR",
      language: "ko",
      acceptLanguage: "ko-KR,ko;q=0.9"
    };
  }

  if (looksLikeChineseQuery(query)) {
    return {
      market: "zh-CN",
      language: "zh-Hans",
      acceptLanguage: "zh-CN,zh;q=0.9"
    };
  }

  return {};
}

function looksLikeChineseQuery(query: string): boolean {
  if (!/[\u4e00-\u9fff]/.test(query)) {
    return false;
  }

  if (/[\u3040-\u30ff\uac00-\ud7af]/.test(query)) {
    return false;
  }

  return /[的一是在有天气查询今天明天现在新闻价格官网怎么多少什么]/.test(query);
}

function buildAcceptLanguage(market?: string, language?: string): string | undefined {
  if (market) {
    const primary = market.split(",")[0]?.trim();
    if (primary) {
      const base = primary.split("-")[0];
      return `${primary},${base};q=0.9`;
    }
  }

  if (language) {
    const primary = language.split(",")[0]?.trim();
    if (primary) {
      const base = primary.split("-")[0];
      return `${primary},${base};q=0.9`;
    }
  }

  return undefined;
}

function formatDateTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}
