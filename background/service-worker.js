import {
  mapFieldsWithLLM,
  mapFieldsLocally,
  parseResumeWithLLM,
  normalizeBaseUrl
} from "../lib/llm.js";

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(["resume", "settings"]);
  if (!existing.resume) {
    await chrome.storage.local.set({
      resume: {
        basic: {
          name: "",
          englishName: "",
          gender: "",
          birthday: "",
          phone: "",
          email: "",
          idType: "身份证",
          idNumber: "",
          ethnicity: "汉族",
          politicalStatus: "",
          partyJoinDate: "",
          nativePlace: "",
          birthPlace: "",
          nationality: "中国",
          health: "健康",
          maritalStatus: "未婚",
          height: "",
          weight: "",
          currentCity: "",
          sourcePlace: "",
          address: "",
          emergencyContact: "",
          emergencyPhone: ""
        },
        education: [],
        internships: [],
        projects: [],
        skills: [],
        certificates: [],
        languages: [],
        selfEvaluation: ""
      }
    });
  }
  if (!existing.settings) {
    await chrome.storage.local.set({
      settings: {
        apiKey: "",
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        useLLM: false,
        clickFillEnabled: true
      }
    });
  } else if (existing.settings?.baseUrl) {
    const fixed = normalizeBaseUrl(existing.settings.baseUrl);
    if (fixed !== existing.settings.baseUrl) {
      await chrome.storage.local.set({
        settings: { ...existing.settings, baseUrl: fixed }
      });
    }
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  if (command === "fill-focused") {
    await chrome.tabs.sendMessage(tab.id, { type: "FILL_FOCUSED" });
  }
  if (command === "scan-and-fill") {
    await fillBasicOnTab(tab.id);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handle(message).then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
  return true;
});

async function handle(message) {
  if (message?.type === "FILL_BASIC_PIPELINE") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("没有活动标签页");
    return fillBasicOnTab(tab.id);
  }
  if (message?.type === "MAP_FIELDS") {
    return mapFields(message.fields, message.resume);
  }
  if (message?.type === "PARSE_RESUME_FILE") {
    return parseUploadedResume(message.payload);
  }
  return { ok: false, error: "unknown" };
}

/**
 * @param {{ kind: 'text'|'image', text?: string, dataUrl?: string, fileName?: string }} payload
 */
async function parseUploadedResume(payload) {
  const { settings } = await chrome.storage.local.get(["settings"]);
  if (!settings?.apiKey) {
    throw new Error("请先在「设置」中填写 API Key，上传简历需要 LLM 解析");
  }

  const resume = await parseResumeWithLLM({
    apiKey: settings.apiKey,
    baseUrl: settings.baseUrl || "https://api.deepseek.com/v1",
    model: settings.model || "deepseek-chat",
    kind: payload.kind,
    text: payload.text,
    dataUrl: payload.dataUrl,
    fileName: payload.fileName
  });

  await chrome.storage.local.set({
    resume,
    resumeMeta: {
      sourceFile: payload.fileName || "",
      parsedAt: new Date().toISOString()
    }
  });

  return {
    ok: true,
    resume,
    sourceFile: payload.fileName || "",
    basicName: resume.basic?.name || ""
  };
}

async function fillBasicOnTab(tabId) {
  const { resume, settings } = await chrome.storage.local.get(["resume", "settings"]);
  const scan = await chrome.tabs.sendMessage(tabId, { type: "SCAN_FIELDS" });
  if (!scan?.ok) throw new Error(scan?.error || "扫描失败，请刷新页面后重试");

  let instructions = mapFieldsLocally(scan.fields, resume || {});
  let mode = "local";

  if (settings?.useLLM && settings?.apiKey) {
    try {
      const llmMapped = await mapFieldsWithLLM({
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl || "https://api.deepseek.com/v1",
        model: settings.model || "deepseek-chat",
        fields: scan.fields,
        resume: resume || {}
      });
      if (llmMapped.length) {
        instructions = llmMapped;
        mode = "llm";
      }
    } catch (e) {
      // LLM 失败回退本地规则
      mode = `local_fallback:${e.message}`;
    }
  }

  const filled = await chrome.tabs.sendMessage(tabId, {
    type: "FILL_BASIC",
    instructions,
    resume
  });

  return {
    ok: true,
    mode,
    scanned: scan.count,
    results: filled?.results || [],
    filledCount: (filled?.results || []).filter((r) => r.ok).length
  };
}

async function mapFields(fields, resume) {
  const { settings } = await chrome.storage.local.get(["settings"]);
  if (settings?.useLLM && settings?.apiKey) {
    const mapped = await mapFieldsWithLLM({
      apiKey: settings.apiKey,
      baseUrl: settings.baseUrl || "https://api.deepseek.com/v1",
      model: settings.model || "deepseek-chat",
      fields,
      resume
    });
    return { ok: true, instructions: mapped, mode: "llm" };
  }
  return { ok: true, instructions: mapFieldsLocally(fields, resume), mode: "local" };
}
