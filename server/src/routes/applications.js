import { Router } from "express";
import { authRequired } from "../auth.js";
import { db } from "../db.js";

const router = Router();

function mapApp(row) {
  return {
    id: row.id,
    userId: row.user_id,
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

router.get("/", authRequired, (req, res) => {
  const rows = db
    .prepare(
      `SELECT * FROM applications
       WHERE user_id = ?
       ORDER BY datetime(applied_at) DESC, id DESC`
    )
    .all(req.user.id);
  res.json({ ok: true, items: rows.map(mapApp) });
});

router.post("/", authRequired, (req, res) => {
  const body = req.body || {};
  const company = String(body.company || "").trim();
  const url = String(body.url || "").trim();
  const title = String(body.title || "").trim();
  const status = String(body.status || "applied").trim() || "applied";
  const notes = String(body.notes || "").trim();
  const appliedAt = body.appliedAt || new Date().toISOString();

  if (!url && !company && !title) {
    return res.status(400).json({ ok: false, error: "至少填写公司、网址或职位名之一" });
  }

  const info = db
    .prepare(
      `INSERT INTO applications
        (user_id, company, url, title, status, notes, applied_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .run(req.user.id, company, url, title, status, notes, appliedAt);

  const row = db.prepare("SELECT * FROM applications WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json({ ok: true, item: mapApp(row) });
});

router.put("/:id", authRequired, (req, res) => {
  const id = Number(req.params.id);
  const existing = db
    .prepare("SELECT * FROM applications WHERE id = ? AND user_id = ?")
    .get(id, req.user.id);
  if (!existing) {
    return res.status(404).json({ ok: false, error: "记录不存在" });
  }

  const body = req.body || {};
  const company = body.company !== undefined ? String(body.company).trim() : existing.company;
  const url = body.url !== undefined ? String(body.url).trim() : existing.url;
  const title = body.title !== undefined ? String(body.title).trim() : existing.title;
  const status = body.status !== undefined ? String(body.status).trim() : existing.status;
  const notes = body.notes !== undefined ? String(body.notes).trim() : existing.notes;
  const appliedAt = body.appliedAt !== undefined ? body.appliedAt : existing.applied_at;

  db.prepare(
    `UPDATE applications
     SET company = ?, url = ?, title = ?, status = ?, notes = ?, applied_at = ?, updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`
  ).run(company, url, title, status, notes, appliedAt, id, req.user.id);

  const row = db.prepare("SELECT * FROM applications WHERE id = ?").get(id);
  res.json({ ok: true, item: mapApp(row) });
});

router.delete("/:id", authRequired, (req, res) => {
  const id = Number(req.params.id);
  const info = db
    .prepare("DELETE FROM applications WHERE id = ? AND user_id = ?")
    .run(id, req.user.id);
  if (!info.changes) {
    return res.status(404).json({ ok: false, error: "记录不存在" });
  }
  res.json({ ok: true });
});

export default router;
