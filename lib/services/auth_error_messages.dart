/// Optional tweaks to auth errors. **Always pass through the server’s real message** for debugging
/// (we used to replace rate-limit text with generic copy, which hid what Supabase actually returned).
String friendlyAuthErrorMessage(String message) {
  final lower = message.toLowerCase();
  if (lower.contains('already registered') ||
      lower.contains('user already registered') ||
      lower.contains('already exists')) {
    return 'An account with this email already exists — tap Sign in on this app.';
  }
  return message;
}
