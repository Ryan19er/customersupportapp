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

/// Evidence row displayed to staff/debug so they can see why the bot answered the way it did.
class EvidenceCitation {
  const EvidenceCitation({
    required this.idx,
    required this.type,
    required this.id,
    this.heading,
    this.productSlug,
    this.subsystem,
    this.score = 0.0,
  });
  final int idx;
  final String type; // chunk | canonical | snippet
  final String id;
  final String? heading;
  final String? productSlug;
  final String? subsystem;
  final double score;
}

/// Structured reply from the Anthropic proxy — keeps backward compat via [text].
class ClaudeReply {
  const ClaudeReply({
    required this.text,
    this.evidence = const [],
    this.resolvedProduct,
    this.auditId,
  });
  final String text;
  final List<EvidenceCitation> evidence;
  final String? resolvedProduct;
  final String? auditId;
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

  /// Detailed variant that also returns the evidence citations returned by the
  /// edge function. Flutter screens that want a Sources accordion should call
  /// this instead of [complete].
  Future<ClaudeReply> completeDetailed({
    required List<ChatTurn> history,
    required String nextUserMessage,
    String additionalSystemContext = '',
    String? systemPromptOverride,
    String? sessionId,
    String? sessionChannel,
    bool includeRuntimeContext = false,
  }) async {
    final raw = await _invoke(
      history: history,
      nextUserMessage: nextUserMessage,
      additionalSystemContext: additionalSystemContext,
      systemPromptOverride: systemPromptOverride,
      sessionId: sessionId,
      sessionChannel: sessionChannel,
      includeRuntimeContext: includeRuntimeContext,
    );
    return raw;
  }

  Future<String> complete({
    required List<ChatTurn> history,
    required String nextUserMessage,
    String additionalSystemContext = '',
    String? systemPromptOverride,
    String? sessionId,
    String? sessionChannel,
    bool includeRuntimeContext = false,
  }) async {
    final reply = await _invoke(
      history: history,
      nextUserMessage: nextUserMessage,
      additionalSystemContext: additionalSystemContext,
      systemPromptOverride: systemPromptOverride,
      sessionId: sessionId,
      sessionChannel: sessionChannel,
      includeRuntimeContext: includeRuntimeContext,
    );
    return reply.text;
  }

  Future<ClaudeReply> _invoke({
    required List<ChatTurn> history,
    required String nextUserMessage,
    String additionalSystemContext = '',
    String? systemPromptOverride,
    String? sessionId,
    String? sessionChannel,
    bool includeRuntimeContext = false,
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
          if (includeRuntimeContext && sessionId != null && sessionChannel != null)
            'resolver': {
              'session_id': sessionId,
              'session_channel': sessionChannel,
              'include_runtime_context': true,
            },
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
        final text = data['text'] as String;
        final evidenceList = data['evidence'];
        final List<EvidenceCitation> evidence = [];
        if (evidenceList is List) {
          for (final e in evidenceList) {
            if (e is! Map) continue;
            evidence.add(EvidenceCitation(
              idx: (e['idx'] as num?)?.toInt() ?? evidence.length + 1,
              type: e['type']?.toString() ?? 'chunk',
              id: e['id']?.toString() ?? '',
              heading: e['heading']?.toString(),
              productSlug: e['product_slug']?.toString(),
              subsystem: e['subsystem']?.toString(),
              score: (e['score'] as num?)?.toDouble() ?? 0.0,
            ));
          }
        }
        final meta = data['resolver_meta'];
        final resolved = (meta is Map) ? meta['product_slug']?.toString() : null;
        final auditId = (meta is Map) ? meta['audit_id']?.toString() : null;
        return ClaudeReply(
          text: text,
          evidence: evidence,
          resolvedProduct: resolved,
          auditId: auditId,
        );
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
