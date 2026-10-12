import { extractResumeContent } from "../lib/resume-extract.js";
import { parseResumeWithLLM, testLLMConnection, normalizeBaseUrl } from "../lib/llm.js";
import { createResumeEditor, summarize } from "./resume-editor.js";
import {
  clearAuth,
  createApplication,
  deleteApplication,
  getAuthState,
  isLoggedIn,
  listApplications,
  login,
  register,
  setAuthState,
  syncLlmDown,
  syncLlmUp,
  syncResumeDown,
  syncResumeUp
} from "../lib/api.js";

const statusEl = document.getElementById("status");
const resumeStatusEl = document.getElementById("resume-status");
const resumeMetaEl = document.getElementById("resume-meta");
const settingsStatusEl = document.getElementById("settings-status");
const accountStatusEl = document.getElementById("account-status");
const appsStatusEl = document.getElementById("apps-status");
const appsListEl = document.getElementById("apps-list");
const editor = createResumeEditor(document.getElementById("resume-editor"));

const PRESETS = {
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat"
  },
  qwen: {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus"
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini"
  }
};

function setStatus(text) {
  statusEl.textContent = typeof text === "string" ? text : JSON.stringify(text, null, 2);
}

function setResumeStatus(text) {
  resumeStatusEl.textContent = typeof text === "string" ? text : JSON.stringify(text, null, 2);
}

function setSettingsStatus(text) {
  settingsStatusEl.textContent = typeof text === "string" ? text : JSON.stringify(text, null, 2);
}

function setAccountStatus(text) {
  accountStatusEl.textContent = typeof text === "string" ? text : JSON.stringify(text, null, 2);
}

function setAppsStatus(text) {
  appsStatusEl.textContent = typeof text === "string" ? text : JSON.stringify(text, null, 2);
}

function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
  });
});

function updateMeta(meta) {
  if (!meta?.sourceFile) {
    resumeMetaEl.textContent = "尚未上传解析";
    return;
  }
  const when = meta.parsedAt ? new Date(meta.parsedAt).toLocaleString() : "";
  resumeMetaEl.textContent = `来源：${meta.sourceFile}${when ? ` · ${when}` : ""}`;
}

function readSettingsFromForm() {
  return {
    useLLM: document.getElementById("useLLM").checked,
    clickFillEnabled: document.getElementById("clickFillEnabled").checked,
    baseUrl: normalizeBaseUrl(
      document.getElementById("baseUrl").value.trim() || "https://api.deepseek.com/v1"
    ),
    model: document.getElementById("model").value.trim() || "deepseek-chat",
    apiKey: document.getElementById("apiKey").value.trim()
  };
}

async function refreshAccountUI() {
  const auth = await getAuthState();
  document.getElementById("serverUrl").value = auth.serverUrl;
  if (isLoggedIn(auth)) {
    setAccountStatus(
      `已登录：${auth.user.email}\n角色：${auth.user.role}\n服务器：${auth.serverUrl}\n不登录也能用；登录后可点「上传/拉取同步」`
    );
  } else {
    setAccountStatus(`未登录 · 本地模式\n服务器：${auth.serverUrl}`);
  }
}

async function getLocalApplications() {
  const { applications } = await chrome.storage.local.get(["applications"]);
  return Array.isArray(applications) ? applications : [];
}

async function setLocalApplications(items) {
  await chrome.storage.local.set({ applications: items });
}

async function loadApplicationsUI() {
  const auth = await getAuthState();
  let items = [];
  try {
    if (isLoggedIn(auth)) {
      const data = await listApplications();
      items = data.items || [];
      await setLocalApplications(items);
    } else {
      items = await getLocalApplications();
    }
  } catch (err) {
    items = await getLocalApplications();
    setAppsStatus(`云端读取失败，显示本地缓存\n${err.message}`);
  }

  if (!items.length) {
    appsListEl.innerHTML = `<div class="empty-block">暂无投递记录</div>`;
    return;
  }

  appsListEl.innerHTML = items
    .map((item) => {
      const id = item.id ?? item.localId;
      return `
        <div class="app-item" data-id="${escapeHtml(id)}">
          <div class="title">${escapeHtml(item.company || item.title || "未命名投递")}</div>
          <div class="meta">${escapeHtml(item.title || "")}${item.title && item.url ? " · " : ""}${escapeHtml(
            item.url || ""
          )}</div>
          <div class="meta">${escapeHtml(item.status || "applied")} · ${escapeHtml(
            item.appliedAt || item.createdAt || ""
          )}</div>
          ${item.notes ? `<div class="meta">${escapeHtml(item.notes)}</div>` : ""}
          <div class="actions">
            <button type="button" class="btn tiny danger" data-del-app="${escapeHtml(id)}">删除</button>
          </div>
        </div>`;
    })
    .join("");

  appsListEl.querySelectorAll("[data-del-app]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.delApp;
      try {
        const authNow = await getAuthState();
        if (isLoggedIn(authNow) && !String(id).startsWith("local_")) {
          await deleteApplication(id);
        }
        const local = await getLocalApplications();
        await setLocalApplications(
          local.filter((x) => String(x.id ?? x.localId) !== String(id))
        );
        setAppsStatus("已删除");
        await loadApplicationsUI();
      } catch (err) {
        setAppsStatus(`删除失败：${err.message}`);
      }
    });
  });
}

