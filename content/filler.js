(function () {
  const CA = (window.CampusAutofill = window.CampusAutofill || {});

  /**
   * @param {Array<{id:string,value:string,action:string,confidence?:number}>} instructions
   */
  async function applyFillInstructions(instructions) {
    const results = [];
    for (const item of instructions || []) {
      if (!item || item.action === "skip" || !item.value) {
        results.push({ id: item?.id, ok: false, reason: "skip" });
        continue;
      }
      if ((item.confidence ?? 1) < 0.45) {
        results.push({ id: item.id, ok: false, reason: "low_confidence" });
        continue;
      }

      const el = CA.findElementByFieldId(item.id);
      if (!el) {
        results.push({ id: item.id, ok: false, reason: "not_found" });
        continue;
      }

      try {
        const ok = await fillElement(el, item.value, item.action);
        CA.highlight(el, ok);
        results.push({ id: item.id, ok, value: item.value });
        await CA.sleep(60);
      } catch (e) {
        results.push({ id: item.id, ok: false, reason: String(e.message || e) });
      }
    }
    return results;
  }

  async function fillElement(el, value, action) {
    const act = action || CA.detectControlType(el);

    if (act === "radio" || (el.tagName === "INPUT" && el.type === "radio")) {
      const root = el.closest(".el-form-item, .ant-form-item, form, .form-item") || document;
      const target = CA.findRadioByLabel(root, value);
      if (!target) return false;
      CA.clickElement(target);
      if (target instanceof HTMLInputElement) {
        target.checked = true;
        target.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return true;
    }

    if (act === "select" || el.tagName === "SELECT" || el.getAttribute("role") === "combobox") {
      if (el.tagName === "SELECT") {
        const options = Array.from(el.options);
        const hit =
          options.find((o) => CA.cleanLabel(o.textContent) === String(value)) ||
          options.find((o) => CA.cleanLabel(o.textContent).includes(String(value)));
        if (!hit) return false;
        el.value = hit.value;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
      return CA.selectCustomOption(el, value);
    }

    if (el.isContentEditable) {
      el.focus();
      el.textContent = String(value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }

    // text / date / textarea
    el.focus();
    CA.setNativeValue(el, String(value));
    return true;
  }

  /**
   * 填充当前聚焦元素
   */
  async function fillFocusedElement(resume, mapping) {
    const el =
      document.activeElement && CA.isFillable(document.activeElement)
        ? document.activeElement
        : CA._lastClickedFillable || null;

    if (!el) {
      return { ok: false, reason: "no_focus", message: "请先点击要填写的输入框" };
    }

    if (!el.dataset.caFieldId) {
      el.dataset.caFieldId = `ca_focus_${Date.now()}`;
    }

    const label = CA.nearbyTextLabel(el);
    let value = mapping?.value || "";
    let action = mapping?.action || CA.detectControlType(el);
    let path = mapping?.path || "";

    if (!value) {
      const hit = CA.matchFieldByLabel(label);
      if (hit) {
        path = hit.path;
        value = CA.getResumeValue(resume, hit.path);
        action = hit.type === "radio" ? "radio" : hit.type === "select" ? "select" : hit.type;
      }
    }

    if (!value) {
      CA.highlight(el, false);
      return {
        ok: false,
        reason: "no_value",
        label,
        message: `未能识别「${label || "当前字段"}」对应的简历内容`
      };
    }

    const ok = await fillElement(el, value, action);
    CA.highlight(el, ok);
    showToast(ok ? `已填：${label || path} = ${value}` : `填写失败：${label}`);
    return { ok, label, path, value };
  }

  function showToast(message) {
    let box = document.getElementById("ca-toast");
    if (!box) {
      box = document.createElement("div");
      box.id = "ca-toast";
      box.className = "ca-toast";
      document.documentElement.appendChild(box);
    }
    box.textContent = message;
    box.classList.add("ca-toast-show");
    clearTimeout(box._timer);
    box._timer = setTimeout(() => box.classList.remove("ca-toast-show"), 2200);
  }

  CA.applyFillInstructions = applyFillInstructions;
  CA.fillElement = fillElement;
  CA.fillFocusedElement = fillFocusedElement;
  CA.showToast = showToast;
})();
