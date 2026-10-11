/**
 * 根据简历 JSON 动态渲染/收集表单。
 * - basic：有值优先显示，解析出的新字段自动出现
 * - 列表区块：教育/实习/项目等按条数渲染，未知数组区块也会自动生成
 */

const BASIC_FIELD_META = {
  name: { label: "姓名", type: "text" },
  englishName: { label: "英文名", type: "text" },
  gender: { label: "性别", type: "select", options: ["", "男", "女"] },
  birthday: { label: "出生日期", type: "date" },
  phone: { label: "手机", type: "text" },
  email: { label: "邮箱", type: "text" },
  idType: { label: "证件类型", type: "text" },
  idNumber: { label: "证件号码", type: "text" },
  ethnicity: { label: "民族", type: "text" },
  politicalStatus: { label: "政治面貌", type: "text" },
  partyJoinDate: { label: "入党/团时间", type: "date" },
  nativePlace: { label: "籍贯", type: "text" },
  birthPlace: { label: "出生地", type: "text" },
  nationality: { label: "国籍", type: "text" },
  health: { label: "健康状况", type: "text" },
  maritalStatus: { label: "婚姻状况", type: "text" },
  height: { label: "身高(cm)", type: "text" },
  weight: { label: "体重(kg)", type: "text" },
  currentCity: { label: "现居住地", type: "text" },
  sourcePlace: { label: "生源地", type: "text" },
  address: { label: "通讯地址", type: "text", full: true },
  emergencyContact: { label: "紧急联系人", type: "text" },
  emergencyPhone: { label: "紧急电话", type: "text" }
};

const CORE_BASIC_KEYS = ["name", "gender", "birthday", "phone", "email", "politicalStatus"];

const SECTION_DEFS = {
  education: {
    title: "教育经历",
    fields: [
      { key: "school", label: "学校", full: true },
      { key: "degree", label: "学历" },
      { key: "major", label: "专业" },
      { key: "startDate", label: "开始", type: "text" },
      { key: "endDate", label: "结束", type: "text" },
      { key: "gpa", label: "GPA" },
      { key: "description", label: "描述", type: "textarea", full: true }
    ]
  },
  internships: {
    title: "实习经历",
    fields: [
      { key: "company", label: "公司", full: true },
      { key: "title", label: "职位" },
      { key: "startDate", label: "开始" },
      { key: "endDate", label: "结束" },
      { key: "description", label: "描述", type: "textarea", full: true }
    ]
  },
  projects: {
    title: "项目经历",
    fields: [
      { key: "name", label: "项目名", full: true },
      { key: "role", label: "角色" },
      { key: "startDate", label: "开始" },
      { key: "endDate", label: "结束" },
      { key: "description", label: "描述", type: "textarea", full: true }
    ]
  },
  skills: {
    title: "技能",
    fields: [
      { key: "name", label: "技能" },
      { key: "level", label: "水平" }
    ]
  },
  certificates: {
    title: "证书",
    fields: [
      { key: "name", label: "证书名", full: true },
      { key: "date", label: "获得时间" }
    ]
  },
  languages: {
    title: "语言能力",
    fields: [
      { key: "name", label: "语言" },
      { key: "level", label: "水平" }
    ]
  }
};

const RESERVED_TOP_KEYS = new Set([
  "basic",
  "selfEvaluation",
  "education",
  "internships",
  "projects",
  "skills",
  "certificates",
  "languages"
]);

