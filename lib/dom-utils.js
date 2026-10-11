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
    if (el.classList.contains("el-input__inner") || el.classList.contains("ant-input")) {
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

  function detectControlType(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "textarea" || el.isContentEditable) return "textarea";
    if (tag === "select") return "select";
    if (tag === "input") {
      const type = (el.type || "text").toLowerCase();
      if (type === "radio") return "radio";
      if (type === "date" || type === "month") return "date";
      return "text";
    }
    const role = el.getAttribute("role");
    if (role === "combobox" || role === "listbox") return "select";
    if (el.className && /date|picker/i.test(el.className)) return "date";
    return "text";
  }

  function setNativeValue(el, value) {
    const proto =
      el.tagName.toLowerCase() === "textarea"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && descriptor.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function clickElement(el) {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    el.click();
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

  async function selectCustomOption(trigger, value) {
    clickElement(trigger);
    await sleep(180);
    const target = String(value).trim();
    const optionSelectors = [
      ".el-select-dropdown__item",
      ".ant-select-item-option",
      "[role='option']",
      ".el-cascader-node",
      "li"
    ];
    const roots = [
      ...document.querySelectorAll(
        ".el-select-dropdown, .ant-select-dropdown, .el-picker-panel, [role='listbox']"
      )
    ].filter(isVisible);

    const searchRoots = roots.length ? roots : [document.body];
    for (const root of searchRoots) {
      for (const sel of optionSelectors) {
        const options = root.querySelectorAll(sel);
        for (const opt of options) {
          if (!isVisible(opt)) continue;
          const text = cleanLabel(opt.textContent);
          if (!text) continue;
          if (text === target || text.includes(target) || target.includes(text)) {
            clickElement(opt);
            await sleep(80);
            return true;
          }
        }
      }
    }
    return false;
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
  CA.sleep = sleep;
  CA.highlight = highlight;
})();
