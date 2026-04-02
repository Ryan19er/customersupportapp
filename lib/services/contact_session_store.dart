import 'package:shared_preferences/shared_preferences.dart';

/// Remembers which **saved contact row** this device is using (no password, no login).
/// Optionally remembers the active [support_chat_sessions] id for "continue this chat".
class ContactSessionStore {
  static const _kContactId = 'stealth_contact_id';
  static const _kSessionId = 'stealth_support_session_id';

  static Future<String?> getContactId() async {
    final p = await SharedPreferences.getInstance();
    return p.getString(_kContactId);
  }

  static Future<void> setContactId(String id) async {
    final p = await SharedPreferences.getInstance();
    await p.setString(_kContactId, id);
  }

  /// Active chat thread for this device (optional). Cleared when starting a new conversation.
  static Future<String?> getSessionId() async {
    final p = await SharedPreferences.getInstance();
    return p.getString(_kSessionId);
  }

  static Future<void> setSessionId(String id) async {
    final p = await SharedPreferences.getInstance();
    await p.setString(_kSessionId, id);
  }

  static Future<void> clearSessionId() async {
    final p = await SharedPreferences.getInstance();
    await p.remove(_kSessionId);
  }

  static Future<void> clear() async {
    final p = await SharedPreferences.getInstance();
    await p.remove(_kContactId);
    await p.remove(_kSessionId);
  }
}
