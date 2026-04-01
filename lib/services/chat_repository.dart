import 'package:supabase_flutter/supabase_flutter.dart';

import '../models/customer_profile.dart';
import '../models/stored_chat_message.dart';
import 'contact_session_store.dart';

/// Persists profile fields + chat messages so threads and AI context survive sessions.
///
/// **Contact mode** (`contactId` set): `chat_contacts` + `support_chat_*` — no login.
/// **Auth mode** (`contactId` null): legacy `profiles` + `chat_sessions` / `chat_messages`.
class ChatRepository {
  ChatRepository(this._client, {this.contactId});

  final SupabaseClient _client;
  final String? contactId;

  bool get _contactMode => contactId != null;

  String? get _userId => _client.auth.currentUser?.id;

  static String _normalizeName(String s) =>
      s.trim().toLowerCase().replaceAll(RegExp(r'\s+'), ' ');
  static String _normalizeEmail(String s) => s.trim().toLowerCase();
  static String _normalizePhone(String s) => s.replaceAll(RegExp(r'[^0-9]'), '');

  /// Finds an existing contact row by same name + email + phone.
  static Future<String?> findExistingContactId({
    required SupabaseClient client,
    required String fullName,
    required String email,
    required String phone,
  }) async {
    final normName = _normalizeName(fullName);
    final normEmail = _normalizeEmail(email);
    final normPhone = _normalizePhone(phone);
    final row = await client
        .from('chat_contacts')
        .select('id')
        .eq('normalized_name', normName)
        .eq('normalized_email', normEmail)
        .eq('normalized_phone', normPhone)
        .limit(1)
        .maybeSingle();
    if (row == null) return null;
    return row['id'] as String?;
  }

  /// Creates a saved contact row (name, email, phone). Caller should persist [ContactSessionStore.setContactId].
  static Future<String> createContact({
    required SupabaseClient client,
    required String fullName,
    required String email,
    required String phone,
  }) async {
    final row = await client.from('chat_contacts').insert({
      'full_name': fullName.trim(),
      'email': email.trim(),
      'phone': phone.trim(),
    }).select('id').single();
    return row['id'] as String;
  }

  Future<CustomerProfile?> fetchProfile() async {
    if (_contactMode) {
      final row = await _client
          .from('chat_contacts')
          .select()
          .eq('id', contactId!)
          .maybeSingle();
      if (row == null) return null;
      return CustomerProfile.fromChatContact(Map<String, dynamic>.from(row));
    }
    final uid = _userId;
    if (uid == null) return null;
    final row = await _client.from('profiles').select().eq('id', uid).maybeSingle();
    if (row == null) return null;
    return CustomerProfile.fromMap(Map<String, dynamic>.from(row));
  }

  /// Saves onboarding fields (auth + `profiles` only).
  Future<void> completeOnboarding({
    String? fullName,
    String? contactEmail,
    required String phone,
    String? companyName,
    required String machineModel,
    required String machineSerial,
  }) async {
    final uid = _userId;
    if (uid == null) throw StateError('Not signed in');
    final co = companyName?.trim();
    final fn = fullName?.trim();
    final ce = contactEmail?.trim();
    await _client.from('profiles').upsert(
      {
        'id': uid,
        if (fn != null && fn.isNotEmpty) 'full_name': fn,
        if (ce != null && ce.isNotEmpty) 'contact_email': ce,
        'phone': phone.trim(),
        'company_name': (co == null || co.isEmpty) ? null : co,
        'machine_model': machineModel.trim(),
        'machine_serial': machineSerial.trim(),
        'onboarding_completed_at': DateTime.now().toUtc().toIso8601String(),
      },
      onConflict: 'id',
    );
  }

  Future<String> getOrCreateSessionId() async {
    if (_contactMode) {
      final existing = await _client
          .from('support_chat_sessions')
          .select('id')
          .eq('contact_id', contactId!)
          .order('updated_at', ascending: false)
          .limit(1)
          .maybeSingle();

      if (existing != null) {
        return existing['id'] as String;
      }

      final inserted = await _client
          .from('support_chat_sessions')
          .insert({'contact_id': contactId!})
          .select('id')
          .single();
      return inserted['id'] as String;
    }

    final uid = _userId;
    if (uid == null) throw StateError('Not signed in');

    final existing = await _client
        .from('chat_sessions')
        .select('id')
        .eq('user_id', uid)
        .order('updated_at', ascending: false)
        .limit(1)
        .maybeSingle();

    if (existing != null) {
      return existing['id'] as String;
    }

    final inserted = await _client
        .from('chat_sessions')
        .insert({'user_id': uid})
        .select('id')
        .single();
    return inserted['id'] as String;
  }

