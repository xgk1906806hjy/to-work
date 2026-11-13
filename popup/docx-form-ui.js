import {
  parseDocxForm,
  mapBlanksToResume,
  collectResumePaths,
  buildFilledDocx,
  downloadBlob,
  getResumeValue,
  formatValueForLabel
} from "../lib/docx-form.js";

/**
 * @param {{ setStatus?: (t: string) => void }} [opts]
 */
export function initDocxFormUi(opts = {}) {
  const formStatusEl = document.getElementById("form-status");
  const formMapListEl = document.getElementById("form-map-list");
  const btnRemap = document.getElementById("btn-form-remap");
  const btnDownload = document.getElementById("btn-form-download");
  const fileInput = document.getElementById("form-file");

  /** @type {null | { zip: any, doc: Document, xml: string, blanks: any[], fileName: string, mappings: any[], pathOptions: any[] }} */
  let state = null;

  function setFormStatus(text) {
    if (formStatusEl) formStatusEl.textContent = text;
    opts.setStatus?.(typeof text === "string" ? text.split("\n")[0] : text);
  }

  function escapeHtml(text) {
    return String(text ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function renderMapList() {
    if (!state?.mappings?.length) {
      formMapListEl.innerHTML = `<div class="empty-block">暂无映射</div>`;
      return;
    }

    const optionsHtml = (selectedPath) => {
      const optsList = [
        `<option value="">（不填 / 跳过）</option>`,
        ...state.pathOptions.map((p) => {
          const label = `${p.hint || p.path}${p.value ? ` = ${String(p.value).slice(0, 24)}` : ""}`;
          return `<option value="${escapeHtml(p.path)}" ${p.path === selectedPath ? "selected" : ""}>${escapeHtml(label)}</option>`;
        })
      ];
      return optsList.join("");
    };

    formMapListEl.innerHTML = state.mappings
      .map((item, index) => {
        const skipped = item.skip || !item.value;
        return `
        <div class="form-map-item ${skipped ? "skipped" : ""}" data-index="${index}">
          <div class="label">${escapeHtml(item.label)}</div>
          <div class="meta">表格位置：第 ${item.tableIndex + 1} 表 / 第 ${item.rowIndex + 1} 行</div>
          <label>简历字段
            <select data-act="path" data-index="${index}">${optionsHtml(item.path || "")}</select>
          </label>
          <div class="row-line">
            <input type="text" data-act="value" data-index="${index}" value="${escapeHtml(item.value || "")}" placeholder="填入值" />
            <label class="check" style="white-space:nowrap">
              <input type="checkbox" data-act="skip" data-index="${index}" ${item.skip ? "checked" : ""} /> 跳过
            </label>
          </div>
        </div>`;
      })
      .join("");
  }

  function syncButtons() {
    const ready = !!(state?.mappings?.length);
    btnRemap.disabled = !ready;
    btnDownload.disabled = !ready;
  }

  async function loadResumeAndSettings() {
    const data = await chrome.storage.local.get(["resume", "settings"]);
    return {
      resume: data.resume || null,
      settings: data.settings || {}
    };
  }

  async function runParseAndMap(file) {
    const { resume, settings } = await loadResumeAndSettings();
    if (!resume || !resume.basic) {
      setFormStatus("请先在「简历」页上传/保存结构化简历");
      return;
    }

    setFormStatus(`正在解析：${file.name} ...`);
    const lower = (file.name || "").toLowerCase();
    if (lower.endsWith(".doc") && !lower.endsWith(".docx")) {
      setFormStatus("暂不支持旧版 .doc，请另存为 .docx");
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const parsed = await parseDocxForm(buffer);
      setFormStatus(`解析到 ${parsed.blanks.length} 个待填项，正在匹配简历字段...`);
      const mappings = await mapBlanksToResume(parsed.blanks, resume, settings);
      const pathOptions = collectResumePaths(resume);
      state = {
        zip: parsed.zip,
        doc: parsed.doc,
        xml: parsed.xml,
        blanks: parsed.blanks,
        fileName: file.name,
        mappings,
        pathOptions
      };
      const filled = mappings.filter((m) => m.path && m.value && !m.skip).length;
      setFormStatus(
        `文件：${file.name}\n待填 ${mappings.length} 项，已匹配可填 ${filled} 项\n可改字段/值后点「下载填好的 Word」` +
          (settings.useLLM ? "\n（已启用 LLM 辅助映射）" : "\n（仅本地词典；可在设置开启 LLM 映射）")
      );
      renderMapList();
      syncButtons();
    } catch (err) {
      state = null;
      syncButtons();
      formMapListEl.innerHTML = "";
      setFormStatus(`解析失败：\n${err.message || err}`);
    }
  }

  fileInput?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await runParseAndMap(file);
  });

  formMapListEl?.addEventListener("change", (e) => {
    const el = e.target;
    if (!(el instanceof HTMLElement) || !state) return;
    const index = Number(el.dataset.index);
    const item = state.mappings[index];
    if (!item) return;
    const act = el.dataset.act;
    if (act === "path" && el instanceof HTMLSelectElement) {
      item.path = el.value;
      item.skip = !el.value;
      if (el.value) {
        chrome.storage.local.get(["resume"]).then(({ resume }) => {
          item.value = formatValueForLabel(item.label, getResumeValue(resume || {}, el.value));
          renderMapList();
        });
      } else {
        item.value = "";
        renderMapList();
      }
      return;
    }
    if (act === "skip" && el instanceof HTMLInputElement) {
      item.skip = el.checked;
      renderMapList();
    }
  });

  formMapListEl?.addEventListener("input", (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || el.dataset.act !== "value" || !state) return;
    const index = Number(el.dataset.index);
    const item = state.mappings[index];
    if (!item) return;
    item.value = el.value;
    item.skip = !el.value;
  });

  btnRemap?.addEventListener("click", async () => {
    if (!state) return;
    const { resume, settings } = await loadResumeAndSettings();
    if (!resume) {
      setFormStatus("本地没有简历数据");
      return;
    }
    setFormStatus("重新匹配中...");
    try {
      state.mappings = await mapBlanksToResume(state.blanks, resume, settings);
      state.pathOptions = collectResumePaths(resume);
      const filled = state.mappings.filter((m) => m.path && m.value && !m.skip).length;
      setFormStatus(`重新匹配完成：可填 ${filled} / ${state.mappings.length}`);
      renderMapList();
    } catch (err) {
      setFormStatus(`重新匹配失败：${err.message || err}`);
    }
  });

  btnDownload?.addEventListener("click", async () => {
    if (!state) return;
    const toWrite = state.mappings.filter((m) => !m.skip && m.value);
    if (!toWrite.length) {
      setFormStatus("没有可写入的字段，请先匹配或手动填写值");
      return;
    }
    setFormStatus(`正在生成 Word（写入 ${toWrite.length} 项）...`);
    try {
      const blob = await buildFilledDocx(
        { zip: state.zip, doc: state.doc, xml: state.xml },
        state.mappings
      );
      const base = (state.fileName || "报名表.docx").replace(/\.docx$/i, "");
      downloadBlob(blob, `${base}-已填写.docx`);
      setFormStatus(`已下载：${base}-已填写.docx\n写入 ${toWrite.length} 项`);
    } catch (err) {
      setFormStatus(`导出失败：${err.message || err}`);
    }
  });

  syncButtons();
}
