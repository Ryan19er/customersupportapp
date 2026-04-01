import 'package:flutter_dotenv/flutter_dotenv.dart';

/// Reads `assets/.env` (bundled at build time). Never commit real secrets.
class EnvConfig {
  EnvConfig._();

  static String get supabaseUrl => dotenv.env['SUPABASE_URL']?.trim() ?? '';

  static String get supabaseAnonKey =>
      dotenv.env['SUPABASE_ANON_KEY']?.trim() ?? '';

  static String get anthropicModel {
    final m = dotenv.env['ANTHROPIC_MODEL']?.trim();
    if (m != null && m.isNotEmpty) return m;
    return 'claude-sonnet-4-6';
  }
}
