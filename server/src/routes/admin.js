import { Router } from "express";
import { adminRequired, registerUser } from "../auth.js";
import { db } from "../db.js";

const router = Router();
router.use(adminRequired);

function parseJson(text, fallback) {
  try {
    return JSON.parse(text || "null") ?? fallback;
  } catch {
    return fallback;
  }
}

function mapApp(row) {
  return {
    id: row.id,
    userId: row.user_id,
    userEmail: row.email,
    company: row.company,
    url: row.url,
    title: row.title,
    status: row.status,
    notes: row.notes,
    appliedAt: row.applied_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

router.get("/stats", (_req, res) => {
  const users = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
  const resumes = db
    .prepare("SELECT COUNT(*) AS c FROM resumes WHERE data_json != '{}' AND data_json != ''")
    .get().c;
  const applications = db.prepare("SELECT COUNT(*) AS c FROM applications").get().c;
  const withLlmKey = db
    .prepare("SELECT COUNT(*) AS c FROM llm_settings WHERE api_key != ''")
    .get().c;
  res.json({
    ok: true,
    stats: { users, resumes, applications, withLlmKey }
  });
});

router.get("/users", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT u.id, u.email, u.role, u.created_at,
              r.updated_at AS resume_updated_at,
              l.base_url, l.model, l.api_key,
              (SELECT COUNT(*) FROM applications a WHERE a.user_id = u.id) AS application_count
       FROM users u
       LEFT JOIN resumes r ON r.user_id = u.id
       LEFT JOIN llm_settings l ON l.user_id = u.id
       ORDER BY u.id DESC`
    )
    .all();
  res.json({
    ok: true,
    items: rows.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      createdAt: row.created_at,
      resumeUpdatedAt: row.resume_updated_at,
      llm: {
        baseUrl: row.base_url,
        model: row.model,
        hasApiKey: !!row.api_key
      },
      applicationCount: row.application_count
    }))
  });
});

router.post("/users", (req, res) => {
  try {
    const user = registerUser({
      email: req.body?.email,
      password: req.body?.password,
      role: req.body?.role === "admin" ? "admin" : "user"
    });
    res.status(201).json({ ok: true, user });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

router.patch("/users/:id", (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare("SELECT id, email, role FROM users WHERE id = ?").get(id);
  if (!user) {
    return res.status(404).json({ ok: false, error: "用户不存在" });
  }
  const role = req.body?.role;
  if (role !== "user" && role !== "admin") {
    return res.status(400).json({ ok: false, error: "role 只能是 user 或 admin" });
  }
  if (user.role === "admin" && role === "user") {
    const adminCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get().c;
    if (adminCount <= 1) {
      return res.status(400).json({ ok: false, error: "至少保留一名管理员" });
    }
  }
  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
  const updated = db
    .prepare("SELECT id, email, role, created_at FROM users WHERE id = ?")
    .get(id);
  res.json({ ok: true, user: updated });
});

router.delete("/users/:id", (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) {
    return res.status(400).json({ ok: false, error: "不能删除当前登录账号" });
  }
  const user = db.prepare("SELECT id, role FROM users WHERE id = ?").get(id);
  if (!user) {
    return res.status(404).json({ ok: false, error: "用户不存在" });
  }
  if (user.role === "admin") {
    const adminCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get().c;
    if (adminCount <= 1) {
      return res.status(400).json({ ok: false, error: "至少保留一名管理员" });
    }
  }
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  res.json({ ok: true });
});

router.get("/resumes", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT r.user_id, r.data_json, r.meta_json, r.updated_at, u.email
       FROM resumes r
       JOIN users u ON u.id = r.user_id
       ORDER BY datetime(r.updated_at) DESC`
    )
    .all();
  res.json({
    ok: true,
    items: rows.map((row) => {
      const resume = parseJson(row.data_json, {});
      const meta = parseJson(row.meta_json, {});
      return {
        userId: row.user_id,
        email: row.email,
        name: resume?.basic?.name || "",
        meta,
        updatedAt: row.updated_at,
        resume
      };
    })
  });
});

