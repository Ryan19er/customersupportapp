# Stealth Admin Panel

Internal admin console for technicians to:
- review all customer conversations
- add root-cause and fix notes
- use an internal training chat channel
- version and rollback AI prompt content

## Setup

1. Copy `.env.example` to `.env.local`.
2. Fill in Supabase values and admin login credentials.
3. Run:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

### Customer app at `/` (local)

The customer Flutter app is copied into `public/` at build time. For a full local check:

```bash
cd ..   # stealth_support_app (Flutter app root)
flutter build web --release
cd admin-panel && npm run sync:public && npm run dev
```

Then `/` is the Flutter app and `/admin` is this panel.

## Vercel (single deployment)

1. In the Vercel project, set **Root Directory** to this folder: `stealth_support_app/admin-panel` (adjust if your repo layout differs — it must point at the folder that contains `package.json` for this app).
2. Add the same env vars as `.env.example` in **Project → Settings → Environment Variables** (including `SUPABASE_SERVICE_ROLE_KEY`).
3. Deploy. The build runs `npm run build:vercel`, which installs Flutter on Vercel when needed, builds the Flutter web bundle, copies it into `public/`, then runs `next build`.
4. Result: **`/`** = customer Flutter app, **`/admin`** = technician admin (login at **`/login`**).

First production deploys can take several minutes while Flutter is downloaded and the web bundle is built.

## Default Admin Credentials

Per current project request:
- username: `admin`
- password: `stealth`

Rotate these immediately for production use.

## Required Supabase Migration

Run migration:
- `../supabase/migrations/006_technician_learning_admin.sql`

This creates tables used by the admin APIs:
- `tech_notes`
- `learning_snippets`
- `product_catalog`
- `issue_patterns`
- `knowledge_documents`
- `prompt_versions`
- `training_chat_messages`
- `learning_events`
