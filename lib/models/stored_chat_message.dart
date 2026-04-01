/// One row in `public.chat_messages`.
class StoredChatMessage {
  const StoredChatMessage({
    required this.id,
    required this.sessionId,
    required this.role,
    required this.content,
    required this.createdAt,
  });

  final String id;
  final String sessionId;
  final String role;
  final String content;
  final DateTime createdAt;

  factory StoredChatMessage.fromMap(Map<String, dynamic> row) {
    return StoredChatMessage(
      id: row['id'] as String,
      sessionId: row['session_id'] as String,
      role: row['role'] as String,
      content: row['content'] as String,
      createdAt: DateTime.parse(row['created_at'].toString()),
    );
  }
}
