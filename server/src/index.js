import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initDb } from "./db.js";
import authRoutes from "./routes/auth.js";
import resumeRoutes from "./routes/resume.js";
import llmRoutes from "./routes/llm.js";
import applicationRoutes from "./routes/applications.js";
import adminRoutes from "./routes/admin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3789);

initDb();

const app = express();
app.use(cors());
app.use(express.json({ limit: "4mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "to-work-server" });
});

app.use("/api/auth", authRoutes);
app.use("/api/resume", resumeRoutes);
app.use("/api/llm", llmRoutes);
app.use("/api/applications", applicationRoutes);
app.use("/api/admin", adminRoutes);

app.use(express.static(path.join(__dirname, "..", "public")));

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: err.message || "服务器错误" });
});

app.listen(PORT, () => {
  console.log(`[to-work-server] http://127.0.0.1:${PORT}`);
  console.log(`[to-work-server] admin UI  http://127.0.0.1:${PORT}/`);
  console.log(`[to-work-server] default admin: admin@local / admin123`);
});
