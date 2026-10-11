(function () {
  const CA = (window.CampusAutofill = window.CampusAutofill || {});

  let enabled = true;
  let resumeCache = null;
  let panel = null;

  async function loadResume() {
    const data = await chrome.storage.local.get(["resume", "settings"]);
    resumeCache = data.resume || CA.createEmptyResume();
    enabled = data.settings?.clickFillEnabled !== false;
    return resumeCache;
  }

  function ensurePanel() {
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "ca-click-panel";
    panel.className = "ca-click-panel";
    panel.innerHTML = `
      <div class="ca-click-panel-title">智能填充</div>
      <div class="ca-click-panel-label"></div>
      <div class="ca-click-panel-value"></div>
      <div class="ca-click-panel-actions">
        <button type="button" data-act="fill">填入</button>
        <button type="button" data-act="pick">选字段</button>
        <button type="button" data-act="close">关闭</button>
      </div>
      <div class="ca-click-panel-pick" hidden></div>
    `;
    document.documentElement.appendChild(panel);

    panel.addEventListener("mousedown", (e) => e.stopPropagation());
    panel.addEventListener("click", async (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === "close") {
        hidePanel();
        return;
      }
      if (act === "fill") {
        await CA.fillFocusedElement(resumeCache, panel._mapping);
        hidePanel();
        return;
      }
      if (act === "pick") {
        renderPickList();
      }
      if (act === "use-path") {
        const path = btn.dataset.path;
        const value = CA.getResumeValue(resumeCache, path);
        panel._mapping = {
          path,
          value,
          action: CA.detectControlType(CA._lastClickedFillable)
        };
        panel.querySelector(".ca-click-panel-value").textContent = `${path} → ${value || "(空)"}`;
        panel.querySelector(".ca-click-panel-pick").hidden = true;
      }
    });
    return panel;
  }

  function renderPickList() {
    const box = panel.querySelector(".ca-click-panel-pick");
    const entries = (CA.FIELD_DICTIONARY || []).filter((d) =>
      CA.getResumeValue(resumeCache, d.path)
    );
    box.hidden = false;
    box.innerHTML = entries
      .map(
        (d) =>
          `<button type="button" data-act="use-path" data-path="${d.path}">${d.keys[0]}：${CA.getResumeValue(
            resumeCache,
            d.path
          )}</button>`
      )
      .join("");
  }

  function hidePanel() {
    if (panel) panel.classList.remove("ca-click-panel-show");
  }

  function showPanelFor(el) {
    const p = ensurePanel();
    const label = CA.nearbyTextLabel(el);
    const hit = CA.matchFieldByLabel(label);
    const value = hit ? CA.getResumeValue(resumeCache, hit.path) : "";
    p._mapping = hit
      ? {
          path: hit.path,
          value,
          action: hit.type === "radio" ? "radio" : hit.type === "select" ? "select" : hit.type
        }
      : null;

    p.querySelector(".ca-click-panel-label").textContent = label || "未识别标签";
    p.querySelector(".ca-click-panel-value").textContent = hit
      ? `${hit.path} → ${value || "(简历中为空)"}`
      : "未匹配到字段，可点「选字段」";
    p.querySelector(".ca-click-panel-pick").hidden = true;

    const rect = el.getBoundingClientRect();
    const top = window.scrollY + rect.bottom + 8;
    const left = window.scrollX + Math.min(rect.left, window.innerWidth - 280);
    p.style.top = `${top}px`;
    p.style.left = `${Math.max(8, left)}px`;
    p.classList.add("ca-click-panel-show");
  }

  function onFocusIn(e) {
    const el = e.target;
    if (!CA.isFillable(el)) return;
    CA._lastClickedFillable = el;
  }

  async function onClick(e) {
    if (!enabled) return;
    if (e.altKey) {
      // Alt + 点击：强制弹出填充面板
      const el = e.target.closest("input, textarea, select, [contenteditable='true'], [role='combobox'], .el-input__inner, .ant-input, .ant-select-selector");
      if (!el || !CA.isFillable(el)) return;
      e.preventDefault();
      e.stopPropagation();
      CA._lastClickedFillable = el;
      el.focus();
      await loadResume();
      showPanelFor(el);
      return;
    }

    // 普通点击只记录焦点，不打断用户填写
    const el = e.target;
    if (CA.isFillable(el)) {
      CA._lastClickedFillable = el;
    }
  }

  async function fillFocusedFromHotkey() {
    await loadResume();
    return CA.fillFocusedElement(resumeCache, null);
  }

  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("click", onClick, true);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.resume) resumeCache = changes.resume.newValue;
    if (changes.settings) {
      enabled = changes.settings.newValue?.clickFillEnabled !== false;
    }
  });

  loadResume();

  CA.fillFocusedFromHotkey = fillFocusedFromHotkey;
  CA.showClickFillPanel = async () => {
    await loadResume();
    const el = document.activeElement;
    if (el && CA.isFillable(el)) showPanelFor(el);
  };
})();
