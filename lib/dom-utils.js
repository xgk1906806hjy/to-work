(function () {
  const CA = (window.CampusAutofill = window.CampusAutofill || {});

  function isVisible(el) {
    if (!(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isFillable(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (el.disabled || el.getAttribute("aria-disabled") === "true") return false;
    if (el.readOnly) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === "textarea") return isVisible(el);
    if (tag === "select") return isVisible(el);
    if (tag === "input") {
      const type = (el.type || "text").toLowerCase();
      if (["hidden", "submit", "button", "file", "image", "reset", "checkbox"].includes(type)) {
        return false;
      }
      return isVisible(el);
    }
    if (el.isContentEditable) return isVisible(el);
    // Ant Design / Element 等自定义控件常落在带 role 的容器上
    const role = el.getAttribute("role");
    if (role === "combobox" || role === "textbox" || role === "listbox") return isVisible(el);
    if (
      el.classList.contains("el-input__inner") ||
      el.classList.contains("ant-input") ||
      el.classList.contains("el-select") ||
      el.classList.contains("el-date-editor") ||
      el.classList.contains("ant-select-selector") ||
      el.classList.contains("ant-picker")
    ) {
      return isVisible(el);
    }
    return false;
  }

  function cleanLabel(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .replace(/[*:：]/g, "")
      .replace(/必填/g, "")
      .trim();
  }

  function labelFromFor(el) {
    if (!el.id) return "";
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    return label ? cleanLabel(label.textContent) : "";
  }

  function labelFromParent(el) {
    let node = el.parentElement;
    for (let i = 0; i < 6 && node; i++) {
      const formItemLabel = node.querySelector(
        ".el-form-item__label, .ant-form-item-label, .form-label, label, .label"
      );
      if (formItemLabel && !formItemLabel.contains(el)) {
        const t = cleanLabel(formItemLabel.textContent);
        if (t && t.length <= 20) return t;
      }
      const prev = node.previousElementSibling;
      if (prev) {
        const t = cleanLabel(prev.textContent);
        if (t && t.length > 0 && t.length <= 16) return t;
      }
      node = node.parentElement;
    }
    return "";
  }

  function nearbyTextLabel(el) {
    const aria = el.getAttribute("aria-label");
    if (aria) return cleanLabel(aria);

    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const parts = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((n) => cleanLabel(n.textContent))
        .filter(Boolean);
      if (parts.length) return parts.join(" ");
    }

    return labelFromFor(el) || labelFromParent(el) || cleanLabel(el.placeholder) || cleanLabel(el.title);
  }

  function closestWidget(el, selectors) {
    if (!(el instanceof Element)) return null;
    for (const sel of selectors) {
      const hit = el.closest(sel);
      if (hit) return hit;
    }
    return null;
  }

  function detectControlType(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "textarea" || el.isContentEditable) return "textarea";
    if (tag === "select") return "select";
    if (tag === "input") {
      const type = (el.type || "text").toLowerCase();
      if (type === "radio") return "radio";
      if (type === "date" || type === "month") return "date";
    }

    const dateWrap = closestWidget(el, [
      ".el-date-editor",
      ".el-date-picker",
      ".ant-picker",
      ".ant-calendar-picker"
    ]);
    if (dateWrap || (el.className && /date|picker|calendar/i.test(String(el.className)))) {
      return "date";
    }

    const selectWrap = closestWidget(el, [
      ".el-select",
      ".el-cascader",
      ".ant-select",
      ".ant-cascader-picker"
    ]);
    const role = el.getAttribute("role");
    if (
      selectWrap ||
      role === "combobox" ||
      role === "listbox" ||
      el.classList?.contains("ant-select-selector")
    ) {
      return "select";
    }
    if (tag === "input") return "text";
    return "text";
  }

  function setNativeValue(el, value) {
    const tag = el.tagName.toLowerCase();
    const proto =
      tag === "textarea"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && descriptor.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(value) }));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function clickElement(el) {
    if (!el) return;
    el.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true, view: window })
    );
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    if (typeof el.click === "function") el.click();
  }

  function findRadioByLabel(groupRoot, value) {
    const radios = (groupRoot || document).querySelectorAll('input[type="radio"]');
    const target = String(value).trim();
    for (const radio of radios) {
      const lab = nearbyTextLabel(radio) || cleanLabel(radio.value) || cleanLabel(radio.parentElement?.textContent);
      if (lab.includes(target) || target.includes(lab) || radio.value === target) {
        return radio;
      }
    }
    // Element/Ant 常用 span 伪装
    const candidates = (groupRoot || document).querySelectorAll(
      ".el-radio, .ant-radio-wrapper, label"
    );
    for (const node of candidates) {
      const t = cleanLabel(node.textContent);
      if (t === target || t.includes(target)) return node;
    }
    return null;
  }

  function parseDateParts(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    let m = raw.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
    if (m) {
      return {
        y: Number(m[1]),
        mo: Number(m[2]),
        d: Number(m[3])
      };
    }
    m = raw.match(/^(\d{4})[-/.年](\d{1,2})月?$/);
    if (m) {
      return { y: Number(m[1]), mo: Number(m[2]), d: 1 };
    }
    return null;
  }

  function formatDateVariants(value) {
    const parts = parseDateParts(value);
    const raw = String(value || "").trim();
    if (!parts) return raw ? [raw] : [];
    const y = String(parts.y);
    const mo = String(parts.mo).padStart(2, "0");
    const d = String(parts.d).padStart(2, "0");
    const moN = String(parts.mo);
    const dN = String(parts.d);
    return [
      `${y}-${mo}-${d}`,
      `${y}/${mo}/${d}`,
      `${y}.${mo}.${d}`,
      `${y}年${mo}月${d}日`,
      `${y}年${moN}月${dN}日`,
      `${y}-${mo}`,
      `${y}/${mo}`,
      `${mo}-${d}`,
      raw
    ];
  }

  function resolveSelectTrigger(el) {
    return (
      closestWidget(el, [".el-select", ".el-cascader", ".ant-select", ".ant-cascader-picker"]) ||
      el.closest("[role='combobox']") ||
      el
    );
  }

  function resolveDateTrigger(el) {
    return (
      closestWidget(el, [
        ".el-date-editor",
        ".el-date-picker",
        ".ant-picker",
        ".ant-calendar-picker"
      ]) || el
    );
  }

  function resolveEditableInput(el) {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el;
    return (
      el.querySelector?.("input.el-input__inner, input.ant-input, input.ant-picker-input > input, input") ||
      null
    );
  }

  function optionTextMatch(optionText, target) {
    const a = cleanLabel(optionText);
    const b = cleanLabel(target);
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.includes(b) || b.includes(a)) return true;
    // 忽略括号备注：中国大陆（含港澳台）
    const aCore = a.replace(/[（(].*?[）)]/g, "").trim();
    const bCore = b.replace(/[（(].*?[）)]/g, "").trim();
    return !!(aCore && bCore && (aCore === bCore || aCore.includes(bCore) || bCore.includes(aCore)));
  }

  async function selectCustomOption(trigger, value) {
    const rootTrigger = resolveSelectTrigger(trigger);
    const input = resolveEditableInput(rootTrigger) || trigger;
    clickElement(rootTrigger);
    await sleep(220);
    if (input && input !== rootTrigger) {
      try {
        input.focus();
      } catch {
        /* ignore */
      }
    }

    const target = String(value).trim();
    const filterInput =
      document.querySelector(
        ".el-select-dropdown .el-input__inner, .ant-select-dropdown input, .el-select__input, input.el-select__input"
      ) || (input instanceof HTMLInputElement ? input : null);
    if (filterInput && !filterInput.readOnly) {
      setNativeValue(filterInput, target);
      await sleep(160);
    }

    const optionSelectors = [
      ".el-select-dropdown__item:not(.is-disabled)",
      ".el-select-dropdown__item",
      ".ant-select-item-option:not(.ant-select-item-option-disabled)",
      ".ant-select-item-option",
      "[role='option']",
      ".el-cascader-node",
      ".el-select-dropdown li",
      ".ant-select-item"
    ];
    const roots = [
      ...document.querySelectorAll(
        ".el-select-dropdown:not([style*='display: none']), .ant-select-dropdown, .el-cascader__dropdown, [role='listbox']"
      )
    ].filter(isVisible);

    const searchRoots = roots.length ? roots : [document.body];
    for (const root of searchRoots) {
      for (const sel of optionSelectors) {
        const options = root.querySelectorAll(sel);
        for (const opt of options) {
          if (!isVisible(opt)) continue;
          if (opt.classList?.contains("is-disabled")) continue;
          const text = cleanLabel(opt.textContent);
          if (!text) continue;
          if (optionTextMatch(text, target)) {
            clickElement(opt);
            await sleep(100);
            return true;
          }
        }
      }
    }

    // 关闭可能打开的下拉，避免挡页面
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return false;
  }

  function getVisibleDatePanel() {
    const panels = [
      ...document.querySelectorAll(
        ".el-picker-panel, .el-date-picker, .el-picker__popper, .el-popper, .ant-picker-dropdown, .ant-calendar"
      )
    ].filter((p) => {
      if (!isVisible(p)) return false;
      return !!(
        p.querySelector(
          ".el-date-table, .el-year-table, .el-month-table, .el-date-picker__header, .ant-picker-body, .ant-picker-content"
        ) || /年|月|今天|Today/i.test(p.textContent || "")
      );
    });
    return panels[panels.length - 1] || null;
  }

  function getPickerIconButtons(panel) {
    const btns = [...panel.querySelectorAll("button.el-picker-panel__icon-btn, .el-picker-panel__icon-btn, .ant-picker-header button")];
    // Element：通常顺序 上年、上月、下月、下年；或带 d-arrow / arrow class
    const prevYear =
      btns.find((b) => /d-arrow-left|super-prev|前一年/i.test(b.className + b.getAttribute("aria-label") + b.title)) ||
      btns[0];
    const prevMonth =
      btns.find((b) => /arrow-left|prev-btn|前一月/i.test(b.className + b.getAttribute("aria-label") + b.title) && b !== prevYear) ||
      btns[1];
    const nextMonth =
      btns.find((b) => /arrow-right|next-btn|后一月/i.test(b.className + b.getAttribute("aria-label") + b.title) && !/d-arrow|super/i.test(b.className)) ||
      btns[btns.length - 2];
    const nextYear =
      btns.find((b) => /d-arrow-right|super-next|后一年/i.test(b.className + b.getAttribute("aria-label") + b.title)) ||
      btns[btns.length - 1];
    return { prevYear, prevMonth, nextMonth, nextYear };
  }

  async function pickFromYearTable(panel, y) {
    for (let page = 0; page < 12; page++) {
      const cells = panel.querySelectorAll(".el-year-table td .cell, .el-year-table td a, .el-year-table td, .ant-picker-cell-in-view");
      for (const cell of cells) {
        if (!isVisible(cell)) continue;
        const t = cleanLabel(cell.textContent);
        if (t === String(y) || t.includes(String(y))) {
          const td = cell.closest("td, .ant-picker-cell") || cell;
          if (td.classList?.contains("disabled") || td.classList?.contains("ant-picker-cell-disabled")) continue;
          clickElement(cell);
          await sleep(120);
          return true;
        }
      }
      const { prevYear, nextYear } = getPickerIconButtons(panel);
      const texts = [...cells].map((c) => Number(cleanLabel(c.textContent))).filter((n) => n > 1900);
      const minY = Math.min(...texts, y);
      const maxY = Math.max(...texts, y);
      if (y < minY && prevYear) clickElement(prevYear);
      else if (y > maxY && nextYear) clickElement(nextYear);
      else break;
      await sleep(100);
    }
    return false;
  }

  async function pickFromMonthTable(panel, mo) {
    const labels = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
    const targets = new Set([
      String(mo),
      String(mo).padStart(2, "0"),
      `${mo}月`,
      labels[mo - 1],
      labels[mo - 1]?.replace("月", "")
    ]);
    const cells = panel.querySelectorAll(
      ".el-month-table td .cell, .el-month-table td a, .el-month-table td, .ant-picker-cell-in-view .ant-picker-cell-inner"
    );
    for (const cell of cells) {
      if (!isVisible(cell)) continue;
      const t = cleanLabel(cell.textContent);
      if ([...targets].some((x) => x && (t === x || t.includes(x)))) {
        clickElement(cell);
        await sleep(120);
        return true;
      }
    }
    return false;
  }

  async function navigatePickerToYearMonth(panel, y, mo) {
    // Element：点「年」「月」标题，比连点箭头快（生日常跨二三十年）
    const labels = [...panel.querySelectorAll(".el-date-picker__header-label, .el-picker-panel__link-btn")];
    const yearLabel = labels.find((n) => /年|\d{4}/.test(n.textContent || "")) || labels[0];
    const monthLabel = labels.find((n) => /月/.test(n.textContent || "")) || labels[1];

    if (yearLabel) {
      clickElement(yearLabel);
      await sleep(150);
      let live = getVisibleDatePanel() || panel;
      if (await pickFromYearTable(live, y)) {
        await sleep(120);
        live = getVisibleDatePanel() || panel;
        // 选完年后常进入月份表；否则再点月标题
        if (!(await pickFromMonthTable(live, mo)) && monthLabel) {
          clickElement(monthLabel);
          await sleep(120);
          live = getVisibleDatePanel() || panel;
          await pickFromMonthTable(live, mo);
        }
        return true;
      }
    }

    // 回退：双箭头按年翻（最多 40 年）
    for (let i = 0; i < 48; i++) {
      const live = getVisibleDatePanel() || panel;
      const headerText = cleanLabel(
        (live.querySelector(".el-date-picker__header, .ant-picker-header-view") || live).textContent
      );
      const yearHit = headerText.includes(String(y));
      const monthHit =
        headerText.includes(`${mo}月`) ||
        new RegExp(`${y}\\D+0?${mo}(\\D|$)`).test(headerText);
      if (yearHit && monthHit) return true;

      const { prevYear, nextYear, prevMonth, nextMonth } = getPickerIconButtons(live);
      const nowYMatch = headerText.match(/(20\d{2}|19\d{2})/);
      const nowY = nowYMatch ? Number(nowYMatch[1]) : y;
      const nowMMatch = headerText.match(/(\d{1,2})\s*月/);
      const nowM = nowMMatch ? Number(nowMMatch[1]) : mo;

      if (nowY > y && prevYear) clickElement(prevYear);
      else if (nowY < y && nextYear) clickElement(nextYear);
      else if (nowY === y && nowM > mo && prevMonth) clickElement(prevMonth);
      else if (nowY === y && nowM < mo && nextMonth) clickElement(nextMonth);
      else if (prevYear) clickElement(prevYear);
      else break;
      await sleep(70);
    }
    return false;
  }

  async function clickDayInPanel(panel, day) {
    const dayText = String(day);
    const dayPad = String(day).padStart(2, "0");
    const cells = panel.querySelectorAll(
      ".el-date-table td.available, .el-date-table td:not(.disabled), .ant-picker-cell-in-view:not(.ant-picker-cell-disabled)"
    );
    for (const td of cells) {
      if (!isVisible(td)) continue;
      if (td.classList.contains("prev-month") || td.classList.contains("next-month")) continue;
      if (td.classList.contains("ant-picker-cell") && !td.classList.contains("ant-picker-cell-in-view")) {
        continue;
      }
      const t = cleanLabel(td.textContent);
      // 单元格文本通常就是“5”或“05”，避免整表文本干扰
      const span = td.querySelector("span, div, .ant-picker-cell-inner") || td;
      const st = cleanLabel(span.textContent);
      if (st === dayText || st === dayPad || t === dayText || t === dayPad) {
        clickElement(span);
        await sleep(120);
        return true;
      }
    }
    return false;
  }

  async function tryWriteDateInput(input, variants) {
    if (!input) return false;
    const wasReadonly = input.hasAttribute("readonly") || input.readOnly;
    if (wasReadonly) {
      input.removeAttribute("readonly");
      try {
        Object.defineProperty(input, "readOnly", { configurable: true, get: () => false });
      } catch {
        /* ignore */
      }
    }
    input.focus();
    for (const v of variants.slice(0, 5)) {
      setNativeValue(input, v);
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(60);
      const cur = cleanLabel(input.value);
      if (cur && cur !== "请选择日期" && /\d{4}/.test(cur)) {
        input.blur();
        return true;
      }
    }
    if (wasReadonly) input.setAttribute("readonly", "readonly");
    return false;
  }

  async function fillDatePicker(el, value) {
    const variants = formatDateVariants(value);
    const parts = parseDateParts(value);
    const wrap = resolveDateTrigger(el);
    const input = resolveEditableInput(wrap) || (el instanceof HTMLInputElement ? el : null);

    // 1) 尝试直接写入（含临时去掉 readonly，适配京东等 Element 站）
    if (await tryWriteDateInput(input, variants)) return true;

    // 2) 打开面板：年 → 月 → 日
    clickElement(input || wrap);
    await sleep(250);
    let panel = getVisibleDatePanel();
    if (!panel) {
      clickElement(wrap);
      await sleep(250);
      panel = getVisibleDatePanel();
    }
    if (!panel || !parts) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return !!(input && cleanLabel(input.value) && /\d{4}/.test(input.value));
    }

    await navigatePickerToYearMonth(panel, parts.y, parts.mo);
    await sleep(100);
    panel = getVisibleDatePanel() || panel;
    const ok = await clickDayInPanel(panel, parts.d);
    if (ok) return true;

    // 再给一次箭头导航后点日
    await navigatePickerToYearMonth(panel, parts.y, parts.mo);
    panel = getVisibleDatePanel() || panel;
    if (await clickDayInPanel(panel, parts.d)) return true;

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return !!(input && cleanLabel(input.value) && /\d{4}/.test(input.value));
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function highlight(el, ok = true) {
    if (!el) return;
    const prev = el.style.outline;
    el.style.outline = ok ? "2px solid #1677ff" : "2px solid #ff4d4f";
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setTimeout(() => {
      el.style.outline = prev;
    }, 1600);
  }

  CA.isVisible = isVisible;
  CA.isFillable = isFillable;
  CA.cleanLabel = cleanLabel;
  CA.nearbyTextLabel = nearbyTextLabel;
  CA.detectControlType = detectControlType;
  CA.setNativeValue = setNativeValue;
  CA.clickElement = clickElement;
  CA.findRadioByLabel = findRadioByLabel;
  CA.selectCustomOption = selectCustomOption;
  CA.fillDatePicker = fillDatePicker;
  CA.formatDateVariants = formatDateVariants;
  CA.resolveSelectTrigger = resolveSelectTrigger;
  CA.resolveDateTrigger = resolveDateTrigger;
  CA.sleep = sleep;
  CA.highlight = highlight;
})();
