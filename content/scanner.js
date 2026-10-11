(function () {
  const CA = (window.CampusAutofill = window.CampusAutofill || {});

  function collectOptions(el) {
    if (el.tagName.toLowerCase() === "select") {
      return Array.from(el.options)
        .map((o) => CA.cleanLabel(o.textContent || o.value))
        .filter(Boolean);
    }
    return [];
  }

  /**
   * 扫描页面可填字段
   * @returns {Array<{id:string,label:string,type:string,options:string[]}>}
   */
  function scanPageFields() {
    const selectors = [
      "input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='file']):not([type='checkbox'])",
      "textarea",
      "select",
      "[contenteditable='true']",
      "[role='combobox']",
      ".el-input__inner",
      ".ant-input",
      ".ant-select-selector"
    ];

    const seen = new Set();
    const fields = [];
    let idx = 0;

    for (const sel of selectors) {
      const nodes = document.querySelectorAll(sel);
      for (const el of nodes) {
        if (!CA.isFillable(el)) continue;
        if (seen.has(el)) continue;
        // 跳过 radio，后面按组处理 label 关联的单项
        if (el.tagName === "INPUT" && el.type === "radio") continue;

        seen.add(el);
        if (!el.dataset.caFieldId) {
          el.dataset.caFieldId = `ca_${Date.now()}_${idx++}`;
        }
        const label = CA.nearbyTextLabel(el);
        if (!label) continue;

        fields.push({
          id: el.dataset.caFieldId,
          label,
          type: CA.detectControlType(el),
          options: collectOptions(el)
        });
      }
    }

    // 性别等 radio 组：按最近 label 聚合
    const radios = document.querySelectorAll('input[type="radio"]');
    const radioGroups = new Map();
    for (const radio of radios) {
      if (!CA.isVisible(radio)) continue;
      const name = radio.name || CA.nearbyTextLabel(radio) || radio.id;
      if (!radioGroups.has(name)) radioGroups.set(name, []);
      radioGroups.get(name).push(radio);
    }
    for (const [, group] of radioGroups) {
      const sample = group[0];
      const label = CA.nearbyTextLabel(sample) || CA.cleanLabel(sample.name);
      if (!label) continue;
      if (!sample.dataset.caFieldId) {
        sample.dataset.caFieldId = `ca_${Date.now()}_${idx++}`;
      }
      // 组 id 挂在第一个 radio
      fields.push({
        id: sample.dataset.caFieldId,
        label,
        type: "radio",
        options: group.map((r) => CA.cleanLabel(r.value || r.parentElement?.textContent)).filter(Boolean)
      });
    }

    return fields;
  }

  function findElementByFieldId(id) {
    return document.querySelector(`[data-ca-field-id="${CSS.escape(id)}"]`);
  }

  CA.scanPageFields = scanPageFields;
  CA.findElementByFieldId = findElementByFieldId;
})();
