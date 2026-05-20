import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import passport from "passport";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";
import { configurePassport } from "./auth/passport.js";
import { requireAuth } from "./middleware/auth.js";
import { authRouter } from "./routes/auth.js";
import { carriersRouter } from "./routes/carriers.js";
import { attachWebSocket } from "./ws.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  throw new Error("SESSION_SECRET is not set. Copy .env.example to .env.");
}

const app = express();
const PgSession = connectPgSimple(session);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    store: new PgSession({
      pool,
      tableName: "session",
      createTableIfMissing: true,
    }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 14, // 14 days
    },
  }),
);

configurePassport();
app.use(passport.initialize());
app.use(passport.session());

// Public auth routes
app.use("/api/auth", authRouter);

// Everything else under /api requires a logged-in session
app.use("/api", requireAuth);
app.use("/api/carriers", carriersRouter);

// Static client (production build only — Vite handles dev)
if (process.env.NODE_ENV === "production") {
  const publicDir = path.resolve(__dirname, "public");
  app.use(express.static(publicDir));
  app.get(/^(?!\/api|\/ws).*/, (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });
}

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[express] unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = Number(process.env.PORT ?? 5000);
const httpServer = createServer(app);
attachWebSocket(httpServer);

httpServer.listen(PORT, () => {
  console.log(`[dispatch-copilot] listening on :${PORT}`);
});