async function maybeSyncResumeUp() {
  const auth = await getAuthState();
  if (!isLoggedIn(auth)) return;
  const { resume, resumeMeta } = await chrome.storage.local.get(["resume", "resumeMeta"]);
  if (!resume) return;
  await syncResumeUp(resume, resumeMeta || {});
}

async function maybeSyncLlmUp(settings) {
  const auth = await getAuthState();
  if (!isLoggedIn(auth)) return;
  await syncLlmUp(settings);
}

async function loadAll() {
  const { resume, settings, resumeMeta } = await chrome.storage.local.get([
    "resume",
    "settings",
    "resumeMeta"
  ]);
  editor.setResume(resume || {});
  updateMeta(resumeMeta);
  if (resume) setResumeStatus(summarize(resume));

  const s = settings || {};
  document.getElementById("useLLM").checked = !!s.useLLM;
  document.getElementById("clickFillEnabled").checked = s.clickFillEnabled !== false;
  document.getElementById("baseUrl").value = s.baseUrl || PRESETS.deepseek.baseUrl;
  document.getElementById("model").value = s.model || PRESETS.deepseek.model;
  document.getElementById("apiKey").value = s.apiKey || "";

  await refreshAccountUI();
  await loadApplicationsUI();
}

document.querySelectorAll("[data-preset]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const preset = PRESETS[btn.dataset.preset];
    if (!preset) return;
    document.getElementById("baseUrl").value = preset.baseUrl;
    document.getElementById("model").value = preset.model;
    setSettingsStatus(`已填入 ${btn.textContent} 预设，请填写 API Key 后点「保存设置」`);
  });
});

document.getElementById("btn-save-settings").addEventListener("click", async () => {
  const settings = readSettingsFromForm();
  document.getElementById("baseUrl").value = settings.baseUrl;
  await chrome.storage.local.set({ settings });
  setSettingsStatus(`已保存\nEndpoint: ${settings.baseUrl}/chat/completions\nModel: ${settings.model}`);
  setStatus("设置已保存");
  try {
    await maybeSyncLlmUp(settings);
    const auth = await getAuthState();
    if (isLoggedIn(auth)) setSettingsStatus((settingsStatusEl.textContent || "") + "\n已同步到云端");
  } catch (err) {
    setSettingsStatus((settingsStatusEl.textContent || "") + `\n云端同步失败：${err.message}`);
  }
});

document.getElementById("btn-test-llm").addEventListener("click", async () => {
  const settings = readSettingsFromForm();
  if (!settings.apiKey) {
    setSettingsStatus("请先填写 API Key");
    return;
  }
  setSettingsStatus("正在测试连接...");
  try {
    await chrome.storage.local.set({ settings });
    document.getElementById("baseUrl").value = settings.baseUrl;
    const result = await testLLMConnection(settings);
    setSettingsStatus(
      `连接成功\n${result.endpoint}\nModel: ${result.model}\n回复: ${result.reply}`
    );
  } catch (err) {
    setSettingsStatus(`连接失败\n${err.message || err}`);
  }
});

document.getElementById("btn-save-resume").addEventListener("click", async () => {
  const resume = editor.getResume();
  await chrome.storage.local.set({ resume });
  setResumeStatus(`已保存 · ${summarize(resume)}`);
  setStatus("简历已保存到本地");
  try {
    await maybeSyncResumeUp();
    const auth = await getAuthState();
    if (isLoggedIn(auth)) setStatus("简历已保存到本地，并已同步云端");
  } catch (err) {
    setStatus(`本地已保存；云端同步失败：${err.message}`);
  }
});

