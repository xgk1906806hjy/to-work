/**
 * Word（.docx）报名表：解析表格空白格、映射简历字段、写回并导出。
 * 依赖全局 JSZip（popup 已引入 vendor/jszip.min.js）。
 */

import { chatCompletions, parseJsonArray } from "./llm.js";

const PLACEHOLDER_RE = /^(_{2,}|—+|-+|／|\/|请填写|请输入|填写|待填)?$/;

const LOCAL_FIELD_DICTIONARY = [
  { keys: ["姓名", "名字", "中文名", "真实姓名"], path: "basic.name" },
  { keys: ["英文名", "英语名", "拼音名", "英文姓名"], path: "basic.englishName" },
  { keys: ["性别"], path: "basic.gender" },
  { keys: ["出生日期", "生日", "出生年月", "出生年月日"], path: "basic.birthday" },
  { keys: ["手机", "手机号", "手机号码", "联系电话", "电话", "联系方式"], path: "basic.phone" },
  { keys: ["邮箱", "电子邮箱", "电子邮件", "Email", "E-mail"], path: "basic.email" },
  { keys: ["证件类型", "证件类别", "身份证件类型"], path: "basic.idType" },
  { keys: ["证件号码", "身份证号", "身份证号码", "证件号"], path: "basic.idNumber" },
  { keys: ["民族"], path: "basic.ethnicity" },
  { keys: ["政治面貌"], path: "basic.politicalStatus" },
  { keys: ["入党", "入团", "入党/团", "入党团时间", "入党时间", "入团时间"], path: "basic.partyJoinDate" },
  { keys: ["籍贯"], path: "basic.nativePlace" },
  { keys: ["出生地"], path: "basic.birthPlace" },
  { keys: ["国籍"], path: "basic.nationality" },
  { keys: ["健康状况", "健康情况"], path: "basic.health" },
  { keys: ["婚姻状况", "婚姻状态"], path: "basic.maritalStatus" },
  { keys: ["身高"], path: "basic.height" },
  { keys: ["体重"], path: "basic.weight" },
  { keys: ["现居住地", "现居地", "当前城市", "所在城市", "居住城市"], path: "basic.currentCity" },
  { keys: ["生源地"], path: "basic.sourcePlace" },
  { keys: ["通讯地址", "联系地址", "家庭住址", "详细地址", "住址"], path: "basic.address" },
  { keys: ["紧急联系人"], path: "basic.emergencyContact" },
  { keys: ["紧急联系人电话", "紧急电话"], path: "basic.emergencyPhone" },
  { keys: ["自我评价", "自我描述", "个人总结"], path: "selfEvaluation" },
  { keys: ["学校", "毕业院校", "院校"], path: "education.0.school" },
  { keys: ["专业"], path: "education.0.major" },
  { keys: ["学历", "学位"], path: "education.0.degree" },
  { keys: ["GPA", "绩点"], path: "education.0.gpa" }
];

function escapeXml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeXmlEntities(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function cleanLabel(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/[*:：]/g, "")
    .replace(/必填/g, "")
    .trim();
}

function localNameElements(root, name) {
  return [...root.getElementsByTagNameNS("*", name)];
}

function directChildrenByLocalName(parent, name) {
  return [...parent.childNodes].filter(
    (n) => n.nodeType === 1 && n.localName === name
  );
}

function cellText(tc) {
  const parts = localNameElements(tc, "t").map((n) => n.textContent || "");
  return decodeXmlEntities(parts.join("")).replace(/\s+/g, " ").trim();
}

function isPlaceholder(text) {
  const t = String(text || "").trim();
  if (!t) return true;
  return PLACEHOLDER_RE.test(t);
}

function looksLikeLabel(text) {
  const t = cleanLabel(text);
  if (!t || t.length > 24) return false;
  if (/^[\d.]+$/.test(t)) return false;
  if (t.length <= 12) return true;
  return LOCAL_FIELD_DICTIONARY.some((e) => e.keys.some((k) => t.includes(k) || k.includes(t)));
}

function matchFieldByLabel(label) {
  if (!label) return null;
  const normalized = cleanLabel(label).replace(/\s+/g, "");
  let best = null;
  let bestScore = 0;
  for (const entry of LOCAL_FIELD_DICTIONARY) {
    for (const key of entry.keys) {
      const k = key.replace(/\s+/g, "");
      if (normalized === k) return entry;
      if (normalized.includes(k) || k.includes(normalized)) {
        const score = Math.min(normalized.length, k.length) / Math.max(normalized.length, k.length);
        if (score > bestScore) {
          bestScore = score;
          best = entry;
        }
      }
    }
  }
  return bestScore >= 0.4 ? best : null;
}

