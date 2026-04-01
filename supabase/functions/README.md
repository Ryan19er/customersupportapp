## Supabase Edge Function Setup

This app uses `anthropic-chat` as a secure server-side proxy for Anthropic.

### 1) Install/login Supabase CLI

```bash
brew install supabase/tap/supabase
supabase login
```

### 2) Link this project

```bash
supabase link --project-ref YOUR_PROJECT_REF
```

### 3) Set server secret (do NOT put in Flutter web env)

```bash
supabase secrets set ANTHROPIC_API_KEY=YOUR_REAL_ANTHROPIC_KEY
```

### 4) Deploy function

```bash
supabase functions deploy anthropic-chat
```

### 5) Verify from local terminal

```bash
curl -sS "https://YOUR_PROJECT_REF.supabase.co/functions/v1/anthropic-chat" \
  -H "apikey: YOUR_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer YOUR_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":[{"type":"text","text":"Say hello"}]}] }'
```

