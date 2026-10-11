/**
 * LLM 字段映射 / 简历解析
 * 兼容 OpenAI 风格 Chat Completions API。
 */

function normalizeBaseUrl(baseUrl) {
  let u = String(baseUrl || "").trim();
  if (!u) u = "https://api.openai.com/v1";
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  u = u.replace(/\/+$/, "");
  u = u.replace(/\/chat\/completions$/i, "");
  // 常见国内兼容接口缺 /v1
  if (/^https?:\/\/api\.deepseek\.com$/i.test(u)) u += "/v1";
  if (/^https?:\/\/dashscope\.aliyuncs\.com\/compatible-mode$/i.test(u)) u += "/v1";
  if (/^https?:\/\/api\.moonshot\.cn$/i.test(u)) u += "/v1";
  return u;
}

function explainFetchError(err, endpoint) {
  const msg = String(err?.message || err || "");
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return [
      `无法连接 API：${endpoint}`,
      "常见原因：",
      "1) Base URL 不正确（需含 /v1，且不要带 /chat/completions）",
      "2) 当前网络访问不了该地址（OpenAI 常需代理；可改用 DeepSeek/通义）",
      "3) 设置改完后未点「保存设置」",
      "请先在设置页点「测试连接」排查。"
    ].join("\n");
  }
  return msg;
}

/**
 * @param {object} params
 * @param {string} params.apiKey
 * @param {string} params.baseUrl
 * @param {string} [params.model]
 * @param {Array<{role:string, content:any}>} params.messages
 * @param {number} [params.temperature]
 */
async function chatCompletions({ apiKey, baseUrl, model, messages, temperature = 0.1 }) {
  if (!apiKey) throw new Error("未配置 API Key");
  const root = normalizeBaseUrl(baseUrl);
  const endpoint = `${root}/chat/completions`;

  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model || "gpt-4o-mini",
        temperature,
        messages
      })
    });
  } catch (err) {
    throw new Error(explainFetchError(err, endpoint));
  }

  if (!res.ok) {
    const text = await res.text();
    let detail = text.slice(0, 280);
    try {
      const j = JSON.parse(text);
      detail = j.error?.message || j.message || detail;
    } catch {
      /* keep raw */
    }
    throw new Error(`API 返回 ${res.status}：${detail}`);
  }

  return res.json();
}

/** 用极短请求验证 Key / Base URL / 网络 */
async function testLLMConnection({ apiKey, baseUrl, model }) {
  const data = await chatCompletions({
    apiKey,
    baseUrl,
    model,
    temperature: 0,
    messages: [
      { role: "user", content: "只回复：ok" }
    ]
  });
  const content = data.choices?.[0]?.message?.content || "";
  return {
    ok: true,
    endpoint: `${normalizeBaseUrl(baseUrl)}/chat/completions`,
    model: model || "gpt-4o-mini",
    reply: String(content).slice(0, 80)
  };
}

/**
 * @param {object} params
 * @param {string} params.apiKey
 * @param {string} params.baseUrl
 * @param {string} params.model
 * @param {Array<{id:string,label:string,type:string,options?:string[]}>} params.fields
 * @param {object} params.resume
 */
async function mapFieldsWithLLM({ apiKey, baseUrl, model, fields, resume }) {
  const system = `你是校招网申表单填写助手。根据用户简历 JSON，为页面字段生成填写指令。
规则：
1. 只输出 JSON 数组，不要 markdown。
2. 每项格式：{"id":"...","path":"basic.name","value":"...","confidence":0.0到1.0,"action":"type|select|radio|date|skip"}
3. 不确定就 action=skip，不要编造。
4. value 必须尽量匹配 options（若提供）。
5. 日期用 YYYY-MM-DD。`;

  const user = JSON.stringify(
    {
      resume,
      fields: fields.map((f) => ({
        id: f.id,
        label: f.label,
        type: f.type,
        options: f.options || []
      }))
    },
    null,
    0
  );

  const data = await chatCompletions({
    apiKey,
    baseUrl,
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  });
  const content = data.choices?.[0]?.message?.content || "[]";
  return parseJsonArray(content);
}

function parseJsonArray(content) {
  const trimmed = String(content).trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1].trim() : trimmed;
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1) return [];
  try {
    const arr = JSON.parse(raw.slice(start, end + 1));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function parseJsonObject(content) {
  const trimmed = String(content).trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1].trim() : trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("LLM 未返回 JSON 对象");
  }
  return JSON.parse(raw.slice(start, end + 1));
}

