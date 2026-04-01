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
