import { Router } from "express";
import { authRequired, loginUser, registerUser, signToken } from "../auth.js";

const router = Router();

router.post("/register", (req, res) => {
  try {
    const user = registerUser({
      email: req.body?.email,
      password: req.body?.password
    });
    const token = signToken(user);
    res.json({ ok: true, token, user });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

router.post("/login", (req, res) => {
  try {
    const user = loginUser({
      email: req.body?.email,
      password: req.body?.password
    });
    const token = signToken(user);
    res.json({ ok: true, token, user });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

router.get("/me", authRequired, (req, res) => {
  res.json({ ok: true, user: req.user });
});

export default router;
