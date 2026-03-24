const state = {
  snapshot: null,
  error: "",
  formDraft: null
};

async function call(action, ...args) {
  try {
    state.error = "";
    await window.wechatAgent[action](...args);
  } catch (error) {
    state.error = error?.message || String(error);
    render();
  }
}

function formatTime(value) {
  if (!value) return "暂无";
  return new Date(value).toLocaleString();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function runtimePill(snapshot) {
  if (snapshot.runtime.isRunning) {
    return `<span class="status-pill ok">运行中</span>`;
  }
  if (snapshot.wechat.status === "expired" || snapshot.wechat.status === "error") {
    return `<span class="status-pill error">需要处理</span>`;
  }
  if (snapshot.wechat.status === "logged_in") {
    return `<span class="status-pill warn">已登录未运行</span>`;
  }
  return `<span class="status-pill idle">未就绪</span>`;
}

function wechatPill(snapshot) {
  switch (snapshot.wechat.status) {
    case "logged_in":
      return `<span class="status-pill ok">微信已登录</span>`;
    case "pending":
      return `<span class="status-pill warn">等待扫码</span>`;
    case "expired":
    case "error":
      return `<span class="status-pill error">登录异常</span>`;
    default:
      return `<span class="status-pill idle">未登录</span>`;
  }
}

function contactStatusPill(status) {
  if (status === "processing") return `<span class="status-pill warn">处理中</span>`;
  if (status === "error") return `<span class="status-pill error">异常</span>`;
  if (status === "muted") return `<span class="status-pill idle">已静音</span>`;
  return `<span class="status-pill ok">正常</span>`;
}

function getChannelOption(snapshot, kind) {
  return snapshot.channelOptions.find((item) => item.kind === kind) || null;
}

function getProviderOption(snapshot, kind) {
  return snapshot.providerOptions.find((item) => item.kind === kind) || null;
}

function isCloudProvider(snapshot, kind) {
  return Boolean(getProviderOption(snapshot, kind)?.apiStyle);
}

function providerVendorLabel(snapshot) {
  return getProviderOption(snapshot, snapshot.settings.providerKind)?.label || "未知供应商";
}

function channelBackendLabel(snapshot) {
  return getChannelOption(snapshot, snapshot.settings.channelBackendKind)?.label || "未知后端";
}

function providerModelLabel(snapshot) {
  if (snapshot.settings.providerKind === "mock") {
    return "内置回复";
  }
  if (snapshot.settings.providerKind === "codex") {
    return snapshot.settings.codexModel || "CLI 默认";
  }
  return snapshot.settings.providerModel || "待填写";
}

function providerApiStyleLabel(style) {
  if (style === "anthropic") return "Anthropic Messages";
  if (style === "gemini") return "Gemini GenerateContent";
  return "OpenAI Chat Completions";
}

function buildDraftFromSnapshot(snapshot) {
  return {
    advancedModeEnabled: snapshot.settings.advancedModeEnabled,
    channelBackendKind: snapshot.settings.channelBackendKind,
    channelBaseUrl: snapshot.settings.channelBaseUrl,
    channelHeadersJson: snapshot.settings.channelHeadersJson,
    providerKind: snapshot.settings.providerKind,
    assistantPreset: snapshot.settings.assistantPreset,
    providerBaseUrl: snapshot.settings.providerBaseUrl,
    providerModel: snapshot.settings.providerModel,
    providerApiStyle: snapshot.settings.providerApiStyle,
    providerApiKey: "",
    codexWorkdir: snapshot.settings.codexWorkdir,
    codexModel: snapshot.settings.codexModel,
    codexSandbox: snapshot.settings.codexSandbox,
    allowUnknownContacts: snapshot.settings.allowUnknownContacts,
    resetHistories: false
  };
}

function currentSettingsDraft(snapshot) {
  if (!state.formDraft) {
    state.formDraft = buildDraftFromSnapshot(snapshot);
  }
  return state.formDraft;
}

function syncDraftFromForm() {
  const snapshot = state.snapshot;
  const form = document.getElementById("settings-form");
  if (!snapshot) {
    return state.formDraft;
  }
  if (!form) {
    return currentSettingsDraft(snapshot);
  }

  const formData = new FormData(form);
  state.formDraft = {
    advancedModeEnabled: document.getElementById("advancedModeEnabled")?.checked
      ?? snapshot.settings.advancedModeEnabled,
    channelBackendKind: formData.get("channelBackendKind") || snapshot.settings.channelBackendKind,
    channelBaseUrl: formData.get("channelBaseUrl") || "",
    channelHeadersJson: formData.get("channelHeadersJson") || "",
    providerKind: formData.get("providerKind") || snapshot.settings.providerKind,
    assistantPreset: formData.get("assistantPreset") || snapshot.settings.assistantPreset,
    providerBaseUrl: formData.get("providerBaseUrl") || "",
    providerModel: formData.get("providerModel") || "",
    providerApiStyle: formData.get("providerApiStyle") || snapshot.settings.providerApiStyle,
    providerApiKey: formData.get("providerApiKey") || "",
    codexWorkdir: formData.get("codexWorkdir") || "",
    codexModel: formData.get("codexModel") || "",
    codexSandbox: formData.get("codexSandbox") || snapshot.settings.codexSandbox,
    allowUnknownContacts: document.getElementById("allowUnknownContacts")?.checked
      ?? snapshot.settings.allowUnknownContacts,
    resetHistories: document.getElementById("resetHistories")?.checked || false
  };

  return state.formDraft;
}

function applyChannelDefaults(kind) {
  const snapshot = state.snapshot;
  if (!snapshot) return;

  const option = getChannelOption(snapshot, kind);
  if (!option) return;

  const draft = currentSettingsDraft(snapshot);
  draft.channelBackendKind = kind;
  draft.channelBaseUrl = option.defaultBaseUrl || "";
  if (!draft.channelHeadersJson.trim()) {
    draft.channelHeadersJson = "{}";
  }
}

function applyProviderDefaults(kind) {
  const snapshot = state.snapshot;
  if (!snapshot) return;

  const option = getProviderOption(snapshot, kind);
  if (!option) return;

  const draft = currentSettingsDraft(snapshot);
  draft.providerKind = kind;
  draft.providerBaseUrl = option.defaultBaseUrl || "";
  draft.providerModel = option.defaultModel || "";
  draft.providerApiStyle = option.apiStyle || draft.providerApiStyle || "openai";
}

function renderChannelOptions(snapshot, selectedKind) {
  return snapshot.channelOptions
    .map(
      (item) =>
        `<option value="${item.kind}" ${selectedKind === item.kind ? "selected" : ""}>${escapeHtml(item.label)}</option>`
    )
    .join("");
}

function renderProviderOptions(snapshot, selectedKind, showCodexOption) {
  const visibleOptions = snapshot.providerOptions.filter(
    (item) => item.kind !== "codex" || showCodexOption
  );
  const groupLabels = {
    builtin: "内置",
    domestic: "国内热门",
    global: "国际热门",
    advanced: "高级"
  };

  return ["builtin", "domestic", "global", "advanced"]
    .map((group) => {
      const options = visibleOptions.filter((item) => item.group === group);
      if (!options.length) return "";
      return `
        <optgroup label="${groupLabels[group]}">
          ${options
            .map(
              (item) =>
                `<option value="${item.kind}" ${selectedKind === item.kind ? "selected" : ""}>${escapeHtml(item.label)}</option>`
            )
            .join("")}
        </optgroup>
      `;
    })
    .join("");
}

function render() {
  const root = document.getElementById("app");
  const snapshot = state.snapshot;

  if (!snapshot) {
    root.innerHTML = `<div class="shell"><div class="main"><div class="hero"><h2>正在加载…</h2></div></div></div>`;
    return;
  }

  const contacts = snapshot.contacts.length
    ? snapshot.contacts
        .map(
          (contact) => `
        <article class="contact-item">
          <header>
            <div>
              <h4>${escapeHtml(contact.id)}</h4>
              <div class="contact-meta">最近收到：${formatTime(contact.lastInboundAt)} · 最近回复：${formatTime(contact.lastReplyAt)}</div>
            </div>
            ${contactStatusPill(contact.status)}
          </header>
          <div class="contact-preview"><strong>最近消息：</strong><br />${escapeHtml(contact.lastMessagePreview || "暂无")}</div>
          <div class="contact-preview"><strong>最近回复：</strong><br />${escapeHtml(contact.lastReplyPreview || "暂无")}</div>
          ${
            contact.lastError
              ? `<div class="contact-preview"><strong>异常：</strong><br />${escapeHtml(contact.lastError)}</div>`
              : ""
          }
          <div class="contact-actions">
            <button class="btn btn-secondary" data-action="toggle-contact" data-contact="${escapeHtml(contact.id)}" data-enabled="${String(!contact.enabled)}">
              ${contact.enabled ? "静音联系人" : "恢复联系人"}
            </button>
            <button class="btn btn-muted" data-action="clear-contact" data-contact="${escapeHtml(contact.id)}">
              清空上下文
            </button>
          </div>
        </article>
      `
        )
        .join("")
    : `<div class="empty">还没有联系人进入列表。完成登录后，应用会自动开始接收消息，这里会自动出现联系人。</div>`;

  const logs = snapshot.logs.length
    ? snapshot.logs
        .map(
          (item) => `
        <article class="log-item">
          <header>
            <strong>${escapeHtml(item.message)}</strong>
            <span class="status-pill ${item.level === "error" ? "error" : item.level === "warn" ? "warn" : "idle"}">${escapeHtml(item.level)}</span>
          </header>
          <div class="log-meta">${formatTime(item.createdAt)}</div>
        </article>
      `
        )
        .join("")
    : `<div class="empty">还没有运行日志。</div>`;

  const settingsDraft = currentSettingsDraft(snapshot);
  const activeChannelOption = getChannelOption(snapshot, settingsDraft.channelBackendKind);
  const activeProviderKind = settingsDraft.providerKind;
  const activeProviderOption = getProviderOption(snapshot, activeProviderKind);
  const showCloudFields = isCloudProvider(snapshot, activeProviderKind);
  const showCodexFields = activeProviderKind === "codex";
  const showCodexOption =
    settingsDraft.advancedModeEnabled
    || activeProviderKind === "codex"
    || snapshot.settings.providerKind === "codex";

  root.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-tag">WeChat Agent Desktop</div>
          <h1>微信里的智能助手</h1>
        </div>
        <div class="stat-grid">
          <div class="stat-card">
            <div class="stat-label">运行状态</div>
            <div class="stat-value">${runtimePill(snapshot)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">微信状态</div>
            <div class="stat-value">${wechatPill(snapshot)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">当前供应商</div>
            <div class="stat-value">${escapeHtml(providerVendorLabel(snapshot))}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">微信后端</div>
            <div class="stat-value">${escapeHtml(channelBackendLabel(snapshot))}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">当前模型</div>
            <div class="stat-value">${escapeHtml(providerModelLabel(snapshot))}</div>
          </div>
        </div>
      </aside>
      <main class="main">
        <section class="hero">
          <h2>快捷操作</h2>
          <div class="hero-actions">
            <button class="btn btn-primary" data-action="login">${snapshot.wechat.status === "logged_in" ? "重新扫码登录" : "开始扫码登录"}</button>
            <button class="btn btn-secondary" data-action="start-runtime" ${snapshot.runtime.isRunning || snapshot.wechat.status !== "logged_in" ? "disabled" : ""}>开始接收消息</button>
            <button class="btn btn-muted" data-action="stop-runtime" ${snapshot.runtime.isRunning ? "" : "disabled"}>暂停接收</button>
          </div>
        </section>

        ${state.error ? `<section class="card"><div class="status-pill error">错误</div><p>${escapeHtml(state.error)}</p></section>` : ""}

        <section class="grid">
          <section class="card card-span">
            <div class="card-head">
              <div>
                <h3>联系人与上下文（${snapshot.contacts.length}）</h3>
              </div>
            </div>
            <div class="contacts">${contacts}</div>
          </section>

          <div class="column">
            <section class="card">
              <div class="card-head">
                <div>
                  <h3>微信登录</h3>
                  <p>${escapeHtml(snapshot.wechat.statusMessage || "尚未开始")}</p>
                </div>
                ${wechatPill(snapshot)}
              </div>
              <div class="login-block">
                <div>
                  <div class="row">
                    <button class="btn btn-primary" data-action="login">${snapshot.wechat.status === "logged_in" ? "刷新二维码" : "获取二维码"}</button>
                    <button class="btn btn-secondary" data-action="logout" ${snapshot.wechat.accountId ? "" : "disabled"}>退出登录</button>
                    <button class="btn btn-muted" data-action="open-data">打开数据目录</button>
                  </div>
                  <p class="meta-note">后端：${escapeHtml(channelBackendLabel(snapshot))}<br />接口：${escapeHtml(snapshot.settings.channelBaseUrl || "暂无")}<br />账号：${escapeHtml(snapshot.wechat.accountId || "暂无")}<br />用户：${escapeHtml(snapshot.wechat.userId || "暂无")}<br />运行：${snapshot.runtime.isRunning ? "正在接收消息" : snapshot.wechat.status === "logged_in" ? "已暂停接收，可手动恢复" : "登录后自动开始"}</p>
                  ${
                    snapshot.wechat.lastError
                      ? `<p class="subtle"><strong>最近异常：</strong>${escapeHtml(snapshot.wechat.lastError)}</p>`
                      : ""
                  }
                </div>
                <div class="qr-box">
                  ${
                    snapshot.wechat.qrUrl
                      ? `<img src="${escapeHtml(snapshot.wechat.qrUrl)}" alt="微信二维码" />`
                      : `<div class="empty">二维码会显示在这里</div>`
                  }
                </div>
              </div>
            </section>

          </div>

          <div class="column">
            <section class="card">
              <div class="card-head">
                <div>
                  <h3>系统设置</h3>
                  ${
                    activeChannelOption
                      ? `<p>${escapeHtml(activeChannelOption.description)}</p>`
                      : ""
                  }
                </div>
              </div>
              <form id="settings-form">
                <div class="field">
                  <label for="channelBackendKind">微信后端</label>
                  <select id="channelBackendKind" name="channelBackendKind">
                    ${renderChannelOptions(snapshot, settingsDraft.channelBackendKind)}
                  </select>
                </div>
                <div class="field">
                  <label for="channelBaseUrl">后端 Base URL</label>
                  <input id="channelBaseUrl" name="channelBaseUrl" value="${escapeHtml(settingsDraft.channelBaseUrl)}" placeholder="${escapeHtml(activeChannelOption?.defaultBaseUrl || "https://example.com")}" />
                </div>
                <div class="field">
                  <label for="channelHeadersJson">附加请求头 JSON</label>
                  <textarea id="channelHeadersJson" name="channelHeadersJson" placeholder="{&#10;  &quot;X-Env&quot;: &quot;staging&quot;&#10;}">${escapeHtml(settingsDraft.channelHeadersJson)}</textarea>
                </div>
                <p class="subtle">适用于自定义 OpenClaw 兼容服务需要额外 Header 的场景。留空或 <code>{}</code> 表示不附加。</p>

                <div class="card-head" style="margin-top:18px;">
                  <div>
                    <h3>助手设置</h3>
                    ${
                      activeProviderOption
                        ? `<p>${escapeHtml(activeProviderOption.description)}</p>`
                        : ""
                    }
                  </div>
                </div>
                <div class="field">
                  <label for="providerKind">助手模式</label>
                  <select id="providerKind" name="providerKind">
                    ${renderProviderOptions(snapshot, settingsDraft.providerKind, showCodexOption)}
                  </select>
                </div>
                <div class="switch-row">
                  <div>
                    <strong>显示高级助手</strong>
                  </div>
                  <input id="advancedModeEnabled" name="advancedModeEnabled" type="checkbox" ${settingsDraft.advancedModeEnabled ? "checked" : ""} />
                </div>
                <div class="field">
                  <label for="assistantPreset">助手风格</label>
                  <select id="assistantPreset" name="assistantPreset">
                    ${presetOptions(settingsDraft.assistantPreset)}
                  </select>
                </div>

                ${
                  showCloudFields
                    ? `
                    <div class="field">
                      <label for="providerBaseUrl">Base URL</label>
                      <input id="providerBaseUrl" name="providerBaseUrl" value="${escapeHtml(settingsDraft.providerBaseUrl)}" placeholder="${escapeHtml(activeProviderOption?.defaultBaseUrl || "https://api.example.com/v1")}" />
                    </div>
                    <div class="field">
                      <label for="providerModel">Model</label>
                      <input id="providerModel" name="providerModel" value="${escapeHtml(settingsDraft.providerModel)}" placeholder="${escapeHtml(activeProviderOption?.modelPlaceholder || "填写模型名称")}" />
                    </div>
                    <div class="field" style="${activeProviderKind === "custom" ? "" : "display:none;"}">
                      <label for="providerApiStyle">API 协议</label>
                      <select id="providerApiStyle" name="providerApiStyle">
                        <option value="openai" ${settingsDraft.providerApiStyle === "openai" ? "selected" : ""}>OpenAI Chat Completions</option>
                        <option value="anthropic" ${settingsDraft.providerApiStyle === "anthropic" ? "selected" : ""}>Anthropic Messages</option>
                        <option value="gemini" ${settingsDraft.providerApiStyle === "gemini" ? "selected" : ""}>Gemini GenerateContent</option>
                      </select>
                    </div>
                    ${
                      activeProviderKind !== "custom"
                        ? `<p class="subtle">当前协议：${escapeHtml(providerApiStyleLabel(activeProviderOption?.apiStyle || settingsDraft.providerApiStyle))}</p>`
                        : ""
                    }
                    <div class="field">
                      <label for="providerApiKey">API Key</label>
                      <input id="providerApiKey" name="providerApiKey" value="${escapeHtml(settingsDraft.providerApiKey)}" placeholder="${snapshot.settings.providerApiKeyMasked ? escapeHtml(snapshot.settings.providerApiKeyMasked) : "留空表示不更新"}" />
                    </div>
                  `
                    : ""
                }

                <div class="field" style="${showCodexFields ? "" : "display:none;"}">
                  <label for="codexWorkdir">Codex 工作目录</label>
                  <input id="codexWorkdir" name="codexWorkdir" value="${escapeHtml(settingsDraft.codexWorkdir)}" placeholder="/path/to/project" />
                </div>
                <div class="row" style="${showCodexFields ? "margin-top:-4px;margin-bottom:10px;" : "display:none;"}">
                  <button class="btn btn-secondary" type="button" data-action="pick-codex-dir">选择目录</button>
                </div>
                <div class="field" style="${showCodexFields ? "" : "display:none;"}">
                  <label for="codexModel">Codex 模型（可留空）</label>
                  <input id="codexModel" name="codexModel" value="${escapeHtml(settingsDraft.codexModel)}" placeholder="例如 gpt-5-codex" />
                </div>
                <div class="field" style="${showCodexFields ? "" : "display:none;"}">
                  <label for="codexSandbox">Codex 权限模式</label>
                  <select id="codexSandbox" name="codexSandbox">
                    <option value="read-only" ${settingsDraft.codexSandbox === "read-only" ? "selected" : ""}>只读问答</option>
                    <option value="workspace-write" ${settingsDraft.codexSandbox === "workspace-write" ? "selected" : ""}>允许在工作目录内修改文件</option>
                  </select>
                </div>
                <div class="switch-row">
                  <div>
                    <strong>保存时清空历史上下文</strong>
                  </div>
                  <input id="resetHistories" name="resetHistories" type="checkbox" ${settingsDraft.resetHistories ? "checked" : ""} />
                </div>
                <div class="switch-row">
                  <div>
                    <strong>自动允许新联系人</strong>
                  </div>
                  <input id="allowUnknownContacts" name="allowUnknownContacts" type="checkbox" ${settingsDraft.allowUnknownContacts ? "checked" : ""} />
                </div>
                <div class="row" style="margin-top: 16px;">
                  <button class="btn btn-primary" type="submit">保存设置</button>
                </div>
              </form>
            </section>

            <section class="card logs-card">
              <div class="card-head">
                <div>
                  <h3>运行日志</h3>
                  <p>仅展示最近 ${snapshot.logs.length} 条，支持滚动翻阅。</p>
                </div>
              </div>
              <div class="logs">${logs}</div>
            </section>
          </div>
        </section>
      </main>
    </div>
  `;

  bindEvents();
}

function presetOptions(selected) {
  return [
    ["general", "通用助手"],
    ["writer", "润色助手"],
    ["work", "工作助手"],
    ["support", "客服助手"]
  ]
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

function bindEvents() {
  document.querySelectorAll("[data-action]").forEach((element) => {
    element.addEventListener("click", async (event) => {
      const action = event.currentTarget.getAttribute("data-action");
      if (action === "login") await call("startWechatLogin", true);
      if (action === "logout") await call("logoutWechat");
      if (action === "start-runtime") await call("startRuntime");
      if (action === "stop-runtime") await call("stopRuntime");
      if (action === "open-data") await call("openDataDirectory");
      if (action === "toggle-contact") {
        const contactId = event.currentTarget.getAttribute("data-contact");
        const enabled = event.currentTarget.getAttribute("data-enabled") === "true";
        await call("setContactEnabled", contactId, enabled);
      }
      if (action === "clear-contact") {
        const contactId = event.currentTarget.getAttribute("data-contact");
        await call("clearContactHistory", contactId);
      }
      if (action === "pick-codex-dir") {
        const selected = await window.wechatAgent.pickDirectory();
        if (selected) {
          syncDraftFromForm();
          state.formDraft.codexWorkdir = selected;
          render();
        }
      }
    });
  });

  const form = document.getElementById("settings-form");
  if (form) {
    form.addEventListener("input", () => {
      syncDraftFromForm();
    });
    form.addEventListener("change", () => {
      syncDraftFromForm();
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const draft = syncDraftFromForm();
      await call("saveSettings", {
        advancedModeEnabled: draft.advancedModeEnabled,
        channelBackendKind: draft.channelBackendKind,
        channelBaseUrl: draft.channelBaseUrl,
        channelHeadersJson: draft.channelHeadersJson,
        providerKind: draft.providerKind,
        previousProviderKind: state.snapshot.settings.providerKind,
        assistantPreset: draft.assistantPreset,
        providerBaseUrl: draft.providerBaseUrl,
        providerModel: draft.providerModel,
        providerApiStyle: draft.providerApiStyle,
        providerApiKey: draft.providerApiKey,
        codexWorkdir: draft.codexWorkdir,
        codexModel: draft.codexModel,
        codexSandbox: draft.codexSandbox,
        allowUnknownContacts: draft.allowUnknownContacts,
        resetHistories: draft.resetHistories
      });
      if (!state.error) {
        state.formDraft = {
          ...draft,
          channelHeadersJson: draft.channelHeadersJson || "{}",
          providerApiKey: "",
          resetHistories: false
        };
        render();
      }
    });
  }

  const channelSelect = document.getElementById("channelBackendKind");
  if (channelSelect) {
    channelSelect.addEventListener("change", (event) => {
      syncDraftFromForm();
      applyChannelDefaults(event.currentTarget.value);
      render();
    });
  }

  const providerSelect = document.getElementById("providerKind");
  if (providerSelect) {
    providerSelect.addEventListener("change", (event) => {
      syncDraftFromForm();
      applyProviderDefaults(event.currentTarget.value);
      render();
    });
  }

  const advancedModeCheckbox = document.getElementById("advancedModeEnabled");
  if (advancedModeCheckbox) {
    advancedModeCheckbox.addEventListener("change", (event) => {
      syncDraftFromForm();
      state.formDraft.advancedModeEnabled = event.currentTarget.checked;
      render();
    });
  }
}

async function bootstrap() {
  state.snapshot = await window.wechatAgent.getSnapshot();
  state.formDraft = buildDraftFromSnapshot(state.snapshot);
  render();
  window.wechatAgent.onSnapshot((snapshot) => {
    state.snapshot = snapshot;
    if (!state.formDraft) {
      state.formDraft = buildDraftFromSnapshot(snapshot);
    }
    render();
  });
}

bootstrap();
