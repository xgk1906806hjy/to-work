import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { db } from "./db.js";

const JWT_SECRET = process.env.JWT_SECRET || "to-work-dev-secret-change-me";
const TOKEN_TTL = process.env.TOKEN_TTL || "7d";

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

export function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    return res.status(401).json({ ok: false, error: "未登录" });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db
      .prepare("SELECT id, email, role, created_at FROM users WHERE id = ?")
      .get(payload.sub);
    if (!user) {
      return res.status(401).json({ ok: false, error: "用户不存在" });
    }
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ ok: false, error: "登录已失效" });
  }
}

export function adminRequired(req, res, next) {
  authRequired(req, res, () => {
    if (req.user.role !== "admin") {
      return res.status(403).json({ ok: false, error: "需要管理员权限" });
    }
    next();
  });
}

export function registerUser({ email, password, role = "user" }) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) {
    throw new Error("请输入有效邮箱");
  }
  if (!password || String(password).length < 6) {
    throw new Error("密码至少 6 位");
  }
  const hash = bcrypt.hashSync(String(password), 10);
  try {
    const info = db
      .prepare("INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)")
      .run(normalized, hash, role === "admin" ? "admin" : "user");
    const userId = info.lastInsertRowid;
    db.prepare("INSERT INTO resumes (user_id) VALUES (?)").run(userId);
    db.prepare("INSERT INTO llm_settings (user_id) VALUES (?)").run(userId);
    return db
      .prepare("SELECT id, email, role, created_at FROM users WHERE id = ?")
      .get(userId);
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      throw new Error("该邮箱已注册");
    }
    throw err;
  }
}

export function loginUser({ email, password }) {
  const normalized = String(email || "").trim().toLowerCase();
  const user = db
    .prepare("SELECT id, email, role, password_hash, created_at FROM users WHERE email = ?")
    .get(normalized);
  if (!user || !bcrypt.compareSync(String(password || ""), user.password_hash)) {
    throw new Error("邮箱或密码错误");
  }
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    created_at: user.created_at
  };
}
