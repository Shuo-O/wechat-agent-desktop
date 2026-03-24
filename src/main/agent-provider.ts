import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type {
  AssistantPresetId,
  ContactEntry,
  ProviderSettings
} from "./types";

const execFileAsync = promisify(execFile);

interface ProviderReplyInput {
  settings: ProviderSettings;
  contact: ContactEntry;
  incomingText: string;
}

export async function generateReply(input: ProviderReplyInput): Promise<string> {
  if (input.settings.kind === "codex") {
    return generateCodexReply(input);
  }

  if (input.settings.kind === "deepseek") {
    return generateDeepSeekReply(input);
  }

  if (input.settings.kind === "openai") {
    return generateOpenAiReply(input);
  }

  return generateMockReply(input);
}

async function generateCodexReply({
  settings,
  contact,
  incomingText
}: ProviderReplyInput): Promise<string> {
  const workdir = settings.codexWorkdir.trim();
  if (!workdir) {
    throw new Error("Codex 模式尚未选择工作目录");
  }

  const outputPath = path.join(
    os.tmpdir(),
    `wechat-agent-codex-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`
  );

  const args = [
    "-a",
    "never",
    "-s",
    settings.codexSandbox,
    "-C",
    workdir
  ];

  if (settings.codexModel.trim()) {
    args.push("-m", settings.codexModel.trim());
  }

  args.push(
    "exec",
    "--skip-git-repo-check",
    "--color",
    "never",
    "-o",
    outputPath,
    buildCodexPrompt(settings.assistantPreset, contact, incomingText, settings.codexSandbox)
  );

  try {
    await execFileAsync("codex", args, {
      cwd: workdir,
      timeout: 180_000,
      maxBuffer: 8 * 1024 * 1024
    });
  } catch (error) {
    const message = extractProcessError(error);
    if (message.includes("ENOENT")) {
      throw new Error("未检测到 Codex 命令，请先在本机安装 Codex CLI");
    }
    if (message.toLowerCase().includes("login")) {
      throw new Error("Codex 尚未登录，请先在终端执行 codex login");
    }
    throw new Error(`Codex 执行失败：${message}`);
  }

  try {
    const content = (await fs.readFile(outputPath, "utf8")).trim();
    if (!content) {
      throw new Error("Codex 返回了空内容");
    }
    return formatForWechat(content);
  } finally {
    await fs.rm(outputPath, { force: true }).catch(() => undefined);
  }
}

async function generateDeepSeekReply({
  settings,
  contact,
  incomingText
}: ProviderReplyInput): Promise<string> {
  const apiKey = settings.deepseekApiKey.trim();
  if (!apiKey) {
    throw new Error("DeepSeek 模式缺少 API Key");
  }

  const model = settings.deepseekModel.trim() || "deepseek-chat";
  const requestBody = {
    model,
    messages: buildOpenAiMessages(
      settings.assistantPreset,
      contact,
      incomingText
    ),
    ...(model === "deepseek-reasoner" ? {} : { temperature: 0.6 })
  };

  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  const payload = (await response.json()) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };

  if (!response.ok) {
    throw new Error(payload.error?.message || `DeepSeek 接口异常 (${response.status})`);
  }

  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("DeepSeek 返回了空内容");
  }

  return formatForWechat(content);
}

async function generateOpenAiReply({
  settings,
  contact,
  incomingText
}: ProviderReplyInput): Promise<string> {
  const apiKey = settings.openaiApiKey.trim();
  if (!apiKey) {
    throw new Error("OpenAI 兼容模式缺少 API Key");
  }

  const baseUrl = settings.openaiBaseUrl.replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: settings.openaiModel,
      messages: buildOpenAiMessages(
        settings.assistantPreset,
        contact,
        incomingText
      ),
      temperature: 0.6
    })
  });

  const payload = (await response.json()) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };

  if (!response.ok) {
    throw new Error(payload.error?.message || `模型接口异常 (${response.status})`);
  }

  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("模型返回了空内容");
  }

  return formatForWechat(content);
}

function buildOpenAiMessages(
  preset: AssistantPresetId,
  contact: ContactEntry,
  incomingText: string
) {
  const history = contact.history.slice(-10).map((item) => ({
    role: item.role,
    content: item.text
  }));

  const lastMessage = history[history.length - 1];

  return [
    {
      role: "system",
      content: presetPrompt(preset)
    },
    ...history,
    ...(lastMessage?.role === "user" && lastMessage.content === incomingText
      ? []
      : [
          {
            role: "user",
            content: incomingText
          }
        ])
  ];
}