  Future<List<StoredChatMessage>> loadMessages(String sessionId) async {
    if (_contactMode) {
      final rows = await _client
          .from('support_chat_messages')
          .select('id, session_id, role, content, created_at')
          .eq('session_id', sessionId)
          .order('created_at', ascending: true);

      final list = rows as List<dynamic>;
      return list
          .map((e) => StoredChatMessage.fromMap(Map<String, dynamic>.from(e as Map)))
          .toList();
    }

    final uid = _userId;
    if (uid == null) return [];

    final rows = await _client
        .from('chat_messages')
        .select('id, session_id, role, content, created_at')
        .eq('session_id', sessionId)
        .order('created_at', ascending: true);

    final list = rows as List<dynamic>;
    return list
        .map((e) => StoredChatMessage.fromMap(Map<String, dynamic>.from(e as Map)))
        .toList();
  }

  Future<void> appendExchange({
    required String sessionId,
    required String userText,
    required Future<String> Function(List<StoredChatMessage> prior, String userMessage) getAssistant,
  }) async {
    if (_contactMode) {
      await _client.from('support_chat_messages').insert({
        'session_id': sessionId,
        'role': 'user',
        'content': userText,
      });

      final all = await loadMessages(sessionId);
      if (all.isEmpty || all.last.role != 'user') {
        throw StateError('Expected user message at end of thread');
      }

      final prior = all.sublist(0, all.length - 1);
      final reply = await getAssistant(prior, userText);

      await _client.from('support_chat_messages').insert({
        'session_id': sessionId,
        'role': 'assistant',
        'content': reply,
      });
      return;
    }

    final uid = _userId;
    if (uid == null) throw StateError('Not signed in');

    await _client.from('chat_messages').insert({
      'session_id': sessionId,
      'role': 'user',
      'content': userText,
    });

    final all = await loadMessages(sessionId);
    if (all.isEmpty || all.last.role != 'user') {
      throw StateError('Expected user message at end of thread');
    }

    final prior = all.sublist(0, all.length - 1);
    final reply = await getAssistant(prior, userText);

    await _client.from('chat_messages').insert({
      'session_id': sessionId,
      'role': 'assistant',
      'content': reply,
    });
  }

  Future<void> signOut() async {
    if (_contactMode) {
      await ContactSessionStore.clear();
      return;
    }
    await _client.auth.signOut();
  }

  Future<void> insertChatMessage({
    required String sessionId,
    required String role,
    required String content,
  }) async {
    if (_contactMode) {
      await _client.from('support_chat_messages').insert({
        'session_id': sessionId,
        'role': role,
        'content': content,
      });
      return;
    }
    final uid = _userId;
    if (uid == null) throw StateError('Not signed in');
    await _client.from('chat_messages').insert({
      'session_id': sessionId,
      'role': role,
      'content': content,
    });
  }

  Future<void> updateMachineInfo({
    required String machineModel,
    required String machineSerial,
  }) async {
    if (_contactMode) {
      await _client.from('chat_contacts').update({
        'machine_model': machineModel.trim(),
        'machine_serial': machineSerial.trim(),
        'updated_at': DateTime.now().toUtc().toIso8601String(),
      }).eq('id', contactId!);
      return;
    }
    final uid = _userId;
    if (uid == null) throw StateError('Not signed in');
    await _client.from('profiles').update({
      'machine_model': machineModel.trim(),
      'machine_serial': machineSerial.trim(),
    }).eq('id', uid);
  }

  Future<List<Map<String, dynamic>>> listTickets() async {
    if (_contactMode) {
      return [];
    }
    final uid = _userId;
    if (uid == null) return [];
    try {
      final rows = await _client
          .from('support_tickets')
          .select()
          .eq('user_id', uid)
          .order('created_at', ascending: false);
      final list = rows as List<dynamic>;
      return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    } catch (_) {
      return [];
    }
  }

  Future<String?> createTicket({String? subject}) async {
    if (_contactMode) {
      return null;
    }
    final uid = _userId;
    if (uid == null) return null;
    final num = 'ST-${DateTime.now().millisecondsSinceEpoch}';
    try {
      final row = await _client.from('support_tickets').insert({
        'user_id': uid,
        'ticket_number': num,
        'subject': subject ?? 'Support request',
        'status': 'open',
      }).select('ticket_number').single();
      return row['ticket_number'] as String?;
    } catch (_) {
      return null;
    }
  }

  Future<void> updateRoleAndEmployee({
    required String appRole,
    String? employeeId,
  }) async {
    if (_contactMode) {
      return;
    }
    final uid = _userId;
    if (uid == null) throw StateError('Not signed in');
    try {
      await _client.from('profiles').update({
        'app_role': appRole,
        'employee_id': employeeId?.trim().isEmpty == true ? null : employeeId?.trim(),
      }).eq('id', uid);
    } catch (_) {}
  }
}
