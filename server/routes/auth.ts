import { Router, type Request, type Response, type NextFunction } from "express";
import passport from "passport";
import { z } from "zod";
import type { PublicUser } from "../../shared/schema.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const authRouter = Router();

authRouter.post("/login", (req: Request, res: Response, next: NextFunction) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }
  // Normalize the email so it matches what we store
  req.body.email = parsed.data.email.toLowerCase();

  passport.authenticate(
    "local",
    (err: Error | null, user: PublicUser | false) => {
      if (err) return next(err);
      if (!user) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }
      req.logIn(user, (loginErr) => {
        if (loginErr) return next(loginErr);
        res.json({ user });
      });
    },
  )(req, res, next);
});

authRouter.post("/logout", (req: Request, res: Response, next: NextFunction) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy((destroyErr) => {
      if (destroyErr) return next(destroyErr);
      res.clearCookie("connect.sid");
      res.json({ ok: true });
    });
  });
});

authRouter.get("/me", (req: Request, res: Response) => {
  if (req.isAuthenticated() && req.user) {
    res.json({ user: req.user });
    return;
  }
  res.status(401).json({ error: "Unauthorized" });
});