function generateMockReply({
  settings,
  incomingText,
  contact
}: ProviderReplyInput): string {
  const short = incomingText.length > 140 ? `${incomingText.slice(0, 140)}...` : incomingText;
  const historyCount = Math.floor(contact.history.length / 2);

  switch (settings.assistantPreset) {
    case "writer":
      return [
        "我先按“润色助手”的方式帮你整理一下：",
        "",
        `原意：${short}`,
        "",
        "建议表达：",
        rewriteSentence(short),
        "",
        "如果你愿意，我也可以继续帮你改成更正式、口语化，或更适合微信发送的版本。"
      ].join("\n");
    case "work":
      return [
        "我按“工作助手”的方式给你一个可直接执行的回复：",
        "",
        `1. 先确认诉求：${short}`,
        "2. 给出下一步：我建议先明确目标、时间点和责任人。",
        "3. 可以直接回对方：收到，我先整理重点，稍后给你一个明确结论。"
      ].join("\n");
    case "support":
      return [
        "我按“客服回复助手”的方式帮你组织回复：",
        "",
        "建议回复：",
        `您好，已收到您的消息：${short}。我们正在帮您确认处理方案，稍后第一时间回复您。`,
        "",
        "如果你需要，我还能继续把它改得更礼貌或更简短。"
      ].join("\n");
    default:
      return [
        "演示助手已收到消息。",
        "",
        `你刚刚说的是：${short}`,
        "",
        historyCount > 0
          ? `当前这位联系人已经有 ${historyCount} 轮上下文，我会继续沿着同一话题回复。`
          : "这是这个联系人的第一轮对话，我会从零开始回复。",
        "",
        "如果你想接入真实模型，可以切换到“DeepSeek”模式并填写 API Key。"
      ].join("\n");
  }
}

function rewriteSentence(input: string): string {
  const cleaned = input.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "你好，我想先确认一下具体需求，方便我更准确地回复你。";
  }

  return `你好，我已经看到你的信息了。关于“${cleaned}”，我先整理一下重点，稍后给你更完整的答复。`;
}

function presetPrompt(preset: AssistantPresetId): string {
  const common =
    "你是一个运行在微信私聊里的中文助手。回复要简洁、自然、像真人发微信，不要使用复杂 Markdown，不要输出代码块，优先给出可直接发送的文本。";

  switch (preset) {
    case "writer":
      return `${common} 你的职责是润色、改写、提炼语气，让文字更适合微信发送。`;
    case "work":
      return `${common} 你的职责是工作沟通、总结重点、给出下一步行动建议。`;
    case "support":
      return `${common} 你的职责是客服回复，礼貌、稳妥、清晰。`;
    default:
      return `${common} 你的职责是通用问答和聊天辅助。`;
  }
}

function buildCodexPrompt(
  preset: AssistantPresetId,
  contact: ContactEntry,
  incomingText: string,
  sandbox: "read-only" | "workspace-write"
): string {
  const history = contact.history
    .slice(-8)
    .map((item) => `${item.role === "user" ? "用户" : "助手"}：${item.text}`)
    .join("\n");

  return [
    "你正在作为微信里的高级代码助手，通过 Codex CLI 生成回复。",
    "请始终用中文回答，回复适合直接发在微信里，简洁、明确、少术语堆叠。",
    `当前助手风格：${presetPrompt(preset)}`,
    `当前沙箱模式：${sandbox === "read-only" ? "只读" : "允许在工作目录内修改文件"}`,
    sandbox === "read-only"
      ? "如果用户要求你改代码，请明确告诉他你当前处于只读模式，可以先给出修改建议。"
      : "如果你确实修改了文件，请在回复里明确说明改了什么文件。"
    ,
    "请结合当前工作目录里的代码和文件来回答。",
    history ? `最近上下文：\n${history}` : "最近上下文：无",
    `当前用户消息：\n${incomingText}`
  ].join("\n\n");
}

function extractProcessError(error: unknown): string {
  if (error && typeof error === "object") {
    const candidate = error as {
      stderr?: string;
      stdout?: string;
      message?: string;
      code?: string | number;
    };
    return candidate.stderr?.trim()
      || candidate.stdout?.trim()
      || candidate.message
      || String(candidate.code ?? "unknown");
  }
  return String(error);
}

function formatForWechat(text: string): string {
  let output = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");
  output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
  output = output.replace(/\*\*(.+?)\*\*/g, "$1");
  output = output.replace(/\*(.+?)\*/g, "$1");
  output = output.replace(/^#{1,6}\s+/gm, "");
  output = output.replace(/\n{3,}/g, "\n\n");
  return output.trim();
}