function getResumeValue(resume, path) {
  if (!resume || !path) return "";
  const parts = path.split(".");
  let cur = resume;
  for (const part of parts) {
    if (cur == null) return "";
    const idx = /^\d+$/.test(part) ? Number(part) : part;
    cur = cur[idx];
  }
  if (cur == null) return "";
  if (typeof cur === "object") return "";
  return String(cur);
}

function formatValueForLabel(label, value) {
  const v = String(value || "").trim();
  if (!v) return "";
  if (/日期|生日|年月/.test(cleanLabel(label))) {
    const m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) {
      return `${m[1]}年${String(m[2]).padStart(2, "0")}月${String(m[3]).padStart(2, "0")}日`;
    }
  }
  return v;
}

/**
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<{ zip: any, xml: string, doc: Document, blanks: Array }>}
 */
async function parseDocxForm(arrayBuffer) {
  if (typeof JSZip === "undefined") {
    throw new Error("缺少 JSZip，无法解析 Word");
  }
  const zip = await JSZip.loadAsync(arrayBuffer);
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("无效的 Word 文件（缺少 document.xml）");
  const xml = await file.async("string");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Word XML 解析失败");
  }

  const blanks = [];
  // 只扫顶层表，避免把嵌套表行算进父表索引
  const body = localNameElements(doc, "body")[0] || doc.documentElement;
  const tables = directChildrenByLocalName(body, "tbl").length
    ? directChildrenByLocalName(body, "tbl")
    : localNameElements(doc, "tbl");
  tables.forEach((tbl, tableIndex) => {
    const rows = directChildrenByLocalName(tbl, "tr");
    rows.forEach((tr, rowIndex) => {
      const cells = directChildrenByLocalName(tr, "tc");
      for (let colIndex = 0; colIndex < cells.length; colIndex++) {
        const tc = cells[colIndex];
        const text = cellText(tc);
        const next = cells[colIndex + 1];
        if (!next) continue;
        const nextText = cellText(next);
        if (looksLikeLabel(text) && isPlaceholder(nextText)) {
          blanks.push({
            id: `t${tableIndex}-r${rowIndex}-c${colIndex + 1}`,
            label: cleanLabel(text),
            tableIndex,
            rowIndex,
            labelCol: colIndex,
            targetCol: colIndex + 1,
            skip: false,
            path: "",
            value: ""
          });
        }
      }
    });
  });

  if (!blanks.length) {
    throw new Error("未在表格中找到「标签 | 空白」待填项。请确认是含表格的 .docx，且待填格为空。");
  }

  return { zip, xml, doc, blanks };
}

function collectResumePaths(resume) {
  const paths = [];
  const seen = new Set();
  const push = (path, hint) => {
    if (!path || seen.has(path)) return;
    seen.add(path);
    const value = getResumeValue(resume, path);
    paths.push({ path, hint: hint || path, value });
  };

  for (const entry of LOCAL_FIELD_DICTIONARY) {
    push(entry.path, entry.keys[0]);
  }

  const basic = resume?.basic && typeof resume.basic === "object" ? resume.basic : {};
  for (const key of Object.keys(basic)) {
    push(`basic.${key}`, key);
  }

  const listKeys = ["education", "internships", "projects", "skills", "certificates", "languages"];
  for (const section of listKeys) {
    const arr = Array.isArray(resume?.[section]) ? resume[section] : [];
    arr.slice(0, 3).forEach((item, index) => {
      if (!item || typeof item !== "object") return;
      for (const key of Object.keys(item)) {
        push(`${section}.${index}.${key}`, `${section}[${index}].${key}`);
      }
    });
  }
  if (resume?.selfEvaluation) push("selfEvaluation", "自我评价");
  return paths;
}

/**
 * 本地词典映射；可选 LLM 补全未命中项
 */
async function mapBlanksToResume(blanks, resume, settings = {}) {
  const mapped = blanks.map((b) => {
    const hit = matchFieldByLabel(b.label);
    const path = hit?.path || "";
    const raw = path ? getResumeValue(resume, path) : "";
    return {
      ...b,
      path,
      value: formatValueForLabel(b.label, raw),
      skip: false
    };
  });

  const unmatched = mapped.filter((b) => !b.path || !b.value);
  if (
    unmatched.length &&
    settings?.useLLM &&
    settings?.apiKey
  ) {
    try {
      const llmHits = await mapFormLabelsWithLLM({
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
        model: settings.model,
        labels: unmatched.map((b) => b.label),
        resume
      });
      const byLabel = new Map(llmHits.map((h) => [cleanLabel(h.label), h]));
      for (const item of mapped) {
        if (item.path && item.value) continue;
        const hit = byLabel.get(cleanLabel(item.label));
        if (!hit?.path) continue;
        item.path = hit.path;
        item.value = formatValueForLabel(item.label, hit.value || getResumeValue(resume, hit.path));
      }
    } catch {
      /* 本地结果继续 */
    }
  }

  return mapped;
}

