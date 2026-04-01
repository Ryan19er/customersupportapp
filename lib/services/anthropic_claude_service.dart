import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../config/stealth_system_prompt.dart';

/// Real [Anthropic Messages API](https://docs.anthropic.com/en/api/messages) client.
/// No mock responses — every reply comes from HTTP POST to api.anthropic.com.
class ChatTurn {
  const ChatTurn({required this.role, required this.text});
  final String role; // "user" | "assistant"
  final String text;
}

class AnthropicApiException implements Exception {
  AnthropicApiException(this.message, {this.statusCode});
  final String message;
  final int? statusCode;
  @override
  String toString() => 'AnthropicApiException: $message';
}

class AnthropicClaudeService {
  AnthropicClaudeService({
    required SupabaseClient client,
    required this.model,
    this.maxTokens = 4096,
    this.systemPrompt = kStealthFullSystemPrompt,
  }) : _client = client;

  final SupabaseClient _client;
  final String model;
  final int maxTokens;
  final String systemPrompt;

  /// Sends the full conversation (excluding the pending user message — pass it as [nextUserMessage]).
  /// [additionalSystemContext] is appended to the base Stealth prompt (e.g. customer + machine facts).
  /// [systemPromptOverride] replaces the default product KB prompt (e.g. lean onboarding chat).
  /// Anthropic expects **alternating** `user` / `assistant` turns. Merge consecutive
  /// same-role lines (e.g. validation retries) so the API does not return `messages` errors.
  static List<ChatTurn> _mergeAlternating(List<ChatTurn> turns) {
    final out = <ChatTurn>[];
    for (final t in turns) {
      if (t.text.trim().isEmpty) continue;
      if (out.isEmpty) {
        out.add(ChatTurn(role: t.role, text: t.text.trim()));
        continue;
      }
      final last = out.last;
      if (last.role == t.role) {
        out[out.length - 1] = ChatTurn(
          role: last.role,
          text: '${last.text}\n\n${t.text.trim()}',
        );
      } else {
        out.add(ChatTurn(role: t.role, text: t.text.trim()));
      }
    }
    return out;
  }

  static Map<String, dynamic> _userMessagePayload(String text) {
    return {
      'role': 'user',
      'content': [
        {'type': 'text', 'text': text},
      ],
    };
  }

  static Map<String, dynamic> _assistantMessagePayload(String text) {
    return {
      'role': 'assistant',
      'content': [
        {'type': 'text', 'text': text},
      ],
    };
  }

  Future<String> complete({
    required List<ChatTurn> history,
    required String nextUserMessage,
    String additionalSystemContext = '',
    String? systemPromptOverride,
  }) async {
    var merged = _mergeAlternating([
      ...history,
      ChatTurn(role: 'user', text: nextUserMessage),
    ]);
    // API requires the sequence to start with a `user` message.
    while (merged.isNotEmpty && merged.first.role == 'assistant') {
      merged = merged.sublist(1);
    }

    final messages = <Map<String, dynamic>>[];
    for (final turn in merged) {
      if (turn.role == 'assistant') {
        messages.add(_assistantMessagePayload(turn.text));
      } else {
        messages.add(_userMessagePayload(turn.text));
      }
    }

    if (messages.isEmpty) {
      messages.add(_userMessagePayload(nextUserMessage.trim()));
    }

    final base = systemPromptOverride ?? systemPrompt;
    final system = additionalSystemContext.trim().isEmpty
        ? base
        : '$base\n\n${additionalSystemContext.trim()}';

    try {
      final response = await _client.functions.invoke(
        'anthropic-chat',
        body: {
          'model': model,
          'max_tokens': maxTokens,
          'system': system,
          'messages': messages,
          'client': kIsWeb ? 'web' : 'native',
        },
      );

      final data = response.data;
      if (response.status < 200 || response.status >= 300) {
        throw AnthropicApiException(
          _extractError(data) ?? 'Anthropic proxy failed with HTTP ${response.status}',
          statusCode: response.status,
        );
      }
      if (data is Map && data['text'] is String) {
        return data['text'] as String;
      }
      throw AnthropicApiException('Unexpected proxy response: missing `text`');
    } catch (e) {
      if (e is AnthropicApiException) rethrow;
      if (kDebugMode) {
        debugPrint('Anthropic proxy invoke error: $e');
      }
      throw AnthropicApiException(
        'Could not reach AI service proxy. Ensure Supabase Edge Function `anthropic-chat` '
        'is deployed and `ANTHROPIC_API_KEY` is set in Supabase secrets.',
      );
    }
  }

  void dispose() {}

  static String? _extractError(dynamic data) {
    if (data is Map) {
      final err = data['error'];
      if (err != null) return err.toString();
      final msg = data['message'];
      if (msg != null) return msg.toString();
    }
    if (data is String && data.isNotEmpty) return data;
    return null;
  }
}
