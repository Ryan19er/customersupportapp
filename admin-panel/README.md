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

**Stealth Development** team on Vercel, project name **`customersupportapp`**. In the CLI, the team appears as **Team Stealth** with slug **`team-stealth-fed896d2`**.

Work inside **`admin-panel`** for CLI commands (this folder is linked to the project; Vercel **Root Directory** is `admin-panel`, with **source outside root** enabled so Flutter can build from the parent repo).

### One-time: login and link

```bash
cd admin-panel
npm install
npx vercel login
npx vercel link --yes --scope team-stealth-fed896d2 --project customersupportapp
```

### Apply / re-apply project settings (CLI + API)

This updates the Vercel project to **Next.js**, **Root Directory `admin-panel`**, and the correct build/install commands (same as `vercel.json`):

```bash
cd admin-panel
npm run vercel:configure
```

Uses `vercel api … PATCH` with `scripts/vercel-patch-project.json`. Run again after creating a new Vercel project if needed.

### Environment variables

Either in the [Vercel dashboard](https://vercel.com) (Project → Settings → Environment Variables) or with the CLI:

```bash
npx vercel env add SUPABASE_URL
# repeat for SUPABASE_SERVICE_ROLE_KEY, ADMIN_USERNAME, ADMIN_PASSWORD, etc.
```

Pull preview env into a local file (optional):

```bash
npm run vercel:env
```

Match the keys in `.env.example`.

### Deploy (CLI)

```bash
npm run vercel:prod
```

Or `npm run vercel:deploy` for a preview deployment.

### GitHub → auto deploy (recommended)

In the Vercel project **customersupportapp**, connect GitHub **`Ryan19er/customersupportapp`**, branch **`main`**, and set **Root Directory** to **`admin-panel`** (relative to the repo root where `pubspec.yaml` lives). Every push to `main` runs `npm run build:vercel` in that folder. See the main repo `README.md` for the checklist.

### URLs after deploy

- **`/`** — customer Flutter app  
- **`/login`** — admin login  
- **`/admin`** — technician admin  

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
