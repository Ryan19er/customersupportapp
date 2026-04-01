import 'package:supabase_flutter/supabase_flutter.dart';

// Registration path for this project: the **deployed app** (your site) calls Supabase Auth with the
// anon key — same as every Supabase + client app. Email/password are stored in Supabase’s auth
// database; `profiles` / chat rows use that user id. There is no separate “website API” unless you add one.

/// **One** `signUp` call per submit — no automatic `signInWithPassword` after it.
/// A follow-up sign-in used to run in the same tap and could trigger Supabase’s auth rate limit
/// (“too many attempts”) even though the user only pressed send once.
///
/// Returns `session` from the response when the project returns a session (typical when email
/// confirmation is off). If there is no session (e.g. confirmation required), returns null —
/// user can use **Sign in** after confirming, or adjust project settings.
Future<Session?> signUpWithSession({
  required SupabaseClient client,
  required String email,
  required String password,
}) async {
  final authResponse = await client.auth.signUp(
    email: email,
    password: password,
  );
  if (authResponse.session != null) {
    return authResponse.session;
  }
  return client.auth.currentSession;
}
