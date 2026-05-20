# Dispatch Copilot — Claude Code Guide

## What this is
Standalone AI dispatcher tool. Chrome extension + web app.
Helps US trucking dispatchers find, score, and reach out on DAT loads
faster. Future integration with MetaSys ERP (not in scope yet).

## Stack
- **Frontend**: React 18, Vite, Tailwind CSS, Shadcn/ui, Radix UI,
  Wouter (routing), TanStack React Query v5, react-hook-form + Zod,
  Lucide React, date-fns + date-fns-tz
- **Backend**: Node.js TypeScript, Express 4, tsx (dev), esbuild (prod),
  Passport.js local strategy, express-session + connect-pg-simple,
  bcrypt, ws (WebSocket server), node-cron, Zod + drizzle-zod
- **Database**: PostgreSQL via Neon Serverless, Drizzle ORM
- **Shared**: `shared/schema.ts` — single source of truth for all tables,
  enums, Zod schemas, and TypeScript types shared between client and server

## Business rules
- **OPS_TZ = `America/New_York`**. All load times, scoring, cron jobs,
  outreach windows use this timezone. **Never UTC**, never another zone.
- `Math.ceil()` for all fee and RPM calculations.
- `org_id` on every table — required for future multi-tenancy.
- UUID primary keys everywhere (`gen_random_uuid()`).
- `external_id` on carriers for future ERP sync.
- Brand color: teal `hsl(189, 95%, 30%)`. No new colors outside Shadcn defaults.

## Database
- Connection string lives in `.env` under `DATABASE_URL`.
  Neon serverless driver — see [`server/db.ts`](server/db.ts).
- Schema is managed with **Drizzle Kit**. Apply with `npm run db:push`.
- **Never** run destructive migrations without a dry run first.
- **Never** touch `shared/schema.ts` without explicit instruction.

## Prompt standards (every Claude Code session)
- **No browser preview ever.** Verification is `tsc --noEmit` +
  `npm run build` + file read-back only.
- Single inspection pass per task.
- One feature per branch.
- Read back every modified block before committing.

## Folder structure
```
dispatch-copilot/
  client/
    src/
      components/
        ui/          # shadcn primitives
        layout/      # sidebar, header, shell
      pages/
        login.tsx
        carriers/
          index.tsx  # carrier list
          [id].tsx   # carrier detail + preferences form
      lib/
        api.ts       # typed fetch wrapper
        queryClient.ts
        ws.ts        # useWebSocket hook
      App.tsx
      main.tsx
    index.html
    vite.config.ts
    tsconfig.json
  server/
    agents/
      load-hunter/   # placeholder, week 2
    auth/
      passport.ts    # Passport local strategy
    routes/
      auth.ts        # /api/auth/*
      carriers.ts    # /api/carriers/*
    middleware/
      auth.ts        # requireAuth
    db.ts            # Drizzle client (Neon serverless)
    ws.ts            # WebSocket server + broadcast()
    index.ts         # Express app entry
  shared/
    schema.ts        # sacred — all tables, types, Zod schemas
  chrome-extension/  # placeholder, week 3
  scripts/
    import-carriers.ts
    seed-users.ts
  CLAUDE.md
  package.json
  tsconfig.json
  tailwind.config.ts
  postcss.config.js
  drizzle.config.ts
  .env.example
  .gitignore
```

## Sacred files
- [`shared/schema.ts`](shared/schema.ts) — do not modify without instruction.
- Any migration that drops columns — never run without dry run.

## Scripts
- `npm run dev` — Express + WebSocket on `:5000` (tsx watch).
- `npm run dev:client` — Vite dev server on `:3000`, proxies `/api` + `/ws`.
- `npm run build` — Vite client build into `dist/public`,
  esbuild server bundle into `dist/`.
- `npm run check` — `tsc --noEmit` over the entire repo.
- `npm run db:push` — apply schema to Neon.
- `npm run seed` — seed the 5 dispatcher accounts.
- `npm run import:carriers -- path/to/file.csv` — import carriers from CSV.

## TSC baseline
**0 errors** (greenfield — maintain zero from day one).
