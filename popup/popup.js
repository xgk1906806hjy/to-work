import { extractResumeContent } from "../lib/resume-extract.js";
import { parseResumeWithLLM, testLLMConnection, normalizeBaseUrl } from "../lib/llm.js";
import { createResumeEditor, summarize } from "./resume-editor.js";

const statusEl = document.getElementById("status");
const resumeStatusEl = document.getElementById("resume-status");
const resumeMetaEl = document.getElementById("resume-meta");
const settingsStatusEl = document.getElementById("settings-status");
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
  document.getElementById("baseUrl").value =
    s.baseUrl || PRESETS.deepseek.baseUrl;
  document.getElementById("model").value = s.model || PRESETS.deepseek.model;
  document.getElementById("apiKey").value = s.apiKey || "";
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
});

document.getElementById("btn-test-llm").addEventListener("click", async () => {
  const settings = readSettingsFromForm();
  if (!settings.apiKey) {
    setSettingsStatus("请先填写 API Key");
    return;
  }
  setSettingsStatus("正在测试连接...");
  try {
    // 先保存，避免用户忘了保存
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
  // 若表单里已填 key 但未保存，也允许用当前表单
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

    // 直接在 popup 调 API，避免 SW 转发大文本/网络异常不好排查
    const resume = await parseResumeWithLLM({
      apiKey: settings.apiKey,
      baseUrl: settings.baseUrl,
      model: settings.model,
      kind: extracted.kind,
      text: extracted.text,
      dataUrl: extracted.dataUrl,
      fileName: extracted.fileName
    });

    await chrome.storage.local.set({
      resume,
      resumeMeta: {
        sourceFile: extracted.fileName || file.name,
        parsedAt: new Date().toISOString()
      }
    });

    editor.setResume(resume);
    updateMeta({
      sourceFile: extracted.fileName || file.name,
      parsedAt: new Date().toISOString()
    });
    setResumeStatus(
      `解析完成：${resume.basic?.name || "（未识别姓名）"}\n${summarize(resume)}\n可折叠查看各区块，改完点「保存修改」`
    );
    setStatus(`简历已解析并写入本地：${extracted.fileName || file.name}`);
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

loadAll().catch((e) => setStatus(String(e)));