const RESUME_SCHEMA_HINT = `{
  "basic": {
    "name": "", "englishName": "", "gender": "", "birthday": "YYYY-MM-DD",
    "phone": "", "email": "", "idType": "身份证", "idNumber": "",
    "ethnicity": "", "politicalStatus": "", "partyJoinDate": "",
    "nativePlace": "", "birthPlace": "", "nationality": "中国",
    "health": "", "maritalStatus": "", "height": "", "weight": "",
    "currentCity": "", "sourcePlace": "", "address": "",
    "emergencyContact": "", "emergencyPhone": ""
  },
  "education": [{"school":"","degree":"","major":"","startDate":"","endDate":"","gpa":"","description":""}],
  "internships": [{"company":"","title":"","startDate":"","endDate":"","description":""}],
  "projects": [{"name":"","role":"","startDate":"","endDate":"","description":""}],
  "skills": [{"name":"","level":""}],
  "certificates": [{"name":"","date":""}],
  "languages": [{"name":"","level":""}],
  "selfEvaluation": "",
  "awards": [{"name":"","date":"","description":""}],
  "research": [{"name":"","role":"","description":""}]
}`;

/**
 * 用 LLM 把简历原文/图片解析为结构化 JSON
 * @param {object} params
 * @param {string} params.apiKey
 * @param {string} params.baseUrl
 * @param {string} params.model
 * @param {'text'|'image'} params.kind
 * @param {string} [params.text]
 * @param {string} [params.dataUrl]
 * @param {string} [params.fileName]
 */
async function parseResumeWithLLM({
  apiKey,
  baseUrl,
  model,
  kind,
  text,
  dataUrl,
  fileName
}) {
  if (!apiKey) throw new Error("未配置 API Key，请先在「设置」里填写后再上传解析");

  const system = `你是校招简历信息抽取助手。把用户简历整理成 JSON。
规则：
1. 只输出一个 JSON 对象，不要 markdown，不要解释。
2. 以给定结构为骨架；简历里出现的信息尽量都收录。
3. basic 可增加额外键（如 wechat、hukou、expectedSalary）；经历条目也可增加额外键。
4. 若有奖学金/竞赛/论文/干部经历等，用额外顶层数组区块（如 awards、research、campusRoles），每项为对象。
5. 没有的信息用空字符串或空数组，不要编造。
6. 日期尽量 YYYY-MM-DD；只有年月则用 YYYY-MM-01。
7. 性别只能是「男」或「女」或空字符串。
8. 身高体重只保留数字；政治面貌用常见中文表述。`;

  /** @type {Array<{role:string, content: any}>} */
  const messages = [{ role: "system", content: system }];

  if (kind === "image") {
    if (!dataUrl) throw new Error("图片内容为空");
    messages.push({
      role: "user",
      content: [
        {
          type: "text",
          text: `请解析这张简历图片（文件名：${fileName || "resume"}），输出符合以下结构的 JSON：\n${RESUME_SCHEMA_HINT}`
        },
        {
          type: "image_url",
          image_url: { url: dataUrl }
        }
      ]
    });
  } else {
    if (!text?.trim()) throw new Error("简历文本为空");
    messages.push({
      role: "user",
      content: `文件名：${fileName || "resume"}\n请根据以下简历正文输出 JSON：\n结构：\n${RESUME_SCHEMA_HINT}\n\n简历正文：\n${text}`
    });
  }

  const data = await chatCompletions({
    apiKey,
    baseUrl,
    model,
    messages
  });
  const content = data.choices?.[0]?.message?.content || "";
  const parsed = parseJsonObject(content);
  return normalizeParsedResume(parsed);
}