function humanizeKey(key) {
  return String(key || "")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

function isEmptyValue(v) {
  if (v == null) return true;
  if (typeof v === "string") return !v.trim();
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function labeledField({ label, name, value, type = "text", options = [], full = false }) {
  const fullCls = full || type === "textarea" || label.length > 6 ? "full" : "";
  if (type === "select") {
    const opts = options
      .map((o) => {
        const val = o === "" ? "" : o;
        const text = o === "" ? "请选择" : o;
        return `<option value="${escapeHtml(val)}" ${String(value) === String(val) ? "selected" : ""}>${escapeHtml(text)}</option>`;
      })
      .join("");
    return `<label class="${fullCls}">${escapeHtml(label)}<select data-name="${escapeHtml(name)}">${opts}</select></label>`;
  }
  if (type === "textarea") {
    return `<label class="full">${escapeHtml(label)}<textarea data-name="${escapeHtml(name)}" rows="3">${escapeHtml(value)}</textarea></label>`;
  }
  const inputType = type === "date" ? "date" : "text";
  return `<label class="${fullCls}">${escapeHtml(label)}<input data-name="${escapeHtml(name)}" type="${inputType}" value="${escapeHtml(value)}" /></label>`;
}

/**
 * @param {HTMLElement} root
 */
export function createResumeEditor(root) {
  /** @type {any} */
  let state = emptyResume();
  let showAllBasic = false;

  function emptyResume() {
    return {
      basic: {},
      education: [],
      internships: [],
      projects: [],
      skills: [],
      certificates: [],
      languages: [],
      selfEvaluation: ""
    };
  }

  function setResume(resume) {
    state = normalizeResume(resume);
    render();
  }

  function getResume() {
    return collectFromDom();
  }

  function normalizeResume(resume) {
    const src = resume && typeof resume === "object" ? resume : {};
    const next = emptyResume();
    next.basic = { ...(src.basic && typeof src.basic === "object" ? src.basic : {}) };
    next.selfEvaluation = src.selfEvaluation != null ? String(src.selfEvaluation) : "";

    for (const key of Object.keys(SECTION_DEFS)) {
      next[key] = Array.isArray(src[key]) ? src[key].map((item) => ({ ...(item || {}) })) : [];
    }

    // 动态保留未知顶层数组/字符串字段
    for (const [key, val] of Object.entries(src)) {
      if (RESERVED_TOP_KEYS.has(key)) continue;
      if (Array.isArray(val)) {
        next[key] = val.map((item) => (item && typeof item === "object" ? { ...item } : { value: item }));
      } else if (typeof val === "string") {
        next[key] = val;
      } else if (val && typeof val === "object") {
        next[key] = { ...val };
      }
    }
    return next;
  }

  function basicKeysToShow() {
    const keys = new Set();
    for (const k of CORE_BASIC_KEYS) keys.add(k);
    for (const k of Object.keys(BASIC_FIELD_META)) {
      if (showAllBasic || !isEmptyValue(state.basic[k])) keys.add(k);
    }
    for (const k of Object.keys(state.basic || {})) {
      if (!isEmptyValue(state.basic[k])) keys.add(k);
    }
    // 稳定顺序：已知字段按 meta 顺序，其余按出现顺序
    const ordered = [];
    for (const k of Object.keys(BASIC_FIELD_META)) {
      if (keys.has(k)) ordered.push(k);
    }
    for (const k of keys) {
      if (!BASIC_FIELD_META[k]) ordered.push(k);
    }
    return ordered;
  }

  function sectionKeys() {
    const keys = [];
    for (const k of Object.keys(SECTION_DEFS)) keys.push(k);
    for (const k of Object.keys(state)) {
      if (RESERVED_TOP_KEYS.has(k)) continue;
      if (Array.isArray(state[k])) keys.push(k);
    }
    return keys;
  }

  function fieldsForSection(sectionKey, items) {
    const def = SECTION_DEFS[sectionKey];
    const base = def ? def.fields.map((f) => ({ ...f })) : [];
    const byKey = new Map(base.map((f) => [f.key, f]));
    for (const item of items || []) {
      if (!item || typeof item !== "object") continue;
      for (const k of Object.keys(item)) {
        if (!byKey.has(k)) {
          const isLong = String(item[k] || "").length > 40 || k.toLowerCase().includes("desc");
          byKey.set(k, {
            key: k,
            label: humanizeKey(k),
            type: isLong ? "textarea" : "text",
            full: isLong
          });
          base.push(byKey.get(k));
        }
      }
    }
    if (!base.length) {
      return [
        { key: "name", label: "名称" },
        { key: "description", label: "描述", type: "textarea", full: true }
      ];
    }
    return base;
  }

  function render() {
    const basicKeys = basicKeysToShow();
    const hiddenCount = Object.keys(BASIC_FIELD_META).filter(
      (k) => !basicKeys.includes(k) && isEmptyValue(state.basic[k])
    ).length;

    const basicFieldsHtml = basicKeys
      .map((key) => {
        const meta = BASIC_FIELD_META[key] || {
          label: humanizeKey(key),
          type: "text",
          full: true
        };
        return labeledField({
          label: meta.label,
          name: `basic.${key}`,
          value: state.basic[key] ?? "",
          type: meta.type || "text",
          options: meta.options || [],
          full: !!meta.full
        });
      })
      .join("");

    const sectionsHtml = sectionKeys()
      .map((sectionKey) => {
        const items = Array.isArray(state[sectionKey]) ? state[sectionKey] : [];
        const title = SECTION_DEFS[sectionKey]?.title || humanizeKey(sectionKey);
        const fields = fieldsForSection(sectionKey, items);
        const cards =
          items.length === 0
            ? `<div class="empty-block">暂无内容，可点击下方添加</div>`
            : items
                .map((item, index) => {
                  const grid = fields
                    .map((f) =>
                      labeledField({
                        label: f.label,
                        name: `${sectionKey}.${index}.${f.key}`,
                        value: item?.[f.key] ?? "",
                        type: f.type || "text",
                        full: !!f.full
                      })
                    )
                    .join("");
                  return `<div class="entry-card" data-section="${escapeHtml(sectionKey)}" data-index="${index}">
                    <div class="entry-head">
                      <strong>#${index + 1}</strong>
                      <button type="button" class="btn tiny danger" data-act="remove-entry" data-section="${escapeHtml(sectionKey)}" data-index="${index}">删除</button>
                    </div>
                    <div class="form-grid">${grid}</div>
                  </div>`;
                })
                .join("");

        return `<details class="section-block" data-section="${escapeHtml(sectionKey)}" ${items.length ? "open" : ""}>
          <summary>
            <span>${escapeHtml(title)}</span>
            <span class="badge">${items.length}</span>
          </summary>
          <div class="section-body">
            ${cards}
            <div class="section-actions">
              <button type="button" class="btn" data-act="add-entry" data-section="${escapeHtml(sectionKey)}">＋ 添加一段</button>
            </div>
          </div>
        </details>`;
      })
      .join("");

    const extraStrings = Object.entries(state)
      .filter(([k, v]) => !RESERVED_TOP_KEYS.has(k) && typeof v === "string")
      .map(([k, v]) =>
        labeledField({
          label: humanizeKey(k),
          name: `top.${k}`,
          value: v,
          type: "textarea",
          full: true
        })
      )
      .join("");

    root.innerHTML = `
      <div class="card section-block always-open">
        <div class="section-title-row">
          <div class="section-title">基础信息</div>
          <div class="section-title-actions">
            <button type="button" class="btn tiny" data-act="toggle-basic">${showAllBasic ? "只显示有值/核心" : `显示全部${hiddenCount ? `（+${hiddenCount}）` : ""}`}</button>
            <button type="button" class="btn tiny" data-act="add-basic-field">＋ 字段</button>
          </div>
        </div>
        <div class="form-grid" id="basic-grid">${basicFieldsHtml}</div>
      </div>

      ${sectionsHtml}

      <div class="card section-block always-open">
        <div class="section-title">自我评价 / 其他</div>
        <div class="form-grid">
          ${labeledField({
            label: "自我评价",
            name: "selfEvaluation",
            value: state.selfEvaluation || "",
            type: "textarea",
            full: true
          })}
          ${extraStrings}
        </div>
        <div class="section-actions">
          <button type="button" class="btn" data-act="add-section">＋ 添加自定义区块</button>
        </div>
      </div>
    `;
  }

  function collectFromDom() {
    const next = normalizeResume(state);
    next.basic = { ...next.basic };
    const inputs = root.querySelectorAll("[data-name]");
    for (const el of inputs) {
      const name = el.getAttribute("data-name");
      const value = el.value;
      if (name === "selfEvaluation") {
        next.selfEvaluation = value;
        continue;
      }
      if (name.startsWith("basic.")) {
        next.basic[name.slice(6)] = value;
        continue;
      }
      if (name.startsWith("top.")) {
        next[name.slice(4)] = value;
        continue;
      }
      const m = name.match(/^([^.]+)\.(\d+)\.(.+)$/);
      if (!m) continue;
      const [, section, indexStr, field] = m;
      const index = Number(indexStr);
      if (!Array.isArray(next[section])) next[section] = [];
      if (!next[section][index] || typeof next[section][index] !== "object") {
        next[section][index] = {};
      }
      next[section][index][field] = value;
    }

    // 去掉数组里的空洞
    for (const key of Object.keys(next)) {
      if (Array.isArray(next[key])) {
        next[key] = next[key].filter((item) => item && typeof item === "object");
      }
    }
    state = next;
    return structuredClone ? structuredClone(next) : JSON.parse(JSON.stringify(next));
  }

  function blankItem(sectionKey) {
    const fields = fieldsForSection(sectionKey, state[sectionKey] || []);
    const item = {};
    for (const f of fields) item[f.key] = "";
    return item;
  }

  root.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn || !root.contains(btn)) return;
    const act = btn.dataset.act;

    // 操作前先同步 DOM → state，避免丢改
    collectFromDom();

    if (act === "toggle-basic") {
      showAllBasic = !showAllBasic;
      render();
      return;
    }

    if (act === "add-basic-field") {
      const key = prompt("新字段英文键名（如 hukou / wechat）");
      if (!key || !/^[\w\u4e00-\u9fa5]+$/.test(key)) {
        alert("键名无效");
        return;
      }
      if (state.basic[key] == null) state.basic[key] = "";
      showAllBasic = true;
      render();
      return;
    }

    if (act === "add-entry") {
      const section = btn.dataset.section;
      if (!Array.isArray(state[section])) state[section] = [];
      state[section].push(blankItem(section));
      render();
      const block = root.querySelector(`details[data-section="${CSS.escape(section)}"]`);
      if (block) block.open = true;
      return;
    }

    if (act === "remove-entry") {
      const section = btn.dataset.section;
      const index = Number(btn.dataset.index);
      if (!Array.isArray(state[section])) return;
      state[section].splice(index, 1);
      render();
      return;
    }

    if (act === "add-section") {
      const key = prompt("新区块英文键名（如 awards / research）");
      if (!key || !/^[\w]+$/.test(key)) {
        alert("键名无效，请用英文/数字/下划线");
        return;
      }
      if (RESERVED_TOP_KEYS.has(key) || key === "basic") {
        alert("该键名已占用");
        return;
      }
      if (!Array.isArray(state[key])) state[key] = [];
      state[key].push({ name: "", description: "" });
      render();
      return;
    }
  });

  return { setResume, getResume, render };
}

export function summarize(resume) {
  const r = resume || {};
  const parts = [];
  const basicCount = Object.values(r.basic || {}).filter((v) => !isEmptyValue(v)).length;
  parts.push(`基础字段 ${basicCount}`);
  for (const [key, def] of Object.entries(SECTION_DEFS)) {
    const n = Array.isArray(r[key]) ? r[key].length : 0;
    if (n) parts.push(`${def.title} ${n}`);
  }
  for (const [key, val] of Object.entries(r)) {
    if (RESERVED_TOP_KEYS.has(key)) continue;
    if (Array.isArray(val) && val.length) parts.push(`${humanizeKey(key)} ${val.length}`);
  }
  return parts.join(" · ") || "空简历";
}

export { SECTION_DEFS, BASIC_FIELD_META };
