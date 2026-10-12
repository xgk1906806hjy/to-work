import { Router } from "express";
import { authRequired } from "../auth.js";
import { db } from "../db.js";

const router = Router();

function parseJson(text, fallback) {
  try {
    return JSON.parse(text || "null") ?? fallback;
  } catch {
    return fallback;
  }
}

router.get("/", authRequired, (req, res) => {
  const row = db
    .prepare("SELECT data_json, meta_json, updated_at FROM resumes WHERE user_id = ?")
    .get(req.user.id);
  res.json({
    ok: true,
    resume: parseJson(row?.data_json, {}),
    meta: parseJson(row?.meta_json, {}),
    updatedAt: row?.updated_at || null
  });
});

router.put("/", authRequired, (req, res) => {
  const resume = req.body?.resume;
  const meta = req.body?.meta;
  if (!resume || typeof resume !== "object") {
    return res.status(400).json({ ok: false, error: "resume 必须是对象" });
  }
  const metaJson = JSON.stringify(meta && typeof meta === "object" ? meta : {});
  db.prepare(
    `INSERT INTO resumes (user_id, data_json, meta_json, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       data_json = excluded.data_json,
       meta_json = excluded.meta_json,
       updated_at = datetime('now')`
  ).run(req.user.id, JSON.stringify(resume), metaJson);

  const row = db
    .prepare("SELECT data_json, meta_json, updated_at FROM resumes WHERE user_id = ?")
    .get(req.user.id);
  res.json({
    ok: true,
    resume: parseJson(row.data_json, {}),
    meta: parseJson(row.meta_json, {}),
    updatedAt: row.updated_at
  });
});

export default router;
