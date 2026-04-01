import 'package:shared_preferences/shared_preferences.dart';

/// Remembers which **saved contact row** this device is using (no password, no login).
class ContactSessionStore {
  static const _kContactId = 'stealth_contact_id';

  static Future<String?> getContactId() async {
    final p = await SharedPreferences.getInstance();
    return p.getString(_kContactId);
  }

  static Future<void> setContactId(String id) async {
    final p = await SharedPreferences.getInstance();
    await p.setString(_kContactId, id);
  }

  static Future<void> clear() async {
    final p = await SharedPreferences.getInstance();
    await p.remove(_kContactId);
  }
}
