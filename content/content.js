(function () {
  const CA = window.CampusAutofill;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    handleMessage(message)
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  });

  async function handleMessage(message) {
    switch (message?.type) {
      case "PING":
        return { ok: true, href: location.href };

      case "SCAN_FIELDS": {
        const fields = CA.scanPageFields();
        return { ok: true, fields, count: fields.length };
      }

      case "FILL_BASIC": {
        const fields = CA.scanPageFields();
        const instructions = message.instructions;
        if (!instructions?.length) {
          // 本地规则
          const resume = message.resume;
          const local = fields.map((f) => {
            const hit = CA.matchFieldByLabel(f.label);
            if (!hit) return { id: f.id, action: "skip", value: "", confidence: 0 };
            const value = CA.getResumeValue(resume, hit.path);
            if (!value) return { id: f.id, path: hit.path, action: "skip", value: "", confidence: 0.2 };
            const action =
              hit.type === "radio" ? "radio" : hit.type === "select" ? "select" : hit.type === "date" ? "date" : "type";
            return { id: f.id, path: hit.path, value, action, confidence: 0.85 };
          });
          const results = await CA.applyFillInstructions(local);
          CA.showToast(`已尝试填写 ${results.filter((r) => r.ok).length}/${results.length} 项`);
          return { ok: true, fields, results, mode: "local" };
        }
        const results = await CA.applyFillInstructions(instructions);
        CA.showToast(`已尝试填写 ${results.filter((r) => r.ok).length}/${results.length} 项`);
        return { ok: true, fields, results, mode: "llm" };
      }

      case "FILL_FOCUSED": {
        const result = await CA.fillFocusedFromHotkey();
        return { ok: !!result.ok, ...result };
      }

      case "SHOW_CLICK_PANEL": {
        await CA.showClickFillPanel();
        return { ok: true };
      }

      default:
        return { ok: false, error: "unknown_message" };
    }
  }

  console.info("[校招自动填写] content script ready");
})();