router.get("/resumes/:userId", (req, res) => {
  const userId = Number(req.params.userId);
  const row = db
    .prepare(
      `SELECT r.user_id, r.data_json, r.meta_json, r.updated_at, u.email
       FROM resumes r
       JOIN users u ON u.id = r.user_id
       WHERE r.user_id = ?`
    )
    .get(userId);
  if (!row) {
    return res.status(404).json({ ok: false, error: "简历不存在" });
  }
  res.json({
    ok: true,
    item: {
      userId: row.user_id,
      email: row.email,
      resume: parseJson(row.data_json, {}),
      meta: parseJson(row.meta_json, {}),
      updatedAt: row.updated_at
    }
  });
});

router.put("/resumes/:userId", (req, res) => {
  const userId = Number(req.params.userId);
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!user) {
    return res.status(404).json({ ok: false, error: "用户不存在" });
  }
  const resume = req.body?.resume;
  const meta = req.body?.meta;
  if (!resume || typeof resume !== "object") {
    return res.status(400).json({ ok: false, error: "resume 必须是对象" });
  }
  db.prepare(
    `INSERT INTO resumes (user_id, data_json, meta_json, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       data_json = excluded.data_json,
       meta_json = excluded.meta_json,
       updated_at = datetime('now')`
  ).run(userId, JSON.stringify(resume), JSON.stringify(meta && typeof meta === "object" ? meta : {}));

  const row = db
    .prepare("SELECT data_json, meta_json, updated_at FROM resumes WHERE user_id = ?")
    .get(userId);
  res.json({
    ok: true,
    item: {
      userId,
      resume: parseJson(row.data_json, {}),
      meta: parseJson(row.meta_json, {}),
      updatedAt: row.updated_at
    }
  });
});

router.get("/llm", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT l.*, u.email
       FROM llm_settings l
       JOIN users u ON u.id = l.user_id
       ORDER BY datetime(l.updated_at) DESC`
    )
    .all();
  res.json({
    ok: true,
    items: rows.map((row) => ({
      userId: row.user_id,
      email: row.email,
      baseUrl: row.base_url,
      model: row.model,
      apiKey: row.api_key,
      useLLM: !!row.use_llm,
      clickFillEnabled: row.click_fill_enabled !== 0,
      updatedAt: row.updated_at
    }))
  });
});

router.put("/llm/:userId", (req, res) => {
  const userId = Number(req.params.userId);
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!user) {
    return res.status(404).json({ ok: false, error: "用户不存在" });
  }
  const body = req.body || {};
  const baseUrl = String(body.baseUrl || "https://api.deepseek.com/v1").trim();
  const model = String(body.model || "deepseek-chat").trim();
  const apiKey = String(body.apiKey ?? "");
  const useLLM = body.useLLM ? 1 : 0;
  const clickFillEnabled = body.clickFillEnabled === false ? 0 : 1;

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
  ).run(userId, baseUrl, model, apiKey, useLLM, clickFillEnabled);

  const row = db.prepare("SELECT * FROM llm_settings WHERE user_id = ?").get(userId);
  res.json({
    ok: true,
    item: {
      userId: row.user_id,
      baseUrl: row.base_url,
      model: row.model,
      apiKey: row.api_key,
      useLLM: !!row.use_llm,
      clickFillEnabled: row.click_fill_enabled !== 0,
      updatedAt: row.updated_at
    }
  });
});

router.get("/applications", (req, res) => {
  const userId = req.query.userId ? Number(req.query.userId) : null;
  const rows = userId
    ? db
        .prepare(
          `SELECT a.*, u.email
           FROM applications a
           JOIN users u ON u.id = a.user_id
           WHERE a.user_id = ?
           ORDER BY datetime(a.applied_at) DESC, a.id DESC`
        )
        .all(userId)
    : db
        .prepare(
          `SELECT a.*, u.email
           FROM applications a
           JOIN users u ON u.id = a.user_id
           ORDER BY datetime(a.applied_at) DESC, a.id DESC`
        )
        .all();
  res.json({ ok: true, items: rows.map(mapApp) });
});

router.delete("/applications/:id", (req, res) => {
  const id = Number(req.params.id);
  const info = db.prepare("DELETE FROM applications WHERE id = ?").run(id);
  if (!info.changes) {
    return res.status(404).json({ ok: false, error: "记录不存在" });
  }
  res.json({ ok: true });
});

export default router;
