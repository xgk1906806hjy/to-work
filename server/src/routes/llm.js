import { Router } from "express";
import { authRequired } from "../auth.js";
import { db } from "../db.js";

const router = Router();

function rowToSettings(row) {
  if (!row) {
    return {
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      apiKey: "",
      useLLM: false,
      clickFillEnabled: true
    };
  }
  return {
    baseUrl: row.base_url,
    model: row.model,
    apiKey: row.api_key,
    useLLM: !!row.use_llm,
    clickFillEnabled: row.click_fill_enabled !== 0,
    updatedAt: row.updated_at
  };
}

router.get("/", authRequired, (req, res) => {
  const row = db.prepare("SELECT * FROM llm_settings WHERE user_id = ?").get(req.user.id);
  res.json({ ok: true, settings: rowToSettings(row) });
});

router.put("/", authRequired, (req, res) => {
  const body = req.body || {};
  const baseUrl = String(body.baseUrl || body.base_url || "https://api.deepseek.com/v1").trim();
  const model = String(body.model || "deepseek-chat").trim();
  const apiKey = String(body.apiKey ?? body.api_key ?? "");
  const useLLM = body.useLLM ?? body.use_llm ? 1 : 0;
  const clickFillEnabled =
    body.clickFillEnabled === undefined && body.click_fill_enabled === undefined
      ? 1
      : body.clickFillEnabled ?? body.click_fill_enabled
        ? 1
        : 0;

  db.prepare(
    `INSERT INTO llm_settings
      (user_id, base_url, model, api_key, use_llm, click_fill_enabled, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       base_url = excluded.base_url,
       model = excluded.model,
       api_key = excluded.api_key,
       use_llm = excluded.use_llm,
       click_fill_enabled = excluded.click_fill_enabled,
       updated_at = datetime('now')`
  ).run(req.user.id, baseUrl, model, apiKey, useLLM, clickFillEnabled);

  const row = db.prepare("SELECT * FROM llm_settings WHERE user_id = ?").get(req.user.id);
  res.json({ ok: true, settings: rowToSettings(row) });
});

export default router;
