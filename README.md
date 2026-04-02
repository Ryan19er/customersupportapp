# Stealth Support (Flutter)

Bulletin-scope app: **AI-led onboarding** (no login-first gate), **Claude** chat, **Guides**, **Tickets**, **Training & safety**, **Account** (roles + employee ID). Backend: **Supabase** (auth, profiles, chat, tickets).

## Setup

1. **Supabase**
   - In **SQL Editor**, run in order:
     - `supabase/migrations/001_stealth_support_schema.sql`
     - `supabase/migrations/002_bulletin_tickets_roles.sql` (tickets + `app_role` / `employee_id` on profiles)
   - **Authentication → Providers**: enable **Email**.
   - Copy **Project URL** and **anon public** key (**long `eyJ…` JWT** recommended for `supabase_flutter`).

2. **Environment**
   - Copy `assets/.env.example` to `assets/.env`.
   - Set `SUPABASE_URL`, `SUPABASE_ANON_KEY` (and optional `ANTHROPIC_MODEL`).
   - Never put the **database password** or **service_role** key in the app.

3. **Edge Function (required for web AI)**
   - Deploy `supabase/functions/anthropic-chat`.
   - Set `ANTHROPIC_API_KEY` in **Supabase secrets** (server-side), not in Flutter web env.

3. **Run**

   ```bash
   cd stealth_support_app
   flutter run
   ```

## In-app flow (bulletin)

1. **Welcome** — AI-style intro + what the app does (customer portal bullets).
2. **Profile & machine** — Name, phone, company, model, serial.
3. **Account** — Email + password → Supabase sign-up → profile saved → **main shell**.
4. **Bottom tabs** — Support (Claude chat), Guides (links + DIY placeholders), Tickets (tracking #), Training (machine-aware modules + ANSI/OSHA card), Account (role, employee ID, sign out, roadmap).

**Returning users** — Same chat thread + profile; optional **Sign in** from welcome screen.

## Web / API keys

Direct **Anthropic** calls from **web** may hit **CORS**; use an Edge Function or backend for production web.

## Vercel (GitHub → auto deploy)

One Vercel project (**Stealth Development → `customersupportapp`**) hosts both the Flutter web app at **`/`** and the Next.js admin at **`/admin`** (login at **`/login`**).

1. In [Vercel](https://vercel.com) → project **customersupportapp** → **Settings → Git**: connect **`Ryan19er/customersupportapp`**, production branch **`main`**.
2. **Settings → General → Root Directory**: set to **`admin-panel`** (required so Vercel detects Next.js; the full repo is still cloned, so the build can run `flutter build web` one level up).
3. **Settings → Environment Variables**: add the same keys as `admin-panel/.env.example` (especially `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`).
4. Push to **`main`** — Vercel runs `npm run build:vercel` in `admin-panel` (Flutter web bundle + Next build).

Details: `admin-panel/README.md`.