async function mapFormLabelsWithLLM({ apiKey, baseUrl, model, labels, resume }) {
  const pathCatalog = collectResumePaths(resume)
    .filter((p) => p.value)
    .slice(0, 80)
    .map((p) => ({ path: p.path, sample: String(p.value).slice(0, 40) }));

  const system = `你是报名表字段映射助手。根据简历可用 path，为表格标签选择最合适的 path。
规则：
1. 只输出 JSON 数组，不要 markdown。
2. 每项：{"label":"...","path":"basic.name","value":"..."}
3. 不确定则 path 与 value 都为空字符串。
4. value 必须来自简历，不要编造。`;

  const data = await chatCompletions({
    apiKey,
    baseUrl,
    model,
    temperature: 0,
    maxTokens: 2048,
    timeoutMs: 90000,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: JSON.stringify({ labels, catalog: pathCatalog }, null, 0)
      }
    ]
  });

  const content = data.choices?.[0]?.message?.content || "[]";
  const arr = parseJsonArray(content);
  return arr
    .filter((x) => x && typeof x === "object")
    .map((x) => ({
      label: String(x.label || ""),
      path: String(x.path || ""),
      value: String(x.value || "")
    }));
}

function findCell(doc, tableIndex, rowIndex, colIndex) {
  const body = localNameElements(doc, "body")[0] || doc.documentElement;
  const tables = directChildrenByLocalName(body, "tbl").length
    ? directChildrenByLocalName(body, "tbl")
    : localNameElements(doc, "tbl");
  const tbl = tables[tableIndex];
  if (!tbl) return null;
  const rows = directChildrenByLocalName(tbl, "tr");
  const tr = rows[rowIndex];
  if (!tr) return null;
  const cells = directChildrenByLocalName(tr, "tc");
  return cells[colIndex] || null;
}

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function setCellText(tc, value) {
  const text = String(value ?? "");
  const doc = tc.ownerDocument;
  const keep = [...tc.childNodes].filter(
    (n) => n.nodeType === 1 && n.localName === "tcPr"
  );
  while (tc.firstChild) tc.removeChild(tc.firstChild);
  for (const n of keep) tc.appendChild(n);

  const p = doc.createElementNS(W_NS, "w:p");
  const r = doc.createElementNS(W_NS, "w:r");
  const t = doc.createElementNS(W_NS, "w:t");
  if (/^\s|\s$/.test(text)) {
    t.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
  }
  t.textContent = text;
  r.appendChild(t);
  p.appendChild(r);
  tc.appendChild(p);
}

function normalizeWordXml(serialized, originalXml) {
  let outXml = serialized;
  // Chrome 可能把 w: 序列化成 ns0: / a:
  outXml = outXml.replace(
    /\sxmlns:(?!w\b)([A-Za-z0-9_]+)="http:\/\/schemas\.openxmlformats\.org\/wordprocessingml\/2006\/main"/g,
    ' xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
  );
  outXml = outXml.replace(/<\/?ns\d+:/g, (m) => m.replace(/ns\d+:/, "w:"));

  if (!outXml.includes('xmlns:w=')) {
    outXml = outXml.replace(
      /<w:document\b/,
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    );
  }

  // 尽量保留原文件里其它命名空间声明
  if (originalXml) {
    const rootMatch = originalXml.match(/<w:document\b[^>]*>/);
    const newRootMatch = outXml.match(/<w:document\b[^>]*>/);
    if (rootMatch && newRootMatch) {
      outXml = outXml.replace(newRootMatch[0], rootMatch[0]);
    }
  }

  if (!/^<\?xml/i.test(outXml)) {
    outXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${outXml}`;
  }
  return outXml;
}

/**
 * @param {{ zip: any, doc: Document, xml?: string }} parsed
 * @param {Array<{ tableIndex:number, rowIndex:number, targetCol:number, value:string, skip?:boolean }>} mappings
 * @returns {Promise<Blob>}
 */
async function buildFilledDocx(parsed, mappings) {
  const { zip, doc } = parsed;
  for (const item of mappings) {
    if (item.skip || !item.value) continue;
    const tc = findCell(doc, item.tableIndex, item.rowIndex, item.targetCol);
    if (!tc) continue;
    setCellText(tc, item.value);
  }

  const serializer = new XMLSerializer();
  const outXml = normalizeWordXml(serializer.serializeToString(doc), parsed.xml || "");
  zip.file("word/document.xml", outXml);
  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  });
  return blob;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName || "报名表-已填写.docx";
  a.click();
  URL.revokeObjectURL(url);
}

export {
  parseDocxForm,
  mapBlanksToResume,
  collectResumePaths,
  buildFilledDocx,
  downloadBlob,
  getResumeValue,
  formatValueForLabel,
  matchFieldByLabel,
  cleanLabel
};