function normalizeParsedResume(parsed) {
  const emptyBasic = {
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
  };

  const basicIn = parsed?.basic && typeof parsed.basic === "object" ? parsed.basic : {};
  const basic = { ...emptyBasic };
  for (const key of Object.keys(emptyBasic)) {
    if (basicIn[key] != null && basicIn[key] !== "") {
      basic[key] = String(basicIn[key]).trim();
    }
  }
  // 保留 LLM 额外抽出的 basic 字段
  for (const [key, val] of Object.entries(basicIn)) {
    if (key in emptyBasic) continue;
    if (val == null || val === "") continue;
    basic[key] = typeof val === "string" ? val.trim() : String(val);
  }

  if (basic.gender && !["男", "女"].includes(basic.gender)) {
    if (/男|male/i.test(basic.gender)) basic.gender = "男";
    else if (/女|female/i.test(basic.gender)) basic.gender = "女";
    else basic.gender = "";
  }
  basic.height = String(basic.height || "").replace(/[^\d.]/g, "");
  basic.weight = String(basic.weight || "").replace(/[^\d.]/g, "");
  basic.birthday = normalizeDate(basic.birthday);
  basic.partyJoinDate = normalizeDate(basic.partyJoinDate);

  const asArr = (v) =>
    Array.isArray(v)
      ? v.map((item) => {
          if (item && typeof item === "object") return { ...item };
          if (item == null || item === "") return {};
          return { name: String(item) };
        })
      : [];

  const knownListKeys = [
    "education",
    "internships",
    "projects",
    "skills",
    "certificates",
    "languages"
  ];

  const result = {
    basic,
    education: asArr(parsed?.education),
    internships: asArr(parsed?.internships),
    projects: asArr(parsed?.projects),
    skills: asArr(parsed?.skills),
    certificates: asArr(parsed?.certificates),
    languages: asArr(parsed?.languages),
    selfEvaluation: parsed?.selfEvaluation != null ? String(parsed.selfEvaluation) : ""
  };

  // 动态保留未知顶层区块（获奖、科研等）
  if (parsed && typeof parsed === "object") {
    for (const [key, val] of Object.entries(parsed)) {
      if (key === "basic" || key === "selfEvaluation" || knownListKeys.includes(key)) continue;
      if (Array.isArray(val)) {
        result[key] = asArr(val);
      } else if (typeof val === "string" && val.trim()) {
        result[key] = val.trim();
      }
    }
  }

  return result;
}

/**
 * 本地规则映射
 */
function mapFieldsLocally(fields, resume) {
  const matchFieldByLabel =
    (typeof window !== "undefined" && window.CampusAutofill?.matchFieldByLabel) ||
    null;
  const getResumeValue =
    (typeof window !== "undefined" && window.CampusAutofill?.getResumeValue) ||
    ((obj, path) => {
      return path.split(".").reduce((a, k) => (a == null ? "" : a[k]), obj) ?? "";
    });

  // background 侧也内嵌一份精简匹配
  const dict = [
    ["姓名", "basic.name"],
    ["英文名", "basic.englishName"],
    ["性别", "basic.gender"],
    ["出生日期", "basic.birthday"],
    ["生日", "basic.birthday"],
    ["手机", "basic.phone"],
    ["电话", "basic.phone"],
    ["邮箱", "basic.email"],
    ["证件类型", "basic.idType"],
    ["证件号码", "basic.idNumber"],
    ["身份证", "basic.idNumber"],
    ["民族", "basic.ethnicity"],
    ["政治面貌", "basic.politicalStatus"],
    ["籍贯", "basic.nativePlace"],
    ["出生地", "basic.birthPlace"],
    ["国籍", "basic.nationality"],
    ["健康", "basic.health"],
    ["婚姻", "basic.maritalStatus"],
    ["身高", "basic.height"],
    ["体重", "basic.weight"],
    ["现居", "basic.currentCity"],
    ["生源地", "basic.sourcePlace"],
    ["地址", "basic.address"],
    ["紧急联系人", "basic.emergencyContact"]
  ];

  return fields.map((field) => {
    let path = "";
    if (matchFieldByLabel) {
      const hit = matchFieldByLabel(field.label);
      path = hit?.path || "";
    }
    if (!path) {
      const label = String(field.label || "").replace(/\s+/g, "");
      for (const [key, p] of dict) {
        if (label.includes(key)) {
          path = p;
          break;
        }
      }
    }
    if (!path) {
      return { id: field.id, path: "", value: "", confidence: 0, action: "skip" };
    }
    const value = String(getResumeValue(resume, path) || "");
    if (!value) {
      return { id: field.id, path, value: "", confidence: 0.2, action: "skip" };
    }
    const action =
      field.type === "radio"
        ? "radio"
        : field.type === "select"
          ? "select"
          : field.type === "date"
            ? "date"
            : "type";
    return { id: field.id, path, value, confidence: 0.85, action };
  });
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const iso = raw.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
  if (iso) {
    const y = iso[1];
    const m = String(iso[2]).padStart(2, "0");
    const d = String(iso[3] || "01").padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const cn = raw.match(/^(\d{4})[年./-](\d{1,2})[月./-](\d{1,2})/);
  if (cn) {
    return `${cn[1]}-${String(cn[2]).padStart(2, "0")}-${String(cn[3]).padStart(2, "0")}`;
  }
  const cnMonth = raw.match(/^(\d{4})[年./-](\d{1,2})月?$/);
  if (cnMonth) {
    return `${cnMonth[1]}-${String(cnMonth[2]).padStart(2, "0")}-01`;
  }
  return raw;
}

export {
  normalizeBaseUrl,
  chatCompletions,
  testLLMConnection,
  mapFieldsWithLLM,
  mapFieldsLocally,
  parseJsonArray,
  parseJsonObject,
  parseResumeWithLLM,
  normalizeParsedResume
};