document.getElementById("btn-export").addEventListener("click", async () => {
  const resume = editor.getResume();
  const blob = new Blob([JSON.stringify(resume, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "campus-resume-backup.json";
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("resume-file").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;

  let { settings } = await chrome.storage.local.get(["settings"]);
  const formSettings = readSettingsFromForm();
  if (formSettings.apiKey) {
    settings = { ...(settings || {}), ...formSettings };
    await chrome.storage.local.set({ settings });
    document.getElementById("baseUrl").value = settings.baseUrl;
  }

  if (!settings?.apiKey) {
    setResumeStatus("请先到「设置」填写 API Key，并点「测试连接」通过后再上传");
    return;
  }

  setResumeStatus(`正在读取：${file.name} ...`);
  try {
    const extracted = await extractResumeContent(file);
    if (extracted.kind === "text") {
      setResumeStatus(
        `已提取文本 ${extracted.text.length} 字\n正在请求 ${normalizeBaseUrl(settings.baseUrl)} ...\n（请保持弹窗打开）`
      );
    } else {
      setResumeStatus(
        `已读取图片\n正在请求 ${normalizeBaseUrl(settings.baseUrl)} ...\n（图片需模型支持视觉；请保持弹窗打开）`
      );
    }

    const resume = await parseResumeWithLLM({
      apiKey: settings.apiKey,
      baseUrl: settings.baseUrl,
      model: settings.model,
      kind: extracted.kind,
      text: extracted.text,
      dataUrl: extracted.dataUrl,
      fileName: extracted.fileName
    });

    const resumeMeta = {
      sourceFile: extracted.fileName || file.name,
      parsedAt: new Date().toISOString()
    };
    await chrome.storage.local.set({ resume, resumeMeta });

    editor.setResume(resume);
    updateMeta(resumeMeta);
    setResumeStatus(
      `解析完成：${resume.basic?.name || "（未识别姓名）"}\n${summarize(resume)}\n可折叠查看各区块，改完点「保存修改」`
    );
    setStatus(`简历已解析并写入本地：${extracted.fileName || file.name}`);

    try {
      await maybeSyncResumeUp();
    } catch (err) {
      setStatus(`本地已保存；云端同步失败：${err.message}`);
    }
  } catch (err) {
    setResumeStatus(`解析失败：\n${err.message || err}`);
  }
});

async function sendToActiveTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("没有活动标签页");
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    throw new Error("无法连接页面脚本，请刷新目标网页后重试（本地文件页需开启“允许访问文件网址”）");
  }
}

document.getElementById("btn-fill-basic").addEventListener("click", async () => {
  setStatus("正在扫描并填写...");
  try {
    const resume = editor.getResume();
    await chrome.storage.local.set({ resume });
    const result = await chrome.runtime.sendMessage({ type: "FILL_BASIC_PIPELINE" });
    setStatus(result);
  } catch (err) {
    setStatus(`失败: ${err.message}`);
  }
});

document.getElementById("btn-fill-focused").addEventListener("click", async () => {
  setStatus("正在填充当前输入框...");
  try {
    await chrome.storage.local.set({ resume: editor.getResume() });
    const result = await sendToActiveTab({ type: "FILL_FOCUSED" });
    setStatus(result);
  } catch (err) {
    setStatus(`失败: ${err.message}`);
  }
});

document.getElementById("btn-show-panel").addEventListener("click", async () => {
  try {
    const result = await sendToActiveTab({ type: "SHOW_CLICK_PANEL" });
    setStatus(result.ok ? "已尝试打开面板（请先点击页面输入框）" : result);
  } catch (err) {
    setStatus(`失败: ${err.message}`);
  }
});

document.getElementById("btn-save-server").addEventListener("click", async () => {
  const serverUrl = document.getElementById("serverUrl").value.trim() || "http://127.0.0.1:3789";
  await setAuthState({ serverUrl });
  await refreshAccountUI();
  setAccountStatus(`服务器已保存：${serverUrl}`);
});

document.getElementById("btn-register").addEventListener("click", async () => {
  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;
  setAccountStatus("注册中...");
  try {
    await setAuthState({
      serverUrl: document.getElementById("serverUrl").value.trim() || "http://127.0.0.1:3789"
    });
    const data = await register(email, password);
    setAccountStatus(`注册成功：${data.user.email}`);
    await refreshAccountUI();
  } catch (err) {
    setAccountStatus(`注册失败：${err.message}`);
  }
});

document.getElementById("btn-login").addEventListener("click", async () => {
  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;
  setAccountStatus("登录中...");
  try {
    await setAuthState({
      serverUrl: document.getElementById("serverUrl").value.trim() || "http://127.0.0.1:3789"
    });
    const data = await login(email, password);
    setAccountStatus(`登录成功：${data.user.email}`);
    await refreshAccountUI();
    await loadApplicationsUI();
  } catch (err) {
    setAccountStatus(`登录失败：${err.message}`);
  }
});

document.getElementById("btn-logout").addEventListener("click", async () => {
  await clearAuth();
  document.getElementById("auth-password").value = "";
  await refreshAccountUI();
  await loadApplicationsUI();
  setAccountStatus("已退出，继续使用本地模式");
});

document.getElementById("btn-sync-up").addEventListener("click", async () => {
  const auth = await getAuthState();
  if (!isLoggedIn(auth)) {
    setAccountStatus("请先登录再上传同步");
    return;
  }
  setAccountStatus("正在上传同步...");
  try {
    const { resume, resumeMeta, settings } = await chrome.storage.local.get([
      "resume",
      "resumeMeta",
      "settings"
    ]);
    if (resume) await syncResumeUp(resume, resumeMeta || {});
    if (settings) await syncLlmUp(settings);
    const localApps = await getLocalApplications();
    for (const item of localApps) {
      if (item.id && !String(item.id).startsWith("local_")) continue;
      await createApplication({
        company: item.company || "",
        title: item.title || "",
        url: item.url || "",
        status: item.status || "applied",
        notes: item.notes || "",
        appliedAt: item.appliedAt || new Date().toISOString()
      });
    }
    await loadApplicationsUI();
    setAccountStatus("上传同步完成（简历 / LLM / 本地投递记录）");
  } catch (err) {
    setAccountStatus(`上传同步失败：${err.message}`);
  }
});

document.getElementById("btn-sync-down").addEventListener("click", async () => {
  const auth = await getAuthState();
  if (!isLoggedIn(auth)) {
    setAccountStatus("请先登录再拉取同步");
    return;
  }
  setAccountStatus("正在拉取同步...");
  try {
    const resumeData = await syncResumeDown();
    const llmData = await syncLlmDown();
    if (resumeData.resume) {
      await chrome.storage.local.set({
        resume: resumeData.resume,
        resumeMeta: resumeData.meta || {}
      });
      editor.setResume(resumeData.resume);
      updateMeta(resumeData.meta || {});
      setResumeStatus(summarize(resumeData.resume));
    }
    if (llmData.settings) {
      const settings = {
        baseUrl: llmData.settings.baseUrl,
        model: llmData.settings.model,
        apiKey: llmData.settings.apiKey || "",
        useLLM: !!llmData.settings.useLLM,
        clickFillEnabled: llmData.settings.clickFillEnabled !== false
      };
      await chrome.storage.local.set({ settings });
      document.getElementById("useLLM").checked = settings.useLLM;
      document.getElementById("clickFillEnabled").checked = settings.clickFillEnabled;
      document.getElementById("baseUrl").value = settings.baseUrl;
      document.getElementById("model").value = settings.model;
      document.getElementById("apiKey").value = settings.apiKey;
    }
    await loadApplicationsUI();
    setAccountStatus("拉取同步完成（已覆盖本地简历 / LLM / 投递列表）");
  } catch (err) {
    setAccountStatus(`拉取同步失败：${err.message}`);
  }
});

document.getElementById("btn-app-from-tab").addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    document.getElementById("app-url").value = tab?.url || "";
    document.getElementById("app-title").value = tab?.title || "";
    if (!document.getElementById("app-company").value) {
      try {
        const host = new URL(tab.url).hostname.replace(/^www\./, "");
        document.getElementById("app-company").value = host;
      } catch {
        /* ignore */
      }
    }
    setAppsStatus("已读取当前页");
  } catch (err) {
    setAppsStatus(`读取失败：${err.message}`);
  }
});

document.getElementById("btn-app-save").addEventListener("click", async () => {
  const payload = {
    company: document.getElementById("app-company").value.trim(),
    title: document.getElementById("app-title").value.trim(),
    url: document.getElementById("app-url").value.trim(),
    notes: document.getElementById("app-notes").value.trim(),
    status: "applied",
    appliedAt: new Date().toISOString()
  };
  if (!payload.company && !payload.title && !payload.url) {
    setAppsStatus("请至少填写公司、职位或网址");
    return;
  }

  try {
    const auth = await getAuthState();
    if (isLoggedIn(auth)) {
      await createApplication(payload);
      setAppsStatus("已保存到云端");
    } else {
      const local = await getLocalApplications();
      local.unshift({
        ...payload,
        localId: `local_${Date.now()}`,
        id: `local_${Date.now()}`,
        createdAt: payload.appliedAt
      });
      await setLocalApplications(local);
      setAppsStatus("已保存到本地（登录后可上传同步）");
    }
    document.getElementById("app-notes").value = "";
    await loadApplicationsUI();
  } catch (err) {
    setAppsStatus(`保存失败：${err.message}`);
  }
});

loadAll().catch((e) => setStatus(String(e)));
